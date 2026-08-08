#!/usr/bin/env node
/**
 * Grava os secrets das Edge Functions pela Management API — mesmo padrão
 * de scripts/migrate.js, sem Supabase CLI.
 *
 * Os três valores são lidos DO AMBIENTE, no momento da execução, e nunca
 * de arquivo: um segredo commitado permanece no histórico do git mesmo
 * depois de apagado. Por isso eles são capturados ANTES de `loadDotEnv()`
 * — se alguém escorregar e colocar BREVO_API_KEY no .env, este script
 * ignora e continua exigindo a variável de ambiente.
 *
 * ⚠ ESCREVE EM PRODUÇÃO. Só rodar a pedido explícito.
 *
 * Secrets gravados:
 *   BREVO_API_KEY    — chave da API v3 do Brevo (xkeysib-...)
 *   EMAIL_REMETENTE  — "Nome <endereco@dominio>" ou só o endereço.
 *                      O domínio precisa estar VERIFICADO no Brevo.
 *   SITE_URL         — base do link de confirmação, sem barra final
 *                      (ex.: https://ciuflaictin.com.br). Nunca vem do
 *                      header Host/Origin da requisição.
 *
 * Env vars de acesso:
 *   VITE_SUPABASE_URL     — lido do .env
 *   SUPABASE_ACCESS_TOKEN — personal access token
 *
 * Uso (PowerShell):
 *   $env:SUPABASE_ACCESS_TOKEN = "sbp_..."
 *   $env:BREVO_API_KEY   = "xkeysib-..."
 *   $env:EMAIL_REMETENTE = "Congresso Unificado ICTIN <nao-responda@ciuflaictin.com.br>"
 *   $env:SITE_URL        = "https://ciuflaictin.com.br"
 *   npm run config:secrets
 *
 *   npm run config:secrets -- --listar   # só mostra QUAIS secrets existem
 */

import { loadDotEnv } from "./load-dotenv.js";

// --- Captura ANTES do .env: o arquivo não pode suprir estes valores. ---
const DO_AMBIENTE = {
  BREVO_API_KEY: process.env.BREVO_API_KEY,
  EMAIL_REMETENTE: process.env.EMAIL_REMETENTE,
  SITE_URL: process.env.SITE_URL,
};

loadDotEnv(); // só para VITE_SUPABASE_URL

const APENAS_LISTAR = process.argv.includes("--listar");

const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

const abortar = (msg) => {
  console.error(`\nERRO: ${msg}`);
  process.exit(1);
};

if (!SUPABASE_URL) {
  abortar("VITE_SUPABASE_URL precisa estar definida (normalmente vem do .env).");
}
if (!ACCESS_TOKEN) {
  console.error("\nERRO: SUPABASE_ACCESS_TOKEN precisa estar definida.");
  console.error("Pegue um token em https://supabase.com/dashboard/account/tokens e rode:");
  console.error('  PowerShell:  $env:SUPABASE_ACCESS_TOKEN = "sbp_..."; npm run config:secrets');
  process.exit(1);
}

const PROJECT_REF = SUPABASE_URL.replace("https://", "").split(".")[0];
const URL_SECRETS = `https://api.supabase.com/v1/projects/${PROJECT_REF}/secrets`;

/** Mostra que o valor existe sem revelá-lo. */
const mascarar = (valor) => `${valor.slice(0, 3)}…${valor.slice(-2)} (${valor.length} chars)`;

async function listar() {
  const res = await fetch(URL_SECRETS, { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } });
  if (!res.ok) abortar(`não foi possível listar os secrets (HTTP ${res.status}).`);
  const nomes = (await res.json()).map((s) => s.name).sort();
  console.log(`\nSecrets do projeto (${nomes.length}) — apenas os nomes:`);
  nomes.forEach((n) => console.log(`  · ${n}`));
  return nomes;
}

async function main() {
  console.log("=== Secrets das Edge Functions ===");
  console.log(`Projeto : ${PROJECT_REF}`);

  if (APENAS_LISTAR) {
    await listar();
    return;
  }

  const faltando = Object.entries(DO_AMBIENTE)
    .filter(([, v]) => !v || v.trim() === "")
    .map(([k]) => k);

  if (faltando.length > 0) {
    console.error(`\nERRO: variável(is) de ambiente ausente(s): ${faltando.join(", ")}`);
    console.error("\nDefina as três no shell (nunca em arquivo versionado) e rode de novo:");
    console.error('  $env:BREVO_API_KEY   = "xkeysib-..."');
    console.error('  $env:EMAIL_REMETENTE = "Congresso Unificado ICTIN <nao-responda@ciuflaictin.com.br>"');
    console.error('  $env:SITE_URL        = "https://ciuflaictin.com.br"');
    console.error("  npm run config:secrets");
    process.exit(1);
  }

  // Barra final duplicaria a barra do link (`//confirmar-email`). A function
  // também apara, mas gravar já normalizado evita a dúvida.
  const valores = {
    BREVO_API_KEY: DO_AMBIENTE.BREVO_API_KEY.trim(),
    EMAIL_REMETENTE: DO_AMBIENTE.EMAIL_REMETENTE.trim(),
    SITE_URL: DO_AMBIENTE.SITE_URL.trim().replace(/\/+$/, ""),
  };

  if (!valores.EMAIL_REMETENTE.includes("@")) {
    abortar('EMAIL_REMETENTE não parece um endereço: use "Nome <conta@dominio>" ou só "conta@dominio".');
  }
  if (!/^https:\/\/|^http:\/\/localhost(:\d+)?$/.test(valores.SITE_URL)) {
    abortar(
      `SITE_URL inválida: "${valores.SITE_URL}". Use https:// (produção) — ` +
        "é a base do link que vai no e-mail.",
    );
  }
  if (!valores.BREVO_API_KEY.startsWith("xkeysib-")) {
    console.log('\n⚠  BREVO_API_KEY não começa com "xkeysib-" — confira se é a chave da API v3.');
  }

  console.log("\nGravando:");
  for (const [nome, valor] of Object.entries(valores)) {
    // SITE_URL e EMAIL_REMETENTE não são segredos; a chave do Brevo é.
    console.log(`  ${nome} = ${nome === "BREVO_API_KEY" ? mascarar(valor) : valor}`);
  }

  const res = await fetch(URL_SECRETS, {
    method: "POST",
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(Object.entries(valores).map(([name, value]) => ({ name, value }))),
  });

  if (!res.ok) {
    let msg = await res.text();
    try {
      msg = JSON.parse(msg)?.message || msg;
    } catch {
      /* corpo não era JSON — usar como veio */
    }
    abortar(`a API devolveu HTTP ${res.status}: ${msg}`);
  }

  console.log("\n✓ Secrets gravados. Eles valem na PRÓXIMA invocação da function.");
  await listar();
}

main().catch((err) => {
  console.error(`\nGravação de secrets falhou: ${err.message}`);
  process.exit(1);
});
