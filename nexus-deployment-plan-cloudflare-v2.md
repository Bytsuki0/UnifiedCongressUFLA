# NEXUS — Deployment Plan (Cloudflare Pages, Direct Upload)

**Architecture:** static React/TypeScript frontend on Cloudflare Pages, Supabase retained as backend (Postgres + Auth + Storage).

**Deploy model:** direct upload. The bundle is built on the developer machine and pushed with `wrangler`. No Git integration, no CI, no server.

**Domain:** `ciuflaictin.com.br` (temporary, congress-duration only).

**Scope:** this congress only. Data sovereignty migration deferred to Phase 2.

---

## How to use this document

Each stage describes an **end state** — the condition the system must be in — not a procedure. Order matters: a stage is not started until the previous stage's verification passes.

Every stage is split into two tracks:

- **Human track** — work only a person can do: dashboards, decisions, waiting on propagation, testing as a real user, handover. Cannot be scripted.
- **Code track** — files to write and adaptations to make in the NEXUS repository. Committed, reviewable, repeatable.

The two tracks within a stage can usually run in parallel. Each track has its own end state and verification. **Rules** apply to the whole stage and hold from that point onward.

A checkbox is ticked only after its verification actually ran. "It should work" is not a verification.

---

## Architecture

```
Browser
  ├── HTTPS ──> Cloudflare Pages       (static bundle only: HTML/JS/CSS)
  └── HTTPS ──> xxxx.supabase.co       (Postgres, Auth, Storage)
```

No application server exists anywhere. The browser talks to Supabase directly with the **anon key**, and all access control is enforced by Row Level Security.

**Consequence:** RLS is the only thing between an anonymous visitor and the submission data. Stage 4 is not optional.

---

## Repository additions

Everything the code track produces, in one view:

```
nexus/
├── .env.production            # anon key only — gitignored
├── .env.example               # committed, no real values
├── public/
│   ├── _redirects             # SPA fallback
│   └── _headers               # security + cache headers
├── src/lib/
│   ├── api.ts                 # single Supabase access module
│   └── config.ts              # env validation, build stamp
├── sql/
│   └── rls-audit.sql          # policy audit queries
├── scripts/
│   ├── check-dns.sh
│   ├── verify-deploy.sh
│   ├── rls-probe.mjs          # automated RLS attack tests
│   └── backup.sh
└── deploy.sh
```

---

## Stage 1 — Domain under Cloudflare control

### Human track

**End state**

- [ ] `ciuflaictin.com.br` added as a zone in the Cloudflare account, Free plan.
- [ ] Registro.br nameservers changed to the two Cloudflare assigned to this zone.
- [ ] Zone status reads **Active**, not "Pending Nameserver Update".
- [ ] Cloudflare account email is one at least one other person can reach — a lab or project address, not a personal inbox that dies at graduation.
- [ ] Domain expiry date recorded and confirmed past the congress date.

**Verification**

Dashboard shows Active, and `./scripts/check-dns.sh` (below) exits 0.

### Code track

**End state**

- [ ] `scripts/check-dns.sh` exists and exits non-zero while propagation is incomplete.

```bash
#!/usr/bin/env bash
# scripts/check-dns.sh — is the domain actually on Cloudflare yet?
set -euo pipefail

DOMAIN="ciuflaictin.com.br"
NS=$(dig NS "$DOMAIN" +short)

echo "$NS"

if echo "$NS" | grep -qi "ns.cloudflare.com"; then
  echo "OK: zone is on Cloudflare"
else
  echo "NOT READY: still on old nameservers — do not proceed to Stage 5" >&2
  exit 1
fi
```

**Verification**

```bash
chmod +x scripts/check-dns.sh
./scripts/check-dns.sh
```

Run it before Stage 5, not once at the start. Propagation takes hours and sometimes longer.

### Rules

- No Pages custom domain is attempted until this exits 0. A custom domain cannot attach to a zone Cloudflare does not control.
- The registrar account credentials are recorded in the same place as the Cloudflare and Supabase credentials — see Stage 6.

---

## Stage 2 — Build produces a shippable, safe bundle

### Human track

**End state**

- [ ] Supabase URL and `anon` key copied from the dashboard into `.env.production`.
- [ ] `service_role` key confirmed never committed. If it ever was — rotate it in the Supabase dashboard now, before anything else.
- [ ] Decision made and recorded: does `www.ciuflaictin.com.br` serve the site, or redirect to apex? (Needed in Stage 5; deciding it now avoids a scramble later.)

**Verification**

In the Supabase dashboard, the key in `.env.production` is listed under `anon` / `public`. Confirm by eye — this is a two-second check that prevents the worst possible outcome in this plan.

### Code track

**End state**

- [ ] `public/_redirects` and `public/_headers` exist and land in `dist/` after a build.
- [ ] `.env.production` is gitignored; `.env.example` is committed with placeholder values.
- [ ] `src/lib/config.ts` fails the build loudly if an env var is missing.
- [ ] `src/lib/api.ts` is the only file in the repo containing `supabase.from(` or `supabase.storage`.
- [ ] The upload component enforces `application/pdf` and a 10 MB cap before the request is sent.
- [ ] `npm ci && npm run build` completes clean.

`public/_redirects`:

```
/*    /index.html   200
```

`public/_headers`:

```
/*
  X-Frame-Options: SAMEORIGIN
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin

/index.html
  Cache-Control: no-cache, no-store, must-revalidate

/assets/*
  Cache-Control: public, max-age=31536000, immutable
```

`src/lib/config.ts`:

```ts
const required = (name: string): string => {
  const value = import.meta.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
};

export const SUPABASE_URL = required('VITE_SUPABASE_URL');
export const SUPABASE_ANON_KEY = required('VITE_SUPABASE_ANON_KEY');

// Stamped at build time — lets deploy verification confirm the live bundle
export const BUILD_ID = __BUILD_ID__;
```

In `vite.config.ts`:

```ts
define: {
  __BUILD_ID__: JSON.stringify(
    new Date().toISOString().replace(/[:.]/g, '-')
  ),
}
```

Render `BUILD_ID` somewhere in the DOM — a footer, or a `<meta name="build-id">`. Stage 3 and Stage 6 both depend on being able to read it from outside.

**Adaptations needed in existing code**

1. **Consolidate Supabase calls.** Every `supabase.from(...)` and `supabase.storage.from(...)` scattered through components moves behind named functions in `src/lib/api.ts` (`getSubmission`, `listMySubmissions`, `uploadPaper`, …). This is the single highest-value refactor in the plan: it makes Phase 2 a change to one file, and it makes Stage 4's audit tractable because every query is in one place to read.

2. **Upload validation.** Client-side MIME and size checks in the upload component. Client-side checks are a UX affordance, not security — the bucket config in Stage 4 is the real enforcement.

3. **Router.** Confirm `BrowserRouter` has no `basename` set, since the app is served from the domain root.

**Verification**

```bash
npm ci && npm run build

grep -r "service_role" dist/                      # must return nothing
test -f dist/_redirects && echo "redirects OK"
test -f dist/_headers   && echo "headers OK"

# Consolidation check — should list only src/lib/api.ts
grep -rl "supabase\.from(\|supabase\.storage" src/
```

All four must pass.

### Rules

- The `service_role` key never enters `.env*`, the repo, or a bundle.
- The `anon` key being publicly readable is expected and safe **only** while RLS is correct.
- `_redirects` is mandatory. Without it, refreshing `/submissions/123` returns 404 — Pages has no nginx `try_files` equivalent.
- No new `supabase.from(...)` outside `src/lib/api.ts`, ever. The grep above is the enforcement.

---

## Stage 3 — Site live on the Pages preview URL

### Human track

**End state**

- [ ] `npx wrangler login` completed; the CLI is authenticated against the right account.
- [ ] Pages project `nexus` created via direct upload (**not** Git-connected).
- [ ] Site loads at `https://nexus.pages.dev`.
- [ ] With DevTools open: requests to `xxxx.supabase.co` return 200, no CORS or 401 errors.
- [ ] Deployed at least twice, so the deployment history has a previous entry — rollback is confirmed available, and you know where the button is.

**Verification**

Browser test above, plus `./scripts/verify-deploy.sh https://nexus.pages.dev`.

### Code track

**End state**

- [ ] `scripts/verify-deploy.sh` exists and checks a live URL end to end.

```bash
#!/usr/bin/env bash
# scripts/verify-deploy.sh <url> [expected-build-id]
set -euo pipefail

URL="${1:?usage: verify-deploy.sh <url> [build-id]}"
EXPECTED="${2:-}"
fail=0

check() {
  local desc="$1" actual="$2" want="$3"
  if [ "$actual" = "$want" ]; then
    echo "  OK   $desc"
  else
    echo "  FAIL $desc (got: $actual, want: $want)" >&2
    fail=1
  fi
}

code() { curl -s -o /dev/null -w "%{http_code}" "$1"; }

echo "Verifying $URL"
check "root responds"        "$(code "$URL/")"                 "200"
check "SPA deep route"       "$(code "$URL/submissions/123")"  "200"

if curl -sI "$URL/" | grep -qi "x-frame-options"; then
  echo "  OK   security headers present"
else
  echo "  FAIL security headers missing — check _headers reached dist/" >&2
  fail=1
fi

if [ -n "$EXPECTED" ]; then
  if curl -s "$URL/" | grep -q "$EXPECTED"; then
    echo "  OK   live build matches $EXPECTED"
  else
    echo "  FAIL live build is stale — purge cache and recheck" >&2
    fail=1
  fi
fi

exit $fail
```

**Verification**

```bash
chmod +x scripts/verify-deploy.sh
npx wrangler pages deploy dist/ --project-name=nexus
./scripts/verify-deploy.sh https://nexus.pages.dev
```

The deep-route check is the one that catches a missing `_redirects`, and it is the failure most likely to reach real users.

### Rules

- The preview URL is used for all testing until Stage 5 passes. Nothing is announced to participants before then.
- Every deploy is a full `dist/` upload. No partial or in-place edits of a live site.
- Nothing is deployed from a `dist/` that was not produced by the current `npm run build`. No hand-edited files inside `dist/`.

---

## Stage 4 — Supabase hardened

Independent of Stages 1–3; start it now, in parallel. It is the stage that actually protects the data.

### Human track

**End state**

- [ ] Site URL set to `https://ciuflaictin.com.br`; `https://ciuflaictin.com.br/**` added to Redirect URLs.
- [ ] Storage bucket set to **private**, MIME restricted to `application/pdf`, file size capped at 10 MB in the bucket config.
- [ ] Plan confirmed not to pause for inactivity before the deadline.
- [ ] `expected submissions × max PDF size` checked against the storage quota, with headroom.
- [ ] Project region noted (relevant to the data-location limitation below).
- [ ] Two test accounts created — Author A and Author B — and retained for the duration.
- [ ] Every row of the policy listing read, not skimmed. Each policy's intent confirmed against what it actually says.

**Verification — manual, with the two test accounts**

- [ ] Anonymous client cannot `select` from the submissions table
- [ ] Author A cannot read Author B's submission
- [ ] Author A cannot `update` or `delete` Author B's submission
- [ ] Non-reviewer accounts cannot read review data
- [ ] A bare public URL to a stored PDF is denied
- [ ] Author A cannot download Author B's PDF via a constructed storage path
- [ ] If double-blind review applies: reviewer accounts cannot read author identity fields

### Code track

**End state**

- [ ] `sql/rls-audit.sql` exists and its first query returns zero rows.
- [ ] `scripts/rls-probe.mjs` exists and every probe reports DENIED.

`sql/rls-audit.sql`:

```sql
-- 1. Tables without RLS enabled. MUST return zero rows.
--    A policy on a table with RLS disabled does nothing at all.
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public' AND rowsecurity = false;

-- 2. Every policy, for line-by-line review.
SELECT tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- 3. Tables with RLS enabled but no policies at all — locked to everyone,
--    which is safe but usually a mistake worth knowing about.
SELECT t.tablename
FROM pg_tables t
LEFT JOIN pg_policies p
  ON p.schemaname = t.schemaname AND p.tablename = t.tablename
WHERE t.schemaname = 'public' AND t.rowsecurity = true
GROUP BY t.tablename
HAVING count(p.policyname) = 0;
```

`scripts/rls-probe.mjs` — an automated attacker using the public anon key:

```js
// node scripts/rls-probe.mjs
// Confirms the anon key cannot reach data it should not reach.
import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_ANON_KEY;
const anon = createClient(url, key);

let failures = 0;

const mustBeDenied = async (label, fn) => {
  const { data, error } = await fn();
  const denied = error !== null || !data || data.length === 0;
  console.log(`  ${denied ? 'OK  ' : 'FAIL'} ${label}`);
  if (!denied) {
    console.error(`       leaked ${data.length} row(s)`);
    failures++;
  }
};

console.log('Anonymous probes:');
await mustBeDenied('cannot read submissions', () =>
  anon.from('submissions').select('*').limit(1));
await mustBeDenied('cannot read reviews', () =>
  anon.from('reviews').select('*').limit(1));
await mustBeDenied('cannot read profiles', () =>
  anon.from('profiles').select('*').limit(1));

// Cross-author probe: sign in as Author A, attempt to read Author B's row.
const a = createClient(url, key);
await a.auth.signInWithPassword({
  email: process.env.TEST_A_EMAIL,
  password: process.env.TEST_A_PASSWORD,
});
console.log('Author A probes:');
await mustBeDenied("cannot read Author B's submission", () =>
  a.from('submissions').select('*').eq('author_id', process.env.TEST_B_ID));

process.exit(failures === 0 ? 0 : 1);
```

**Adaptations needed**

Add table names to the probe list as the schema grows. A new table with no probe is a table nobody has tested.

**Verification**

```bash
psql "$SUPABASE_CONNECTION_STRING" -f sql/rls-audit.sql
node scripts/rls-probe.mjs
```

Query 1 returns zero rows; the probe exits 0.

### Rules

- Reading a policy is not testing a policy. Both tracks run — the script catches regressions, the human list catches things the script does not model.
- Any schema or policy change re-triggers **both** tracks. There is no "small change" exemption.
- The probe script never uses the `service_role` key. Its entire value is that it holds exactly what an attacker holds.

---

## Stage 5 — Custom domain live

### Human track

**End state**

- [ ] `ciuflaictin.com.br` attached as a custom domain to the Pages project, status **Active**.
- [ ] The `www` decision from Stage 2 implemented (serve, or redirect to apex).
- [ ] Certificate issued — this is not instantaneous; allow for it.
- [ ] Full auth loop passed in a browser: register a new account → confirmation email arrives → link clicked → lands back on `ciuflaictin.com.br` logged in.

**Verification**

The auth loop above, performed by hand. It is the check that catches a mismatched Supabase Site URL, and it **fails silently** if skipped — links simply redirect to the wrong place and users assume the system is broken.

### Code track

**End state**

- [ ] No new code. `scripts/verify-deploy.sh` from Stage 3 is reused against the real domain, plus a certificate check.

**Verification**

```bash
./scripts/check-dns.sh
./scripts/verify-deploy.sh https://ciuflaictin.com.br

# HTTP must redirect to HTTPS
curl -sI http://ciuflaictin.com.br | head -1     # 301 or 308

# Certificate must outlast the congress
echo | openssl s_client -connect ciuflaictin.com.br:443 2>/dev/null \
  | openssl x509 -noout -dates
```

### Rules

- The domain is announced to participants only after the auth loop has succeeded on the real domain.
- Do not schedule this stage for the same day as an announcement. Certificate issuance and DNS both have variable timing.

---

## Stage 6 — Deploy is one repeatable command

### Human track

**End state**

- [ ] `deploy.sh` has been run successfully by **a second person**, on their own machine, start to finish.
- [ ] A rollback has been performed at least once in the dashboard, deliberately, as a drill.
- [ ] Credentials for Cloudflare, Supabase, and Registro.br are stored somewhere at least one other person can access.
- [ ] That person knows where this document is.

**Verification**

The second person deploys a trivial visible change without your hands on the keyboard. If they need you to explain a step, the documentation gap is real — fix it now, not during the deadline week.

### Code track

**End state**

- [ ] `deploy.sh` exists, is executable, and is the only way the site is updated.
- [ ] It aborts on a leaked key or a missing `_redirects`.
- [ ] It verifies the live site after upload.

```bash
#!/usr/bin/env bash
# deploy.sh — the only supported way to update NEXUS
set -euo pipefail

PROJECT="nexus"
URL="https://ciuflaictin.com.br"

npm ci
npm run build

if grep -rq "service_role" dist/; then
  echo "ABORT: service_role key found in bundle" >&2
  exit 1
fi

if [ ! -f dist/_redirects ]; then
  echo "ABORT: _redirects missing — SPA routes will 404" >&2
  exit 1
fi

BUILD_ID=$(grep -o 'build-id[^>]*content="[^"]*"' dist/index.html \
  | grep -o '[^"]*"$' | tr -d '"' || echo "")

npx wrangler pages deploy dist/ --project-name="$PROJECT"

sleep 10
./scripts/verify-deploy.sh "$URL" "$BUILD_ID"
echo "Deployed and verified: $URL"
```

**Verification**

Two runs, in this order:

```bash
chmod +x deploy.sh
./deploy.sh                                    # must succeed and verify

echo 'const x = "service_role";' >> src/lib/api.ts
./deploy.sh                                    # must ABORT before uploading
git checkout src/lib/api.ts
```

The second run is the important one. **A guard that has never fired is not known to work.**

### Rules

- No manual uploads through the dashboard. Every change goes through `deploy.sh`.
- If a deploy appears not to take effect, purge cache in the Cloudflare dashboard before assuming the build was wrong. The build-ID check in `verify-deploy.sh` distinguishes these two cases.
- Rollback is a dashboard action on a previous deployment — not a git revert plus rebuild. It is faster and it is the correct move under time pressure.

---

## Stage 7 — Ready for the deadline

Submission traffic is extremely bursty: most of it arrives in the final hours. This stage completes **two weeks** before the deadline, not on the day.

### Human track

**End state**

- [ ] Full end-to-end run passed: register → log in → submit a paper → PDF uploads → confirmation email arrives.
- [ ] Verified on mobile and on at least two desktop browsers.
- [ ] The end-to-end run performed by someone who did not build the system, if at all possible.
- [ ] Domain expiry, certificate expiry, and Supabase quota all confirmed sufficient.
- [ ] A restored backup inspected by eye — the row count matches and the data is actually the right data.
- [ ] Someone other than you is reachable during the deadline window and knows how to redeploy and roll back.

**Verification**

Authors of a system do not stumble where users do. If nobody else is available, at minimum run the flow on a device and browser you never develop on, with a fresh account.

### Code track

**End state**

- [ ] `scripts/backup.sh` exists and performs both database and storage backup.
- [ ] It has been run **and its output restored** into a scratch local database.
- [ ] It runs daily in the final week and immediately after the deadline closes.

```bash
#!/usr/bin/env bash
# scripts/backup.sh — database + storage snapshot
set -euo pipefail

STAMP=$(date +%F-%H%M)
OUT="${BACKUP_DIR:-$HOME/nexus-backups}/$STAMP"
mkdir -p "$OUT"

pg_dump "$SUPABASE_CONNECTION_STRING" -Fc -f "$OUT/nexus.dump"

# Storage — the database dump does NOT contain the PDFs
npx supabase storage download --recursive \
  "ss://papers" "$OUT/storage/" || {
    echo "WARNING: storage backup failed — PDFs are NOT backed up" >&2
    exit 1
  }

echo "Backup written to $OUT"
du -sh "$OUT"
```

**Verification — the restore is the test, not the dump**

```bash
./scripts/backup.sh

createdb nexus_restore_test
pg_restore -d nexus_restore_test "$LATEST/nexus.dump"
psql nexus_restore_test -c "SELECT count(*) FROM submissions;"
ls -R "$LATEST/storage/" | head
```

The row count must match production, and the storage directory must contain actual PDFs.

**A backup that has never been restored is not a backup.**

### Rules

- Backups are stored off the developer machine.
- Storage and database are backed up together, always. A database dump alone loses every submitted paper.
- No deploys in the final 24 hours before the deadline except to fix a confirmed break.

---

## Free plan limits (Cloudflare Pages)

| Limit | Free plan | Relevant here? |
|---|---|---|
| Builds (Git-connected) | 500/month | No — direct upload does not use Cloudflare's builders |
| Files per site | 20,000 | No — a Vite SPA bundle is dozens of files |
| Custom domains per project | 100 | No |
| Bandwidth / requests | Unlimited, fair use | No — a submission SPA is not video or bulk file distribution |

PDFs live in Supabase Storage, not in the bundle, so Pages' limits never interact with submission volume. Supabase quota is the number to watch — Stage 4.

---

## Known limitations

1. **Data location.** Submission data lives on Supabase infrastructure (US or EU region) for the duration of the congress; the frontend is served from Cloudflare's network. Migrating afterward does not retroactively change where data was processed. Raise this upfront rather than letting it surface later.

2. **Third-party dependency.** A Supabase outage takes submissions down with no local fallback; a Cloudflare outage takes the frontend down. Neither has a Phase 1 mitigation — both are far more reliable than a laptop on a residential connection.

3. **Security surface concentrated in RLS.** With no backend layer, a single misconfigured policy is directly exploitable from the browser. Stage 4 is the entire mitigation.

4. **Temporary domain.** `ciuflaictin.com.br` is not a university domain. Links printed in congress materials will not survive a later move to `ufla.br`. Decide before publishing whether that matters.

5. **Bus factor.** One person holds the Cloudflare account, the Supabase project, and the deploy tooling. The human tracks of Stages 6 and 7 exist specifically to reduce this, and they are the items most likely to get skipped. Do not skip them.

---

## Phase 2 outline (post-congress)

Not in scope. Sketched so Phase 1 does not paint us into a corner.

- Export full snapshot: `scripts/backup.sh` output is already exactly this
- Stand up Postgres on university infrastructure
- Replace direct Supabase calls with a small FastAPI or Flask backend
- Move PDFs to a filesystem behind an authentication check
- Automated off-host backups
- Formalize maintenance ownership with the department
- Move the frontend to a `ufla.br` subdomain

**Design rule carried from Stage 2:** all Supabase access goes through `src/lib/api.ts`. No component contains `supabase.from(...)`. This makes Phase 2 a change to one file instead of a rewrite, and it is far cheaper to enforce now than to retrofit.

If Phase 2 needs server-side logic while staying on Cloudflare, Workers with static assets serves the same bundle and adds a request handler in the same deployment — no re-platforming.

---

## Order of work

| Priority | Stage | Human track | Code track | Blocked by |
|---|---|---|---|---|
| Start now | 1 — Domain | Registrar + Cloudflare zone | `check-dns.sh` | Nothing (propagation delay) |
| Start now | 4 — Supabase | Dashboard config, 2 test accounts, manual probes | `rls-audit.sql`, `rls-probe.mjs` | Nothing |
| Then | 2 — Build | Copy keys, rotate if leaked | `_redirects`, `_headers`, `config.ts`, `api.ts` refactor | Nothing |
| Then | 3 — Preview live | `wrangler login`, project creation, DevTools check | `verify-deploy.sh` | Stage 2 |
| Then | 5 — Domain live | Attach domain, auth loop | (reuses Stage 3) | 1, 3, 4 |
| Then | 6 — Deploy | Second-person deploy, rollback drill | `deploy.sh` | Stage 5 |
| Deadline −2wk | 7 — Readiness | End-to-end run, handover | `backup.sh` | All |

Stages 1 and 4 have no dependencies and the longest lead times. **The `api.ts` refactor in Stage 2 is the largest single piece of programming work in this plan** — everything else is configuration and short scripts. Start it early; it is also what makes Stage 4's audit possible.
