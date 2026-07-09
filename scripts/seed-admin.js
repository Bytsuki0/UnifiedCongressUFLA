#!/usr/bin/env node
/**
 * Admin seeding — grants the 'admin' role (public.user_roles) to an
 * EXISTING auth user, identified by e-mail.
 *
 * The admin identity is intentionally NOT hardcoded anywhere in the
 * codebase (see SEC-06 in SECURITY_ANALYSIS.md). Bootstrap the first
 * admin with:
 *
 *   ADMIN_EMAIL=someone@ufla.br npm run seed:admin
 *
 * Requires env vars (from your secret store, NOT from a dev .env):
 *   VITE_SUPABASE_URL      — e.g. https://xxxx.supabase.co
 *   SUPABASE_ACCESS_TOKEN  — personal access token (management API)
 *   ADMIN_EMAIL            — e-mail of the user to promote
 *
 * Further admins should be managed through the user_roles table by an
 * existing admin.
 */

const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();

if (!SUPABASE_URL || !ACCESS_TOKEN || !ADMIN_EMAIL) {
  console.error("ERROR: VITE_SUPABASE_URL, SUPABASE_ACCESS_TOKEN and ADMIN_EMAIL must be set.");
  console.error("Usage: ADMIN_EMAIL=someone@ufla.br npm run seed:admin");
  process.exit(1);
}
if (!/^[^\s@']+@[^\s@']+\.[^\s@']+$/.test(ADMIN_EMAIL)) {
  console.error("ERROR: ADMIN_EMAIL does not look like a valid e-mail address.");
  process.exit(1);
}

const PROJECT_REF = SUPABASE_URL.replace("https://", "").split(".")[0];
const MGMT_SQL_URL = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;

async function execSQL(sql) {
  const res = await fetch(MGMT_SQL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(body);
  return body;
}

async function main() {
  console.log(`Granting 'admin' role to ${ADMIN_EMAIL} on project ${PROJECT_REF} ...`);
  const result = await execSQL(`
    WITH target AS (
      SELECT id FROM auth.users WHERE lower(email) = '${ADMIN_EMAIL}'
    ), ins AS (
      INSERT INTO public.user_roles (user_id, role)
      SELECT id, 'admin' FROM target
      ON CONFLICT (user_id, role) DO NOTHING
      RETURNING user_id
    )
    SELECT
      (SELECT count(*) FROM target) AS user_found,
      (SELECT count(*) FROM ins)    AS role_granted;
  `);
  const [row] = JSON.parse(result);
  if (!row || Number(row.user_found) === 0) {
    console.error("No auth user found with that e-mail. The user must sign up first.");
    process.exit(1);
  }
  if (Number(row.role_granted) === 0) {
    console.log("User already had the admin role — nothing to do.");
  } else {
    console.log("✓ Admin role granted.");
  }
}

main().catch((err) => {
  console.error("Seeding failed:", err.message);
  process.exit(1);
});
