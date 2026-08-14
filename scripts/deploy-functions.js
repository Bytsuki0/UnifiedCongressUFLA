#!/usr/bin/env node
/**
 * Deploy das Edge Functions pela Management API — sem Supabase CLI e sem
 * Docker, no mesmo padrão de scripts/migrate.js e scripts/gen-types.js.
 *
 * O projeto nunca adotou o Supabase CLI (ver CLAUDE.md): tudo que toca o
 * servidor passa pela Management API autenticada com o access token
 * pessoal. O service_role NÃO é usado aqui.
 *
 * Como funciona: POST multipart em
 *   /v1/projects/{ref}/functions/deploy?slug=<slug>
 * com o campo `metadata` (JSON) e um campo `file` por arquivo do fonte.
 * Os caminhos em `metadata.entrypoint_path` e no nome de cada parte são
 * RELATIVOS À RAIZ DO REPOSITÓRIO, com barras normais — é assim que o
 * CLI oficial monta o formulário, e o servidor casa um com o outro.
 *
 * ⚠ PUBLICA EM PRODUÇÃO. Só rodar a pedido explícito.
 *
 * Env vars:
 *   VITE_SUPABASE_URL     — lido do .env
 *   SUPABASE_ACCESS_TOKEN — personal access token (supabase.com/dashboard/account/tokens)
 *
 * Uso (PowerShell):
 *   $env:SUPABASE_ACCESS_TOKEN = "sbp_..."
 *   npm run deploy:functions                  # publica todas as functions
 *   npm run deploy:functions -- enviar-email  # publica só essa
 *   npm run deploy:functions -- --dry-run     # mostra o que subiria, não envia
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadDotEnv } from "./load-dotenv.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(__dirname, "..");
const DIR_FUNCTIONS = path.join(RAIZ, "supabase", "functions");

loadDotEnv();

const SIMULACAO = process.argv.includes("--dry-run");
const SLUGS_PEDIDOS = process.argv.slice(2).filter((a) => !a.startsWith("--"));

const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

const abortar = (msg) => {
  console.error(`\nERRO: ${msg}`);
  process.exit(1);
};

if (!SUPABASE_URL) {
  abortar("VITE_SUPABASE_URL precisa estar definida (normalmente vem do .env).");
}
if (!ACCESS_TOKEN && !SIMULACAO) {
  console.error("\nERRO: SUPABASE_ACCESS_TOKEN precisa estar definida.");
  console.error("Pegue um token em https://supabase.com/dashboard/account/tokens e rode:");
  console.error('  PowerShell:  $env:SUPABASE_ACCESS_TOKEN = "sbp_..."; npm run deploy:functions');
  console.error("O token nunca deve ir para arquivo versionado — só variável de ambiente.");
  process.exit(1);
}

const PROJECT_REF = SUPABASE_URL.replace("https://", "").split(".")[0];

/** Secrets que as functions de e-mail exigem em runtime (só conferência). */
const SECRETS_ESPERADOS = ["BREVO_API_KEY", "EMAIL_REMETENTE", "SITE_URL"];

/** Functions que dependem dos SECRETS_ESPERADOS (dispara a conferência). */
const FUNCTIONS_COM_SECRETS = ["enviar-email", "redefinir-senha"];

/**
 * `verify_jwt` por function; ausente = true.
 *
 * `redefinir-senha` fica SEM a verificação do gateway de propósito: o
 * fluxo "esqueci minha senha" é anônimo por definição, e a chave
 * `sb_publishable_` que o frontend envia como Authorization NÃO é um
 * JWT — o gateway a recusaria. A proteção mora em outro lugar: CORS
 * com allowlist na function e limites em SQL (5 pedidos/hora por IP,
 * 1 pedido/2 h por conta — migration 20260814120000).
 */
const VERIFY_JWT_POR_SLUG = { "redefinir-senha": false };

/** Caminho relativo à raiz do repo, sempre com barras normais. */
const caminhoApi = (absoluto) => path.relative(RAIZ, absoluto).split(path.sep).join("/");

/** Todos os arquivos de uma pasta de function (o fonte inteiro sobe). */
function listarArquivos(dir) {
  const encontrados = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const completo = path.join(dir, item.name);
    if (item.isDirectory()) encontrados.push(...listarArquivos(completo));
    else encontrados.push(completo);
  }
  return encontrados;
}

/** Pastas em supabase/functions/ que têm um index.ts. `_shared` e afins ficam de fora. */
function descobrirSlugs() {
  if (!fs.existsSync(DIR_FUNCTIONS)) return [];
  return fs
    .readdirSync(DIR_FUNCTIONS, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
    .map((d) => d.name)
    .filter((slug) => fs.existsSync(path.join(DIR_FUNCTIONS, slug, "index.ts")))
    .sort();
}

/** Lista os NOMES dos secrets do projeto (o valor nunca é impresso). */
async function nomesDosSecrets() {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/secrets`, {
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
  });
  if (!res.ok) return null;
  try {
    return (await res.json()).map((s) => s.name);
  } catch {
    return null;
  }
}

async function publicar(slug) {
  const dir = path.join(DIR_FUNCTIONS, slug);
  const entrypoint = path.join(dir, "index.ts");
  if (!fs.existsSync(entrypoint)) {
    abortar(`supabase/functions/${slug}/index.ts não existe.`);
  }

  const arquivos = listarArquivos(dir);
  const metadata = {
    name: slug,
    // Com `true`, a plataforma exige JWT válido antes de chegar à function.
    // É apenas a primeira camada: qualquer JWT do projeto passa aqui, então
    // a function ainda resolve o usuário com getUser(). Quem precisa aceitar
    // chamada anônima declara `false` em VERIFY_JWT_POR_SLUG (com o porquê).
    verify_jwt: VERIFY_JWT_POR_SLUG[slug] ?? true,
    entrypoint_path: caminhoApi(entrypoint),
    import_map_path: "",
    static_patterns: [],
  };

  console.log(`\n▸ ${slug}`);
  console.log(`  entrypoint : ${metadata.entrypoint_path}`);
  for (const arquivo of arquivos) {
    console.log(`  arquivo    : ${caminhoApi(arquivo)} (${fs.statSync(arquivo).size} bytes)`);
  }

  if (SIMULACAO) {
    console.log("  --dry-run: nada foi enviado.");
    return;
  }

  const form = new FormData();
  form.append("metadata", JSON.stringify(metadata));
  for (const arquivo of arquivos) {
    form.append("file", new File([fs.readFileSync(arquivo)], caminhoApi(arquivo)));
  }

  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/functions/deploy?slug=${encodeURIComponent(slug)}`,
    { method: "POST", headers: { Authorization: `Bearer ${ACCESS_TOKEN}` }, body: form },
  );

  const corpo = await res.text();
  if (res.status !== 201) {
    let msg;
    try {
      msg = JSON.parse(corpo)?.message || corpo;
    } catch {
      msg = corpo;
    }
    abortar(`o deploy de "${slug}" devolveu HTTP ${res.status}: ${msg}`);
  }

  const info = JSON.parse(corpo);
  console.log(`  ✓ publicada — versão ${info.version}, status ${info.status}`);
  console.log(`    ${SUPABASE_URL}/functions/v1/${slug}`);
}

async function main() {
  console.log("=== Deploy de Edge Functions ===");
  console.log(`Projeto : ${PROJECT_REF}`);
  console.log(`Modo    : ${SIMULACAO ? "simulação (--dry-run)" : "PRODUÇÃO"}`);

  const disponiveis = descobrirSlugs();
  if (disponiveis.length === 0) {
    abortar("nenhuma function encontrada em supabase/functions/ (esperado <slug>/index.ts).");
  }

  const desconhecidos = SLUGS_PEDIDOS.filter((s) => !disponiveis.includes(s));
  if (desconhecidos.length > 0) {
    abortar(
      `function(s) inexistente(s): ${desconhecidos.join(", ")}.\n` +
        `Disponíveis: ${disponiveis.join(", ")}`,
    );
  }

  const alvos = SLUGS_PEDIDOS.length > 0 ? SLUGS_PEDIDOS : disponiveis;
  console.log(`Alvos   : ${alvos.join(", ")}`);

  for (const slug of alvos) await publicar(slug);

  if (SIMULACAO) return;

  // Conferência dos secrets: a function sobe mesmo sem eles, mas devolve
  // "config_ausente" na primeira chamada. Melhor descobrir agora.
  if (alvos.some((slug) => FUNCTIONS_COM_SECRETS.includes(slug))) {
    const nomes = await nomesDosSecrets();
    if (nomes === null) {
      console.log("\n⚠  Não foi possível listar os secrets do projeto (sem permissão?).");
    } else {
      const faltando = SECRETS_ESPERADOS.filter((n) => !nomes.includes(n));
      if (faltando.length > 0) {
        console.log(`\n⚠  Secrets ausentes: ${faltando.join(", ")}`);
        console.log("   A function responderá `config_ausente` até você rodar:");
        console.log("     npm run config:secrets");
      } else {
        console.log(`\n  OK   secrets presentes: ${SECRETS_ESPERADOS.join(", ")}`);
      }
    }
  }

  console.log("\n✓ Concluído.");
}

main().catch((err) => {
  console.error(`\nDeploy das functions falhou: ${err.message}`);
  process.exit(1);
});
