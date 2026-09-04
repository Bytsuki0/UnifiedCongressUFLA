#!/usr/bin/env node
/**
 * Etapa 4 do plano de deploy — sonda de RLS.
 *
 * Ataca o banco de produção usando exatamente o que qualquer visitante tem:
 * a URL do projeto e a chave publishable/anon que vai no bundle. É esse o
 * valor do script — ele não sabe nada que um atacante não saiba. Nunca usar
 * service_role aqui: com service_role tudo passa e o teste vira teatro.
 *
 * Sem backend próprio, o RLS é a única barreira entre um anônimo e os dados
 * de submissão. Este é o par dinâmico de sql/rls-audit.sql (estático).
 *
 * Uso:
 *   npm run rls:probe                  # só as sondas anônimas
 *   npm run rls:probe -- --write       # inclui tentativa de INSERT anônimo
 *
 * Para a fase autenticada (cruzamento entre autores), exportar antes:
 *   $env:TEST_A_EMAIL="..."; $env:TEST_A_PASSWORD="..."
 *   $env:TEST_B_EMAIL="..."; $env:TEST_B_PASSWORD="..."
 * As duas contas de teste são as do human track da Etapa 4 e devem ser
 * mantidas até o fim do congresso.
 *
 * Saída: código 0 se nenhuma sonda vazou; != 0 caso contrário.
 */

import { createClient } from "@supabase/supabase-js";
import { loadDotEnv } from "./load-dotenv.js";

loadDotEnv();

const URL = process.env.VITE_SUPABASE_URL;
const KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const COM_ESCRITA = process.argv.includes("--write");

/**
 * Autoteste: prova que a sonda SABE detectar um vazamento.
 *
 * Uma sonda que só devolve "tudo OK" é indistinguível de uma sonda
 * quebrada. Com --autoteste, as duas tabelas que `anon` PODE ler por
 * desenho (minicourses, schedule) são reclassificadas como "negada".
 * A sonda tem então obrigação de acusá-las como vazamento e sair != 0;
 * se sair 0, o caminho de detecção está furado e o resultado limpo da
 * execução normal não vale nada.
 *
 * Não altera schema nem dados — só a expectativa, contra dados reais.
 */
const AUTOTESTE = process.argv.includes("--autoteste");

if (!URL || !KEY) {
  console.error(
    "Faltam VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY (.env ou ambiente)."
  );
  process.exit(2);
}

// Nunca autenticar o cliente anônimo: sessão persistida em disco
// contaminaria a sonda com um usuário logado de uma execução anterior.
const semSessao = { auth: { persistSession: false, autoRefreshToken: false } };
const anon = createClient(URL, KEY, semSessao);

let falhas = 0;
let fracos = 0;

const ok = (msg) => console.log(`  \x1b[32mOK  \x1b[0m ${msg}`);
const fraco = (msg) => {
  console.log(`  \x1b[33mFRACO\x1b[0m ${msg}`);
  fracos++;
};
const falhou = (msg) => {
  console.log(`  \x1b[31mFALHA\x1b[0m ${msg}`);
  falhas++;
};

/**
 * Tabelas do schema public e o que `anon` pode fazer com elas.
 *
 * 'publica' = leitura anônima é intencional (dados de divulgação, sem PII).
 * Só duas se qualificam, liberadas por policy `TO anon` no
 * security_hardening: minicourses e schedule.
 * Todo o resto é 'negada'. Tabela nova sem entrada aqui é tabela que
 * ninguém testou — o script avisa.
 */
const TABELAS = {
  _migrations: "negada",
  allowed_email_domains: "negada",
  arquivos_download: "negada",
  attendances: "negada",
  avaliacoes: "negada",
  avaliadores: "negada",
  categoria_anexos: "negada",
  categorias: "negada",
  certificates: "negada",
  congress_registrations: "negada",
  configuracoes: "negada",
  criterios: "negada",
  decisoes_editoriais: "negada",
  estudantes: "negada",
  minicourse_registrations: "negada",
  minicourses: "publica",
  notification_reads: "negada",
  notifications: "negada",
  pareceres: "negada",
  professores: "negada",
  profiles: "negada",
  rate_limits: "negada",
  schedule: "publica",
  tokens_email: "negada",
  trabalho_anexos: "negada",
  trabalho_revisores: "negada",
  trabalhos: "negada",
  user_roles: "negada",
};

/**
 * RPCs que `anon` NÃO pode nem executar — a chamada tem que dar erro.
 * As liberadas por desenho (confirmar_email, verify_certificate,
 * minicourse_occupancy) ficam fora desta lista de propósito — ver
 * sql/rls-audit.sql, consulta 5.
 */
const RPCS_NEGADAS = [
  ["pool_revisores", {}],
  ["conflitos_do_trabalho", { p_trabalho_id: "00000000-0000-0000-0000-000000000000" }],
  ["decisao_consolidada", { p_trabalho_id: "00000000-0000-0000-0000-000000000000" }],
  ["aplicar_decisao", { p_trabalho_id: "00000000-0000-0000-0000-000000000000" }],
  // O nome do argumento aqui era `p_trabalho_id`, mas a assinatura real é
  // `_trabalho_id`: o PostgREST devolvia PGRST202 ("função não encontrada")
  // e a sonda registrava "negada" sem ter testado permissão nenhuma — a
  // sonda cega contra a qual o comentário logo abaixo adverte.
  ["distribuir_revisores", { _trabalho_id: "00000000-0000-0000-0000-000000000000" }],
  // Distribuição recomendada (migration 20260820120000): a que propõe e a
  // que grava. Ambas exigem `is_event_staff()`, e nem executáveis por anon.
  ["recomendar_distribuicao", {}],
  ["confirmar_distribuicao", { _pares: [] }],
  // Parecer editorial (migration 20260820140000). A primeira é staff-only;
  // as outras duas exigem sessão do autor.
  [
    "registrar_parecer_editorial",
    {
      _trabalho_id: "00000000-0000-0000-0000-000000000000",
      _decisao: "aprovado",
      _comentario: "sonda",
    },
  ],
  [
    "parecer_editorial_do_meu_trabalho",
    { _trabalho_id: "00000000-0000-0000-0000-000000000000" },
  ],
  [
    "reenviar_trabalho",
    {
      _trabalho_id: "00000000-0000-0000-0000-000000000000",
      _titulo: "sonda",
      _palavras_chave: ["sonda"],
      _autores: "sonda",
      _orientador_email: null,
      _coautores: [],
      _categoria_id: "00000000-0000-0000-0000-000000000000",
      _anexos: [],
    },
  ],
  // Anexos por categoria (migration 20260904120000). `submeter_trabalho`
  // e `aplicar_anexos` nasceram junto com as duas tabelas de anexo: a
  // primeira exige sessão do autor, a segunda é INTERNA — nem
  // `authenticated` a executa, só as quatro RPCs SECURITY DEFINER.
  [
    "submeter_trabalho",
    {
      _titulo: "sonda",
      _palavras_chave: ["sonda"],
      _categoria_id: "00000000-0000-0000-0000-000000000000",
      _autores: "sonda",
      _orientador_email: null,
      _coautores: [],
      _anexos: [],
    },
  ],
  [
    "aplicar_anexos",
    { _trabalho_id: "00000000-0000-0000-0000-000000000000", _anexos: [] },
  ],
  // Prazo de submissão (migration 20260813120000). Os nomes de argumento
  // aqui são os REAIS da assinatura: com nome errado o PostgREST devolve
  // PGRST202 ("função não encontrada") e a sonda registraria "negada" sem
  // ter chegado a testar permissão nenhuma.
  ["submissoes_abertas", {}],
  ["prazo_submissoes", {}],
  ["data_local", {}],
  // ⚠ Os nomes abaixo tinham ficado para trás: a sonda chamava
  // `editar_submissao` com `_resumo`/`_pdf_url`, assinatura que a
  // 20260819120000 já havia substituído. O PostgREST devolvia PGRST202
  // ("função não encontrada") e a sonda anotava "negada" sem ter testado
  // permissão nenhuma — exatamente a cegueira contra a qual o comentário
  // acima adverte. Assinatura atual: 20260904120000.
  [
    "editar_submissao",
    {
      _trabalho_id: "00000000-0000-0000-0000-000000000000",
      _titulo: "sonda",
      _palavras_chave: ["sonda"],
      _anexos: [],
    },
  ],
  [
    "enviar_correcao",
    {
      _trabalho_id: "00000000-0000-0000-0000-000000000000",
      _titulo: "sonda",
      _palavras_chave: ["sonda"],
      _anexos: [],
    },
  ],
];

/**
 * RPCs que `anon` PODE executar por desenho (o security_hardening faz
 * `GRANT EXECUTE ... TO anon, authenticated` nelas de propósito), mas que
 * só podem responder "você não é ninguém": todas derivam de auth.uid(),
 * que é NULL sem sessão. O teste aqui não é se executam — é se o retorno
 * vaza alguma coisa.
 */
const RPCS_INOCUAS = [
  ["is_app_admin", {}, (v) => v === false],
  ["is_event_staff", {}, (v) => v === false],
  ["get_my_roles", {}, (v) => Array.isArray(v) && v.length === 0],
];

/**
 * As únicas colunas que `arquivos_download_publicos()` tem direito de
 * devolver (migration 20260830120000, que aposentou `links_downloads()`).
 *
 * A função é aberta a `anon` de propósito (a landing e o /login mostram
 * botões de download sem sessão) e é a única janela pública para dentro
 * de `arquivos_download` — tabela que fica negada, logo acima. O risco
 * dela não é executar, é DEVOLVER DEMAIS: um `SELECT *` ou uma coluna
 * nova entrando na lista publicaria `criado_por` (o uuid do admin) para
 * o mundo. Por isso o teste é sobre o formato do retorno, não sobre a
 * permissão.
 */
const COLUNAS_ARQUIVOS_DOWNLOAD = [
  "id",
  "grupo",
  "titulo",
  "url",
  "formato",
  "descricao",
];

// ---------------------------------------------------------------------
// Fase 1 — leitura anônima de cada tabela
// ---------------------------------------------------------------------
console.log(`\nProjeto: ${URL}`);
console.log(`Chave:   ${KEY.slice(0, 12)}… (publishable/anon)\n`);
if (AUTOTESTE) {
  TABELAS.minicourses = "negada";
  TABELAS.schedule = "negada";
  // Mesma ideia do lado das RPCs: arquivos_download_publicos() é executável
  // por anon por desenho, então exigi-la negada obriga a sonda a acusá-la.
  RPCS_NEGADAS.push(["arquivos_download_publicos", {}]);
  console.log(
    "\x1b[33mAUTOTESTE\x1b[0m: minicourses, schedule e arquivos_download_publicos() " +
      "foram marcadas como 'negada'.\n  São legivelmente públicas, então a " +
      "sonda TEM de acusar vazamento nas três.\n  Se esta execução passar, " +
      "a sonda está cega.\n",
  );
}

console.log("Fase 1 — leitura anônima das tabelas:");

for (const [tabela, esperado] of Object.entries(TABELAS)) {
  const { data, error } = await anon.from(tabela).select("*").limit(1);

  if (esperado === "publica") {
    if (error) falhou(`${tabela}: leitura pública quebrou (${error.message})`);
    else ok(`${tabela}: legível por anon, como projetado`);
    continue;
  }

  if (error) {
    // Erro de permissão é a negativa forte: o banco recusou explicitamente.
    ok(`${tabela}: negada (${error.code || error.message})`);
  } else if (!data || data.length === 0) {
    // Sem erro e sem linhas é ambíguo: pode ser RLS filtrando tudo ou
    // simplesmente uma tabela vazia. Não conta como prova.
    fraco(`${tabela}: 0 linhas, mas sem erro — RLS filtrando ou tabela vazia?`);
  } else {
    falhou(`${tabela}: VAZOU ${data.length} linha(s) para anon`);
    console.log(`         ${JSON.stringify(data[0]).slice(0, 160)}`);
  }
}

// ---------------------------------------------------------------------
// Fase 2 — RPCs que anon não deve executar
// ---------------------------------------------------------------------
console.log("\nFase 2 — RPCs negadas a anon:");

for (const [nome, args] of RPCS_NEGADAS) {
  const { data, error } = await anon.rpc(nome, args);
  if (error) ok(`${nome}(): negada (${error.code || error.message})`);
  else falhou(`${nome}(): EXECUTOU como anon → ${JSON.stringify(data).slice(0, 120)}`);
}

console.log("\nFase 2b — RPCs liberadas a anon: têm que responder 'ninguém':");

for (const [nome, args, aceitavel] of RPCS_INOCUAS) {
  const { data, error } = await anon.rpc(nome, args);
  if (error) ok(`${nome}(): negada (${error.code || error.message})`);
  else if (aceitavel(data)) ok(`${nome}(): ${JSON.stringify(data)} — sem sessão, sem papel`);
  else falhou(`${nome}(): retornou ${JSON.stringify(data).slice(0, 120)} para anon`);
}

// arquivos_download_publicos(): pública por desenho. O teste não é se
// executa — é se devolve SÓ o que a tela precisa. Ver COLUNAS_ARQUIVOS_DOWNLOAD.
//
// Lista vazia é resposta legítima (a organização pode não ter publicado
// nada), e nesse caso não há chave para conferir: o que se prova aqui é
// que a função executou sem erro.
{
  const { data, error } = await anon.rpc("arquivos_download_publicos");
  if (error) {
    falhou(
      `arquivos_download_publicos(): deveria executar como anon e não executou ` +
        `(${error.code || error.message}) — a migration 20260830120000 já subiu?`
    );
  } else {
    const extras = Object.keys(data?.[0] ?? {}).filter(
      (k) => !COLUNAS_ARQUIVOS_DOWNLOAD.includes(k)
    );
    if (extras.length) {
      falhou(`arquivos_download_publicos(): expõe além do previsto → ${extras.join(", ")}`);
    } else {
      ok("arquivos_download_publicos(): executável por anon, devolve só os campos da tela");
    }
  }
}

// has_role(uuid, text) aceita um user_id ARBITRÁRIO e é executável por anon.
// Não vaza dados de submissão, mas permite testar "este uuid é admin?" sem
// sessão. Só explorável por quem já tem um uuid válido em mãos, então é
// observação, não falha — anotado para a revisão humana da Etapa 4.
{
  const { data, error } = await anon.rpc("has_role", {
    _user_id: "00000000-0000-0000-0000-000000000000",
    _role: "admin",
  });
  if (error) ok(`has_role(): negada (${error.code || error.message})`);
  else
    console.log(
      `  \x1b[36mNOTA \x1b[0m has_role(): executável por anon (retornou ${JSON.stringify(data)}).\n` +
        "         Permite sondar o papel de um uuid conhecido. Baixo risco\n" +
        "         (uuid não é adivinhável), mas é superfície desnecessária:\n" +
        "         dá para restringir a `authenticated` numa migration futura."
    );
}

// ---------------------------------------------------------------------
// Fase 3 — Storage
// ---------------------------------------------------------------------
console.log("\nFase 3 — Storage (bucket de PDFs):");

const BUCKET = process.env.VITE_SUPABASE_PDF_BUCKET || "Pdfs";
{
  const { data, error } = await anon.storage.from(BUCKET).list();
  if (error) ok(`listar ${BUCKET}: negada (${error.message})`);
  else if (!data || data.length === 0) fraco(`listar ${BUCKET}: 0 objetos, sem erro`);
  else falhou(`listar ${BUCKET}: VAZOU ${data.length} objeto(s) para anon`);
}
{
  // Bucket privado não pode assinar URL sem sessão.
  const { data, error } = await anon.storage.from(BUCKET).createSignedUrl("teste.pdf", 60);
  if (error) ok(`assinar URL em ${BUCKET}: negada (${error.message})`);
  else falhou(`assinar URL em ${BUCKET}: anon conseguiu assinar → ${data?.signedUrl}`);
}

// ---------------------------------------------------------------------
// Fase 4 — escrita anônima (opcional, --write)
// ---------------------------------------------------------------------
if (COM_ESCRITA) {
  console.log("\nFase 4 — escrita anônima (--write):");
  const marcador = `RLS-PROBE-${Date.now()}`;
  const { data, error } = await anon
    .from("trabalhos")
    .insert({ titulo: marcador, status: "pendente" })
    .select();

  if (error) {
    ok(`insert em trabalhos: negada (${error.code || error.message})`);
  } else {
    falhou("insert em trabalhos: ANON GRAVOU NO BANCO DE PRODUÇÃO");
    console.log(`         marcador: ${marcador} — removendo…`);
    const alvo = data?.[0]?.id;
    if (alvo) {
      const { error: delErr } = await anon.from("trabalhos").delete().eq("id", alvo);
      console.log(
        delErr
          ? `         NÃO consegui remover (${delErr.message}) — apagar à mão!`
          : "         linha removida."
      );
    }
  }
} else {
  console.log("\nFase 4 — escrita anônima: pulada (rode com --write para incluir).");
}

// ---------------------------------------------------------------------
// Fase 5 — cruzamento entre autores (exige as duas contas de teste)
// ---------------------------------------------------------------------
const A_EMAIL = process.env.TEST_A_EMAIL;
const A_SENHA = process.env.TEST_A_PASSWORD;
const B_EMAIL = process.env.TEST_B_EMAIL;
const B_SENHA = process.env.TEST_B_PASSWORD;

if (!A_EMAIL || !A_SENHA || !B_EMAIL || !B_SENHA) {
  console.log(
    "\nFase 5 — cruzamento entre autores: PULADA (faltam TEST_A_*/TEST_B_*).\n" +
      "  A Etapa 4 NÃO está completa sem ela: as sondas anônimas não cobrem\n" +
      "  o caso 'autor logado lê o trabalho de outro autor'."
  );
} else {
  console.log("\nFase 5 — cruzamento entre autores:");

  // Descobre o id de B logando como B, para depois atacar como A.
  const clienteB = createClient(URL, KEY, semSessao);
  const { data: sessaoB, error: erroB } = await clienteB.auth.signInWithPassword({
    email: B_EMAIL,
    password: B_SENHA,
  });
  if (erroB) {
    falhou(`não consegui logar como autor B (${erroB.message})`);
  } else {
    const idB = sessaoB.user.id;
    const clienteA = createClient(URL, KEY, semSessao);
    const { error: erroA } = await clienteA.auth.signInWithPassword({
      email: A_EMAIL,
      password: A_SENHA,
    });

    if (erroA) {
      falhou(`não consegui logar como autor A (${erroA.message})`);
    } else if ((await clienteA.rpc("is_event_staff")).data === true) {
      // Guarda contra um falso positivo caro: com `avaliador` ou `admin`,
      // is_event_staff() é true e as policies de trabalhos/profiles/
      // user_roles/pareceres liberam a base inteira POR DESENHO. A sonda
      // acusaria cinco "vazamentos" que são o comportamento correto, e o
      // relatório perderia o sentido. A fase exige autores comuns.
      const papeis = (await clienteA.rpc("get_my_roles")).data ?? [];
      falhou(
        `a conta A (${A_EMAIL}) é da ORGANIZAÇÃO — papéis: ${papeis.join(", ")}.\n` +
          "       is_event_staff() = true, então ler e editar os trabalhos de\n" +
          "       terceiros é o comportamento CORRETO do RLS, não um vazamento.\n" +
          "       Esta fase precisa de duas contas de autor comum (sem\n" +
          "       'avaliador' nem 'admin'). Remova os papéis em /admin/papeis\n" +
          "       ou use outras duas contas, e rode de novo.",
      );
    } else {
      const comoA = async (rotulo, consulta) => {
        const { data, error } = await consulta();
        if (error) ok(`${rotulo}: negada (${error.code || error.message})`);
        else if (!data || data.length === 0) ok(`${rotulo}: 0 linhas`);
        else falhou(`${rotulo}: VAZOU ${data.length} linha(s)`);
      };

      await comoA("A não lê trabalhos de B", () =>
        clienteA.from("trabalhos").select("*").eq("owner_id", idB)
      );
      await comoA("A não lê o profile de B", () =>
        clienteA.from("profiles").select("*").eq("id", idB)
      );
      await comoA("A não lê os papéis de B", () =>
        clienteA.from("user_roles").select("*").eq("user_id", idB)
      );
      await comoA("A não lê pareceres alheios", () =>
        clienteA.from("pareceres").select("*").not("revisor_email", "eq", A_EMAIL)
      );
      await comoA("A não lê avaliações", () =>
        clienteA.from("avaliacoes").select("*")
      );
      await comoA("A não lê inscrições de B", () =>
        clienteA.from("congress_registrations").select("*").eq("user_id", idB)
      );

      // UPDATE cruzado: sem linhas afetadas é o resultado correto.
      const { data: upd, error: updErr } = await clienteA
        .from("trabalhos")
        .update({ titulo: "SEQUESTRADO PELA SONDA" })
        .eq("owner_id", idB)
        .select();
      if (updErr) ok(`A não altera trabalhos de B: negada (${updErr.code || updErr.message})`);
      else if (!upd || upd.length === 0) ok("A não altera trabalhos de B: 0 linhas afetadas");
      else falhou(`A ALTEROU ${upd.length} trabalho(s) de B — dado corrompido, corrigir à mão`);

      await clienteA.auth.signOut();
    }
    await clienteB.auth.signOut();
  }
}

// ---------------------------------------------------------------------
console.log("\n" + "─".repeat(64));
if (falhas > 0) {
  console.error(`${falhas} sonda(s) VAZARAM. Não publicar o site assim.`);
  process.exit(1);
}
if (fracos > 0) {
  console.log(
    `Nenhum vazamento. ${fracos} resultado(s) fraco(s): 0 linhas sem erro do ` +
      `banco.\nConfirmar à mão, no dashboard, que essas tabelas não estão só vazias.`
  );
} else {
  console.log("Nenhum vazamento. Todas as negativas vieram do banco.");
}
process.exit(0);
