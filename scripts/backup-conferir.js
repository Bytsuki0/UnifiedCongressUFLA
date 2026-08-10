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

import { spawnSync } from "child_process";
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

/**
 * Tabelas copiadas no snapshot mas deliberadamente fora do restaurar.sql
 * (hoje só `_migrations`, que o migrate.js cria em tempo de execução).
 * Cobrar INSERT ou recontagem delas seria acusar falha no que é de propósito.
 */
const puladas = new Set(manifesto.restore_pulado ?? []);

console.log(`\nConferindo ${DESTINO}`);
console.log(`Gerado em ${manifesto.gerado_em} · projeto ${manifesto.projeto}`);
if (puladas.size > 0) console.log(`Fora do restore de propósito: ${[...puladas].join(", ")}`);
console.log("");

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
const falhasAntes = falhas;
for (const { tabela, linhas } of manifesto.tabelas) {
  if (puladas.has(tabela)) continue;
  if (linhas > 0 && !sql.includes(`INSERT INTO public.${tabela} `)) {
    falhou(`restaurar.sql não tem INSERT para ${tabela} (${linhas} linhas)`);
  }
}
// O inverso também é defeito: INSERT para tabela que não existe num banco
// novo aborta a transação inteira e leva o restore junto.
for (const tabela of puladas) {
  if (sql.includes(`INSERT INTO public.${tabela} `)) {
    falhou(
      `restaurar.sql tem INSERT para ${tabela}, que está marcada como fora do restore.\n` +
        "       Ela não existe num banco recém-criado: o INSERT aborta a transação\n" +
        "       e NADA é restaurado. Regere com: npm run backup -- --regerar-sql <pasta>",
    );
  }
}
if (falhas === falhasAntes) ok("restaurar.sql cobre todas as tabelas não vazias");

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

const EXE = process.platform === "win32" ? "docker.exe" : "docker";

/**
 * Chama o docker SEM shell, devolvendo saída, erro e código.
 *
 * Antes usava `shell: true` no Windows: os argumentos viravam uma linha só
 * e o cmd.exe reinterpretava `(`, `)` e `;`. O SQL da recontagem
 * (`SELECT count(*) FROM public.x;`) chegava despedaçado no psql, a saída
 * voltava vazia e `Number("")` dava 0 — a conferência acusava
 * "restaurado tem 0" em toda tabela, mesmo com a restauração correta.
 * Guarda cega ao contrário: não podia passar nunca.
 */
const docker = (args) => {
  const r = spawnSync(EXE, args, { encoding: "utf8" });
  return { out: r.stdout ?? "", err: r.stderr ?? "", code: r.status ?? -1 };
};

const temDocker = docker(["ps"]).code === 0;

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

try {
  docker(["rm", "-f", CONTAINER]);

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
    if (docker(["exec", CONTAINER, "pg_isready", "-U", "postgres"]).code === 0) {
      pronto = true;
      break;
    }
  }
  if (!pronto) throw new Error("o postgres do container não subiu a tempo");
  ok("postgres descartável no ar");

  /** Roda um script no container. Devolve stdout E stderr — é no stderr
   *  que o psql escreve os ERROR, e era ele que estava sendo descartado. */
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

  const errosDe = (saida) =>
    saida.err.split("\n").filter((l) => /\bERROR\b/.test(l));

  // As migrations criam o schema. Erros de objeto do Supabase (auth.uid,
  // storage.*, roles) são esperados fora do Supabase — o que precisa
  // existir são as TABELAS de public.
  console.log("  aplicando migrations …");
  const migrations = fs
    .readdirSync(path.join(RAIZ, "supabase", "migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  // Fora do Supabase, `auth` e `storage` não existem. O prelúdio recria o
  // mínimo que as migrations tocam — inclusive as COLUNAS de auth.users e as
  // tabelas de storage, senão dezenas de policies falham e o schema
  // restaurado deixa de parecer com o de produção.
  const preludio = [
    "CREATE SCHEMA IF NOT EXISTS auth;",
    "CREATE SCHEMA IF NOT EXISTS storage;",
    "CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;",
    "CREATE OR REPLACE FUNCTION auth.email() RETURNS text LANGUAGE sql AS $$ SELECT NULL::text $$;",
    "CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT NULL::text $$;",
    `CREATE TABLE IF NOT EXISTS auth.users (
       id uuid PRIMARY KEY,
       email text,
       encrypted_password text,
       email_confirmed_at timestamptz,
       raw_user_meta_data jsonb,
       raw_app_meta_data jsonb,
       created_at timestamptz DEFAULT now()
     );`,
    `CREATE TABLE IF NOT EXISTS storage.buckets (
       id text PRIMARY KEY,
       name text,
       public boolean DEFAULT false,
       file_size_limit bigint,
       allowed_mime_types text[],
       created_at timestamptz DEFAULT now()
     );`,
    `CREATE TABLE IF NOT EXISTS storage.objects (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
       bucket_id text,
       name text,
       owner uuid,
       metadata jsonb,
       created_at timestamptz DEFAULT now()
     );`,
    // Usada por 15 policies de Storage para ler a pasta do caminho.
    "CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[] " +
      "LANGUAGE sql AS $$ SELECT string_to_array(name, '/') $$;",
    "DO $$ BEGIN CREATE PUBLICATION supabase_realtime; EXCEPTION WHEN duplicate_object THEN NULL; END $$;",
    "DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;",
    "DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;",
    "DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;",
  ].join("\n");

  const saidaMig = psql(
    preludio +
      "\n" +
      migrations
        .map((f) => fs.readFileSync(path.join(RAIZ, "supabase", "migrations", f), "utf8"))
        .join("\n"),
  );

  // Erro em objeto do Supabase é esperado fora dele. Erro em `public.` não é:
  // significa que as migrations não reconstroem o schema que o dump espera.
  const errosMigration = errosDe(saidaMig);
  const errosPublic = errosMigration.filter((l) => /\bpublic\./.test(l));
  if (errosPublic.length > 0) {
    falhou(`${errosPublic.length} erro(s) em public. ao aplicar as migrations:`);
    for (const l of errosPublic.slice(0, 5)) console.log(`         ${l.trim()}`);
  } else if (errosMigration.length > 0) {
    console.log(
      `  \x1b[33mNOTA \x1b[0m ${errosMigration.length} erro(s) em objetos do Supabase ` +
        "(auth/storage/realtime) — esperado fora do Supabase",
    );
  }

  console.log("  aplicando restaurar.sql …");
  const saidaRestore = psql(fs.readFileSync(path.join(DESTINO, "restaurar.sql"), "utf8"));

  // O restaurar.sql é UMA transação: o primeiro erro aborta tudo e o COMMIT
  // vira ROLLBACK. Sem ler o stderr, isso aparecia só como "0 linhas" e
  // parecia um backup vazio em vez de um restore que falhou.
  const errosRestore = errosDe(saidaRestore).filter(
    (l) => !/current transaction is aborted/.test(l),
  );
  if (errosRestore.length > 0) {
    falhou(`restaurar.sql deu ${errosRestore.length} erro(s). O primeiro derruba o resto:`);
    for (const l of errosRestore.slice(0, 3)) console.log(`         ${l.trim()}`);
  }
  if (/^ROLLBACK$/m.test(saidaRestore.out)) {
    falhou("a transação do restaurar.sql terminou em ROLLBACK — nada foi restaurado");
  }

  // A prova: recontar dentro do banco restaurado.
  console.log("  recontando …");
  let divergencias = 0;
  let conferidas = 0;
  for (const { tabela, linhas } of manifesto.tabelas) {
    if (linhas === 0 || puladas.has(tabela)) continue;
    const r = docker([
      "exec", CONTAINER, "psql", "-U", "postgres", "-d", "restore_test",
      "-tAc", `SELECT count(*) FROM public.${tabela};`,
    ]);
    // Contagem que não roda não pode virar 0 em silêncio: 0 é um número
    // plausível e o erro passaria por "tabela vazia".
    if (r.code !== 0) {
      falhou(`${tabela}: a recontagem não rodou — ${r.err.trim().split("\n")[0]}`);
      divergencias++;
      continue;
    }
    const n = Number(r.out.trim());
    if (!Number.isInteger(n)) {
      falhou(`${tabela}: recontagem devolveu algo que não é número (${JSON.stringify(r.out)})`);
      divergencias++;
      continue;
    }
    if (n !== linhas) {
      falhou(`${tabela}: backup tem ${linhas}, restaurado tem ${n}`);
      divergencias++;
      continue;
    }
    conferidas++;
  }
  if (divergencias === 0 && conferidas > 0) {
    ok(`${conferidas} tabela(s) restauraram com a contagem exata`);
  } else if (divergencias === 0) {
    falhou("nenhuma tabela tinha linhas para conferir — o restore não provou nada");
  }

  // -------------------------------------------------------------------
  // Integridade referencial: contagem certa não é dado certo.
  //
  // O restore roda com session_replication_role = replica, que desliga a
  // checagem de FK. Já aconteceu de `categorias` ficar com a contagem exata
  // mas com ids errados, deixando todo `trabalhos.categoria_id` apontando
  // para o nada — e a conferência aprovou. Aqui as FKs são conferidas à mão.
  // -------------------------------------------------------------------
  console.log("  conferindo as chaves estrangeiras …");
  const saidaFk = psql(`
    \\pset tuples_only on
    \\pset format unaligned
    CREATE TEMP TABLE _orfaos(origem text, destino text, coluna text, n bigint);
    DO $$
    DECLARE r record; c bigint;
    BEGIN
      FOR r IN
        SELECT con.conrelid::regclass::text  AS origem,
               con.confrelid::regclass::text AS destino,
               quote_ident(sa.attname)       AS scol,
               quote_ident(ta.attname)       AS tcol
          FROM pg_constraint con
          JOIN pg_class cl     ON cl.oid = con.conrelid
          JOIN pg_namespace ns ON ns.oid = cl.relnamespace
          JOIN pg_attribute sa ON sa.attrelid = con.conrelid  AND sa.attnum = con.conkey[1]
          JOIN pg_attribute ta ON ta.attrelid = con.confrelid AND ta.attnum = con.confkey[1]
         WHERE con.contype = 'f' AND ns.nspname = 'public'
           AND array_length(con.conkey, 1) = 1
      LOOP
        EXECUTE format(
          'SELECT count(*) FROM %s s WHERE s.%s IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM %s t WHERE t.%s = s.%s)',
          r.origem, r.scol, r.destino, r.tcol, r.scol) INTO c;
        IF c > 0 THEN
          INSERT INTO _orfaos VALUES (r.origem, r.destino, r.scol, c);
        END IF;
      END LOOP;
    END $$;
    SELECT origem || '|' || destino || '|' || coluna || '|' || n FROM _orfaos;
  `);

  const orfaos = saidaFk.out
    .split("\n")
    .filter((l) => l.includes("|"))
    .map((l) => {
      const [origem, destino, coluna, n] = l.trim().split("|");
      return { origem, destino, coluna, n: Number(n) };
    });

  // FK para auth.users sempre "quebra" no ensaio: o backup não copia as
  // contas (elas moram no schema auth, fora do alcance deste dump). É um
  // limite conhecido do backup, não um defeito da restauração.
  const quebradas = orfaos.filter((o) => !/^auth\./.test(o.destino));
  const contas = orfaos.filter((o) => /^auth\./.test(o.destino));

  for (const o of quebradas) {
    falhou(`${o.origem}.${o.coluna}: ${o.n} linha(s) apontam para ${o.destino} inexistente`);
  }
  if (quebradas.length === 0) {
    ok("nenhuma FK órfã entre as tabelas de public");
  }
  if (contas.length > 0) {
    const total = contas.reduce((s, o) => s + o.n, 0);
    console.log(
      `  \x1b[33mNOTA \x1b[0m ${total} linha(s) referenciam auth.users, que este backup NÃO copia.\n` +
        "         Restaurar num projeto novo deixa esses donos órfãos: os dados\n" +
        "         voltam, as contas não. Ver o item auth.users no CLAUDE.md.",
    );
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
