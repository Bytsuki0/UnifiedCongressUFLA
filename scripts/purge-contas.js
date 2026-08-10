#!/usr/bin/env node
/**
 * Purga de contas — remove TODAS as contas do sistema exceto as
 * informadas na lista de preservação, junto com os dados derivados
 * delas (trabalhos submetidos, associações de revisor, pareceres,
 * inscrições, certificados, etc.).
 *
 * Existe porque a base foi povoada com e-mails de teste e só a conta
 * real da organização deve sobrar.
 *
 * Dois modos:
 *
 *   (padrão)               remove TODAS as contas fora da lista de
 *                          preservação — a faxina original.
 *
 *   --nao-confirmadas [N]  RETENÇÃO: remove só as contas que nunca
 *                          confirmaram o e-mail e já passaram da carência
 *                          de N dias (padrão 30), contada do `created_at`
 *                          da conta. A lista de preservação continua
 *                          valendo, e nada mais é tocado: as tabelas
 *                          ligadas por e-mail em texto são recortadas
 *                          pelos e-mails EXATOS das contas inventariadas,
 *                          nunca pelo "tudo que não está na lista".
 *                          O CASCADE de auth.users leva os tokens da conta
 *                          junto; além disso saem os `tokens_email` que
 *                          venceram há mais de 30 dias (de qualquer conta,
 *                          usados ou não — depois disso não provam mais
 *                          nada, e a confirmação já está no perfil).
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
 *   node scripts/purge-contas.js --nao-confirmadas          # retenção, 30 dias
 *   node scripts/purge-contas.js --nao-confirmadas 45 --apply
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

// Lista curta de propósito: cada e-mail aqui é uma conta que NÃO será
// apagada nem quando alguém rodar o script sem pensar. `silva39@estudante`
// saiu em 2026-08-08 — era conta de teste, foi removida na limpeza, e
// manter um e-mail morto na lista só ensina a confiar num fantasma.
const DEFAULT_KEEP = ["gustavo.silva47@estudante.ufla.br"];

const KEEP = (process.env.KEEP_EMAILS
  ? process.env.KEEP_EMAILS.split(",")
  : DEFAULT_KEEP
)
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

const APPLY = process.argv.includes("--apply");
/** Inclui na remoção os arquivos soltos na raiz de `Pdfs` (sem dono). */
const ORFAOS = process.argv.includes("--orfaos");

/** Carência padrão do modo retenção: conta não confirmada só sai depois disso. */
const RETENCAO_PADRAO_DIAS = 30;
/** Token vencido há mais que isso não prova mais nada — a confirmação vive no perfil. */
const RETENCAO_TOKENS_DIAS = 30;

/**
 * `--nao-confirmadas [dias]` — liga o modo retenção. Aceita a flag sozinha
 * (usa o padrão), `--nao-confirmadas 45` e `--nao-confirmadas=45`. Um valor
 * não numérico logo depois da flag (`--apply`, por exemplo) não é consumido.
 */
function lerRetencao(argv) {
  const i = argv.findIndex((a) => a === "--nao-confirmadas" || a.startsWith("--nao-confirmadas="));
  if (i === -1) return { ativo: false, dias: null };

  let bruto;
  if (argv[i].includes("=")) bruto = argv[i].slice(argv[i].indexOf("=") + 1);
  else if (/^\d+$/.test(argv[i + 1] ?? "")) bruto = argv[i + 1];
  else bruto = String(RETENCAO_PADRAO_DIAS);

  const dias = Number(bruto);
  if (!/^\d+$/.test(String(bruto).trim()) || !Number.isInteger(dias)) {
    console.error(`ERRO: --nao-confirmadas espera um número inteiro de dias (recebi "${bruto}").`);
    console.error("Exemplos:  --nao-confirmadas   |   --nao-confirmadas 45   |   --nao-confirmadas=45");
    process.exit(1);
  }
  return { ativo: true, dias };
}

const { ativo: RETENCAO, dias: DIAS_CORTE } = lerRetencao(process.argv);

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

/** Lista SQL de literais, já escapada. */
function arraySql(valores, tipo) {
  if (valores.length === 0) return `ARRAY[]::${tipo}[]`;
  const itens = valores.map((v) => `'${String(v).replace(/'/g, "''")}'`).join(", ");
  return `ARRAY[${itens}]::${tipo}[]`;
}

/**
 * Quais contas saem: no modo padrão, todas fora da lista de preservação;
 * na retenção, só as que passaram da carência sem confirmar o e-mail.
 *
 * A retenção exige a linha de `profiles` EXISTINDO com a coluna nula. Conta
 * sem perfil (estado quebrado — o trigger `handle_new_user` falhou) fica de
 * fora de propósito: não dá para afirmar que ela não confirmou.
 */
const ALVO_CONTAS = RETENCAO
  ? `lower(u.email) <> ALL(${KEEP_SQL})
       AND u.created_at < now() - interval '${DIAS_CORTE} days'
       AND EXISTS (SELECT 1 FROM public.profiles p
                    WHERE p.id = u.id AND p.email_confirmado_em IS NULL)`
  : `lower(u.email) <> ALL(${KEEP_SQL})`;

const QUERY_CONTAS = `
  SELECT u.id, u.email, u.created_at, u.last_sign_in_at,
         p.nome, p.email_confirmado_em,
         (SELECT array_agg(ur.role ORDER BY ur.role)
            FROM public.user_roles ur WHERE ur.user_id = u.id) AS roles
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE ${ALVO_CONTAS}
  ORDER BY u.email`;

/** Tokens que já venceram e cuja janela de retenção também passou. */
const QUERY_TOKENS_VENCIDOS = `
  SELECT token_hash, user_id, proposito, email, created_at, expires_at, used_at
    FROM public.tokens_email
   WHERE expires_at < now() - interval '${RETENCAO_TOKENS_DIAS} days'
   ORDER BY expires_at`;

/**
 * Recortes das tabelas derivadas, a partir das contas já inventariadas.
 *
 * Modo padrão: o recorte é "tudo que não está na lista de preservação" —
 * inclusive linhas de e-mail que não pertencem a conta nenhuma (lixo antigo
 * das tabelas legadas). Era o objetivo da faxina original, e continua igual.
 *
 * Retenção: o recorte são os ids/e-mails EXATOS das contas inventariadas.
 * Literais, não subconsulta — o que for apagado é exatamente o que entrou no
 * backup, e nenhum passo depende do passo anterior ainda não ter rodado.
 */
function recortes(contas) {
  const IDS = arraySql(contas.map((c) => c.id), "uuid");
  const EMAILS = arraySql(
    contas.map((c) => String(c.email ?? "").toLowerCase()).filter(Boolean),
    "text",
  );

  const porEmail = (col) =>
    RETENCAO ? `lower(${col}) = ANY(${EMAILS})` : `lower(${col}) <> ALL(${KEEP_SQL})`;
  const porDono = (col) =>
    RETENCAO
      ? `${col} = ANY(${IDS})`
      : `${col} IN (SELECT u.id FROM auth.users u WHERE lower(u.email) <> ALL(${KEEP_SQL}))`;

  return { porEmail, porDono };
}

/** Consultas de inventário das tabelas derivadas (as contas já vieram à parte). */
function montarInventario({ porEmail, porDono }) {
  return {
    trabalhos: `
      SELECT * FROM public.trabalhos
      WHERE ${porDono("owner_id")} ORDER BY created_at`,
    avaliadores: `
      SELECT * FROM public.avaliadores
      WHERE ${porEmail("email")} ORDER BY email`,
    estudantes: `
      SELECT * FROM public.estudantes
      WHERE ${porEmail("email")} ORDER BY email`,
    professores: `
      SELECT * FROM public.professores
      WHERE ${porEmail("email")} ORDER BY email`,
    trabalho_revisores: `
      SELECT * FROM public.trabalho_revisores
      WHERE ${porEmail("revisor_email")} ORDER BY created_at`,
    pareceres: `
      SELECT * FROM public.pareceres
      WHERE ${porEmail("revisor_email")} ORDER BY created_at`,
    profiles: `
      SELECT * FROM public.profiles
      WHERE ${porEmail("email")} ORDER BY email`,
  };
}

/**
 * Ordem de remoção. As FKs para auth.users são ON DELETE CASCADE, então
 * apagar a conta leva junto profiles, user_roles, inscrições no congresso,
 * minicursos, certificados, notificações, presenças — e os tokens de e-mail.
 * O que NÃO é ligado por FK (é ligado por e-mail em texto) precisa sair
 * explicitamente.
 */
function montarPassos({ porEmail, porDono }) {
  const alvo = RETENCAO ? "das contas não confirmadas" : "fora da lista";
  const passos = [
    [`trabalhos ${alvo} (leva revisores, pareceres e avaliações)`,
      `DELETE FROM public.trabalhos t WHERE ${porDono("t.owner_id")}`],
    [`co-chairs (avaliadores) ${alvo}`,
      `DELETE FROM public.avaliadores WHERE ${porEmail("email")}`],
    [`associações revisor↔trabalho por e-mail ${alvo}`,
      `DELETE FROM public.trabalho_revisores WHERE ${porEmail("revisor_email")}`],
    [`pareceres de revisores ${alvo}`,
      `DELETE FROM public.pareceres WHERE ${porEmail("revisor_email")}`],
    [`fichas de estudante ${alvo}`,
      `DELETE FROM public.estudantes WHERE ${porEmail("email")}`],
    [`fichas de professor ${alvo}`,
      `DELETE FROM public.professores WHERE ${porEmail("email")}`],
    ["contas de autenticação (cascata: profiles, papéis, inscrições, certificados, tokens…)",
      `DELETE FROM auth.users WHERE ${porDono("id")}`],
    ["profiles órfãos remanescentes",
      `DELETE FROM public.profiles WHERE ${porEmail("email")}`],
  ];

  // Higiene de retenção, independente de haver conta a remover: token
  // vencido há mais de 30 dias não sustenta mais nenhuma investigação —
  // a confirmação que ele produziu está carimbada no perfil.
  if (RETENCAO) {
    passos.push([
      `tokens de e-mail vencidos há mais de ${RETENCAO_TOKENS_DIAS} dias`,
      `DELETE FROM public.tokens_email
        WHERE expires_at < now() - interval '${RETENCAO_TOKENS_DIAS} days'`,
    ]);
  }

  return passos;
}

async function main() {
  console.log("=== Purga de contas ===");
  console.log(`Projeto   : ${PROJECT_REF}`);
  console.log(`Preservar : ${KEEP.join(", ")}`);
  console.log(
    `Alcance   : ${
      RETENCAO
        ? `RETENÇÃO — contas não confirmadas criadas há mais de ${DIAS_CORTE} dia(s)` +
          `, e tokens vencidos há mais de ${RETENCAO_TOKENS_DIAS} dias`
        : "TODAS as contas fora da lista de preservação"
    }`,
  );
  console.log(`Modo      : ${APPLY ? "APLICAR (destrutivo)" : "simulação (nada será apagado)"}\n`);

  // 1. Inventário — as contas primeiro: na retenção, elas definem o
  //    recorte de todo o resto.
  const inventario = { contas: await sql(QUERY_CONTAS) };
  console.log(`  ${String(inventario.contas.length).padStart(4)} × contas`);

  const recorte = recortes(inventario.contas);
  for (const [nome, query] of Object.entries(montarInventario(recorte))) {
    inventario[nome] = await sql(query);
    console.log(`  ${String(inventario[nome].length).padStart(4)} × ${nome}`);
  }
  if (RETENCAO) {
    inventario.tokens_vencidos = await sql(QUERY_TOKENS_VENCIDOS);
    console.log(`  ${String(inventario.tokens_vencidos.length).padStart(4)} × tokens_vencidos`);
  }

  // A lista de preservação envelhece: e-mail que não existe mais no banco
  // não protege nada, e conferi-la antes é mais barato que descobrir depois.
  const existentes = new Set(
    (await sql("SELECT lower(email) AS email FROM auth.users")).map((u) => u.email),
  );
  const keepFantasma = KEEP.filter((e) => !existentes.has(e));
  if (keepFantasma.length > 0) {
    console.log(
      `\nℹ  Na lista de preservação, sem conta correspondente: ${keepFantasma.join(", ")}` +
        "\n   (não protege ninguém — confira se o e-mail certo está na lista)",
    );
  }

  const total = Object.values(inventario).reduce((n, rows) => n + rows.length, 0);
  if (total === 0) {
    console.log(
      RETENCAO
        ? "\nNada a remover — nenhuma conta passou da carência sem confirmar, e não há token vencido."
        : "\nNada a remover — a base já contém apenas as contas preservadas.",
    );
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
    const papeis = (c.roles ?? []).join(", ") || "sem papel";
    const idade = c.created_at
      ? `  criada em ${String(c.created_at).slice(0, 10)} (${Math.floor(
          (Date.now() - new Date(c.created_at).getTime()) / 86_400_000,
        )} dias)`
      : "";
    console.log(`  - ${c.email}  [${papeis}]${RETENCAO ? idade : ""}`);
  });

  if (RETENCAO && inventario.tokens_vencidos.length > 0) {
    console.log(
      `\nTokens vencidos há mais de ${RETENCAO_TOKENS_DIAS} dias (${inventario.tokens_vencidos.length}):`,
    );
    inventario.tokens_vencidos.forEach((t) =>
      console.log(
        `  - ${t.email}  ${t.proposito}  venceu em ${String(t.expires_at).slice(0, 10)}` +
          `  ${t.used_at ? "usado" : "nunca usado"}`,
      ),
    );
  }

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
    console.log(
      `  node scripts/purge-contas.js${RETENCAO ? ` --nao-confirmadas ${DIAS_CORTE}` : ""}` +
        `${ORFAOS ? " --orfaos" : ""} --apply`,
    );
    return;
  }

  // 2. Backup antes de qualquer DELETE. Nome distinto por modo: uma
  //    retenção não pode sobrescrever o backup da faxina do mesmo dia.
  const dir = path.join(__dirname, "..", "supabase", "backups");
  fs.mkdirSync(dir, { recursive: true });
  const prefixo = RETENCAO ? "purge-nao-confirmadas" : "purge-contas";
  const arquivo = path.join(dir, `${prefixo}-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(
    arquivo,
    JSON.stringify(
      {
        gerado_em: new Date().toISOString(),
        modo: RETENCAO ? `nao-confirmadas ${DIAS_CORTE} dias` : "todas fora da lista",
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
  for (const [descricao, query] of montarPassos(recorte)) {
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
  // A faxina deixa poucas contas e listá-las é a conferência. A retenção
  // roda sobre a base cheia: aí a lista inteira é ruído.
  if (RETENCAO) {
    const [{ nao_confirmadas: naoConf } = {}] = await sql(
      "SELECT count(*)::int AS nao_confirmadas FROM public.profiles WHERE email_confirmado_em IS NULL",
    );
    const [{ tokens } = {}] = await sql(
      "SELECT count(*)::int AS tokens FROM public.tokens_email",
    );
    console.log(`  ${naoConf} ainda não confirmada(s), dentro da carência de ${DIAS_CORTE} dia(s)`);
    console.log(`  ${tokens} token(s) de e-mail em base`);
  } else {
    restantes.forEach((u) => console.log(`  - ${u.email}`));

    const sobraram = await sql(
      `SELECT bucket_id, name FROM storage.objects ORDER BY bucket_id, name`,
    );
    console.log(`\nArquivos restantes no Storage (${sobraram.length}):`);
    sobraram.forEach((o) => console.log(`  - ${o.bucket_id}/${o.name}`));
  }

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
