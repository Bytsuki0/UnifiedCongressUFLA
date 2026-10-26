// ============================================================
// Edge Function `emails-revisores` - fila dos e-mails aos revisores
// ------------------------------------------------------------
// Ponte entre o Apps Script da conta congressoparaiso@ufla.br
// (apps-script/emails-revisores.gs) e a fila do banco (migration
// 20261014120000). Quem chama é SÓ o Apps Script, a cada minuto; nenhum
// navegador fala com esta função, por isso ela não tem CORS. O Brevo
// continua com a verificação de e-mail e a redefinição de senha.
//
// O que mora aqui é o TEXTO dos e-mails. Quem recebe o quê, e quando, é
// regra do SQL (`emails_devidos`); quem envia é o Apps Script (MailApp).
//
// Cada e-mail reservado é uma linha de `envios_revisores` (migration
// 20261026120000), e o Apps Script a fecha por `concluir` com o resultado
// do MailApp — é esse registro que a tela de Atribuições mostra.
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

/** Revisores por busca quando o Apps Script não diz. O SQL prende em 1..50. */
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

  const rodape = "Dúvidas? Responda este e-mail - a resposta chega à comissão organizadora.";

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
    rodape,
    `${APP_NAME} - ${APP_TAGLINE}`,
  ].join("\n");

  // HTML deliberadamente simples e com estilo inline, como o das functions
  // do Brevo: cliente de e-mail não carrega CSS externo.
  const itens = d.titulos.map((t) => `<li style="margin:0 0 6px;">${escapar(t)}</li>`).join("");
  const html = `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:24px;background:#f4f5f7;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2937;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
      <tr><td>
        <p style="margin:0 0 4px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;">${APP_NAME}</p>
        <h1 style="margin:0 0 20px;font-size:20px;color:#111827;">${titulo}</h1>
        <p style="margin:0 0 16px;line-height:1.6;">${escapar(saudacao)}</p>
        <p style="margin:0 0 12px;line-height:1.6;">${escapar(abertura)}</p>
        <ul style="margin:0 0 20px;padding-left:20px;line-height:1.6;">${itens}</ul>
        ${fecho ? `<p style="margin:0 0 24px;line-height:1.6;">${escapar(fecho)}</p>` : ""}
        <p style="margin:0 0 24px;">
          <a href="${link}" style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;">Abrir o Portal de Revisão</a>
        </p>
        <p style="margin:0;font-size:13px;color:#6b7280;">${rodape}</p>
      </td></tr>
    </table>
    <p style="max-width:560px;margin:16px auto 0;font-size:12px;color:#9ca3af;text-align:center;">
      ${APP_NAME} - ${APP_TAGLINE}
    </p>
  </body>
</html>`;

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
    const { data, error } = await clienteServico.rpc("emails_devidos", {
      _limite: Number(corpo.limite) || LIMITE_PADRAO,
    });
    if (error) {
      console.error(`emails_devidos falhou [${error.code ?? ""}]: ${error.message}`);
      return responder(500, { ok: false, erro: "falha_fila" });
    }

    const devidos = (data ?? []) as Devido[];
    // Só contagens no log: endereço de revisor não vai para log nenhum.
    if (devidos.length > 0) console.log(`pegar: ${devidos.length} e-mail(s) reservado(s).`);

    return responder(200, {
      ok: true,
      remetente: APP_NAME,
      emails: devidos.map((d) => ({
        id: d.envio_id,
        tipo: d.tipo,
        associacoes: d.associacoes,
        para: d.revisor_email,
        ...montarEmail(d, SITE_URL!),
      })),
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
