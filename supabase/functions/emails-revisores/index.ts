// ============================================================
// Edge Function `emails-revisores` - fila dos e-mails da conta UFLA
// ------------------------------------------------------------
// Ponte entre o Apps Script da conta congressoparaiso@ufla.br
// (apps-script/emails-revisores.gs) e as filas do banco: a dos revisores
// (migration 20261014120000), desde a 20261027120000 a do resultado da
// avaliação aos AUTORES e, desde a 20261104120000, a do cronograma de
// apresentações (dia, horário, sala e formato, também aos autores). O nome
// ficou "emails-revisores" porque trocá-lo exigiria editar a Propriedade
// URL_FUNCAO do Apps Script.
// Quem chama é SÓ o Apps Script, a cada minuto; nenhum navegador fala com
// esta função, por isso ela não tem CORS. O Brevo continua com a
// verificação de e-mail e a redefinição de senha.
//
// O que mora aqui é o TEXTO dos e-mails. Quem recebe o quê, e quando, é
// regra do SQL (`emails_devidos`, `resultados_devidos`,
// `apresentacoes_devidas`); quem envia é o Apps Script (MailApp).
//
// Cada e-mail reservado é uma linha de `envios_revisores` (migration
// 20261026120000), de `envios_resultados` (20261027120000) ou de
// `envios_apresentacoes` (20261104120000), e o Apps Script a fecha por
// `concluir` com o resultado do MailApp — os ids são UUIDs, e
// `concluir_envios` acha cada um na tabela certa.
//
// ⚠ DEPLOY COM `verify_jwt: false` (ver scripts/deploy-functions.js): o
//   Apps Script não tem JWT do Supabase. Quem autentica é o cabeçalho
//   `x-segredo`, comparado com o secret SEGREDO_FILA_EMAILS. É a exceção à
//   regra "identidade só do JWT": o chamador não é um usuário, é o
//   remetente oficial - e o máximo que ele consegue é fazer sair o que o
//   banco já considera devido, com o texto daqui.
//
// ⚠ `pegar` RESERVA. Chamá-la à mão com a fila cheia marca os e-mails como
//   enviados sem que ninguém os envie. Testar só com a fila vazia.
//
// Secrets: SEGREDO_FILA_EMAILS (npm run config:secrets) e SITE_URL (o mesmo
//   das functions do Brevo, base do link). Injetados pela plataforma:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// ============================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

// Marca - duplicada de src/lib/brand.ts DE PROPÓSITO (Deno não importa
// do bundle do Vite). Se a marca mudar lá, mudar aqui também.
const APP_NAME = "Congresso Unificado ICTIN";
const APP_TAGLINE = "ICTIN · Submissões Científicas";

/** E-mails por busca quando o Apps Script não diz. Preso em 1..50, aqui e no SQL. */
const LIMITE_PADRAO = 20;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Tipo = "atribuicao" | "lembrete" | "atraso";

/** Uma linha de `emails_devidos()`: um e-mail para um revisor. */
type Devido = {
  /** A linha de `envios_revisores` que o Apps Script fecha em `concluir`. */
  envio_id: string;
  tipo: Tipo;
  revisor_email: string;
  revisor_nome: string | null;
  associacoes: string[];
  titulos: string[];
  /** 'AAAA-MM-DD' ou null (sem prazo - só a designação sai sem ele). */
  prazo: string | null;
};

/** Uma linha de `resultados_devidos()`: o e-mail de UM autor, com todos os trabalhos dele. */
type Resultado = {
  /** A linha de `envios_resultados` que o Apps Script fecha em `concluir`. */
  envio_id: string;
  autor_email: string;
  autor_nome: string | null;
  /** 1 reenvio · 2 correções · 3 aprovado · 4 reprovado - o mais urgente do autor. */
  prioridade: number;
  /** Já na ordem de urgência, do SQL. `media` nula = trabalho sem nota. */
  trabalhos: { titulo: string; status: string; media: number | null; pareceres: number }[];
};

/** Uma linha de `apresentacoes_devidas()`: o e-mail de UM autor, com os trabalhos dele que mudaram. */
type Apresentacao = {
  /** A linha de `envios_apresentacoes` que o Apps Script fecha em `concluir`. */
  envio_id: string;
  autor_email: string;
  autor_nome: string | null;
  /**
   * Na ordem do SQL (dia, início, título). `data` é 'AAAA-MM-DD' e as horas
   * 'HH:MM'; `tipo` vazio = a categoria ainda não tem formato definido.
   * `alteracao` = o autor já tinha recebido um e-mail deste trabalho.
   */
  trabalhos: {
    titulo: string;
    categoria: string;
    tipo: string;
    data: string;
    hora_inicio: string;
    hora_fim: string;
    sala: string;
    alteracao: boolean;
  }[];
};

/** Resposta JSON. `erro` é um código estável, como nas functions do Brevo. */
function responder(status: number, corpo: Record<string, unknown>): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Comparação em tempo constante: compara os SHA-256, nunca as strings. */
async function mesmoSegredo(recebido: string, esperado: string): Promise<boolean> {
  const hash = async (texto: string) =>
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto)));
  const [a, b] = await Promise.all([hash(recebido), hash(esperado)]);
  let diferenca = 0;
  for (let i = 0; i < a.length; i++) diferenca |= a[i] ^ b[i];
  return diferenca === 0;
}

/** Título e nome foram digitados por autores e usuários: no HTML, só escapados. */
const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
const escapar = (texto: string) => texto.replace(/[&<>"']/g, (c) => ESCAPES[c]);

/**
 * 'AAAA-MM-DD' → 'DD/MM/AAAA' sem passar por `Date`: a string sem hora é
 * lida como UTC, e em Lavras o dia 01 viraria 31 do mês anterior.
 */
const dataBr = (iso: string) => iso.split("-").reverse().join("/");

/** Hoje em Lavras, 'AAAA-MM-DD' - zero-padded, então `<=` já é cronológico. */
const hojeEmLavras = () =>
  new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

// ------------------------------------------------------------
// Corpo dos e-mails (pt-BR)
// ------------------------------------------------------------
const RODAPE = "Dúvidas? Responda este e-mail - a resposta chega à comissão organizadora.";

/**
 * A moldura comum a todos os e-mails daqui. HTML deliberadamente simples e
 * com estilo inline, como o das functions do Brevo: cliente de e-mail não
 * carrega CSS externo. `miolo` chega pronto - e escapado - de quem chama.
 */
function moldura(titulo: string, miolo: string, link: string, botao: string): string {
  return `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:24px;background:#f4f5f7;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2937;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
      <tr><td>
        <p style="margin:0 0 4px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;">${APP_NAME}</p>
        <h1 style="margin:0 0 20px;font-size:20px;color:#111827;">${titulo}</h1>
        ${miolo}
        <p style="margin:0 0 24px;">
          <a href="${link}" style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;">${botao}</a>
        </p>
        <p style="margin:0;font-size:13px;color:#6b7280;">${RODAPE}</p>
      </td></tr>
    </table>
    <p style="max-width:560px;margin:16px auto 0;font-size:12px;color:#9ca3af;text-align:center;">
      ${APP_NAME} - ${APP_TAGLINE}
    </p>
  </body>
</html>`;
}

// Só TÍTULOS: a avaliação é às cegas (ver COLUNAS_VISIVEIS em
// src/services/revisorService.ts) - autor, orientador e coautores não
// descem para o revisor, nem por e-mail.
function montarEmail(d: Devido, siteUrl: string) {
  const nome = d.revisor_nome?.trim() || null;
  const saudacao = nome ? `Olá, ${nome}!` : "Olá!";
  const link = `${siteUrl.replace(/\/+$/, "")}/revisor`;
  const n = d.titulos.length;
  const registreOs = n === 1 ? "registre-o" : "registre-os";
  const prazo = d.prazo ? dataBr(d.prazo) : "";

  let assunto: string;
  let titulo: string;
  let abertura: string;
  let fecho: string | null = null;

  if (d.tipo === "atribuicao") {
    assunto = `Trabalhos para avaliar - ${APP_NAME}`;
    titulo = "Você tem trabalhos para avaliar";
    abertura =
      n === 1
        ? `Você foi designado(a) para avaliar o trabalho abaixo no ${APP_NAME}:`
        : `Você foi designado(a) para avaliar estes ${n} trabalhos no ${APP_NAME}:`;
    if (d.prazo) {
      fecho =
        hojeEmLavras() <= d.prazo
          ? `O prazo para registrar os pareceres vai até ${prazo}, às 23h59 (horário de Brasília).`
          : `O prazo previsto para os pareceres encerrou em ${prazo}; ${registreOs} o quanto antes.`;
    }
  } else if (d.tipo === "lembrete") {
    assunto = `Lembrete: pareceres até ${prazo} | ${APP_NAME}`;
    titulo = "O prazo dos pareceres está acabando";
    abertura =
      `O prazo para registrar os pareceres termina em ${prazo}, às 23h59 (horário de Brasília), e ` +
      (n === 1 ? "ainda falta o parecer deste trabalho:" : `ainda faltam os pareceres destes ${n} trabalhos:`);
  } else {
    assunto = `Pareceres em atraso - ${APP_NAME}`;
    titulo = "Pareceres em atraso";
    abertura =
      `O prazo para os pareceres encerrou em ${prazo} e ` +
      (n === 1
        ? "o parecer deste trabalho ainda não foi registrado:"
        : `os pareceres destes ${n} trabalhos ainda não foram registrados:`);
    fecho =
      `Por favor, ${registreOs} o quanto antes. Se houver algum impedimento, responda este e-mail para avisar a comissão organizadora.`;
  }

  const texto = [
    saudacao,
    "",
    abertura,
    "",
    ...d.titulos.map((t) => `- ${t}`),
    "",
    ...(fecho ? [fecho, ""] : []),
    `Abra o Portal de Revisão: ${link}`,
    "",
    RODAPE,
    `${APP_NAME} - ${APP_TAGLINE}`,
  ].join("\n");

  const itens = d.titulos.map((t) => `<li style="margin:0 0 6px;">${escapar(t)}</li>`).join("");
  const html = moldura(
    titulo,
    `<p style="margin:0 0 16px;line-height:1.6;">${escapar(saudacao)}</p>
        <p style="margin:0 0 12px;line-height:1.6;">${escapar(abertura)}</p>
        <ul style="margin:0 0 20px;padding-left:20px;line-height:1.6;">${itens}</ul>
        ${fecho ? `<p style="margin:0 0 24px;line-height:1.6;">${escapar(fecho)}</p>` : ""}`,
    link,
    "Abrir o Portal de Revisão",
  );

  return { assunto, html, texto };
}

// ------------------------------------------------------------
// Resultado da avaliação, aos autores (migration 20261027120000)
// ------------------------------------------------------------
// UM e-mail por autor, com TODOS os trabalhos dele - o SQL só o libera
// depois da última decisão. Média e número de pareceres, nunca quem os
// assinou: a avaliação é às cegas. Os comentários ficam no portal.

/** O desfecho como o autor o lê (o rótulo de `statusLabel`, por extenso) e o que ele tem de fazer. */
const DESFECHOS: Record<string, { rotulo: string; acao: string | null }> = {
  resubmeter: {
    rotulo: "Reenvio solicitado",
    acao: "Reenvie o trabalho completo pelo portal, no botão Reenviar.",
  },
  aprovado_correcoes: {
    rotulo: "Aprovado com correções",
    acao: "Envie a versão corrigida pelo portal, no botão Corrigir, para concluir a aprovação.",
  },
  aprovado: { rotulo: "Aprovado", acao: null },
  reprovado: { rotulo: "Reprovado", acao: null },
};

function montarEmailResultado(r: Resultado, siteUrl: string) {
  const nome = r.autor_nome?.trim() || null;
  const saudacao = nome ? `Olá, ${nome}!` : "Olá!";
  const link = `${siteUrl.replace(/\/+$/, "")}/estudante/papeis-submetidos`;
  const n = r.trabalhos.length;

  // Reenvio e correção pedem ação do autor: o assunto já diz isso na caixa de entrada.
  const assunto =
    r.prioridade <= 2
      ? `Resultado da avaliação: ação necessária - ${APP_NAME}`
      : `Resultado da avaliação - ${APP_NAME}`;
  const titulo = n === 1 ? "O resultado do seu trabalho" : "O resultado dos seus trabalhos";
  const abertura =
    n === 1
      ? `Saiu o resultado da avaliação do seu trabalho no ${APP_NAME}:`
      : `Saiu o resultado da avaliação dos seus ${n} trabalhos no ${APP_NAME}:`;
  const fecho = "Os comentários dos avaliadores estão no portal, na página de cada trabalho.";

  const blocos = r.trabalhos.map((t) => {
    const desfecho = DESFECHOS[t.status] ?? { rotulo: t.status, acao: null };
    const pareceres = t.pareceres === 1 ? "1 parecer" : `${t.pareceres} pareceres`;
    // `toFixed(2)`, como a média que o autor vê em PareceresRecebidos.
    const nota =
      t.media === null ? null : `Média das notas: ${Number(t.media).toFixed(2)} de 5 (${pareceres}).`;
    return { titulo: t.titulo, rotulo: desfecho.rotulo, nota, acao: desfecho.acao };
  });

  const texto = [
    saudacao,
    "",
    abertura,
    "",
    ...blocos.flatMap((b) => [
      `- ${b.titulo}`,
      `  Resultado: ${b.rotulo}`,
      ...(b.nota ? [`  ${b.nota}`] : []),
      ...(b.acao ? [`  ${b.acao}`] : []),
      "",
    ]),
    fecho,
    "",
    `Abra o portal: ${link}`,
    "",
    RODAPE,
    `${APP_NAME} - ${APP_TAGLINE}`,
  ].join("\n");

  const itens = blocos
    .map(
      (b) =>
        `<li style="margin:0 0 12px;"><strong>${escapar(b.titulo)}</strong><br>` +
        `Resultado: <strong>${escapar(b.rotulo)}</strong>` +
        (b.nota ? `<br>${escapar(b.nota)}` : "") +
        (b.acao ? `<br><em>${escapar(b.acao)}</em>` : "") +
        `</li>`,
    )
    .join("");
  const html = moldura(
    titulo,
    `<p style="margin:0 0 16px;line-height:1.6;">${escapar(saudacao)}</p>
        <p style="margin:0 0 12px;line-height:1.6;">${escapar(abertura)}</p>
        <ul style="margin:0 0 20px;padding-left:20px;line-height:1.6;">${itens}</ul>
        <p style="margin:0 0 24px;line-height:1.6;">${escapar(fecho)}</p>`,
    link,
    "Abrir o portal",
  );

  return { assunto, html, texto };
}

// ------------------------------------------------------------
// Cronograma de apresentações, aos autores (migration 20261104120000)
// ------------------------------------------------------------
// UM e-mail por autor por lote, com os trabalhos dele que ganharam
// informação nova no AdminCA: agendados agora ou alterados. Só o dono do
// trabalho recebe - coautor não, como decidido com o usuário.

function montarEmailApresentacao(a: Apresentacao, siteUrl: string) {
  const nome = a.autor_nome?.trim() || null;
  const saudacao = nome ? `Olá, ${nome}!` : "Olá!";
  const link = `${siteUrl.replace(/\/+$/, "")}/estudante/apresentacoes`;
  const n = a.trabalhos.length;
  const alterou = a.trabalhos.some((t) => t.alteracao);

  // A mudança precisa aparecer já na caixa de entrada: quem leu o primeiro
  // e-mail não abre o segundo se o assunto for igual.
  const assunto = alterou
    ? `Atualização da sua apresentação - ${APP_NAME}`
    : `Sua apresentação no ${APP_NAME}`;
  const titulo = n === 1 ? "Sua apresentação no congresso" : "Suas apresentações no congresso";
  const abertura = alterou
    ? n === 1
      ? `O cronograma de apresentações do ${APP_NAME} mudou. Confira os dados do seu trabalho:`
      : `O cronograma de apresentações do ${APP_NAME} mudou. Confira os dados dos seus ${n} trabalhos:`
    : n === 1
      ? `A apresentação do seu trabalho no ${APP_NAME} foi agendada:`
      : `As apresentações dos seus ${n} trabalhos no ${APP_NAME} foram agendadas:`;
  const fecho =
    "O cronograma completo, com todos os trabalhos, está no portal, na aba Cronograma de Apresentações.";

  const blocos = a.trabalhos.map((t) => ({
    titulo: t.titulo,
    linhas: [
      ...(t.tipo ? [`Formato: ${t.tipo}`] : []),
      `Dia: ${dataBr(t.data)}`,
      `Horário: ${t.hora_inicio} às ${t.hora_fim} (horário de Brasília)`,
      `Sala: ${t.sala}`,
    ],
    alteracao: t.alteracao,
  }));

  const texto = [
    saudacao,
    "",
    abertura,
    "",
    ...blocos.flatMap((b) => [
      `- ${b.titulo}${b.alteracao ? " (alterado)" : ""}`,
      ...b.linhas.map((l) => `  ${l}`),
      "",
    ]),
    fecho,
    "",
    `Abra o portal: ${link}`,
    "",
    RODAPE,
    `${APP_NAME} - ${APP_TAGLINE}`,
  ].join("\n");

  const itens = blocos
    .map(
      (b) =>
        `<li style="margin:0 0 12px;"><strong>${escapar(b.titulo)}</strong>` +
        (b.alteracao ? ` <em>(alterado)</em>` : "") +
        b.linhas.map((l) => `<br>${escapar(l)}`).join("") +
        `</li>`,
    )
    .join("");
  const html = moldura(
    titulo,
    `<p style="margin:0 0 16px;line-height:1.6;">${escapar(saudacao)}</p>
        <p style="margin:0 0 12px;line-height:1.6;">${escapar(abertura)}</p>
        <ul style="margin:0 0 20px;padding-left:20px;line-height:1.6;">${itens}</ul>
        <p style="margin:0 0 24px;line-height:1.6;">${escapar(fecho)}</p>`,
    link,
    "Ver o cronograma de apresentações",
  );

  return { assunto, html, texto };
}

// ------------------------------------------------------------
// Certificados (migration 20261111120000)
// ------------------------------------------------------------
// Aviso sem anexo: o certificado é desenhado no navegador, no portal. Um
// e-mail por pessoa por leva; `avisados` são os usos que esta leva liberou.

/** Uma linha de `certificados_devidos()`. */
type Certificado = {
  envio_id: string;
  para: string;
  para_nome: string | null;
  avisados: string[];
};

function montarEmailCertificado(c: Certificado, siteUrl: string) {
  const nome = c.para_nome?.trim() || null;
  const saudacao = nome ? `Olá, ${nome}!` : "Olá!";
  const base = siteUrl.replace(/\/+$/, "");
  // O botão leva ao portal do primeiro uso avisado; os demais vão por extenso.
  const portais = [
    c.avisados.some((u) => u !== "revisao" && u !== "avaliacao")
      ? { rotulo: "Submissão", link: `${base}/estudante/certificados` }
      : null,
    c.avisados.includes("revisao") ? { rotulo: "Revisão", link: `${base}/revisor/certificados` } : null,
    c.avisados.includes("avaliacao")
      ? { rotulo: "Avaliação", link: `${base}/avaliacao/certificados` }
      : null,
  ].filter((p): p is { rotulo: string; link: string } => p !== null);
  const link = portais[0]?.link ?? base;

  const assunto = `Seu certificado está disponível - ${APP_NAME}`;
  const abertura =
    `Seu certificado do ${APP_NAME} já pode ser baixado no portal, na aba Certificados` +
    (portais.length > 1 ? " de cada área em que você participou:" : ".");

  const texto = [
    saudacao,
    "",
    abertura,
    "",
    ...portais.map((p) => `- ${p.rotulo}: ${p.link}`),
    "",
    RODAPE,
    `${APP_NAME} - ${APP_TAGLINE}`,
  ].join("\n");

  const itens =
    portais.length > 1
      ? `<ul style="margin:0 0 20px;padding-left:20px;line-height:1.6;">${portais
          .map((p) => `<li><a href="${p.link}">${escapar(p.rotulo)}</a></li>`)
          .join("")}</ul>`
      : "";
  const html = moldura(
    "Seu certificado está disponível",
    `<p style="margin:0 0 16px;line-height:1.6;">${escapar(saudacao)}</p>
        <p style="margin:0 0 20px;line-height:1.6;">${escapar(abertura)}</p>
        ${itens}`,
    link,
    "Baixar o certificado",
  );

  return { assunto, html, texto };
}

// ------------------------------------------------------------
// Handler
// ------------------------------------------------------------
Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return responder(405, { ok: false, erro: "metodo_invalido" });
  }

  // 1. Secrets - falta de configuração é erro de operação.
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const SEGREDO = Deno.env.get("SEGREDO_FILA_EMAILS");
  const SITE_URL = Deno.env.get("SITE_URL");

  const faltando = Object.entries({
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
    SEGREDO_FILA_EMAILS: SEGREDO,
    SITE_URL,
  })
    .filter(([, v]) => !v)
    .map(([k]) => k);

  if (faltando.length > 0) {
    console.error(`Secrets ausentes: ${faltando.join(", ")}`);
    return responder(500, { ok: false, erro: "config_ausente" });
  }

  // 2. Quem chama - antes de ler o corpo.
  if (!(await mesmoSegredo(req.headers.get("x-segredo") ?? "", SEGREDO!))) {
    return responder(401, { ok: false, erro: "segredo_invalido" });
  }

  let corpo: Record<string, unknown>;
  try {
    corpo = JSON.parse(await req.text()) as Record<string, unknown>;
  } catch {
    return responder(400, { ok: false, erro: "corpo_invalido" });
  }
  if (!corpo || typeof corpo !== "object") {
    return responder(400, { ok: false, erro: "corpo_invalido" });
  }

  const clienteServico = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ==========================================================
  // acao: "pegar" - reserva o que está devido e devolve os e-mails prontos
  // ==========================================================
  if (corpo.acao === "pegar") {
    // Preso a 1..50, como no SQL: a soma das três filas nunca passa do que o
    // Apps Script pediu - e ele pede o que a cota do dia ainda permite.
    const limite = Math.min(Math.max(Math.trunc(Number(corpo.limite)) || LIMITE_PADRAO, 1), 50);
    const { data, error } = await clienteServico.rpc("emails_devidos", { _limite: limite });
    if (error) {
      console.error(`emails_devidos falhou [${error.code ?? ""}]: ${error.message}`);
      return responder(500, { ok: false, erro: "falha_fila" });
    }
    const devidos = (data ?? []) as Devido[];

    // Os resultados aos autores ocupam o que sobrar do lote. Revisor
    // primeiro: designação e lembrete correm contra um prazo.
    let resultados: Resultado[] = [];
    if (devidos.length < limite) {
      const r = await clienteServico.rpc("resultados_devidos", {
        _limite: limite - devidos.length,
      });
      if (r.error) {
        // ⚠ Sem 500 aqui: os e-mails aos revisores acima JÁ foram
        // reservados, e uma resposta de erro os deixaria "sem confirmação"
        // para sempre. Os resultados esperam a próxima busca.
        console.error(`resultados_devidos falhou [${r.error.code ?? ""}]: ${r.error.message}`);
      } else {
        resultados = (r.data ?? []) as Resultado[];
      }
    }

    // O cronograma de apresentações ocupa o que ainda sobrar: informativo,
    // não corre contra prazo nenhum.
    let apresentacoes: Apresentacao[] = [];
    const resta = limite - devidos.length - resultados.length;
    if (resta > 0) {
      const a = await clienteServico.rpc("apresentacoes_devidas", { _limite: resta });
      if (a.error) {
        // ⚠ Sem 500, pelo mesmo motivo dos resultados: o que já foi
        // reservado acima ficaria "sem confirmação" para sempre.
        console.error(`apresentacoes_devidas falhou [${a.error.code ?? ""}]: ${a.error.message}`);
      } else {
        apresentacoes = (a.data ?? []) as Apresentacao[];
      }
    }

    // Os avisos de certificado vêm por último: não correm contra prazo.
    let certificados: Certificado[] = [];
    const restaCert = resta - apresentacoes.length;
    if (restaCert > 0) {
      const c = await clienteServico.rpc("certificados_devidos", { _limite: restaCert });
      if (c.error) {
        // ⚠ Sem 500, pelo mesmo motivo das filas acima.
        console.error(`certificados_devidos falhou [${c.error.code ?? ""}]: ${c.error.message}`);
      } else {
        certificados = (c.data ?? []) as Certificado[];
      }
    }

    // Só contagens no log: endereço de revisor ou de autor não vai para log nenhum.
    if (devidos.length + resultados.length + apresentacoes.length + certificados.length > 0) {
      console.log(
        `pegar: ${devidos.length} e-mail(s) a revisores, ${resultados.length} resultado(s), ` +
          `${apresentacoes.length} apresentação(ões) e ${certificados.length} certificado(s) reservado(s).`,
      );
    }

    return responder(200, {
      ok: true,
      remetente: APP_NAME,
      emails: [
        ...devidos.map((d) => ({
          id: d.envio_id,
          tipo: d.tipo,
          associacoes: d.associacoes,
          para: d.revisor_email,
          ...montarEmail(d, SITE_URL!),
        })),
        // Na ordem do SQL: o reenvio sai antes da correção, e assim por diante.
        ...resultados.map((r) => ({
          id: r.envio_id,
          tipo: "resultado",
          para: r.autor_email,
          ...montarEmailResultado(r, SITE_URL!),
        })),
        ...apresentacoes.map((a) => ({
          id: a.envio_id,
          tipo: "apresentacao",
          para: a.autor_email,
          ...montarEmailApresentacao(a, SITE_URL!),
        })),
        ...certificados.map((c) => ({
          id: c.envio_id,
          tipo: "certificado",
          para: c.para,
          ...montarEmailCertificado(c, SITE_URL!),
        })),
      ],
    });
  }

  // ==========================================================
  // acao: "concluir" - o resultado de cada envio, como o MailApp respondeu
  // ==========================================================
  // `resultados` = [{ id, erro }], erro null = enviado. Id que não é UUID
  // fica de fora: o cast no SQL derrubaria o lote inteiro, e as linhas
  // boas ficariam "reservado" para sempre.
  if (corpo.acao === "concluir") {
    const brutos = (Array.isArray(corpo.resultados) ? corpo.resultados : []) as {
      id?: unknown;
      erro?: unknown;
    }[];
    const resultados = brutos
      .filter((r) => UUID.test(String(r?.id)))
      .map((r) => ({
        id: String(r.id),
        erro: typeof r.erro === "string" && r.erro ? r.erro : null,
      }));
    const { data, error } = await clienteServico.rpc("concluir_envios", {
      _resultados: resultados,
    });
    if (error) {
      console.error(`concluir_envios falhou [${error.code ?? ""}]: ${error.message}`);
      return responder(500, { ok: false, erro: "falha_conclusao" });
    }
    const falhas = resultados.filter((r) => r.erro).length;
    console.log(`concluir: ${data ?? 0} envio(s) fechado(s), ${falhas} com falha.`);
    return responder(200, { ok: true, concluidos: data ?? 0 });
  }

  return responder(400, { ok: false, erro: "acao_invalida" });
});
