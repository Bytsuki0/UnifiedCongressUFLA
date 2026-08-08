#!/usr/bin/env node
/**
 * Etapa 3 do plano de deploy — verificação de um deploy publicado.
 *
 * Checa de fora, contra a URL real, o que só falha em produção: rota
 * profunda da SPA (pega _redirects faltando), cabeçalhos de segurança
 * (pega _headers que não chegou ao dist/) e, opcionalmente, se o build no
 * ar é o que acabou de subir (pega cache velho da Cloudflare).
 *
 * Porte em Node do verify-deploy.sh do plano: esta máquina é Windows e o
 * script original depende de bash + curl + grep.
 *
 * Uso:
 *   node scripts/verify-deploy.js https://nexus.pages.dev
 *   node scripts/verify-deploy.js https://ciuflaictin.com.br <build-id>
 *   npm run verify:deploy -- https://ciuflaictin.com.br
 *
 * Sem o <build-id>, a checagem de frescor é pulada — o script avisa.
 */

const URL_BASE = (process.argv[2] || "").replace(/\/$/, "");
const BUILD_ESPERADO = process.argv[3] || "";

if (!URL_BASE) {
  console.error("uso: node scripts/verify-deploy.js <url> [build-id]");
  process.exit(2);
}

let falhas = 0;
const ok = (msg) => console.log(`  \x1b[32mOK  \x1b[0m ${msg}`);
const falhou = (msg) => {
  console.log(`  \x1b[31mFALHA\x1b[0m ${msg}`);
  falhas++;
};

/** GET com timeout, devolvendo status, cabeçalhos e corpo. */
async function buscar(caminho, opcoes = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const resp = await fetch(URL_BASE + caminho, {
      redirect: "follow",
      signal: ctrl.signal,
      ...opcoes,
    });
    const corpo = opcoes.method === "HEAD" ? "" : await resp.text();
    return { status: resp.status, headers: resp.headers, corpo };
  } finally {
    clearTimeout(t);
  }
}

console.log(`\nVerificando ${URL_BASE}\n`);

// 1. Raiz responde.
try {
  const { status } = await buscar("/");
  status === 200 ? ok("raiz responde 200") : falhou(`raiz respondeu ${status}, esperado 200`);
} catch (err) {
  falhou(`raiz inacessível (${err.message})`);
}

// 2. Rota profunda da SPA. É a checagem que pega _redirects faltando —
//    a falha mais provável de chegar a um usuário real, porque só aparece
//    quando alguém recarrega a página em vez de navegar pelo menu.
try {
  const { status, corpo } = await buscar("/estudante/historico");
  if (status !== 200) {
    falhou(`rota profunda respondeu ${status} — _redirects não chegou ao dist/`);
  } else if (!corpo.includes('id="root"')) {
    falhou("rota profunda respondeu 200 mas não devolveu o index.html da SPA");
  } else {
    ok("rota profunda serve o index.html (SPA fallback ativo)");
  }
} catch (err) {
  falhou(`rota profunda inacessível (${err.message})`);
}

// 3. Cabeçalhos de segurança da regra /*.
try {
  const { headers } = await buscar("/");
  const esperados = {
    "x-frame-options": "SAMEORIGIN",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
  };
  for (const [nome, valor] of Object.entries(esperados)) {
    const atual = headers.get(nome);
    if (!atual) falhou(`cabeçalho ${nome} ausente — _headers não chegou ao dist/`);
    else if (atual.toLowerCase() !== valor.toLowerCase())
      falhou(`cabeçalho ${nome}: "${atual}", esperado "${valor}"`);
    else ok(`cabeçalho ${nome}: ${atual}`);
  }
} catch (err) {
  falhou(`não consegui ler cabeçalhos (${err.message})`);
}

// 4. Rota autenticada não pode ser indexável.
try {
  const { headers } = await buscar("/admin/papeis");
  const robots = headers.get("x-robots-tag");
  robots && /noindex/i.test(robots)
    ? ok(`/admin/* com X-Robots-Tag: ${robots}`)
    : falhou(`/admin/* sem X-Robots-Tag noindex (veio: ${robots || "nada"})`);
} catch (err) {
  falhou(`não consegui checar X-Robots-Tag (${err.message})`);
}

// 5. HTTP tem que ir para HTTPS.
//
// Em *.workers.dev a zona é da Cloudflare, não nossa: o "Always Use HTTPS"
// não é configurável e o host responde 200 em claro. Não dá para corrigir,
// então ali isso é NOTA. No domínio próprio é FALHA — lá o redirecionamento
// depende de um botão que é nosso, e servir a aplicação em claro expõe a
// sessão de quem digita o endereço sem https.
const ehWorkersDev = /\.workers\.dev$/i.test(new URL(URL_BASE).hostname);

if (URL_BASE.startsWith("https://")) {
  const semTls = URL_BASE.replace("https://", "http://");
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    const resp = await fetch(semTls + "/", { redirect: "manual", signal: ctrl.signal });
    clearTimeout(t);
    if (resp.status === 301 || resp.status === 308 || resp.status === 302) {
      ok(`http → https (${resp.status})`);
    } else if (resp.status === 200) {
      if (ehWorkersDev) {
        console.log(
          "  \x1b[36mNOTA \x1b[0m http responde 200 em claro — em *.workers.dev a zona é\n" +
            "         da Cloudflare e o redirecionamento não é configurável.\n" +
            "         No domínio próprio isto vira FALHA: ligar 'Always Use\n" +
            "         HTTPS' na zona antes de anunciar o endereço.",
        );
      } else {
        falhou(
          "http respondeu 200 sem redirecionar — ligar 'Always Use HTTPS' na zona",
        );
      }
    } else {
      ok(`http respondeu ${resp.status} (não serve conteúdo em claro)`);
    }
  } catch (err) {
    ok(`http recusou conexão (${err.message.slice(0, 40)})`);
  }
}

// 6. HSTS — obriga o navegador a usar https nas visitas seguintes.
{
  const { headers } = await buscar("/");
  const hsts = headers.get("strict-transport-security");
  if (hsts && /max-age=\d+/.test(hsts)) ok(`HSTS presente: ${hsts}`);
  else falhou("Strict-Transport-Security ausente — _headers não chegou ao dist/");
}

// 6. O build no ar é o que acabou de subir?
if (BUILD_ESPERADO) {
  try {
    const { corpo } = await buscar("/", { headers: { "Cache-Control": "no-cache" } });
    const m = corpo.match(/name="build-id"\s+content="([^"]+)"/);
    if (!m) falhou("index.html no ar não tem <meta name=\"build-id\">");
    else if (m[1] === BUILD_ESPERADO) ok(`build no ar é ${m[1]}`);
    else
      falhou(
        `build no ar é ${m[1]}, esperado ${BUILD_ESPERADO} — ` +
          "bundle velho em cache; purgar cache na Cloudflare e repetir"
      );
  } catch (err) {
    falhou(`não consegui ler o build-id (${err.message})`);
  }
} else {
  console.log(
    "  \x1b[36mNOTA \x1b[0m sem <build-id> no argumento: frescor do bundle não verificado."
  );
}

console.log("\n" + "─".repeat(64));
if (falhas > 0) {
  console.error(`${falhas} verificação(ões) falharam em ${URL_BASE}.`);
  process.exit(1);
}
console.log(`${URL_BASE} verificado.`);
process.exit(0);
