# Email Verification — Architecture Blueprint

> **What this is:** a context document, not an implementation guide. It describes the
> moving parts, the boundaries between them, and the decisions that have to be made.
> Bracketed items marked `[DECIDE]` are project-specific and intentionally unanswered.
>
> **Stack assumed:** Vite + React (SPA) · JavaScript API server · PostgreSQL

---

## 1. Scope

**In scope:** proving that a person who signed up controls the mailbox they claimed.

**Not in scope, but shares the same machinery:** password reset, email-change
confirmation, magic-link login. All three are "single-use token sent to a mailbox."
If more than one of these is planned, the token layer should be designed once with a
`purpose` discriminator rather than duplicated per feature.

**What verification does *not* prove:** that the person is who they say they are, that
the mailbox is theirs long-term, or that the address is disposable-free. It proves
mailbox access at one moment in time. Any product logic that assumes more is
mis-founded.

---

## 2. Trust boundary

The single most important structural fact:

```
  React SPA (untrusted)          API server (trusted)         Postgres
  ─────────────────────          ────────────────────         ────────
  displays state                 owns all state transitions   source of truth
  routes the user                validates every token
  never decides access           enforces every gate
```

The SPA is a rendering layer. It can *display* "your email is unverified," but it must
never be what *enforces* that. Any protected data must be refused by the API for an
unverified account, independent of what the client does. A blueprint that gets this
wrong produces a system where opening devtools grants access.

Corollary: verification status must be readable by the API on every request that needs
it — either from the session/JWT claims or from a user lookup. `[DECIDE]` which, and
if from a token claim, how stale that claim is allowed to be after verification flips.

---

## 3. Domain model

### 3.1 Account verification state

A user account occupies exactly one state:

| State | Meaning | Can authenticate? | Can use app? |
|---|---|---|---|
| `unverified` | signed up, mailbox unproven | `[DECIDE]` | no / limited |
| `verified` | mailbox proven | yes | yes |

There is deliberately no `pending` state. "An email is in flight" is a property of the
*token*, not of the account — modelling it on the account creates ambiguity when a user
requests a second email while the first is still valid.

`[DECIDE]` — **Can an unverified user hold a session at all?** Two coherent postures:

- **Login-blocked:** verification is a precondition for authentication. Simpler to reason
  about; harsher UX; the "check your email" screen must survive page refresh without a
  session, which means it can't be session-backed.
- **Login-allowed, feature-gated:** unverified users get a session but a restricted
  surface. Better UX and lets you show a persistent banner; requires every protected
  endpoint to carry the gate, so the gate must be default-on middleware rather than
  opt-in per route.

The rest of this document works under either; where the choice matters it is flagged.

### 3.2 Token

A verification token is a short-lived, single-use, bearer credential. Properties that
matter architecturally:

- **Unguessable** — high-entropy random, not derived from user data. Nothing about the
  user should be recoverable or predictable from it.
- **Not stored in recoverable form** — the database holds a one-way hash. A database
  leak must not yield working links. (This is why "encrypt the token" is the wrong
  frame: encryption is reversible by design, which is the opposite of the goal.)
- **Expiring** — carries an absolute expiry. `[DECIDE]` duration; 24h is conventional.
- **Single-use** — consumption is recorded, and a consumed token is inert.
- **Bound to one user** — and, if the token layer is shared, to one `purpose`.

Tokens live in their own relation, not as columns on the user row. A user may
legitimately have several outstanding tokens (they clicked "resend" twice), and token
rows are garbage that should be reapable without touching user data.

Sketch, not schema:

```
verification_tokens
  token_hash   ← primary key, the lookup handle
  user_id      ← FK, cascade on user delete
  purpose      ← if the layer is shared
  expires_at
  used_at      ← null until consumed; the single-use record
  created_at   ← for resend throttling
```

`[DECIDE]` — whether "consumed" is `used_at` timestamp or row deletion. Timestamp
preserves the ability to distinguish *"already used"* from *"never existed"*, which is
better UX and better forensics; deletion is tidier. Retention favours the timestamp
plus a cleanup job.

---

## 4. Surface map

Endpoints described as **contracts** — inputs, effects, and what each must refuse.

### `POST /auth/signup`
Creates the account in `unverified`, mints a token, hands off to the mail sender.

- Effect on user: row created, unverified.
- Effect on tokens: one row.
- **Must not** block the response on mail delivery succeeding — see §6.
- **Must not** reveal whether the address was already registered. `[DECIDE]` the
  policy here; the leak-free version returns an identical response either way and
  sends a *different* email to already-registered addresses.

### `GET|POST /auth/verify`
Consumes a token. The one endpoint that flips account state.

- Input: the raw token.
- Refuses: unknown hash, expired, already-consumed. These three are distinguishable
  internally and `[DECIDE]` whether they are distinguishable to the user — "this link
  already got used" is far better UX than a generic failure, and leaks little.
- Effect: user → `verified`, token → consumed. Both in one transaction; a partial
  application here is the worst failure mode in the system.
- Idempotency: a second call with the same token must not error destructively. Treat
  "already consumed by this same user" as success-shaped if that user is already
  verified.

`[DECIDE]` — **GET or POST?** GET makes the emailed link work by simply clicking it.
But mail scanners and link-preview bots fetch URLs in emails, which will consume tokens
before the human clicks. The mitigation is that the emailed link lands on a *frontend
route* that then issues a POST — see §5. Choosing GET-consumes-directly means accepting
occasional "already used" reports from users who never clicked.

### `POST /auth/resend`
Issues a fresh token for an unverified account.

- **Must** be throttled — per-address and per-IP. This is the endpoint that turns your
  service into someone else's spam cannon.
- `[DECIDE]` whether issuing a new token invalidates outstanding ones. Invalidating is
  cleaner mentally; not invalidating avoids the "I clicked the older email" support
  ticket. Both are defensible.
- Must not reveal account existence.

### `GET /me` (or whatever exposes session state)
Must include verification status. This is what the SPA renders from, and what the
"check your email" screen polls or refetches against.

---

## 5. Frontend shape (Vite/React specifics)

The SPA introduces two concerns a server-rendered app wouldn't have.

**The verify link is a deep link into a client-routed app.** The emailed URL points at
a path the React router owns. That means:

- The Vite dev server and the production host must both serve `index.html` for unknown
  paths, or the link 404s outside of development. This is a hosting/config decision,
  not application code, and it is the most common way this feature breaks in production
  while working perfectly locally.
- The token arrives as a URL query param, which means it lands in browser history,
  and potentially in the `Referer` header of any subsequent outbound request from that
  page. Clearing it from the URL after read (`replaceState`) is the usual mitigation.
  `[DECIDE]` whether that matters for your threat model.

**The route is a state machine, not a page.** `/verify` should render:

```
  reading token from URL
        ↓
  submitting → success  → redirect [DECIDE: to login? to app? auto-session?]
             → expired  → offer resend
             → consumed → "already verified, go log in"
             → invalid  → dead end, offer signup/support
             → network  → retryable, do NOT report as invalid
```

Conflating the last two is a real bug: a failed fetch is not a bad token, and telling a
user their link is invalid when their wifi dropped sends them into a resend loop.

**The "check your email" screen** is the other half. It is shown after signup and needs
to survive a refresh. If login is blocked for unverified users, this screen has no
session to read from — so its state must come from somewhere else `[DECIDE]`: a URL
param, a short-lived client-side flag, or making it a purely static page with a
"resend" form that takes the address as input.

**Environment config.** The base URL used to build the emailed link is server-side
config, not `import.meta.env`. It differs per environment and getting it from the
request `Host` header is an open redirect waiting to happen. Pin it in server config.

---

## 6. Mail delivery as an external dependency

Treat the mail provider as an unreliable third party, because it is. Structurally:

- **Delivery is not part of the signup transaction.** The account and token are
  committed; the send is a side effect that may fail. If it fails the user is not
  broken — they are an unverified user with a working resend button. Coupling the two
  produces failed signups during provider outages.
- `[DECIDE]` — fire-and-forget vs. a queue/outbox. At low volume, awaiting the send
  with a caught error is acceptable and much simpler. A queue becomes worth it when
  send latency starts affecting response times or when retries matter.
- **Deliverability is not a code problem.** SPF, DKIM, DMARC, sender reputation, and
  provider sandbox limits determine whether this feature works at all, and none of them
  live in the repo. Budget for them separately.
- Log the provider's message ID against the send. When a user insists no email arrived,
  this is the only thing that distinguishes "we never sent it" from "it's in their spam."

---

## 7. Failure modes worth designing against

| Failure | Consequence | Where it's addressed |
|---|---|---|
| Mail scanner prefetches the link | Token consumed before user clicks | §4 GET-vs-POST |
| User clicks an old email after resend | "Invalid link" on a legitimate action | §4 resend invalidation policy |
| DB dump leaks tokens | Attacker verifies arbitrary accounts | §3.2 hash-at-rest |
| Resend endpoint abused | Your domain gets blocklisted | §4 throttling |
| Unverified accounts accumulate | Table bloat; address squatting | `[DECIDE]` reaping policy |
| Verify partially applied | User verified, token still live (or worse, inverse) | §4 single transaction |
| SPA fallback misconfigured | Every emailed link 404s in prod only | §5 hosting config |
| Verification checked only client-side | Gate is cosmetic | §2 trust boundary |

---

## 8. Open decisions, collected

Fill these in as the product takes shape. They are listed together because several
interact — the login posture in particular constrains the "check your email" screen and
the gating middleware.

1. Login posture for unverified accounts — blocked, or allowed-and-gated? (§3.1)
2. Token lifetime. (§3.2)
3. Consumption recorded as timestamp or deletion; retention/reaping policy. (§3.2)
4. Account-existence disclosure policy on signup and resend. (§4)
5. Verify via GET or via frontend-route-then-POST. (§4)
6. Does resend invalidate outstanding tokens? (§4)
7. Post-verification destination — login screen, app, or auto-authenticate? (§5)
8. Where the "check your email" screen gets its state. (§5)
9. Synchronous send vs. queue. (§6)
10. Is the token layer shared with password reset / email change from the start? (§1)

---

## 9. Definition of done

Not a test plan — a list of properties that should hold once this is built.

- An unverified account cannot reach protected data **with the SPA bypassed entirely**
  (curl against the API).
- A token works exactly once, and the second attempt produces a distinct, non-alarming
  outcome.
- An expired token produces a path forward (resend), not a dead end.
- Signup succeeds even when the mail provider is down.
- The emailed link works in production, from a mobile mail client, in a browser with no
  existing session.
- Nothing in the database can be used to forge a valid link.
