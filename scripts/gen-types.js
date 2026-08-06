#!/usr/bin/env node
/**
 * Type generator — regenerates src/integrations/supabase/types.ts from the
 * LIVE database schema, via the Supabase Management API (no CLI, no Docker).
 *
 * Read-only: nothing in the database is touched.
 *
 * Env vars (same pattern as migrate.js):
 *   VITE_SUPABASE_URL     — e.g. https://xxxx.supabase.co (read from .env)
 *   SUPABASE_ACCESS_TOKEN — personal access token (supabase.com/dashboard/account/tokens)
 *
 * Usage (PowerShell):
 *   $env:SUPABASE_ACCESS_TOKEN = "sbp_..."
 *   npm run gen:types
 *
 * Run after every applied migration that changes tables/RPCs, so the
 * frontend types never freeze on an old schema again.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadDotEnv } from "./load-dotenv.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

loadDotEnv();

const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

if (!SUPABASE_URL) {
  console.error("ERROR: VITE_SUPABASE_URL must be set (normally read from .env).");
  process.exit(1);
}
if (!ACCESS_TOKEN) {
  console.error("ERROR: SUPABASE_ACCESS_TOKEN must be set.");
  console.error('PowerShell:  $env:SUPABASE_ACCESS_TOKEN = "sbp_..."; npm run gen:types');
  process.exit(1);
}

const PROJECT_REF = SUPABASE_URL.replace("https://", "").split(".")[0];
const OUT_FILE = path.join(__dirname, "..", "src", "integrations", "supabase", "types.ts");

async function main() {
  console.log("=== Nexus Corp — Supabase type generation ===");
  console.log(`Project : ${PROJECT_REF}\n`);

  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/types/typescript?included_schemas=public`,
    { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } }
  );
  if (!res.ok) {
    throw new Error(`Management API returned HTTP ${res.status}: ${await res.text()}`);
  }

  const { types } = await res.json();
  if (!types || !types.includes("Database")) {
    throw new Error("Unexpected response — no TypeScript payload returned.");
  }

  const header =
    "// Gerado automaticamente por `npm run gen:types` a partir do schema do banco.\n" +
    "// NÃO editar à mão — rode o script novamente após cada migration aplicada.\n\n";

  fs.writeFileSync(OUT_FILE, header + types, "utf8");
  console.log(`✓ Wrote ${path.relative(process.cwd(), OUT_FILE)} (${types.length} chars)`);
}

main().catch((err) => {
  console.error("\nType generation failed:", err.message);
  process.exit(1);
});
