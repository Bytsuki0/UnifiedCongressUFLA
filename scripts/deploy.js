#!/usr/bin/env node
/**
 * Etapa 6 do plano de deploy — a ÚNICA forma suportada de atualizar o site.
 *
 * Sequência: build limpo → travas de segurança → upload direto pelo
 * wrangler → verificação da URL pública contra o build-id que acabou de
 * subir. Se qualquer trava falhar, nada é enviado.
 *
 * Porte em Node do deploy.sh do plano (Windows não tem bash/grep aqui).
 *
 * Uso:
 *   npm run deploy               # publica em produção e verifica
 *   npm run deploy -- --preview  # publica e verifica só a URL .pages.dev
 *   npm run deploy -- --dry-run  # roda as travas, NÃO envia nada
 *
 * Pré-requisito, uma vez por máquina:  npx wrangler login
 */

import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(__dirname, "..");
const DIST = path.join(RAIZ, "dist");

const PROJETO = process.env.CF_PAGES_PROJECT || "ciufla";
const URL_PRODUCAO = process.env.DEPLOY_URL || "https://ciuflaictin.com.br";
// Fallback: a URL real é extraída da saída do wrangler (ver abaixo). Esta
// constante só entra em cena se o formato da saída mudar.
const URL_PREVIEW_PADRAO = `https://${PROJETO}.ictin-ufla.workers.dev`;

const SO_PREVIEW = process.argv.includes("--preview");
const SIMULACAO = process.argv.includes("--dry-run");

const passo = (msg) => console.log(`\n\x1b[36m▸ ${msg}\x1b[0m`);
const abortar = (msg) => {
  console.error(`\n\x1b[31mABORTADO: ${msg}\x1b[0m`);
  process.exit(1);
};

const rodar = (cmd, args) =>
  execFileSync(cmd, args, { cwd: RAIZ, stdio: "inherit", shell: process.platform === "win32" });

// ---------------------------------------------------------------------
// 1. Build limpo
// ---------------------------------------------------------------------
passo("Build de produção");
rodar("npm", ["run", "build"]);

// ---------------------------------------------------------------------
// 2. Travas — cada uma já falhou de verdade em algum projeto
// ---------------------------------------------------------------------
passo("Travas de segurança do bundle");

if (!fs.existsSync(DIST)) abortar("dist/ não existe depois do build.");

/**
 * Procura credenciais de servidor no bundle.
 *
 * O plano original manda fazer `grep -q "service_role" dist/`. Isso NÃO
 * pega o caso que importa: a chave service_role de verdade é um JWT, e a
 * string "service_role" vive base64-codificada dentro do payload — o
 * grep literal passa batido justamente na chave real. Por isso aqui são
 * três verificações:
 *
 *   1. `sb_secret_` — formato novo de chave secreta do Supabase, literal
 *   2. `service_role` sem diferenciar maiúsculas — pega .env vazado,
 *      nome de variável, comentário
 *   3. todo token parecido com JWT tem o payload decodificado e o campo
 *      `role` inspecionado — é o que pega a chave real
 */
const arquivosDoDist = [];
(function varrer(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const completo = path.join(dir, item.name);
    if (item.isDirectory()) varrer(completo);
    else arquivosDoDist.push(completo);
  }
})(DIST);

const vazamentos = [];
const JWT_RE = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g;

for (const arquivo of arquivosDoDist) {
  const conteudo = fs.readFileSync(arquivo, "utf8");
  const rel = path.relative(RAIZ, arquivo);

  if (conteudo.includes("sb_secret_")) {
    vazamentos.push(`${rel}: chave sb_secret_ (secret key do Supabase)`);
  }
  if (/service_role/i.test(conteudo)) {
    vazamentos.push(`${rel}: a string "service_role" aparece em texto`);
  }
  for (const token of conteudo.match(JWT_RE) ?? []) {
    try {
      const payload = JSON.parse(
        Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
      );
      if (payload.role && payload.role !== "anon") {
        vazamentos.push(`${rel}: JWT com role="${payload.role}" (esperado "anon")`);
      }
    } catch {
      /* não era um JWT legível — ignorar */
    }
  }
}

if (vazamentos.length) {
  abortar(
    `credencial de servidor encontrada no bundle:\n  ${[...new Set(vazamentos)].join("\n  ")}\n` +
      "Uma chave dessas ignora o RLS por completo. Remover do bundle E " +
      "rotacionar a chave no dashboard do Supabase — publicada, ela já vazou.",
  );
}
console.log(`  OK   nenhuma credencial de servidor em ${arquivosDoDist.length} arquivos`);

/**
 * Fallback de SPA.
 *
 * No Pages isso era o arquivo `_redirects` com `/* /index.html 200`. Em
 * Workers com static assets essa regra é REJEITADA pela API ("infinite
 * loop detected") e quem resolve é o `not_found_handling` do
 * wrangler.jsonc. A trava mudou de alvo junto: o que não pode faltar
 * agora é a configuração, não o arquivo.
 */
const wranglerConfig = fs.readFileSync(path.join(RAIZ, "wrangler.jsonc"), "utf8");
if (!/"not_found_handling"\s*:\s*"single-page-application"/.test(wranglerConfig)) {
  abortar(
    'wrangler.jsonc sem `"not_found_handling": "single-page-application"` — ' +
      "recarregar a página em /estudante/historico devolveria 404.",
  );
}
console.log("  OK   fallback de SPA configurado (not_found_handling)");

if (fs.existsSync(path.join(DIST, "_redirects"))) {
  abortar(
    "dist/_redirects existe — em Workers a regra catch-all é rejeitada pela API " +
      "da Cloudflare e derruba o deploy inteiro. Remover public/_redirects.",
  );
}
console.log("  OK   sem _redirects conflitante");

if (!fs.existsSync(path.join(DIST, "_headers"))) {
  abortar("_headers ausente — o site iria ao ar sem cabeçalhos de segurança.");
}
console.log("  OK   _headers presente");

const indexHtml = fs.readFileSync(path.join(DIST, "index.html"), "utf8");
const buildId = indexHtml.match(/name="build-id"\s+content="([^"]+)"/)?.[1];
if (!buildId) abortar("index.html sem <meta name=\"build-id\"> — a verificação pós-deploy cega.");
console.log(`  OK   build-id: ${buildId}`);

passo("Trava de consolidação (acesso ao Supabase)");
try {
  rodar("node", ["scripts/check-consolidacao.js"]);
} catch {
  abortar("há acesso direto ao Supabase fora de src/services — ver lista acima.");
}

// ---------------------------------------------------------------------
// 3. Upload
// ---------------------------------------------------------------------
if (SIMULACAO) {
  console.log("\n--dry-run: travas passaram, nada foi enviado.");
  process.exit(0);
}

passo(`Enviando o Worker "${PROJETO}"`);
// O projeto usa Workers com static assets (@cloudflare/vite-plugin +
// wrangler.jsonc), não o Pages direct upload do plano original. O bundle
// servido é o mesmo dist/; muda só o comando de envio. `_headers` e
// `_redirects` continuam valendo, e o SPA fallback também vem do
// `assets.not_found_handling` do wrangler.jsonc.
let saidaWrangler = "";
try {
  // stdout capturado para extrair a URL publicada; stderr segue direto
  // para o terminal, senão o progresso do upload sumiria.
  saidaWrangler = execFileSync("npx", ["wrangler", "deploy"], {
    cwd: RAIZ,
    encoding: "utf8",
    stdio: ["inherit", "pipe", "inherit"],
    shell: process.platform === "win32",
  });
  console.log(saidaWrangler);
} catch (err) {
  if (err.stdout) console.log(err.stdout);
  abortar(
    "o wrangler falhou — ver a mensagem acima.\n" +
      "  · autenticação: rode `npx wrangler login` uma vez nesta máquina\n" +
      "  · subdomínio workers.dev indisponível: registre um em\n" +
      "    https://dash.cloudflare.com/?to=/:account/workers/onboarding",
  );
}

// O wrangler imprime a URL publicada; é ela que vale, não um palpite nosso.
const urlPublicada = saidaWrangler.match(/https:\/\/[^\s]+\.workers\.dev/)?.[0];

// ---------------------------------------------------------------------
// 4. Verificação da URL pública
// ---------------------------------------------------------------------
const alvo = SO_PREVIEW ? (urlPublicada ?? URL_PREVIEW_PADRAO) : URL_PRODUCAO;

passo(`Aguardando propagação e verificando ${alvo}`);

// Sleep em Node puro: `timeout` do Windows não roda sob Git Bash e
// `sleep` não existe no cmd.exe — qualquer um dos dois quebraria aqui.
const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A borda leva alguns segundos para servir o bundle novo, e o tempo varia.
 * Um sleep fixo de 10s dava falso negativo de build-id — a verificação
 * acusava "cache velho" num deploy que estava correto. Aqui a espera é por
 * tentativa, até o build-id no ar bater com o que subiu.
 */
const TENTATIVAS = 6;
let noAr = null;
for (let i = 1; i <= TENTATIVAS; i++) {
  await esperar(5000);
  try {
    const resp = await fetch(`${alvo}/`, { headers: { "Cache-Control": "no-cache" } });
    noAr = (await resp.text()).match(/name="build-id"\s+content="([^"]+)"/)?.[1] ?? null;
  } catch {
    noAr = null;
  }
  if (noAr === buildId) break;
  console.log(`  tentativa ${i}/${TENTATIVAS}: no ar ${noAr ?? "(sem resposta)"}`);
}

if (noAr !== buildId) {
  abortar(
    `depois de ${TENTATIVAS} tentativas o ar ainda serve ${noAr ?? "(nada)"}, ` +
      `esperado ${buildId}.\nPurgue o cache na Cloudflare e rode:\n` +
      `  node scripts/verify-deploy.js ${alvo} ${buildId}`,
  );
}

try {
  rodar("node", ["scripts/verify-deploy.js", alvo, buildId]);
} catch {
  abortar(`o deploy subiu mas ${alvo} não passou na verificação — ver acima.`);
}

console.log(`\n\x1b[32mPublicado e verificado: ${alvo}\x1b[0m`);
console.log(`build-id ${buildId}`);
