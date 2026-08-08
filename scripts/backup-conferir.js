#!/usr/bin/env node
/**
 * Etapa 7 — conferência do backup. "Um backup que nunca foi restaurado
 * não é um backup."
 *
 * Roda em dois níveis, e diz sempre qual dos dois rodou:
 *
 *   ESTRUTURAL (sempre)
 *     · manifesto bate com os arquivos que existem no disco
 *     · contagem de linhas por tabela confere com a produção AGORA
 *     · todo PDF salvo começa com %PDF- (arquivo íntegro, não HTML de erro)
 *     · restaurar.sql tem INSERT para toda tabela não vazia
 *
 *   RESTAURAÇÃO DE VERDADE (só com o Docker ligado)
 *     · sobe um postgres descartável
 *     · aplica supabase/migrations/ e depois restaurar.sql
 *     · reconta as linhas dentro do banco restaurado e compara
 *
 * O nível estrutural pega backup truncado e PDF corrompido, mas NÃO prova
 * que o dump restaura. Só o segundo nível prova. Ligue o Docker Desktop
 * antes de rodar a conferência que vale.
 *
 * Uso:
 *   npm run backup:conferir -- supabase/backups/2026-08-08-16-30
 */

import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadDotEnv } from "./load-dotenv.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(__dirname, "..");

loadDotEnv();

const DESTINO = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (!DESTINO || !fs.existsSync(DESTINO)) {
  console.error("uso: node scripts/backup-conferir.js <pasta-do-backup>");
  process.exit(2);
}

const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const PROJECT_REF = SUPABASE_URL.replace("https://", "").split(".")[0];

let falhas = 0;
const ok = (m) => console.log(`  \x1b[32mOK  \x1b[0m ${m}`);
const falhou = (m) => {
  console.log(`  \x1b[31mFALHA\x1b[0m ${m}`);
  falhas++;
};

const manifesto = JSON.parse(fs.readFileSync(path.join(DESTINO, "manifesto.json"), "utf8"));
console.log(`\nConferindo ${DESTINO}`);
console.log(`Gerado em ${manifesto.gerado_em} · projeto ${manifesto.projeto}\n`);

// ---------------------------------------------------------------------
// Nível 1 — estrutural
// ---------------------------------------------------------------------
console.log("▸ Estrutura do backup");

if (!manifesto.completo) {
  falhou("backup marcado como PARCIAL (--somente-banco) — sem Storage, não serve");
}

let linhasNoDisco = 0;
for (const { tabela, linhas } of manifesto.tabelas) {
  const arquivo = path.join(DESTINO, "tabelas", `${tabela}.json`);
  if (!fs.existsSync(arquivo)) {
    falhou(`${tabela}.json não existe`);
    continue;
  }
  const dados = JSON.parse(fs.readFileSync(arquivo, "utf8"));
  if (dados.length !== linhas) {
    falhou(`${tabela}: manifesto diz ${linhas}, arquivo tem ${dados.length}`);
  }
  linhasNoDisco += dados.length;
}
if (linhasNoDisco === manifesto.total_linhas) {
  ok(`${linhasNoDisco} linhas conferem com o manifesto`);
}

// PDFs precisam ser PDFs de verdade: um download com erro grava HTML.
if (manifesto.completo) {
  const raizStorage = path.join(DESTINO, "storage");
  let pdfs = 0;
  let corrompidos = 0;
  if (fs.existsSync(raizStorage)) {
    (function varrer(dir) {
      for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
        const completo = path.join(dir, item.name);
        if (item.isDirectory()) varrer(completo);
        else if (/\.pdf$/i.test(item.name)) {
          pdfs++;
          const cabecalho = Buffer.alloc(5);
          const fd = fs.openSync(completo, "r");
          fs.readSync(fd, cabecalho, 0, 5, 0);
          fs.closeSync(fd);
          if (cabecalho.toString("latin1") !== "%PDF-") {
            corrompidos++;
            falhou(`não é PDF: ${path.relative(DESTINO, completo)}`);
          }
        }
      }
    })(raizStorage);
  }
  if (pdfs > 0 && corrompidos === 0) ok(`${pdfs} PDF(s) com cabeçalho válido`);
  else if (pdfs === 0) falhou("nenhum PDF no backup — os trabalhos submetidos sumiram?");
}

const sql = fs.readFileSync(path.join(DESTINO, "restaurar.sql"), "utf8");
for (const { tabela, linhas } of manifesto.tabelas) {
  if (linhas > 0 && !sql.includes(`INSERT INTO public.${tabela} `)) {
    falhou(`restaurar.sql não tem INSERT para ${tabela} (${linhas} linhas)`);
  }
}
ok("restaurar.sql cobre todas as tabelas não vazias");

// ---------------------------------------------------------------------
// Nível 1b — o backup bate com a produção de agora?
// ---------------------------------------------------------------------
if (ACCESS_TOKEN && SUPABASE_URL) {
  console.log("\n▸ Comparação com a produção");
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: manifesto.tabelas
          .map((t) => `SELECT '${t.tabela}' AS tabela, count(*) AS n FROM public.${t.tabela}`)
          .join(" UNION ALL "),
      }),
    },
  );
  if (!res.ok) {
    falhou(`não consegui consultar a produção (${res.status})`);
  } else {
    const atual = Object.fromEntries(
      (await res.json()).map((r) => [r.tabela, Number(r.n)]),
    );
    let divergentes = 0;
    for (const { tabela, linhas } of manifesto.tabelas) {
      if (atual[tabela] !== linhas) {
        divergentes++;
        console.log(
          `  \x1b[33mNOTA \x1b[0m ${tabela}: backup ${linhas}, produção ${atual[tabela]}`,
        );
      }
    }
    // Divergência não é erro: o congresso segue recebendo submissão. O que
    // importa é saber a idade do backup, não exigir que ele seja atual.
    if (divergentes === 0) ok("todas as contagens idênticas à produção");
    else ok(`${divergentes} tabela(s) mudaram desde o backup (esperado num evento ativo)`);
  }
} else {
  console.log("\n▸ Comparação com a produção: pulada (sem SUPABASE_ACCESS_TOKEN)");
}

// ---------------------------------------------------------------------
// Nível 2 — restauração de verdade
// ---------------------------------------------------------------------
console.log("\n▸ Restauração num Postgres descartável");

const temDocker = (() => {
  try {
    execFileSync("docker", ["ps"], { stdio: "pipe", shell: process.platform === "win32" });
    return true;
  } catch {
    return false;
  }
})();

if (!temDocker) {
  console.log(
    "  \x1b[33mPULADA\x1b[0m — o daemon do Docker não está no ar.\n" +
      "         A conferência estrutural NÃO prova que o dump restaura.\n" +
      "         Abra o Docker Desktop e rode de novo antes do prazo:\n" +
      `         npm run backup:conferir -- ${path.relative(RAIZ, DESTINO)}`,
  );
  console.log("\n" + "─".repeat(60));
  if (falhas > 0) {
    console.error(`${falhas} problema(s) na estrutura do backup.`);
    process.exit(1);
  }
  console.log("Estrutura íntegra. Restauração NÃO comprovada (falta Docker).");
  process.exit(0);
}

const CONTAINER = "nexus-restore-test";
const docker = (args, opts = {}) =>
  execFileSync("docker", args, {
    stdio: "pipe",
    encoding: "utf8",
    shell: process.platform === "win32",
    ...opts,
  });

try {
  try {
    docker(["rm", "-f", CONTAINER]);
  } catch {
    /* não existia */
  }

  console.log("  subindo postgres:16 …");
  docker([
    "run", "-d", "--name", CONTAINER,
    "-e", "POSTGRES_PASSWORD=teste",
    "-e", "POSTGRES_DB=restore_test",
    "postgres:16",
  ]);

  // Espera o banco aceitar conexão.
  let pronto = false;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      docker(["exec", CONTAINER, "pg_isready", "-U", "postgres"]);
      pronto = true;
      break;
    } catch {
      /* ainda subindo */
    }
  }
  if (!pronto) throw new Error("o postgres do container não subiu a tempo");
  ok("postgres descartável no ar");

  const psql = (sqlTexto) => {
    const tmp = path.join(DESTINO, "__tmp.sql");
    fs.writeFileSync(tmp, sqlTexto);
    docker(["cp", tmp, `${CONTAINER}:/tmp/in.sql`]);
    fs.unlinkSync(tmp);
    return docker([
      "exec", CONTAINER, "psql", "-U", "postgres", "-d", "restore_test",
      "-v", "ON_ERROR_STOP=0", "-f", "/tmp/in.sql",
    ]);
  };

  // As migrations criam o schema. Erros de objeto do Supabase (auth.uid,
  // storage.*, roles) são esperados fora do Supabase — o que precisa
  // existir são as TABELAS de public.
  console.log("  aplicando migrations …");
  const migrations = fs
    .readdirSync(path.join(RAIZ, "supabase", "migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const preludio = [
    "CREATE SCHEMA IF NOT EXISTS auth;",
    "CREATE SCHEMA IF NOT EXISTS storage;",
    "CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;",
    "CREATE OR REPLACE FUNCTION auth.email() RETURNS text LANGUAGE sql AS $$ SELECT NULL::text $$;",
    "CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text);",
    "DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;",
    "DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;",
    "DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;",
  ].join("\n");
  psql(
    preludio +
      "\n" +
      migrations
        .map((f) => fs.readFileSync(path.join(RAIZ, "supabase", "migrations", f), "utf8"))
        .join("\n"),
  );

  console.log("  aplicando restaurar.sql …");
  psql(fs.readFileSync(path.join(DESTINO, "restaurar.sql"), "utf8"));

  // A prova: recontar dentro do banco restaurado.
  console.log("  recontando …");
  let divergencias = 0;
  for (const { tabela, linhas } of manifesto.tabelas) {
    if (linhas === 0) continue;
    let n = -1;
    try {
      const saida = docker([
        "exec", CONTAINER, "psql", "-U", "postgres", "-d", "restore_test",
        "-tAc", `SELECT count(*) FROM public.${tabela};`,
      ]);
      n = Number(saida.trim());
    } catch {
      n = -1;
    }
    if (n !== linhas) {
      falhou(`${tabela}: backup tem ${linhas}, restaurado tem ${n < 0 ? "TABELA AUSENTE" : n}`);
      divergencias++;
    }
  }
  if (divergencias === 0) {
    ok("todas as tabelas restauraram com a contagem exata");
  }
} catch (err) {
  falhou(`restauração falhou: ${err.message.slice(0, 200)}`);
} finally {
  try {
    docker(["rm", "-f", CONTAINER]);
    console.log("  container removido");
  } catch {
    console.log(`  ATENÇÃO: remova à mão -> docker rm -f ${CONTAINER}`);
  }
}

console.log("\n" + "─".repeat(60));
if (falhas > 0) {
  console.error(`${falhas} problema(s). Este backup NÃO é confiável.`);
  process.exit(1);
}
console.log("Backup íntegro E restaurado com sucesso num banco limpo.");
process.exit(0);
