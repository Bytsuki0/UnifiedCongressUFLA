# Esqueci minha senha — Forgot Password Flow

## Extra
[The forgot-password feature is fully implemented and verified locally — all 170 tests pass (45 new), TypeScript, ESLint, and the production build are clean, and the deploy script's dry run picks up the new function. The design doc remains at forgot-password-plan.md.

What was built

Migration — extends criar_token_email to mint redefinir_senha tokens (requires a confirmed account, 2-hour cooldown per account, 2-hour expiry; the verification flow keeps its 60 s / 24 h behavior untouched). Adds criar_token_redefinicao (email→user lookup + 5/hour per-IP rate limit) and consumir_token_redefinicao (atomic single-use consume), both callable only by service_role, with a self-check block that aborts the migration if grants drift.
Edge function redefinir-senha — anonymous, two actions: solicitar sends the Brevo email with a link to /redefinir-senha?token=…, and trocar consumes the token, sets the password via GoTrue's admin API, invalidates any other open reset links, and signs the user out of all devices. Anti-enumeration as you chose: unknown, unconfirmed, and on-cooldown emails all get the same generic success. If the password update fails after the token was consumed, the token is restored so the link isn't wasted.
Deploy script — now supports per-function verify_jwt; redefinir-senha deploys with it off (your sb_publishable_ key isn't a JWT, so the gateway would reject anonymous calls otherwise).
Frontend — /esqueci-senha (email form with the generic success message) and /redefinir-senha (new password + confirm, token stripped from the URL on load and consumed only on submit so mail scanners can't burn it). "Esqueceu sua senha?" link added to Login.tsx, plus routes, tab titles, noindex headers, and the lib/service split with four new test files.
To go live, run these (they publish to production, so I left them to you):


SUPABASE_ACCESS_TOKEN=sbp_... npm run migrate
SUPABASE_ACCESS_TOKEN=sbp_... npm run deploy:functions -- redefinir-senha
Then smoke-test that verify_jwt: false took effect — this curl with no auth header must return 200 {"ok":true}, not a 401:


curl -X POST https://<your-project>.supabase.co/functions/v1/redefinir-senha \
  -H 'Content-Type: application/json' -d '{"acao":"solicitar","email":"naoexiste@example.com"}'
Two things to watch on first real use: confirm the reset email arrives (same Brevo secrets as enviar-email, nothing new to configure), and check that a session in a second browser is dropped after a reset — the global sign-out uses a GoTrue admin endpoint that isn't wrapped by the SDK, and the code treats it as best-effort if the endpoint is absent.]

## Context

Item 7 of `fixes.txt` ("esqueci minha senha"). The app is a React SPA (Vite + React Router) whose entire backend is Supabase: RLS + SECURITY DEFINER RPCs in `supabase/migrations/`, one Brevo-backed edge function (`enviar-email`) for the home-grown email-verification flow. There is currently **no way to recover a lost password** — no reset call, no password-change UI anywhere.

The groundwork already exists: `tokens_email.proposito` (migration `20260806140000_verificacao_email.sql`) already accepts `'redefinir_senha'` in its CHECK — the column was added precisely so the reset flow reuses the same token layer. Only the minting RPC refuses it today. This plan completes that flow.

**Requirements (user-confirmed):**
- Only emails with a **confirmed** account (`profiles.email_confirmado_em IS NOT NULL`) receive a reset email, via the existing Brevo integration.
- One reset request per account **every 2 hours**.
- New page to set the new password, reachable **only** via a single-use secure token in the emailed link (random 32 bytes, only the SHA-256 hash stored — the same scheme used for verification; satisfies the "encrypted token" requirement).
- **Anti-enumeration (user decision):** the request page always shows the same generic message whether the email exists, is unconfirmed, or is on cooldown.
- **Link validity (user decision): 2 hours** — matches the request cadence; never two live links at once.

**Key structural facts (verified):**
- The frontend key is `sb_publishable_…` (`.env.example`) — **not a JWT**. An anonymous call cannot pass a `verify_jwt: true` gateway, so the flow needs a **new edge function `redefinir-senha` deployed with `verify_jwt: false`**; abuse control lives in SQL (account cooldown + per-IP limit) plus the CORS allowlist.
- `auth.users` is not exposed through PostgREST, so the email → user lookup must happen **inside SQL**, not in the edge function.
- The in-SQL `x-forwarded-for` idiom sees the edge function's fetch, not the browser — the client IP must be read in Deno and passed to the RPC as a parameter.
- auth-js 2.108.1 has no admin "sign out by user id" wrapper — session revocation uses GoTrue's REST endpoint via raw fetch (best-effort).

---

## 1. Migration — `supabase/migrations/20260814120000_redefinir_senha.sql`

Repo conventions: pt-BR header comment, `SECURITY DEFINER SET search_path = public`, `extensions.`-qualified pgcrypto, `REVOKE ALL` + targeted `GRANT`, final `DO $$` self-check. No table changes needed.

### 1a. `CREATE OR REPLACE criar_token_email(p_user_id, p_proposito)` — extend, same signature/grants (service_role only)

| Concern | `verificacao_email` (unchanged) | `redefinir_senha` (new) |
|---|---|---|
| Purpose guard | accepted | accepted (`NOT IN (…)` → PT400) |
| Unknown user | PT404 | PT404 |
| Confirmation check | confirmed → PT409 | **NOT confirmed → PT403** (inverse) |
| Throttle (already scoped per user+proposito) | 60 s → PT429 | **7200 s → PT429** (message keeps leading integer) |
| Token expiry | 24 h | **2 h** |

### 1b. New `criar_token_redefinicao(p_email text, p_ip text DEFAULT NULL) RETURNS TABLE(token text, nome text, motivo text, segundos integer)` — service_role only

Single round trip for "solicitar"; RAISEs only for the two honest cases, returns calm status rows otherwise:

1. Normalize `lower(trim(p_email))`; empty/malformed → **RAISE PT400**.
2. Per-IP limit `consume_rate_limit('redefinir_senha:'||coalesce(p_ip,'unknown'), 5, 3600)` → **RAISE PT429** (5/hour/IP; honest — reveals nothing about accounts). Called here because this RPC runs as owner — `consume_rate_limit` has no grants.
3. `auth.users` lookup by email; not found → `(NULL,NULL,'inexistente',NULL)`.
4. Call `criar_token_email(v_user_id, 'redefinir_senha')` inside `BEGIN…EXCEPTION`: PT403 → `('nao_confirmado')`; PT429 (2 h cooldown) → `('aguarde', segundos)`.
5. Success → `(v_token, profiles.nome, 'ok', NULL)`.

### 1c. New `consumir_token_redefinicao(p_token text) RETURNS TABLE(status text, user_id uuid)` — service_role only

Mirrors `confirmar_email`'s idempotent style, scoped `proposito='redefinir_senha'`: blank/unknown → `('invalido',NULL)`; `used_at` set → `('usado',NULL)`; past `expires_at` → `('expirado',NULL)`; else atomic `UPDATE … SET used_at=now() WHERE token_hash=v_hash AND used_at IS NULL` (concurrency loser → `'usado'`) → `('ok', user_id)`.

### 1d. `DO $$` self-check
RAISE if any of the three functions is executable by `anon`/`authenticated`, if `criar_token_email` isn't executable by `service_role`, or if the `proposito` CHECK no longer contains `'redefinir_senha'`.

## 2. New edge function — `supabase/functions/redefinir-senha/index.ts`

Self-contained (no `_shared/` in repo; duplication is the documented convention). Copy from `enviar-email/index.ts`: `ORIGENS_PERMITIDAS`, `cabecalhosCors`, `responder`, `sha256Hex`, `separarRemetente`, brand constants, secret validation. **No `getUser()` at all** — identity comes from the token or from nothing. Secrets: the same three (`BREVO_API_KEY`, `EMAIL_REMETENTE`, `SITE_URL`) — nothing new to configure. Raw token never logged.

POST-only, body discriminated by `acao`:

### `{acao:"solicitar", email}`
Flow: parse → client IP = first `x-forwarded-for` entry → `rpc("criar_token_redefinicao", {p_email, p_ip})` → if `motivo !== 'ok'` return **200 `{ok:true}` without sending** (anti-enumeration: `inexistente`, `nao_confirmado`, `aguarde` are indistinguishable) → else link `${SITE_URL}/redefinir-senha?token=…`, new `montarEmailRedefinicao(nome, link)` (same HTML skeleton; subject "Redefina sua senha — …"; copy: valid **2 h**, single use, "se não foi você, ignore — sua senha não será alterada"), Brevo send, store `message_id` by hash (non-fatal).

| Outcome | Status / body |
|---|---|
| Sent OR silently skipped | 200 `{ok:true}` |
| Malformed JSON/acao | 400 `corpo_invalido` |
| Email malformed (PT400) | 400 `email_invalido` |
| Per-IP limit (PT429) | 429 `aguarde` + `segundos` |
| Brevo failure | 502 `falha_envio` (micro-leak only during an outage — accepted, commented) |
| Missing secrets / RPC unexpected | 500 `config_ausente` / `falha_token` |

### `{acao:"trocar", token, novaSenha}`
Ordering matters:
1. `novaSenha.length >= 12` server-side → else 400 `senha_curta` (`MIN_SENHA = 12` duplicated with keep-in-sync comment pointing at `src/lib/cadastro.ts`; `fixes.txt` item 6 may later lower it — separate change, two places).
2. `rpc("consumir_token_redefinicao")` → `invalido` 400 / `usado` 409 / `expirado` 410.
3. `auth.admin.updateUserById(user_id, {password})`. **On failure: compensating revert** — service-role `UPDATE tokens_email SET used_at = NULL WHERE token_hash = sha256Hex(token)` (precedented direct write: `enviar-email` already updates `message_id`) → 500 `falha_troca` (policy rejection → also revert, map `senha_curta`).
4. Bulk-invalidate remaining open `redefinir_senha` tokens of the user (direct service-role update) — non-fatal.
5. Best-effort global sign-out: raw `fetch` `POST ${SUPABASE_URL}/auth/v1/admin/users/{id}/logout?scope=global` with service-role `Authorization` + `apikey` headers (no auth-js wrapper exists). Non-2xx → log and continue.
6. 200 `{ok:true}`.

No rate limit on "trocar" — same justification documented on `confirmar_email` (32 random bytes are unguessable).

## 3. Deploy script — `scripts/deploy-functions.js`

- Replace hardcoded `verify_jwt: true` (line ~119): `const VERIFY_JWT_POR_SLUG = { "redefinir-senha": false };` → `verify_jwt: VERIFY_JWT_POR_SLUG[slug] ?? true`, with a why-comment (anonymous flow; publishable key isn't a JWT; protection = CORS + SQL limits).
- Generalize the secrets check (line ~190) to a `FUNCTIONS_COM_SECRETS = ["enviar-email", "redefinir-senha"]` list (same `SECRETS_ESPERADOS`).

## 4. Frontend

Established **lib / service / page** split (README: pages never call the backend directly).

### `src/lib/redefinirSenha.ts` (pure — mirrors `src/lib/verificacaoEmail.ts`)
- `COOLDOWN_RESET_SEGUNDOS = 7200` fallback; `interpretarRespostaSolicitacao(status, corpo)` and `interpretarRespostaTroca(status, corpo)` → discriminated result types over the erro codes above, incl. status-based fallback and the "rede" distinction.
- `validarNovaSenha(senha, confirmacao)` reusing `MIN_SENHA` from `@/lib/cadastro`.
- pt-BR text maps; generic success copy: "Se este e-mail pertencer a uma conta confirmada, você receberá um link de redefinição em instantes. Confira também a caixa de spam."; 7200 s rendered as "2 horas".

### `src/services/redefinirSenhaService.ts` (mirrors `verificacaoEmailService.ts`)
`solicitarRedefinicao(email)` / `trocarSenha(token, novaSenha)` via `supabase.functions.invoke("redefinir-senha", {body})`, recovering non-2xx bodies from `error.context instanceof Response` → `.json().catch(() => null)` → interpret; catch → `rede`.

### `src/pages/EsqueciSenha.tsx` — route `/esqueci-senha` (public)
Card layout like `ConfirmarEmail.tsx` (`cadastro-wrapper`/`cadastro-card`, plain `useState`, sonner): overline "REDEFINIÇÃO DE SENHA", one email field, "ENVIAR LINK". States `formulario | enviando | enviado | cooldown`. Success = the generic copy in a `<p role="status">` — never "e-mail não encontrado". 429 → disabled button + countdown (mirror `/verifique-email` UX). Toasts only for `rede`/`falha_envio`. Footer links `/login`, `/cadastro`.

### `src/pages/RedefinirSenha.tsx` — route `/redefinir-senha` (public)
Template = `ConfirmarEmail.tsx`, preserving both hard-won behaviors: (1) token read once (StrictMode ref guard), stripped via `history.replaceState`, held in `useRef`; (2) consumed **only on submit**, never on mount (mail-scanner prefetch). Form: "Nova senha" + "Confirmar nova senha" with the show/hide toggle markup from `Cadastro.tsx` (~lines 250–276), placeholder `Mínimo ${MIN_SENHA} caracteres`, client-side `validarNovaSenha`. Phases: `lendo | pronto | trocando | trocada | token_invalido | token_usado | token_expirado | rede`. `trocada` → "Senha redefinida! Entre com a nova senha." + ENTRAR → `/login` (no auto-login — sessions were just revoked). Failure cards link to `/esqueci-senha` ("PEDIR NOVO LINK"); `rede` keeps "TENTAR DE NOVO" (token still in the ref and, thanks to the revert, still valid).

### Wiring
- `src/App.tsx`: two public `<Route>`s next to `/confirmar-email`.
- `src/pages/Login.tsx`: in the `<p>` after `</form>`, add `Esqueceu sua senha? <Link to="/esqueci-senha">Redefinir</Link>`; drive-by: fix the stale "Mínimo 6 caracteres" placeholder → `MIN_SENHA`.
- `src/lib/pageTitles.ts`: `["/esqueci-senha", "Esqueci minha senha"]`, `["/redefinir-senha", "Redefinir senha"]` (static paths, no ordering hazard).
- `vercel.json`: extend the X-Robots-Tag source to include both new routes.

## 5. Tests (Vitest, mirroring existing files)

- `src/test/redefinirSenha.test.ts` — pure lib: both interpreters per status/erro (429 with/without `segundos`, status fallback, network never becomes a token verdict), `validarNovaSenha` boundaries.
- `src/test/redefinirSenhaService.test.ts` — copy the `vi.hoisted` mock + `erroHttp(status, corpo)` helper from `verificacaoEmailService.test.ts`; lock the `error.context` trap; assert exact invoke payloads.
- `src/test/redefinirSenhaPagina.test.tsx` — mirror `confirmarEmail.test.tsx`: token stripped from URL on mount; **zero service calls until submit**; mismatch/short password blocked inline; `rede` shows retry; no token → invalid card.
- `src/test/esqueciSenha.test.tsx` — generic copy on success; 429 countdown disables button; `rede` re-enables form.
- Run `pageTitles.test.ts` (ordering guard) — new static entries should pass untouched.

## 6. Rollout order

1. `npm run migrate` (self-check aborts on grant/constraint drift). `gen:types` not needed — new RPCs are service_role-only.
2. Edit deploy script → `npm run deploy:functions -- --dry-run` → `npm run deploy:functions -- redefinir-senha` (production, per script warning). Secrets already present (`npm run config:secrets -- --listar` to confirm).
3. **Gateway smoke test**: `curl -X POST …/functions/v1/redefinir-senha -d '{"acao":"solicitar","email":"naoexiste@example.com"}'` with **no** Authorization header → must return `200 {ok:true}`, not a platform 401 (proves `verify_jwt: false` took).
4. Frontend deploy as usual.

## Verification checklist

- `npx vitest run` green.
- E2E dev (`npm run dev`, port 5000 — CORS-allowlisted, against production Supabase):
  - Confirmed account → generic message → Brevo email arrives → link opens `/redefinir-senha`, token vanishes from the URL bar → new 12+ char password → login works with new, fails with old.
  - Unknown email, unconfirmed account, and a 2nd request within 2 h → **identical generic message**, and no new email / no new `tokens_email` row.
  - Reused link → "usado"; pre-change sibling link also dead (bulk invalidation); tampered token → "inválido"; expired (manual `UPDATE expires_at`) → "expirado" with "PEDIR NOVO LINK".
  - 6th request from one IP within an hour → 429 countdown in the UI.
  - Second-browser session signed out after reset (or documented as known-optional gap if the endpoint is absent).
  - Verification flow regression: `/verifique-email` resend still throttles at 60 s and confirms normally (shared `criar_token_email`).

## Risks / verify during implementation

1. `verify_jwt` + publishable key — the smoke-test curl is the proof; also confirm anonymous `functions.invoke` succeeds client-side.
2. GoTrue admin logout endpoint (`/auth/v1/admin/users/{id}/logout`) is not wrapped by auth-js — verify with a one-off curl; treat failure as non-fatal (JWTs die at the 1 h `jwt_exp` anyway; refresh tokens are the residual gap if absent).
3. Client IP must arrive as `p_ip` from Deno (`x-forwarded-for` of the function's request); log presence once, never the value next to anything sensitive.
4. Confirm GoTrue admin password update enforces the 12-char policy; any policy rejection must trigger the token revert.
5. Enumeration side-channels accepted: 502 during a Brevo outage, minor timing skew between sent/skipped paths — noted, not engineered around.
6. Brevo free tier 300/day — reset volume bounded by the 2 h/account + 5/h/IP limits; mind congress-opening day.
