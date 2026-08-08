// ============================================================
// Edge Function `enviar-email` — Etapa 2 da verificação de e-mail
// ------------------------------------------------------------
// Única ponte do projeto para um serviço externo (Brevo). O CLAUDE.md
// autoriza Edge Functions SOMENTE para isso: aqui não mora regra de
// negócio nem autorização — quem decide se o token pode ser cunhado é
// a RPC `criar_token_email` (SECURITY DEFINER, GRANT só a service_role).
// Esta função apenas: identifica o chamador pelo JWT, pede o token ao
// banco, entrega o e-mail e anota o `message_id` devolvido pelo Brevo.
//
// ⚠ O TOKEN CRU NUNCA É LOGADO. Ele existe só no retorno da RPC, no
//   corpo do e-mail e na URL que o usuário clica. Nenhum console.log
//   desta função pode receber `token`.
//
// ⚠ A identidade vem EXCLUSIVAMENTE do JWT (`auth.getUser()`). O corpo
//   da requisição não aceita `email` nem `user_id` — se vierem, são
//   ignorados. Isso é o que impede usar a função para spammar terceiros.
//
// ------------------------------------------------------------
// Pendências EXTERNAS ao repositório (painel do Brevo / DNS) —
// registradas aqui porque é onde a falha aparece:
//
//   · Remetente/domínio `ciuflaictin.com.br` precisa estar VERIFICADO
//     no Brevo, senão o envio volta 400 mesmo com a chave correta.
//   · SPF, DKIM e DMARC do domínio: sem eles o e-mail chega em spam
//     (ou é recusado pelo Gmail/Outlook). Fora do escopo desta etapa —
//     configurar no DNS + painel do Brevo.
//   · Plano free do Brevo = 300 e-mails/dia. Estimativa do dia 1:
//     180 cadastros + ~30% de reenvios ≈ 234 — cabe, com ~25% de folga.
//     Se a janela de inscrição concentrar mais que isso, contratar um
//     mês do plano pago ANTES de abrir as inscrições.
//
// Secrets exigidos (gravados por `npm run config:secrets`):
//   BREVO_API_KEY     — chave da API v3 do Brevo (xkeysib-...)
//   EMAIL_REMETENTE   — "Nome <endereco@dominio>" ou só o endereço
//   SITE_URL          — base do link de confirmação (SEM barra final)
// Injetados pela plataforma: SUPABASE_URL, SUPABASE_ANON_KEY,
//   SUPABASE_SERVICE_ROLE_KEY.
// ============================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

// ------------------------------------------------------------
// Marca — duplicada de src/lib/brand.ts DE PROPÓSITO
// ------------------------------------------------------------
// A function roda em Deno, fora do bundle do Vite: não há como importar
// `src/lib/brand.ts` daqui. Se a marca mudar lá, mudar aqui também.
const APP_NAME = "Congresso Unificado ICTIN";
const APP_TAGLINE = "ICTIN · Submissões Científicas";

// ------------------------------------------------------------
// CORS — allowlist explícita
// ------------------------------------------------------------
// Dois ambientes convivem: o banco JÁ é produção, mas o frontend roda
// local durante o desenvolvimento (Vite na porta 5000, ver
// vite.config.ts). Por isso os dois entram. `*` não serve: a requisição
// carrega Authorization, e refletir qualquer origem daria a qualquer
// site a chance de disparar e-mails com a sessão de quem estiver logado.
const ORIGENS_PERMITIDAS = [
  "http://localhost:5000",
  "http://127.0.0.1:5000",
  "https://ciuflaictin.com.br",
  "https://www.ciuflaictin.com.br",
];

function cabecalhosCors(origem: string | null): Record<string, string> {
  const permitida = origem !== null && ORIGENS_PERMITIDAS.includes(origem);
  return {
    // Sem origem permitida o cabeçalho some e o navegador barra a resposta.
    ...(permitida ? { "Access-Control-Allow-Origin": origem } : {}),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

/** Resposta JSON já com CORS. `erro` é um código estável — a UI decide o texto. */
function responder(
  origem: string | null,
  status: number,
  corpo: Record<string, unknown>,
): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { ...cabecalhosCors(origem), "Content-Type": "application/json" },
  });
}

/** sha256 hex — o MESMO cálculo do `encode(digest(token,'sha256'),'hex')` do Postgres. */
async function sha256Hex(texto: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** "Congresso <nao-responda@dominio>" → { name, email }; só o endereço também serve. */
function separarRemetente(valor: string): { name: string; email: string } {
  const comNome = valor.match(/^\s*(.*?)\s*<\s*([^>]+)\s*>\s*$/);
  if (comNome) return { name: comNome[1] || APP_NAME, email: comNome[2] };
  return { name: APP_NAME, email: valor.trim() };
}

// ------------------------------------------------------------
// Corpo do e-mail (pt-BR)
// ------------------------------------------------------------
function montarEmail(nome: string | null, link: string) {
  const saudacao = nome ? `Olá, ${nome}!` : "Olá!";
  const assunto = `Confirme seu e-mail — ${APP_NAME}`;

  const textContent = [
    saudacao,
    "",
    `Para começar a usar o ${APP_NAME}, confirme seu endereço de e-mail abrindo o link abaixo:`,
    "",
    link,
    "",
    "O link vale por 24 horas e pode ser usado uma única vez.",
    "Se não foi você quem se cadastrou, ignore esta mensagem — nenhuma ação será tomada.",
    "",
    `${APP_NAME} — ${APP_TAGLINE}`,
  ].join("\n");

  // HTML deliberadamente simples e com estilo inline: cliente de e-mail
  // não carrega CSS externo nem entende classes utilitárias.
  const htmlContent = `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:24px;background:#f4f5f7;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2937;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
      <tr><td>
        <p style="margin:0 0 4px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;">${APP_NAME}</p>
        <h1 style="margin:0 0 20px;font-size:20px;color:#111827;">Confirme seu e-mail</h1>
        <p style="margin:0 0 16px;line-height:1.6;">${saudacao}</p>
        <p style="margin:0 0 24px;line-height:1.6;">
          Para começar a usar o ${APP_NAME}, confirme seu endereço de e-mail:
        </p>
        <p style="margin:0 0 24px;">
          <a href="${link}" style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;">Confirmar e-mail</a>
        </p>
        <p style="margin:0 0 8px;line-height:1.6;font-size:14px;color:#4b5563;">
          Se o botão não funcionar, copie e cole este endereço no navegador:
        </p>
        <p style="margin:0 0 24px;word-break:break-all;font-size:13px;color:#4b5563;">${link}</p>
        <p style="margin:0 0 8px;font-size:13px;color:#6b7280;">O link vale por 24 horas e pode ser usado uma única vez.</p>
        <p style="margin:0;font-size:13px;color:#6b7280;">
          Se não foi você quem se cadastrou, ignore esta mensagem — nenhuma ação será tomada.
        </p>
      </td></tr>
    </table>
    <p style="max-width:560px;margin:16px auto 0;font-size:12px;color:#9ca3af;text-align:center;">
      ${APP_NAME} — ${APP_TAGLINE}
    </p>
  </body>
</html>`;

  return { assunto, htmlContent, textContent };
}

// ------------------------------------------------------------
// Handler
// ------------------------------------------------------------
Deno.serve(async (req: Request): Promise<Response> => {
  const origem = req.headers.get("Origin");

  // Preflight: o navegador não manda Authorization aqui.
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cabecalhosCors(origem) });
  }

  if (req.method !== "POST") {
    return responder(origem, 405, { ok: false, erro: "metodo_invalido" });
  }

  // 1. Secrets — falta de configuração é erro de operação, não do usuário.
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY");
  const EMAIL_REMETENTE = Deno.env.get("EMAIL_REMETENTE");
  const SITE_URL = Deno.env.get("SITE_URL");

  const faltando = Object.entries({
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
    BREVO_API_KEY,
    EMAIL_REMETENTE,
    SITE_URL,
  })
    .filter(([, v]) => !v)
    .map(([k]) => k);

  if (faltando.length > 0) {
    console.error(`Secrets ausentes: ${faltando.join(", ")}`);
    return responder(origem, 500, {
      ok: false,
      erro: "config_ausente",
      mensagem: "Envio de e-mail não configurado no servidor.",
    });
  }

  // 2. Identidade — só do JWT.
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return responder(origem, 401, {
      ok: false,
      erro: "sem_sessao",
      mensagem: "Entre na sua conta para receber o e-mail de confirmação.",
    });
  }

  // Cliente com a chave pública + o Authorization do chamador: `getUser()`
  // resolve o JWT no GoTrue. Uma anon key crua passa pelo gateway (também
  // é um JWT), mas não tem `sub` — e morre exatamente aqui.
  const clienteUsuario = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: dadosUsuario, error: erroUsuario } = await clienteUsuario.auth.getUser();
  const usuario = dadosUsuario?.user;
  if (erroUsuario || !usuario) {
    return responder(origem, 401, {
      ok: false,
      erro: "sem_sessao",
      mensagem: "Sessão inválida ou expirada. Entre novamente.",
    });
  }

  // 3. Corpo: só `proposito`, e só um valor aceito. Campos extras
  //    (`email`, `user_id`) são ignorados — nunca influenciam o destino.
  let proposito = "verificacao_email";
  try {
    const bruto = await req.text();
    if (bruto.trim() !== "") {
      const corpo = JSON.parse(bruto) as Record<string, unknown>;
      if (typeof corpo?.proposito === "string") proposito = corpo.proposito;
    }
  } catch {
    return responder(origem, 400, {
      ok: false,
      erro: "corpo_invalido",
      mensagem: "Requisição malformada.",
    });
  }

  if (proposito !== "verificacao_email") {
    return responder(origem, 400, {
      ok: false,
      erro: "proposito_invalido",
      mensagem: "Propósito de e-mail não suportado.",
    });
  }

  const clienteServico = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 4. Cunhagem — a RPC é a dona das regras (throttle, já confirmado…).
  //    Os SQLSTATEs 'PTxxx' vêm no campo `code`; separar por código, nunca
  //    pela mensagem (que é texto para humano e pode mudar).
  const { data: token, error: erroToken } = await clienteServico.rpc("criar_token_email", {
    p_user_id: usuario.id,
    p_proposito: proposito,
  });

  if (erroToken) {
    const codigo = erroToken.code ?? "";
    if (codigo === "PT429") {
      const segundos = Number(erroToken.message?.match(/\d+/)?.[0] ?? 60);
      return responder(origem, 429, {
        ok: false,
        erro: "aguarde",
        segundos,
        mensagem: `Aguarde ${segundos} segundo(s) para pedir outro e-mail.`,
      });
    }
    if (codigo === "PT409") {
      return responder(origem, 409, {
        ok: false,
        erro: "ja_confirmado",
        mensagem: "Este e-mail já foi confirmado.",
      });
    }
    if (codigo === "PT404") {
      return responder(origem, 404, {
        ok: false,
        erro: "usuario_invalido",
        mensagem: "Conta não encontrada.",
      });
    }
    if (codigo === "PT400") {
      return responder(origem, 400, {
        ok: false,
        erro: "proposito_invalido",
        mensagem: "Propósito de e-mail não suportado.",
      });
    }
    console.error(`criar_token_email falhou [${codigo}]: ${erroToken.message}`);
    return responder(origem, 500, {
      ok: false,
      erro: "falha_token",
      mensagem: "Não foi possível gerar o link de confirmação.",
    });
  }

  if (typeof token !== "string" || token.length === 0) {
    console.error("criar_token_email devolveu vazio.");
    return responder(origem, 500, { ok: false, erro: "falha_token" });
  }

  // 5. Envio. O link SEMPRE sai do secret SITE_URL — nunca de Host/Origin,
  //    que o atacante controla e transformaria o e-mail legítimo num
  //    link de phishing com token válido.
  const destino = usuario.email;
  if (!destino) {
    return responder(origem, 400, { ok: false, erro: "sem_email" });
  }

  const link = `${SITE_URL!.replace(/\/+$/, "")}/confirmar-email?token=${encodeURIComponent(token)}`;
  const nome =
    (typeof usuario.user_metadata?.nome === "string" ? usuario.user_metadata.nome : null) ??
    (typeof usuario.user_metadata?.full_name === "string" ? usuario.user_metadata.full_name : null);
  const { assunto, htmlContent, textContent } = montarEmail(nome, link);

  let messageId: string | null = null;
  try {
    const resposta = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": BREVO_API_KEY!,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        sender: separarRemetente(EMAIL_REMETENTE!),
        to: [{ email: destino, ...(nome ? { name: nome } : {}) }],
        subject: assunto,
        htmlContent,
        textContent,
      }),
    });

    const corpoBrevo = await resposta.text();
    if (!resposta.ok) {
      // Sem o token na mensagem: o corpo devolvido pelo Brevo nunca o contém.
      console.error(`Brevo recusou o envio (HTTP ${resposta.status}): ${corpoBrevo}`);
      return responder(origem, 502, {
        ok: false,
        erro: "falha_envio",
        mensagem: "Não conseguimos enviar o e-mail agora. Tente novamente em instantes.",
      });
    }
    try {
      messageId = (JSON.parse(corpoBrevo) as { messageId?: string }).messageId ?? null;
    } catch {
      messageId = null;
    }
  } catch (e) {
    console.error(`Falha de rede ao falar com o Brevo: ${e instanceof Error ? e.message : e}`);
    return responder(origem, 502, {
      ok: false,
      erro: "falha_envio",
      mensagem: "Não conseguimos enviar o e-mail agora. Tente novamente em instantes.",
    });
  }

  // 6. Forense: guardar o id do provedor na linha do token. A linha é
  //    localizada pelo HASH (o mesmo que o Postgres gravou) — o token cru
  //    não é reenviado ao banco. Falhar aqui NÃO invalida o envio: o
  //    e-mail já saiu, e o usuário não deve ver erro por causa do rastro.
  if (messageId) {
    const hash = await sha256Hex(token);
    const { error: erroUpdate } = await clienteServico
      .from("tokens_email")
      .update({ message_id: messageId })
      .eq("token_hash", hash);
    if (erroUpdate) {
      console.error(`Não foi possível gravar message_id: ${erroUpdate.message}`);
    }
  }

  return responder(origem, 200, { ok: true, message_id: messageId });
});
