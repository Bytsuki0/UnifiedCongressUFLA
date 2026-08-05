# Security Setup — required manual steps

The code changes for SEC-01 … SEC-09 (see `SECURITY_ANALYSIS.md`) are in the
repo: least-privilege RLS, a DB-backed role model, private Storage buckets,
server-side domain enforcement, and IP rate limiting on the public
certificate-verification RPC. A few steps **cannot** be done from code and
must be performed by you, in this order.

## 1. Rotate the exposed secrets (SEC-03) — do this FIRST

The old `.env` contained live secrets; treat them as **compromised**:

1. Supabase Dashboard → Settings → API → **regenerate the `service_role` key**.
2. <https://supabase.com/dashboard/account/tokens> → **revoke** the old
   personal access token and generate a new one.
3. Supabase Dashboard → Settings → Database → **reset the database password**
   (it looked like a reused personal password — do not reuse it anywhere).
4. Verify `.env` never entered git history: `git log --all -- .env`
   (clean at the time of writing — keep it that way).

From now on, keep `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ACCESS_TOKEN` only
in a CI/deploy secret store. `.env` (and `.env.example`) hold **only**
browser-safe `VITE_*` values.

## 2. Apply the migrations (SEC-01/02/04/05/09 + unified signup)

```bash
# with the NEW access token exported in the shell, not in .env
SUPABASE_ACCESS_TOKEN=... SUPABASE_SERVICE_ROLE_KEY=... npm run migrate
```

This applies two migrations:

- `20260709120000_security_hardening.sql` — role table (`user_roles`),
  owner-scoped/role-scoped RLS on every table, private buckets with
  per-owner policies, server-side signup validation, exact-match +
  rate-limited `verify_certificate`.
- `20260710120000_cadastro_unificado_externos.sql` — the `externo` role
  for non-UFLA participants, plus per-profile required-field validation
  in the signup trigger (see §6).

## 3. Seed the first admin (SEC-06)

The admin is no longer a hardcoded e-mail. After the admin user has signed
up (or for the existing account):

```bash
ADMIN_EMAIL=admin@ufla.br SUPABASE_ACCESS_TOKEN=... npm run seed:admin
```

Further admins can be granted by an existing admin through the
`user_roles` table. Consider moving the admin account to an institutional
address instead of a personal Gmail.

## 4. Auth settings in the Supabase Dashboard (SEC-07, SEC-08, SEC-11)

Dashboard → Authentication → Sign In / Up (or Settings, depending on UI
version):

- **Enable "Confirm email"** — sign-ups now receive a confirmation link
  (the frontend already handles the "check your e-mail" flow and the
  "Email not confirmed" login error).
- **Enable leaked-password protection** (HaveIBeenPwned check).
- Set **minimum password length ≥ 12**.
- Review **rate limits** (Authentication → Rate Limits): lower the limits
  for sign-up, sign-in, and OTP/email sending.
- Optional but recommended: enable **CAPTCHA** (Cloudflare Turnstile /
  hCaptcha) for sign-up and sign-in.

## 5. Edge / network protection (SEC-08)

Rate limiting inside the database now protects `verify_certificate`
(30 requests / 5 min per IP), but the data plane as a whole should sit
behind a CDN/WAF:

- Put the deployed frontend behind **Cloudflare** (or similar) with bot
  protection and per-IP rate rules.
- If you later add Edge Functions for mutations, throttle them there too.

## 6. What changed for existing data — read before going live

- **Old PDF uploads** live at the root of the `Pdfs` bucket (no owner
  folder). Staff (admin/avaliador) and professors can still open them via
  signed URLs; the submitting students cannot, because ownership wasn't
  recorded at upload time. New uploads go to `<user_id>/...` and are fully
  owner-scoped.
- **`trabalhos.owner_id`** is `NULL` for pre-existing rows (ownership was
  never stored). Students will not see their old submissions; staff sees
  everything. If needed, backfill `owner_id` manually by matching authors
  to `estudantes.user_id`.
- **Sign-up profiles are derived from the e-mail domain in the database**
  via `public.allowed_email_domains`: `estudante.ufla.br` → estudante
  (requires matrícula, período, curso), `ufla.br` / `ufla-br` / `ufla_br`
  → professor (requires departamento). **Any other domain creates an
  `externo` participant account** (name/e-mail/password only), which can
  reach the `/congresso` area but not the submission or review portals.
  A user can never obtain an institutional role without the matching
  institutional address — the trigger ignores what the browser sends.
- The `verify_certificate` RPC no longer matches code prefixes (exact code
  only) — QR links keep working; hand-typed partial codes no longer do.

## 7. Remaining items NOT covered here

These are separate findings (medium/low) still open: cookie-based sessions
/ CSP headers (SEC-10, SEC-13), dependency updates (`npm audit`, SEC-14),
server-side input validation via Edge Functions (SEC-16), and the
audit-trail table (SEC-17).
