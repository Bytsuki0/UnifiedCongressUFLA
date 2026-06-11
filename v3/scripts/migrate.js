#!/usr/bin/env node
/**
 * Migration runner — applies all .sql files in supabase/migrations/
 * in chronological (filename) order, skipping already-applied ones.
 *
 * Requires env vars:
 *   VITE_SUPABASE_URL         — e.g. https://xxxx.supabase.co
 *   SUPABASE_ACCESS_TOKEN     — personal access token (supabase.com/dashboard/account/tokens)
 *   SUPABASE_SERVICE_ROLE_KEY — project service_role key
 *
 * Usage:  node scripts/migrate.js   OR   npm run migrate
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !ACCESS_TOKEN || !SERVICE_KEY) {
  console.error("ERROR: VITE_SUPABASE_URL, SUPABASE_ACCESS_TOKEN and SUPABASE_SERVICE_ROLE_KEY must be set.");
  process.exit(1);
}

const PROJECT_REF  = SUPABASE_URL.replace("https://", "").split(".")[0];
const MGMT_SQL_URL = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;

/** Run raw SQL via Supabase Management API. Returns { ok, error } */
async function execSQL(sql) {
  const res = await fetch(MGMT_SQL_URL, {
    method: "POST",
    headers: {
      Authorization:  `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });
  const body = await res.text();
  if (!res.ok) return { ok: false, error: body };
  return { ok: true, data: body };
}

/** Errors that are safe to ignore during migration (object already exists, etc.) */
function isIgnorableError(msg) {
  return (
    msg.includes("already exists") ||
    msg.includes("duplicate key") ||
    msg.includes("does not exist") ||
    msg.includes("relation") && msg.includes("already")
  );
}

/** Reload PostgREST schema cache */
async function reloadSchemaCache() {
  await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/services/postgrest/reload`,
    { method: "POST", headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } }
  );
  await new Promise((r) => setTimeout(r, 2500));
}

/** Ensure migration tracking table exists */
async function ensureMigrationsTable() {
  const { ok, error } = await execSQL(`
    CREATE TABLE IF NOT EXISTS public._migrations (
      id          SERIAL PRIMARY KEY,
      filename    TEXT NOT NULL UNIQUE,
      applied_at  TIMESTAMPTZ DEFAULT NOW()
    );
    GRANT ALL    ON public._migrations TO service_role;
    GRANT SELECT ON public._migrations TO anon, authenticated;
    GRANT USAGE, SELECT ON SEQUENCE public._migrations_id_seq
      TO anon, authenticated, service_role;
  `);
  if (!ok) throw new Error(`Could not create _migrations table: ${error}`);
}

/** Get already-applied migration filenames */
async function getApplied() {
  const { ok, data, error } = await execSQL(
    "SELECT filename FROM public._migrations ORDER BY filename"
  );
  if (!ok) throw new Error(`Could not read _migrations: ${error}`);
  const rows = JSON.parse(data);
  return new Set(rows.map((r) => r.filename));
}

/** Record a migration as applied */
async function markApplied(filename) {
  const safe = filename.replace(/'/g, "''");
  const { ok, error } = await execSQL(
    `INSERT INTO public._migrations (filename) VALUES ('${safe}') ON CONFLICT DO NOTHING`
  );
  if (!ok) throw new Error(`Could not record migration: ${error}`);
}

async function main() {
  console.log("=== Nexus Corp — Database Migrations ===");
  console.log(`Project : ${PROJECT_REF}\n`);

  await ensureMigrationsTable();

  const applied = await getApplied();

  const migrationsDir = path.join(__dirname, "..", "supabase", "migrations");
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const pending = files.filter((f) => !applied.has(f));

  if (pending.length === 0) {
    console.log("All migrations already applied — nothing to do.");
    return;
  }

  console.log(`Pending: ${pending.length} migration(s)\n`);

  for (const filename of pending) {
    const sql = fs.readFileSync(path.join(migrationsDir, filename), "utf8");
    process.stdout.write(`  Applying ${filename} ... `);

    const { ok, error } = await execSQL(sql);

    if (!ok) {
      let errMsg;
      try { errMsg = JSON.parse(error)?.message || error; }
      catch { errMsg = error; }

      if (isIgnorableError(errMsg)) {
        // Objects already exist — migration was partially applied before. Mark done.
        console.log("⚠  (already applied, skipping)");
        await markApplied(filename);
        continue;
      }

      console.log("✗");
      throw new Error(errMsg);
    }

    await markApplied(filename);
    console.log("✓");
  }

  process.stdout.write("\n  Reloading PostgREST schema cache ... ");
  await reloadSchemaCache();
  console.log("✓");

  console.log(`\n✓ Done — ${pending.length} migration(s) applied.`);
}

main().catch((err) => {
  console.error("\nMigration failed:", err.message);
  process.exit(1);
});
