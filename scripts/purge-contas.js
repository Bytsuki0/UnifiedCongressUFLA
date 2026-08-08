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
 *   SUPABASE_SERVICE_ROLE_KEY — opcional; SEM ela os arquivos do Storage
 *                           não saem (o blob não é alcançável por SQL) e o
 *                           script apenas lista o que ficou para trás
 *   KEEP_EMAILS           — opcional, lista separada por vírgula que
 *                           SUBSTITUI a lista padrão abaixo
 *
 * Uso (PowerShell):
 *   $env:SUPABASE_ACCESS_TOKEN = "sbp_..."
 *   node scripts/purge-contas.js            # simulação: só mostra o que sairia
 *   node scripts/purge-contas.js --apply    # executa (grava backup antes)
 *
 * A simulação é o padrão. O backup de tudo que será apagado vai para
 * supabase/backups/purge-contas-<data>.json (linhas) e
 * supabase/backups/purge-contas-<data>-arquivos/ (os PDFs baixados) antes
 * de qualquer DELETE, e o --apply só continua se o backup for gravado.
 *
 * Arquivos: a pasta de cada usuário no Storage é o `auth.uid()` dele
 * (`<bucket>/<user_id>/...`), então "arquivo da conta removida" é
 * exatamente "objeto cujo primeiro segmento do caminho é um id removido".
 *
 * Objetos soltos na RAIZ do bucket `Pdfs` (sem pasta de usuário) são
 * anteriores a esse padrão: não pertencem a conta nenhuma, então apagar
 * contas nunca os alcança. Por padrão são só relatados; `--orfaos` inclui
 * esses arquivos na remoção. A varredura é restrita a `Pdfs` de propósito —
 * em `certificate-templates` o primeiro segmento é a categoria do modelo
 * ("minicourse", "schedule"), não um usuário, e varrer lá apagaria os
 * modelos de certificado do evento.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
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
/** Inclui na remoção os arquivos soltos na raiz de `Pdfs` (sem dono). */
const ORFAOS = process.argv.includes("--orfaos");

const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

  // Arquivos das contas removidas, em TODOS os buckets. O blob não sai
  // por SQL: storage.objects é só o índice, então a remoção de verdade
  // passa pela API de Storage, com a service_role.
  const idsRemovidos = new Set(inventario.contas.map((c) => c.id));
  const objetos = await sql(
    `SELECT bucket_id, name, (metadata->>'size')::bigint AS bytes
       FROM storage.objects ORDER BY bucket_id, name`,
  );
  const arquivosDasContas = objetos.filter((o) => idsRemovidos.has(String(o.name).split("/")[0]));
  // Objetos na raiz de `Pdfs`, sem pasta de usuário: não pertencem a conta
  // nenhuma, então nenhuma remoção de conta os alcança. Só saem com --orfaos.
  const orfaosSemDono = objetos.filter(
    (o) =>
      o.bucket_id === "Pdfs" && !/^[0-9a-f-]{36}$/i.test(String(o.name).split("/")[0]),
  );
  const aRemover = ORFAOS ? [...arquivosDasContas, ...orfaosSemDono] : arquivosDasContas;

  console.log(`\nContas a remover (${inventario.contas.length}):`);
  inventario.contas.forEach((c) => {
    console.log(`  - ${c.email}  [${(c.roles ?? []).join(", ") || "sem papel"}]`);
  });

  console.log(`\nArquivos das contas removidas (${arquivosDasContas.length}):`);
  arquivosDasContas.forEach((o) => console.log(`  - ${o.bucket_id}/${o.name}  (${o.bytes ?? "?"} bytes)`));

  if (orfaosSemDono.length > 0) {
    console.log(
      `\n${ORFAOS ? "Órfãos da raiz de \"Pdfs\", TAMBÉM removidos (--orfaos)" : "ℹ  Órfãos na raiz de \"Pdfs\" — sem dono, NÃO serão tocados (use --orfaos)"}` +
        ` (${orfaosSemDono.length}):`,
    );
    orfaosSemDono.forEach((o) => console.log(`  ${ORFAOS ? "-" : "  "} ${o.name}  (${o.bytes ?? "?"} bytes)`));
  }

  if (aRemover.length > 0 && !SERVICE_ROLE) {
    console.log(
      "\n⚠  SUPABASE_SERVICE_ROLE_KEY ausente: os arquivos acima NÃO sairão.\n" +
        '   PowerShell:  $env:SUPABASE_SERVICE_ROLE_KEY = "sb_secret_..."',
    );
  }

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
    JSON.stringify(
      {
        gerado_em: new Date().toISOString(),
        preservados: KEEP,
        ...inventario,
        arquivos_removidos: aRemover,
        orfaos_sem_dono: { removidos: ORFAOS, lista: orfaosSemDono },
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log(`\nBackup gravado em ${path.relative(path.join(__dirname, ".."), arquivo)}`);

  // 2b. Os PDFs em si, baixados ANTES de sumirem. Sem isto o backup JSON
  //     guardaria só o caminho de um arquivo que não existe mais.
  const admin = SERVICE_ROLE
    ? createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } })
    : null;

  const dirArquivos = arquivo.replace(/\.json$/, "-arquivos");
  if (admin && aRemover.length > 0) {
    console.log("\nBaixando os arquivos antes de apagar:");
    for (const o of aRemover) {
      const { data, error } = await admin.storage.from(o.bucket_id).download(o.name);
      if (error || !data) {
        throw new Error(
          `não consegui baixar ${o.bucket_id}/${o.name} (${error?.message ?? "vazio"}) — ` +
            "abortando ANTES de qualquer DELETE, para não apagar sem cópia",
        );
      }
      const destino = path.join(dirArquivos, o.bucket_id, o.name);
      fs.mkdirSync(path.dirname(destino), { recursive: true });
      fs.writeFileSync(destino, Buffer.from(await data.arrayBuffer()));
      console.log(`  ✓ ${o.bucket_id}/${o.name}`);
    }
    console.log(`  → ${path.relative(path.join(__dirname, ".."), dirArquivos)}`);
  }

  // 3. Remoção — banco primeiro, arquivos depois.
  console.log("\nRemovendo:");
  for (const [descricao, query] of PASSOS) {
    process.stdout.write(`  ${descricao} ... `);
    await sql(query);
    console.log("✓");
  }

  if (admin && aRemover.length > 0) {
    const porBucket = new Map();
    for (const o of aRemover) {
      if (!porBucket.has(o.bucket_id)) porBucket.set(o.bucket_id, []);
      porBucket.get(o.bucket_id).push(o.name);
    }
    for (const [bucket, nomes] of porBucket) {
      process.stdout.write(`  ${nomes.length} arquivo(s) do bucket ${bucket} ... `);
      const { error } = await admin.storage.from(bucket).remove(nomes);
      console.log(error ? `FALHOU: ${error.message}` : "✓");
    }
  }

  const restantes = await sql("SELECT email FROM auth.users ORDER BY email");
  console.log(`\n✓ Concluído. Contas restantes (${restantes.length}):`);
  restantes.forEach((u) => console.log(`  - ${u.email}`));

  const sobraram = await sql(
    `SELECT bucket_id, name FROM storage.objects ORDER BY bucket_id, name`,
  );
  console.log(`\nArquivos restantes no Storage (${sobraram.length}):`);
  sobraram.forEach((o) => console.log(`  - ${o.bucket_id}/${o.name}`));

  if (!admin && aRemover.length > 0) {
    console.log(
      `\n⚠  ${aRemover.length} arquivo(s) das contas removidas CONTINUAM no Storage` +
        " (faltou SUPABASE_SERVICE_ROLE_KEY). Apague pelo painel ou rode de novo com a chave.",
    );
  }
}

main().catch((err) => {
  console.error("\nPurga falhou:", err.message);
  process.exit(1);
});
