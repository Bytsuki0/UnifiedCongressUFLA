#!/usr/bin/env node
/**
 * Suíte de segurança — cada verificação roda DUAS vezes.
 *
 * Uma vez com a árvore limpa, que tem de PASSAR, e uma vez com uma
 * vulnerabilidade plantada de propósito, que tem de FALHAR. Uma trava que
 * nunca disparou não é uma trava conhecida: se o canário passa, a
 * verificação está cega e o resultado limpo dela não vale nada.
 *
 * Esta suíte já pegou três travas cegas neste projeto:
 *   · o grep por "service_role" não via a chave real (JWT em base64);
 *   · a trava de consolidação não via chamadas quebradas em várias linhas;
 *   · a mesma trava não via o alias `const sb = supabase`.
 *
 * Uso:
 *   npm run check:seguranca
 *   npm run check:seguranca -- --url https://ciufla.ictin-ufla.workers.dev
 *
 * Os canários são criados e removidos automaticamente. Se a suíte for
 * interrompida no meio, rode-a de novo: a limpeza roda antes de cada teste.
 */

import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(__dirname, "..");

const argUrl = process.argv.indexOf("--url");
const URL_VIVA =
  argUrl !== -1 ? process.argv[argUrl + 1] : "https://ciufla.ictin-ufla.workers.dev";

const CANARIO_PUBLIC = path.join(RAIZ, "public", "__canario-seguranca.txt");
const CANARIO_PAGINA = path.join(RAIZ, "src", "pages", "__CanarioSeguranca.tsx");

let falhas = 0;
const resultados = [];

const limpar = () => {
  for (const f of [CANARIO_PUBLIC, CANARIO_PAGINA]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
};

/** Roda um comando e devolve só o código de saída. */
function codigoDeSaida(cmd, args) {
  try {
    execFileSync(cmd, args, {
      cwd: RAIZ,
      stdio: "pipe",
      shell: process.platform === "win32",
    });
    return 0;
  } catch (err) {
    return err.status ?? 1;
  }
}

/**
 * Executa um par de testes: `esperaPassar` deve sair 0 e `esperaFalhar`
 * deve sair != 0. Só o par completo conta como verificado.
 */
function par(nome, { limpo, canario, prepararCanario }) {
  console.log(`\n\x1b[1m${nome}\x1b[0m`);
  limpar();

  process.stdout.write("  passe certificado  … ");
  const codigoLimpo = limpo();
  const okLimpo = codigoLimpo === 0;
  console.log(okLimpo ? "\x1b[32mPASSOU\x1b[0m" : `\x1b[31mFALHOU (saída ${codigoLimpo})\x1b[0m`);

  process.stdout.write("  vulnerab. plantada … ");
  if (prepararCanario) prepararCanario();
  const codigoCanario = canario();
  const okCanario = codigoCanario !== 0;
  console.log(
    okCanario
      ? `\x1b[32mDETECTADA (saída ${codigoCanario})\x1b[0m`
      : "\x1b[31mNÃO DETECTADA — verificação CEGA\x1b[0m",
  );
  limpar();

  const ok = okLimpo && okCanario;
  if (!ok) falhas++;
  resultados.push({ nome, okLimpo, okCanario });
  return ok;
}

console.log("═".repeat(66));
console.log(" SUÍTE DE SEGURANÇA — cada teste roda limpo e com canário");
console.log("═".repeat(66));

// ---------------------------------------------------------------------
// 1. Credenciais de servidor no bundle
// ---------------------------------------------------------------------
par("1. Credencial de servidor no bundle (deploy.js)", {
  limpo: () => codigoDeSaida("node", ["scripts/deploy.js", "--dry-run"]),
  prepararCanario: () => {
    // JWT com role=service_role: a string literal "service_role" NÃO
    // aparece no arquivo, ela vive base64 dentro do payload. É o caso
    // que o `grep service_role` do plano original não pegava.
    const payload = Buffer.from(
      JSON.stringify({ iss: "supabase", role: "service_role", iat: 1700000000 }),
    ).toString("base64url");
    fs.writeFileSync(
      CANARIO_PUBLIC,
      `KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${payload}.assinaturafalsa\n`,
    );
  },
  canario: () => codigoDeSaida("node", ["scripts/deploy.js", "--dry-run"]),
});

// ---------------------------------------------------------------------
// 2. Consolidação do acesso ao Supabase
// ---------------------------------------------------------------------
par("2. Acesso direto ao Supabase fora de services (check-consolidacao.js)", {
  limpo: () => codigoDeSaida("node", ["scripts/check-consolidacao.js"]),
  prepararCanario: () => {
    // Chamada QUEBRADA EM VÁRIAS LINHAS e sob alias — as duas formas que
    // a primeira versão da trava não enxergava.
    fs.writeFileSync(
      CANARIO_PAGINA,
      [
        'import { supabase } from "@/integrations/supabase/client";',
        "",
        "const sb = supabase;",
        "",
        "export default function CanarioSeguranca() {",
        "  const carregar = async () => {",
        "    const { data } = await sb",
        '      .from("trabalhos")',
        '      .select("*");',
        "    return data;",
        "  };",
        "  return null;",
        "}",
        "",
      ].join("\n"),
    );
  },
  canario: () => codigoDeSaida("node", ["scripts/check-consolidacao.js"]),
});

// ---------------------------------------------------------------------
// 3. RLS — a sonda sabe ver um vazamento?
// ---------------------------------------------------------------------
par("3. RLS contra produção (rls-probe.js)", {
  limpo: () => codigoDeSaida("node", ["scripts/rls-probe.js"]),
  // --autoteste marca como "negada" duas tabelas que anon PODE ler.
  // A sonda tem de acusar vazamento nas duas.
  canario: () => codigoDeSaida("node", ["scripts/rls-probe.js", "--autoteste"]),
});

// ---------------------------------------------------------------------
// 4. Zona sob a Cloudflare
// ---------------------------------------------------------------------
par("4. DNS na Cloudflare (check-dns.js)", {
  limpo: () => codigoDeSaida("node", ["scripts/check-dns.js"]),
  // Domínio que comprovadamente não está na Cloudflare.
  canario: () => codigoDeSaida("node", ["scripts/check-dns.js", "ufla.br"]),
});

// ---------------------------------------------------------------------
// 5. Verificação do site publicado
// ---------------------------------------------------------------------
par(`5. Site publicado (verify-deploy.js → ${URL_VIVA})`, {
  limpo: () => codigoDeSaida("node", ["scripts/verify-deploy.js", URL_VIVA]),
  // Site real sem nenhum dos cabeçalhos nem o fallback de SPA.
  canario: () => codigoDeSaida("node", ["scripts/verify-deploy.js", "https://example.com"]),
});

// ---------------------------------------------------------------------
console.log("\n" + "═".repeat(66));
for (const r of resultados) {
  const marca = r.okLimpo && r.okCanario ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
  const detalhe = [
    r.okLimpo ? "limpo passa" : "\x1b[31mlimpo NÃO passa\x1b[0m",
    r.okCanario ? "canário detectado" : "\x1b[31mcanário NÃO detectado\x1b[0m",
  ].join(" · ");
  console.log(` ${marca} ${r.nome}\n     ${detalhe}`);
}
console.log("═".repeat(66));

if (falhas > 0) {
  console.error(
    `\n${falhas} verificação(ões) não estão comprovadamente funcionando.\n` +
      "Uma trava cega é pior que trava nenhuma: ela dá confiança falsa.",
  );
  process.exit(1);
}
console.log("\nTodas as verificações passam limpas E detectam a vulnerabilidade plantada.");
process.exit(0);
