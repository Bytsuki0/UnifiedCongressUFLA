# Security & Production-Readiness Analysis — UnifiedCongressUFLA

**Date:** 2026-07-01
**Scope:** Full codebase — frontend (`src/`), Supabase migrations (`supabase/migrations/`), migration tooling (`scripts/`), environment config (`.env`), and dependencies.

> **Bottom line:** In its current state this system is **not safe to deploy publicly.** The database is effectively an open API: Row-Level Security exists but every policy is `USING (true) WITH CHECK (true)`, so anyone holding the anon key (shipped in the browser bundle) can **read, modify, or delete every record** — submissions, reviews, grades, student/professor PII, and certificates. Authorization is enforced only in React and is trivially bypassed. On top of that, real production secrets (service-role key, DB password, personal access token) are sitting in a working-tree `.env`. Treat the current keys as **compromised** and rotate them before doing anything else.

Findings are ordered by severity. Each has an ID you can reference in issues/PRs.

---

## Severity summary

| ID | Severity | Issue |
|----|----------|-------|
| SEC-01 | 🔴 Critical | Open RLS policies (`USING (true)`) on every table — full anon read/write/delete |
| SEC-02 | 🔴 Critical | Authorization enforced only client-side; API-level privilege escalation |
| SEC-03 | 🔴 Critical | Live secrets (service_role key, DB password, PAT) present in `.env` |
| SEC-04 | 🔴 Critical | Role assignment via openly-writable tables → self-promote to avaliador/admin |
| SEC-05 | 🟠 High | Public / open Storage buckets — anyone can read, overwrite, delete any file |
| SEC-06 | 🟠 High | Hardcoded admin identity (`bytsuki066@gmail.com`) across code + SQL |
| SEC-07 | 🟠 High | No email verification — anyone can register any UFLA address |
| SEC-08 | 🟠 High | No rate limiting / bot / DDoS protection on public endpoints |
| SEC-09 | 🟠 High | PII (incl. CPF) stored in plaintext and world-readable |
| SEC-10 | 🟡 Medium | Session tokens & business data in `localStorage` (XSS-exfiltratable) |
| SEC-11 | 🟡 Medium | Weak password policy (6 chars, no complexity, no breach check) |
| SEC-12 | 🟡 Medium | Certificate verification allows prefix enumeration + counter abuse |
| SEC-13 | 🟡 Medium | No Content-Security-Policy or security headers |
| SEC-14 | 🟡 Medium | Vulnerable dependencies (`tar` high, `esbuild` dev) |
| SEC-15 | 🟢 Low | Client trusts user-controlled `user_metadata.perfil` |
| SEC-16 | 🟢 Low | No server-side input validation; mass-assignment on inserts |
| SEC-17 | 🟢 Low | Business logic / audit trail kept in `localStorage` (spoofable) |

---

## 🔴 Critical

### SEC-01 — Open Row-Level Security policies on every table
**Where:** all files under `supabase/migrations/` — e.g. `20260429142626_*.sql:35-48`, `20260610120000_create_estudantes_professores.sql:31-33`, `20260618120000_*.sql:67-71`, `20260624120000_event_management_pages.sql:227-239`.

Every table enables RLS and then immediately defines a policy like:

```sql
CREATE POLICY "public all trabalhos" ON public.trabalhos FOR ALL USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trabalhos TO anon, authenticated;
```

Because the anon key is embedded in the client bundle (`VITE_SUPABASE_PUBLISHABLE_KEY`), **any visitor** can hit the REST/PostgREST endpoint directly and:

- Read every submission, review (`pareceres`), grade (`avaliacoes`), student/professor record, profile (CPF, phone), and certificate.
- Alter another student's grade, flip a `trabalho.status` to `aprovado`, delete all submissions, or issue themselves data.

This nullifies the entire "double-blind review" premise — reviewer identities, author identities, and scores are all openly queryable.

**Fix:** Replace every `USING (true)` policy with ownership/role-scoped rules, e.g.:
```sql
-- students see only their own works
CREATE POLICY "own trabalhos" ON public.trabalhos
  FOR SELECT USING (auth.uid() = owner_id);
```
Add an `owner_id uuid DEFAULT auth.uid()` column to user-owned tables, and gate writes with `WITH CHECK (auth.uid() = owner_id)`. Reviewer/admin access should go through a security-definer helper backed by a real roles table (see SEC-04). Revoke blanket `anon` write grants.

---

### SEC-02 — Authorization is client-side only
**Where:** `src/components/ProtectedRoute.tsx`, `src/contexts/AuthContext.tsx:22-39`, `src/pages/Login.tsx:8-38`.

`ProtectedRoute` and `resolveRole()` decide access **in the browser**. The database does not distinguish roles at all (see SEC-01). An attacker never has to load the React app — they call Supabase directly with the anon key. Route guards, `allowedRoles`, and the "admin only" portal are cosmetic.

**Fix:** Enforce authorization in the database (RLS + `SECURITY DEFINER` functions checking a server-side role). The frontend guard is fine as UX, but must not be the only line of defense.

---

### SEC-03 — Production secrets committed to the working tree
**Where:** `.env` (root).

The file contains **real, non-placeholder** values:

```
SUPABASE_SERVICE_ROLE_KEY=sb_secret_...        # bypasses ALL RLS
SUPABASE_ACCESS_TOKEN=sbp_...                  # full account/management API access
SUPABASE_DB_PASSWORD=Gksc24092004azazelares@   # looks like a personal password
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

`.env` is currently git-ignored (good), but:
- The service-role key **bypasses RLS entirely** — it is the master key to the whole database. It must never live next to frontend config, and never on a developer laptop shared with the client build.
- The DB password appears to be a reused personal password.
- These values have now been shared/read; assume they are leaked.

**Fix (do first):**
1. **Rotate all three immediately** in the Supabase dashboard (service_role key, access token, DB password).
2. Keep only `VITE_*` (URL + anon key) in any environment the frontend touches.
3. Move `SERVICE_ROLE_KEY` / `ACCESS_TOKEN` to a CI/deploy secret store; run migrations from there, not from a dev `.env`.
4. Verify `.env` never entered git history: `git log --all -- .env` (currently clean — keep it that way).
5. Ship a committed `.env.example` with placeholders only.

---

### SEC-04 — Role assignment relies on openly-writable tables
**Where:** `src/contexts/AuthContext.tsx:22-39`, `src/pages/Login.tsx:8-38`, migrations for `avaliadores` / `professores` / `estudantes`.

Roles are derived by looking up the user's email in `avaliadores` / `professores`, tables that anyone can `INSERT` into (SEC-01). So an attacker can:

```js
await supabase.from('avaliadores').insert({ nome:'x', email:'me@x.com', instituicao:'x' })
```

…and `resolveRole()` now returns `"avaliador"`, granting the co-chairs dashboard, rankings, and reviewer assignment. There is no binding between the `auth.users` identity and these role tables beyond a matching string.

**Fix:** Introduce a dedicated `user_roles` table writable **only** by admins (or a secure server function), keyed to `auth.uid()`, not email. Resolve roles from a `SECURITY DEFINER` function. Never let a user write their own role.

---

## 🟠 High

### SEC-05 — Public and openly-writable Storage buckets
**Where:** `supabase/migrations/20260617120000_trabalhos_submission_fields.sql:34-63`, `20260624120000_event_management_pages.sql:407-426`.

- The `Pdfs` bucket is `public = true` with open object policies → every uploaded paper is world-readable **and** any anon user can overwrite or delete arbitrary files (`FOR UPDATE/DELETE USING (bucket_id='Pdfs')`).
- `certificates`, `avatars`, `certificate-templates` are `public=false` but their `storage.objects` policies grant `SELECT/INSERT/UPDATE/DELETE` to anyone matching `bucket_id`, so the privacy of the bucket flag is defeated by RLS.
- Object paths are predictable (`${Date.now()}-${filename}`), so listing/enumeration is easy.

**Fix:** Make buckets private; scope object policies to the owner (`(storage.foldername(name))[1] = auth.uid()::text` pattern), issue **signed URLs** with expiry for downloads instead of public URLs, and restrict deletes/updates to owners or admins. Add server-side content validation (see SEC-16).

---

### SEC-06 — Hardcoded admin identity
**Where:** `src/contexts/AuthContext.tsx:20`, `src/pages/Login.tsx:6`, `src/pages/event/admin/AdminUsuarios.tsx:10`, `supabase/migrations/20260624120000_event_management_pages.sql:15-26`.

Admin is `bytsuki066@gmail.com`, hardcoded in four places (including the SQL `is_app_admin()` function). Problems:
- It's a personal Gmail, not an institutional account, embedded in a public repo.
- Anyone who gains control of that mailbox (or registers it first if it's ever freed) becomes admin.
- No way to add/rotate/revoke admins without code + migration changes.
- The value is visible to every user in the shipped bundle.

**Fix:** Drive admin from the `user_roles` table (SEC-04) managed through an admin UI; seed the first admin via a one-off secured migration referencing a `user_id`, not a literal email in source.

---

### SEC-07 — No email verification / ownership proof
**Where:** `src/pages/Cadastro.tsx:27-40`, `src/pages/ProfessorCadastro.tsx:35-46` (`emailRedirectTo: undefined`), `src/pages/PreCadastro.tsx:7-15` (domain check is client-only).

Sign-up creates an immediately-usable account with no confirmation email. The "must be a UFLA email" rule is enforced only in the browser and can be bypassed by calling `supabase.auth.signUp` directly. Consequences: impersonation (register `reitor@ufla.br`), spam/fake accounts, and no assurance the registrant owns the address they claim.

**Fix:** Enable "Confirm email" in Supabase Auth; require the confirmation click before login. Enforce the allowed-domain rule server-side (Auth hook / Edge Function / DB trigger on profile creation). Consider institutional SSO if UFLA provides it.

---

### SEC-08 — No rate limiting, bot, or DDoS protection
**Where:** architecture-wide; all data access is direct anon PostgREST/Storage calls.

There is no CAPTCHA on login/registration, no throttling on submissions or certificate verification, no WAF/CDN in front. Combined with open policies (SEC-01), a single script can enumerate or wipe the database, mass-create accounts, or brute-force logins. Supabase's built-in auth limits help a little but the data plane is wide open.

**Fix:** Put the app behind a CDN/WAF (Cloudflare, etc.) with rate limits; add CAPTCHA/Turnstile to auth and public forms; enable Supabase Auth rate limiting; route mutating operations through Edge Functions you can throttle and audit; add per-IP limits on `verify_certificate`.

---

### SEC-09 — PII (including CPF) stored plaintext and world-readable
**Where:** `profiles` (`cpf`, `telefone`, `instituicao`) in `20260624120000_*.sql:41-60`; `estudantes` (`matricula`) ; `AdminUsuarios.tsx` reads full contact data.

Personal data — CPF, phone, matrícula, emails — is stored in plaintext under open-read policies. Under Brazilian **LGPD** this is a reportable exposure of personal data. Anyone can dump the entire `profiles` table.

**Fix:** Lock these tables to owner-only reads (SEC-01), restrict admin reads to genuine admins, minimize what you collect, and document a lawful basis + retention policy. Consider not storing CPF at all unless strictly required.

---

## 🟡 Medium

### SEC-10 — Session tokens and business data in `localStorage`
**Where:** `src/integrations/supabase/client.ts:11-16` (`storage: localStorage`), `src/pages/revisor/shared.ts` (`LS` helper stores submissions, drafts, notifications).

Access/refresh tokens in `localStorage` are readable by any injected script (XSS → full account takeover, no expiry help from `HttpOnly`). The revisor flow also persists submissions and "status history" in `localStorage`, so that data is user-editable and not authoritative.

**Fix:** Prefer cookie-based sessions where feasible; at minimum add a strong CSP (SEC-13) to reduce XSS risk. Move any authoritative data to the server; treat `localStorage` as disposable cache only.

---

### SEC-11 — Weak password policy
**Where:** `src/pages/Cadastro.tsx:22-25`, `src/pages/ProfessorCadastro.tsx:30`, Login placeholder "Mínimo 6 caracteres".

Minimum 6 characters, no complexity, no length ceiling, no breached-password check. Enforced only client-side.

**Fix:** Raise to ≥12 chars, enable Supabase's leaked-password protection (HaveIBeenPwned), and enforce server-side. Add MFA for admin/reviewer accounts.

---

### SEC-12 — Certificate verification enables enumeration & counter abuse
**Where:** `supabase/migrations/20260624120000_event_management_pages.sql:259-303`.

`verify_certificate` matches on a **prefix**: `c.verification_code LIKE norm.c || '%'` once `length >= 8`. An attacker can walk short prefixes to enumerate valid certificates and their holder's name + institution (returned to `anon`). `verify_and_mark_certificate` increments `verification_count` unbounded (counter inflation / minor DoS).

**Fix:** Require full-code exact match (drop the `LIKE '%'` branch), rate-limit the RPC, and avoid returning personal data to anonymous callers beyond a boolean/valid flag. Use long, non-sequential codes (already UUID-derived — just don't allow prefixes).

---

### SEC-13 — No Content-Security-Policy or security headers
**Where:** `index.html` (no CSP meta), no hosting header config in repo.

No CSP, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, or HSTS. This amplifies XSS impact (SEC-10) and allows clickjacking/framing.

**Fix:** Add a strict CSP (script-src self, connect-src limited to the Supabase project, frame-ancestors none) and the standard security headers via your host (Netlify/Vercel/nginx) or a meta CSP as a stopgap.

---

### SEC-14 — Known-vulnerable dependencies
**Where:** `npm audit` — 3 vulnerabilities (2 high, 1 low).

- `tar` (high): multiple path-traversal / arbitrary file write advisories (transitive via `@mapbox/node-pre-gyp`).
- `esbuild` (dev, moderate): arbitrary file read via the dev server on Windows.

**Fix:** `npm audit fix` (and re-test), pin/upgrade transitive deps, and add `npm audit` (or Dependabot/Snyk) to CI so this is caught continuously.

---

## 🟢 Low

### SEC-15 — Client trusts user-controlled metadata
`signUp` writes `perfil: "estudante"/"professor"` into `user_metadata` (`Cadastro.tsx:36`, `ProfessorCadastro.tsx:43`), which the user can set. `resolveRole` currently uses tables instead, but any future reliance on `user_metadata.perfil` would be a privilege-escalation vector. Never trust `user_metadata` for authorization.

### SEC-16 — No server-side validation / mass assignment
Inserts (e.g. `trabalhos` in `NovaSubmissao.tsx`, reviewer auto-distribution in `revisorService.ts`) are validated only in the browser and accept arbitrary fields under open policies. PDF checks are client-side (`type`, 10 MB); a direct API caller can bypass them. Add DB constraints/triggers or Edge Functions that validate and set `status`, `owner_id`, timestamps server-side; never accept `status` from the client.

### SEC-17 — Audit trail lives in `localStorage`
`statusHistory`, drafts, and notifications in the revisor flow are stored client-side (`revisor/shared.ts`, `Avaliacao.tsx`), so the "who changed what" record is fabricable and lost across devices. Move audit logging to an append-only server table.

---

## Missing features required before production

These aren't bugs but gaps that block a real deployment:

**Authentication & accounts**
- [ ] Email confirmation flow (SEC-07)
- [ ] **Password reset / "forgot password"** — currently absent entirely
- [ ] Account lockout / brute-force protection + CAPTCHA (SEC-08, SEC-11)
- [ ] MFA, at least for admin and reviewers
- [ ] Session timeout / idle logout; "log out everywhere"
- [ ] Institutional SSO (if UFLA offers SAML/OIDC)

**Profiles & roles**
- [ ] Profile view/edit for the **estudante** and **revisor** portals (only the congresso area has `Perfil`)
- [ ] Real DB-backed role management with an admin UI (SEC-04, SEC-06)
- [ ] Admin bootstrapping that isn't a hardcoded personal email

**Data protection & compliance**
- [ ] LGPD: privacy policy, consent, lawful basis, data-retention & deletion, DPO contact (SEC-09)
- [ ] Data-subject export/delete tooling
- [ ] Encryption-at-rest posture documented; minimize CPF/PII collection

**Platform hardening**
- [ ] Least-privilege RLS across all tables (SEC-01)
- [ ] Private buckets + signed URLs (SEC-05)
- [ ] Secrets management + rotation of the currently-exposed keys (SEC-03)
- [ ] WAF/CDN + rate limiting (SEC-08)
- [ ] CSP + security headers (SEC-13)
- [ ] Server-side validation via Edge Functions (SEC-16)

**Operations**
- [ ] Database backups + tested restore / disaster recovery
- [ ] Error monitoring + logging/alerting (Sentry, log drains)
- [ ] Audit log table for grade/status changes (SEC-17)
- [ ] CI security scanning (`npm audit`, secret scanning, SAST)
- [ ] Staging environment separate from production
- [ ] Virus/malware scanning for uploaded PDFs
- [ ] Terms of Service / acceptable-use

---

## Recommended remediation order

1. **Rotate the exposed secrets now** (SEC-03) and confirm `.env` is not in git history.
2. **Rewrite RLS** to least-privilege and add `owner_id` + a secure `user_roles` model (SEC-01, SEC-02, SEC-04).
3. **Lock down Storage** (private buckets, signed URLs, owner-scoped policies) (SEC-05).
4. **Turn on email confirmation, password reset, and stronger password rules** (SEC-07, SEC-11).
5. **Add WAF/CDN + rate limiting + CAPTCHA**, and move mutations behind Edge Functions (SEC-08, SEC-16).
6. **Address PII/LGPD, CSP/headers, dependency updates, and the remaining medium/low items.**

> Nothing in this list requires abandoning Supabase — every item maps to a standard Supabase feature (RLS policies, Auth settings, signed URLs, Edge Functions, Vault). The architecture is fine; the security posture is currently set to "prototype / open sprint" and needs to be turned on before real users and real data are involved.
