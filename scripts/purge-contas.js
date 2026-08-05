#!/usr/bin/env node
/**
 * Purga de contas — remove TODAS as contas do sistema exceto as
 * informadas na lista de preservação, junto com os dados derivados
 * delas (trabalhos submetidos, associações de revisor, pareceres,
 * inscrições, certificados, etc.).
 *
 * Existe porque a base foi povoada com e-mails de teste e só duas
 * contas reais devem sobrar.
 *
 * Env vars:
 *   VITE_SUPABASE_URL     — lido do .env
 *   SUPABASE_ACCESS_TOKEN — personal access token (supabase.com/dashboard/account/tokens)
 *   KEEP_EMAILS           — opcional, lista separada por vírgula que
 *                           SUBSTITUI a lista padrão abaixo
 *
 * Uso (PowerShell):
 *   $env:SUPABASE_ACCESS_TOKEN = "sbp_..."
 *   node scripts/purge-contas.js            # simulação: só mostra o que sairia
 *   node scripts/purge-contas.js --apply    # executa (grava backup antes)
 *
 * A simulação é o padrão. O backup JSON de tudo que será apagado vai
 * para supabase/backups/purge-contas-<data>.json antes de qualquer
 * DELETE, e o --apply só continua se o backup for gravado.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadDotEnv } from "./load-dotenv.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

loadDotEnv();

const DEFAULT_KEEP = [
  "gustavo.silva39@estudante.ufla.br",
  "gustavo.silva47@estudante.ufla.br",
];

const KEEP = (process.env.KEEP_EMAILS
  ? process.env.KEEP_EMAILS.split(",")
  : DEFAULT_KEEP
)
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

const APPLY = process.argv.includes("--apply");

const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

if (!SUPABASE_URL) {
  console.error("ERRO: VITE_SUPABASE_URL precisa estar definida (normalmente vem do .env).");
  process.exit(1);
}
if (!ACCESS_TOKEN) {
  console.error("ERRO: SUPABASE_ACCESS_TOKEN precisa estar definida.");
  console.error('PowerShell:  $env:SUPABASE_ACCESS_TOKEN = "sbp_..."; node scripts/purge-contas.js');
  process.exit(1);
}
if (KEEP.length === 0) {
  console.error("ERRO: a lista de e-mails preservados está vazia — abortando (isso apagaria tudo).");
  process.exit(1);
}

const PROJECT_REF = SUPABASE_URL.replace("https://", "").split(".")[0];
const MGMT_SQL_URL = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;

/** Lista SQL dos e-mails preservados, já escapada. */
const KEEP_SQL = `ARRAY[${KEEP.map((e) => `'${e.replace(/'/g, "''")}'`).join(", ")}]::text[]`;

/** Executa SQL pela Management API e devolve as linhas. */
async function sql(query) {
  const res = await fetch(MGMT_SQL_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const body = await res.text();
  if (!res.ok) {
    let msg;
    try { msg = JSON.parse(body)?.message || body; } catch { msg = body; }
    throw new Error(msg);
  }
  return body ? JSON.parse(body) : [];
}

/** Consultas de inventário: tudo que será removido. */
const INVENTARIO = {
  contas: `
    SELECT u.id, u.email, u.created_at, u.last_sign_in_at,
           p.nome,
           (SELECT array_agg(ur.role ORDER BY ur.role)
              FROM public.user_roles ur WHERE ur.user_id = u.id) AS roles
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.id = u.id
    WHERE lower(u.email) <> ALL(${KEEP_SQL})
    ORDER BY u.email`,
  trabalhos: `
    SELECT t.*
    FROM public.trabalhos t
    JOIN auth.users u ON u.id = t.owner_id
    WHERE lower(u.email) <> ALL(${KEEP_SQL})
    ORDER BY t.created_at`,
  avaliadores: `
    SELECT * FROM public.avaliadores
    WHERE lower(email) <> ALL(${KEEP_SQL}) ORDER BY email`,
  estudantes: `
    SELECT * FROM public.estudantes
    WHERE lower(email) <> ALL(${KEEP_SQL}) ORDER BY email`,
  professores: `
    SELECT * FROM public.professores
    WHERE lower(email) <> ALL(${KEEP_SQL}) ORDER BY email`,
  trabalho_revisores: `
    SELECT * FROM public.trabalho_revisores
    WHERE lower(revisor_email) <> ALL(${KEEP_SQL}) ORDER BY created_at`,
  pareceres: `
    SELECT * FROM public.pareceres
    WHERE lower(revisor_email) <> ALL(${KEEP_SQL}) ORDER BY created_at`,
  profiles: `
    SELECT * FROM public.profiles
    WHERE lower(email) <> ALL(${KEEP_SQL}) ORDER BY email`,
};

/**
 * Ordem de remoção. As FKs para auth.users são ON DELETE CASCADE, então
 * apagar a conta leva junto profiles, user_roles, inscrições no congresso,
 * minicursos, certificados, notificações e presenças. O que NÃO é ligado
 * por FK (é ligado por e-mail em texto) precisa sair explicitamente.
 */
const PASSOS = [
  ["trabalhos das contas removidas (leva revisores, pareceres e avaliações)", `
    DELETE FROM public.trabalhos t
    USING auth.users u
    WHERE t.owner_id = u.id AND lower(u.email) <> ALL(${KEEP_SQL})`],
  ["co-chairs (avaliadores) fora da lista", `
    DELETE FROM public.avaliadores WHERE lower(email) <> ALL(${KEEP_SQL})`],
  ["associações revisor↔trabalho por e-mail fora da lista", `
    DELETE FROM public.trabalho_revisores WHERE lower(revisor_email) <> ALL(${KEEP_SQL})`],
  ["pareceres de revisores fora da lista", `
    DELETE FROM public.pareceres WHERE lower(revisor_email) <> ALL(${KEEP_SQL})`],
  ["fichas de estudante fora da lista", `
    DELETE FROM public.estudantes WHERE lower(email) <> ALL(${KEEP_SQL})`],
  ["fichas de professor fora da lista", `
    DELETE FROM public.professores WHERE lower(email) <> ALL(${KEEP_SQL})`],
  ["contas de autenticação (cascata: profiles, papéis, inscrições, certificados…)", `
    DELETE FROM auth.users WHERE lower(email) <> ALL(${KEEP_SQL})`],
  ["profiles órfãos remanescentes", `
    DELETE FROM public.profiles WHERE lower(email) <> ALL(${KEEP_SQL})`],
];

async function main() {
  console.log("=== Purga de contas ===");
  console.log(`Projeto   : ${PROJECT_REF}`);
  console.log(`Preservar : ${KEEP.join(", ")}`);
  console.log(`Modo      : ${APPLY ? "APLICAR (destrutivo)" : "simulação (nada será apagado)"}\n`);

  // 1. Inventário
  const inventario = {};
  for (const [nome, query] of Object.entries(INVENTARIO)) {
    inventario[nome] = await sql(query);
    console.log(`  ${String(inventario[nome].length).padStart(4)} × ${nome}`);
  }

  const total = Object.values(inventario).reduce((n, rows) => n + rows.length, 0);
  if (total === 0) {
    console.log("\nNada a remover — a base já contém apenas as contas preservadas.");
    return;
  }

  // PDFs que ficarão órfãos no Storage (o blob não sai por SQL).
  const idsRemovidos = new Set(inventario.contas.map((c) => c.id));
  const pdfs = await sql(`SELECT name FROM storage.objects WHERE bucket_id = 'Pdfs' ORDER BY name`);
  const pdfsOrfaos = pdfs.filter((o) => idsRemovidos.has(String(o.name).split("/")[0]));

  console.log(`\nContas a remover (${inventario.contas.length}):`);
  inventario.contas.forEach((c) => {
    console.log(`  - ${c.email}  [${(c.roles ?? []).join(", ") || "sem papel"}]`);
  });

  if (!APPLY) {
    console.log("\nSimulação concluída. Para executar de verdade:");
    console.log("  node scripts/purge-contas.js --apply");
    return;
  }

  // 2. Backup antes de qualquer DELETE
  const dir = path.join(__dirname, "..", "supabase", "backups");
  fs.mkdirSync(dir, { recursive: true });
  const arquivo = path.join(dir, `purge-contas-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(
    arquivo,
    JSON.stringify({ gerado_em: new Date().toISOString(), preservados: KEEP, ...inventario, pdfs_orfaos: pdfsOrfaos }, null, 2),
    "utf8",
  );
  console.log(`\nBackup gravado em ${path.relative(path.join(__dirname, ".."), arquivo)}`);

  // 3. Remoção
  console.log("\nRemovendo:");
  for (const [descricao, query] of PASSOS) {
    process.stdout.write(`  ${descricao} ... `);
    await sql(query);
    console.log("✓");
  }

  const restantes = await sql("SELECT email FROM auth.users ORDER BY email");
  console.log(`\n✓ Concluído. Contas restantes (${restantes.length}):`);
  restantes.forEach((u) => console.log(`  - ${u.email}`));

  if (pdfsOrfaos.length > 0) {
    console.log(`\n⚠  ${pdfsOrfaos.length} PDF(s) no bucket "Pdfs" pertenciam às contas removidas.`);
    console.log("   O arquivo em si não sai por SQL — apague pelo painel (Storage → Pdfs):");
    pdfsOrfaos.forEach((o) => console.log(`     ${o.name}`));
  }
}

main().catch((err) => {
  console.error("\nPurga falhou:", err.message);
  process.exit(1);
});
