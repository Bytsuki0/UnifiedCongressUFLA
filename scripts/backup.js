#!/usr/bin/env node
/**
 * Etapa 7 do plano de deploy — snapshot do banco E do Storage.
 *
 * O plano manda `pg_dump` + `supabase storage download`. Nenhum dos dois
 * existe nesta máquina (Windows, sem Postgres client instalado), então:
 *
 *   · BANCO   — SQL pela Management API (mesmo caminho do migrate.js,
 *               autenticado com SUPABASE_ACCESS_TOKEN). Cada tabela sai
 *               como JSON, mais um .sql com INSERTs para restaurar.
 *   · STORAGE — supabase-js com a service_role, que é a única chave capaz
 *               de listar e baixar objeto de bucket privado.
 *
 * O dump é LÓGICO (linhas), não físico como o do pg_dump: não carrega
 * schema, índices nem policies. O schema já está versionado em
 * supabase/migrations/, então restaurar = rodar as migrations e depois
 * este dump. É essa a combinação que reconstrói o congresso inteiro.
 *
 * Uso (PowerShell):
 *   $env:SUPABASE_ACCESS_TOKEN     = "sbp_..."
 *   $env:SUPABASE_SERVICE_ROLE_KEY = "sb_secret_..."   # ou o JWT antigo
 *   npm run backup
 *
 * Nenhuma das duas entra no .env: são segredos, vivem só no ambiente da
 * chamada. Sem a service_role o script AVISA e sai != 0 — um backup só do
 * banco perde todos os PDFs submetidos, que é justamente o que não pode
 * ser perdido.
 *
 * Opções:
 *   --somente-banco   aceita rodar sem a service_role (NÃO é backup completo)
 *   --dir <caminho>   destino (padrão: ./supabase/backups/<data>)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadDotEnv } from "./load-dotenv.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(__dirname, "..");

loadDotEnv();

const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SOMENTE_BANCO = process.argv.includes("--somente-banco");

const idxDir = process.argv.indexOf("--dir");
const CARIMBO = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
const DESTINO =
  idxDir !== -1
    ? path.resolve(process.argv[idxDir + 1])
    : path.join(RAIZ, "supabase", "backups", CARIMBO);

if (!SUPABASE_URL || !ACCESS_TOKEN) {
  console.error(
    "Faltam VITE_SUPABASE_URL (.env) e/ou SUPABASE_ACCESS_TOKEN (ambiente).\n" +
      'PowerShell:  $env:SUPABASE_ACCESS_TOKEN = "sbp_..."; npm run backup',
  );
  process.exit(2);
}

if (!SERVICE_ROLE && !SOMENTE_BANCO) {
  console.error(
    "AVISO: SUPABASE_SERVICE_ROLE_KEY não está no ambiente.\n" +
      "Sem ela os PDFs e certificados NÃO são copiados, e um dump só do\n" +
      "banco perde todo arquivo submetido.\n\n" +
      'PowerShell:  $env:SUPABASE_SERVICE_ROLE_KEY = "sb_secret_..."\n' +
      "Para aceitar um backup parcial de propósito: npm run backup -- --somente-banco",
  );
  process.exit(2);
}

const PROJECT_REF = SUPABASE_URL.replace("https://", "").split(".")[0];
const MGMT_SQL_URL = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;

/** Roda SQL pela Management API e devolve as linhas já em JSON. */
async function consultar(sql) {
  const res = await fetch(MGMT_SQL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });
  const texto = await res.text();
  if (!res.ok) throw new Error(`Management API ${res.status}: ${texto.slice(0, 300)}`);
  return JSON.parse(texto);
}

/** Escapa um valor para virar literal SQL no arquivo de restauração. */
function literalSQL(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "object") return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

fs.mkdirSync(DESTINO, { recursive: true });
fs.mkdirSync(path.join(DESTINO, "tabelas"), { recursive: true });

console.log(`\nBackup de ${PROJECT_REF}`);
console.log(`Destino: ${DESTINO}\n`);

// ---------------------------------------------------------------------
// 1. Banco
// ---------------------------------------------------------------------
console.log("▸ Banco (Management API)");

const tabelas = (
  await consultar(`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' ORDER BY tablename;
  `)
).map((t) => t.tablename);

const resumo = [];
let totalLinhas = 0;
const partesSQL = [
  "-- Restauração lógica gerada por scripts/backup.js",
  "-- Rode DEPOIS de aplicar supabase/migrations/ num banco vazio.",
  "-- O schema NÃO está aqui: vem das migrations.",
  "BEGIN;",
  "SET session_replication_role = replica;  -- adia as FKs até o COMMIT",
  "",
];

for (const tabela of tabelas) {
  const linhas = await consultar(`SELECT * FROM public.${tabela};`);
  fs.writeFileSync(
    path.join(DESTINO, "tabelas", `${tabela}.json`),
    JSON.stringify(linhas, null, 2),
  );

  if (linhas.length > 0) {
    const colunas = Object.keys(linhas[0]);
    partesSQL.push(`-- ${tabela} (${linhas.length} linhas)`);
    for (const linha of linhas) {
      const valores = colunas.map((c) => literalSQL(linha[c])).join(", ");
      partesSQL.push(
        `INSERT INTO public.${tabela} (${colunas.join(", ")}) VALUES (${valores}) ON CONFLICT DO NOTHING;`,
      );
    }
    partesSQL.push("");
  }

  totalLinhas += linhas.length;
  resumo.push({ tabela, linhas: linhas.length });
  console.log(`  ${String(linhas.length).padStart(6)}  ${tabela}`);
}

partesSQL.push("SET session_replication_role = DEFAULT;", "COMMIT;");
fs.writeFileSync(path.join(DESTINO, "restaurar.sql"), partesSQL.join("\n"));
console.log(`  → ${totalLinhas} linhas em ${tabelas.length} tabelas\n`);

// ---------------------------------------------------------------------
// 2. Storage
// ---------------------------------------------------------------------
let totalArquivos = 0;
const bucketsResumo = [];

if (SOMENTE_BANCO) {
  console.log("▸ Storage: PULADO (--somente-banco). Este NÃO é um backup completo.\n");
} else {
  console.log("▸ Storage (service_role)");
  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });

  const { data: buckets, error: erroBuckets } = await admin.storage.listBuckets();
  if (erroBuckets) {
    console.error(`  ERRO ao listar buckets: ${erroBuckets.message}`);
    process.exit(1);
  }

  /** Storage não tem listagem recursiva: percorre pasta por pasta. */
  async function listarRecursivo(bucket, prefixo = "") {
    const { data, error } = await admin.storage
      .from(bucket)
      .list(prefixo, { limit: 1000 });
    if (error) throw new Error(`${bucket}/${prefixo}: ${error.message}`);

    const arquivos = [];
    for (const item of data ?? []) {
      const caminho = prefixo ? `${prefixo}/${item.name}` : item.name;
      // Entrada sem metadata é pasta, não objeto.
      if (item.id === null || item.metadata === null) {
        arquivos.push(...(await listarRecursivo(bucket, caminho)));
      } else {
        arquivos.push(caminho);
      }
    }
    return arquivos;
  }

  for (const bucket of buckets) {
    const arquivos = await listarRecursivo(bucket.name);
    let baixados = 0;

    for (const caminho of arquivos) {
      const { data, error } = await admin.storage.from(bucket.name).download(caminho);
      if (error) {
        console.error(`  FALHA ${bucket.name}/${caminho}: ${error.message}`);
        continue;
      }
      const destino = path.join(DESTINO, "storage", bucket.name, caminho);
      fs.mkdirSync(path.dirname(destino), { recursive: true });
      fs.writeFileSync(destino, Buffer.from(await data.arrayBuffer()));
      baixados++;
    }

    totalArquivos += baixados;
    bucketsResumo.push({ bucket: bucket.name, arquivos: baixados, esperados: arquivos.length });
    console.log(`  ${String(baixados).padStart(6)}/${arquivos.length}  ${bucket.name}`);

    if (baixados !== arquivos.length) {
      console.error(
        `  ATENÇÃO: ${arquivos.length - baixados} objeto(s) de ${bucket.name} não vieram.`,
      );
    }
  }
  console.log(`  → ${totalArquivos} arquivos\n`);
}

// ---------------------------------------------------------------------
// 3. Manifesto — é o que a conferência de restauração compara
// ---------------------------------------------------------------------
const manifesto = {
  projeto: PROJECT_REF,
  gerado_em: new Date().toISOString(),
  completo: !SOMENTE_BANCO,
  total_linhas: totalLinhas,
  total_arquivos: totalArquivos,
  tabelas: resumo,
  buckets: bucketsResumo,
};
fs.writeFileSync(
  path.join(DESTINO, "manifesto.json"),
  JSON.stringify(manifesto, null, 2),
);

console.log("─".repeat(60));
console.log(`Backup em ${DESTINO}`);
console.log(`  ${totalLinhas} linhas · ${totalArquivos} arquivos`);
if (SOMENTE_BANCO) {
  console.log("\n  PARCIAL: sem Storage. Não serve como backup do congresso.");
}
console.log(
  "\nUm backup que nunca foi restaurado não é um backup.\n" +
    "Confira com:  npm run backup:conferir -- " + DESTINO,
);
