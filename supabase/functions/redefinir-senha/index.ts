// ============================================================
// Edge Function `redefinir-senha` — fluxo "esqueci minha senha"
// ------------------------------------------------------------
// Segunda ponte do projeto para o Brevo, irmã de `enviar-email`.
// Aqui não mora regra de negócio: quem decide se o token pode ser
// cunhado/consumido é o SQL (migration 20260814120000). Esta função
// apenas transporta — pede o token, entrega o e-mail, e na volta do
// link troca a senha pela Admin API do GoTrue (a única coisa que o
// SQL não alcança: auth.users é do GoTrue).
//
// ⚠ DEPLOY COM `verify_jwt: false` (ver scripts/deploy-functions.js).
//   O fluxo é anônimo por definição — quem esqueceu a senha não tem
//   sessão — e a chave `sb_publishable_` do frontend NÃO é um JWT,
//   então o gateway com verify_jwt barraria a chamada. A proteção
//   mora no SQL: 5 pedidos/hora por IP + 1 pedido/2 h por conta.
//
// ⚠ ANTI-ENUMERAÇÃO: para `inexistente`, `nao_confirmado` e `aguarde`
//   (cooldown da conta) a resposta é o MESMO `{ok:true}` sem envio.
//   O formulário público nunca confirma se um e-mail tem conta.
//   Exceções honestas: limite por IP (429, não revela nada sobre
//   contas) e falha do Brevo (502 — durante uma indisponibilidade do
//   provedor isso tecnicamente distingue contas reais; aceito, porque
//   engolir o erro deixaria usuários legítimos sem feedback).
//
// ⚠ O TOKEN CRU NUNCA É LOGADO. Ele existe só no retorno da RPC, no
//   corpo do e-mail e na URL que o usuário clica.
//
// Secrets exigidos (os mesmos de `enviar-email`, nada novo):
//   BREVO_API_KEY, EMAIL_REMETENTE, SITE_URL
// Injetados pela plataforma: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// ============================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

// Marca — duplicada de src/lib/brand.ts DE PROPÓSITO (Deno não importa
// do bundle do Vite). Se a marca mudar lá, mudar aqui também.
const APP_NAME = "Congresso Unificado ICTIN";
const APP_TAGLINE = "ICTIN · Submissões Científicas";

// Duplicada de src/lib/cadastro.ts (MIN_SENHA) pelo mesmo motivo da
// marca. O GoTrue tem a própria política como retaguarda; validar aqui
// devolve um erro legível antes de queimar o token.
const MIN_SENHA = 8;

// ------------------------------------------------------------
// CORS — mesma allowlist explícita de `enviar-email`
// ------------------------------------------------------------
const ORIGENS_PERMITIDAS = [
  "http://localhost:5000",
  "http://127.0.0.1:5000",
  "https://ciuflaictin.com.br",
  "https://www.ciuflaictin.com.br",
];

function cabecalhosCors(origem: string | null): Record<string, string> {
  const permitida = origem !== null && ORIGENS_PERMITIDAS.includes(origem);
  return {
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
function montarEmailRedefinicao(nome: string | null, link: string) {
  const saudacao = nome ? `Olá, ${nome}!` : "Olá!";
  const assunto = `Redefina sua senha — ${APP_NAME}`;

  const textContent = [
    saudacao,
    "",
    `Recebemos um pedido para redefinir a senha da sua conta no ${APP_NAME}. Abra o link abaixo para escolher uma nova senha:`,
    "",
    link,
    "",
    "O link vale por 2 horas e pode ser usado uma única vez.",
    "Se não foi você quem pediu a redefinição, ignore esta mensagem — sua senha não será alterada.",
    "",
    `${APP_NAME} — ${APP_TAGLINE}`,
  ].join("\n");

  const htmlContent = `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:24px;background:#f4f5f7;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2937;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
      <tr><td>
        <p style="margin:0 0 4px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;">${APP_NAME}</p>
        <h1 style="margin:0 0 20px;font-size:20px;color:#111827;">Redefina sua senha</h1>
        <p style="margin:0 0 16px;line-height:1.6;">${saudacao}</p>
        <p style="margin:0 0 24px;line-height:1.6;">
          Recebemos um pedido para redefinir a senha da sua conta no ${APP_NAME}. Clique no botão para escolher uma nova senha:
        </p>
        <p style="margin:0 0 24px;">
          <a href="${link}" style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;">Redefinir senha</a>
        </p>
        <p style="margin:0 0 8px;line-height:1.6;font-size:14px;color:#4b5563;">
          Se o botão não funcionar, copie e cole este endereço no navegador:
        </p>
        <p style="margin:0 0 24px;word-break:break-all;font-size:13px;color:#4b5563;">${link}</p>
        <p style="margin:0 0 8px;font-size:13px;color:#6b7280;">O link vale por 2 horas e pode ser usado uma única vez.</p>
        <p style="margin:0;font-size:13px;color:#6b7280;">
          Se não foi você quem pediu a redefinição, ignore esta mensagem — sua senha não será alterada.
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
// Tipos das RPCs (linhas devolvidas pelas RETURNS TABLE)
// ------------------------------------------------------------
type LinhaCriacao = {
  token: string | null;
  nome: string | null;
  motivo: "ok" | "inexistente" | "nao_confirmado" | "aguarde";
  segundos: number | null;
};

type LinhaConsumo = {
  status: "ok" | "invalido" | "usado" | "expirado";
  user_id: string | null;
};

/** Primeira linha de um retorno RETURNS TABLE (o supabase-js entrega array). */
function primeiraLinha<T>(dados: unknown): T | null {
  if (Array.isArray(dados)) return (dados[0] as T) ?? null;
  if (dados && typeof dados === "object") return dados as T;
  return null;
}

// ------------------------------------------------------------
// Handler
// ------------------------------------------------------------
Deno.serve(async (req: Request): Promise<Response> => {
  const origem = req.headers.get("Origin");

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cabecalhosCors(origem) });
  }

  if (req.method !== "POST") {
    return responder(origem, 405, { ok: false, erro: "metodo_invalido" });
  }

  // 1. Secrets — falta de configuração é erro de operação, não do usuário.
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY");
  const EMAIL_REMETENTE = Deno.env.get("EMAIL_REMETENTE");
  const SITE_URL = Deno.env.get("SITE_URL");

  const faltando = Object.entries({
    SUPABASE_URL,
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
      mensagem: "Redefinição de senha não configurada no servidor.",
    });
  }

  // 2. Corpo: discriminado por `acao`. Sem sessão, sem getUser() — a
  //    identidade sai do e-mail (solicitar) ou do token (trocar).
  let corpo: Record<string, unknown>;
  try {
    corpo = JSON.parse(await req.text()) as Record<string, unknown>;
  } catch {
    return responder(origem, 400, { ok: false, erro: "corpo_invalido" });
  }
  if (!corpo || typeof corpo !== "object") {
    return responder(origem, 400, { ok: false, erro: "corpo_invalido" });
  }

  const clienteServico = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ==========================================================
  // acao: "solicitar" — { email } → e-mail com o link (ou silêncio)
  // ==========================================================
  if (corpo.acao === "solicitar") {
    const email = typeof corpo.email === "string" ? corpo.email.trim() : "";
    if (email === "") {
      return responder(origem, 400, { ok: false, erro: "email_invalido" });
    }

    // O IP do navegador chega no cabeçalho da NOSSA requisição; o que o
    // PostgREST enxergaria é o IP do fetch do Deno. Por isso o repasse
    // por parâmetro. Nunca logar o IP junto de qualquer outro dado.
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;

    const { data, error } = await clienteServico.rpc("criar_token_redefinicao", {
      p_email: email,
      p_ip: ip,
    });

    if (error) {
      const codigo = error.code ?? "";
      if (codigo === "PT400") {
        return responder(origem, 400, {
          ok: false,
          erro: "email_invalido",
          mensagem: "Informe um e-mail válido.",
        });
      }
      if (codigo === "PT429") {
        // Limite por IP — o único 429 honesto (não fala de contas).
        const segundos = Number(error.message?.match(/\d+/)?.[0] ?? 3600);
        return responder(origem, 429, {
          ok: false,
          erro: "aguarde",
          segundos,
          mensagem: `Muitas tentativas. Aguarde ${segundos} segundo(s).`,
        });
      }
      console.error(`criar_token_redefinicao falhou [${codigo}]: ${error.message}`);
      return responder(origem, 500, { ok: false, erro: "falha_token" });
    }

    const linha = primeiraLinha<LinhaCriacao>(data);
    if (!linha || !linha.motivo) {
      console.error("criar_token_redefinicao devolveu vazio.");
      return responder(origem, 500, { ok: false, erro: "falha_token" });
    }

    // Anti-enumeração: conta inexistente, não confirmada ou em cooldown
    // recebem o MESMO sucesso genérico, sem envio. Só o motivo é logado
    // (nunca o e-mail consultado).
    if (linha.motivo !== "ok") {
      console.log(`solicitar ignorado (${linha.motivo}).`);
      return responder(origem, 200, { ok: true });
    }

    const token = linha.token;
    if (typeof token !== "string" || token.length === 0) {
      console.error("criar_token_redefinicao devolveu 'ok' sem token.");
      return responder(origem, 500, { ok: false, erro: "falha_token" });
    }

    // O link SEMPRE sai do secret SITE_URL — nunca de Host/Origin, que o
    // atacante controla e transformaria o e-mail num phishing com token válido.
    const link = `${SITE_URL!.replace(/\/+$/, "")}/redefinir-senha?token=${encodeURIComponent(token)}`;
    const { assunto, htmlContent, textContent } = montarEmailRedefinicao(linha.nome, link);

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
          to: [{ email: email.toLowerCase(), ...(linha.nome ? { name: linha.nome } : {}) }],
          subject: assunto,
          htmlContent,
          textContent,
        }),
      });

      const corpoBrevo = await resposta.text();
      if (!resposta.ok) {
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

    // Forense: o id do provedor na linha do token, localizada pelo HASH.
    // Falhar aqui NÃO invalida o envio.
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

    return responder(origem, 200, { ok: true });
  }

  // ==========================================================
  // acao: "trocar" — { token, novaSenha } → senha nova no GoTrue
  // ==========================================================
  if (corpo.acao === "trocar") {
    const token = typeof corpo.token === "string" ? corpo.token.trim() : "";
    const novaSenha = typeof corpo.novaSenha === "string" ? corpo.novaSenha : "";
    if (token === "" || novaSenha === "") {
      return responder(origem, 400, { ok: false, erro: "corpo_invalido" });
    }

    // Antes de queimar o token: senha curta é erro do formulário, não
    // pode custar o link da pessoa.
    if (novaSenha.length < MIN_SENHA) {
      return responder(origem, 400, {
        ok: false,
        erro: "senha_curta",
        minimo: MIN_SENHA,
        mensagem: `A senha precisa ter pelo menos ${MIN_SENHA} caracteres.`,
      });
    }

    const { data, error } = await clienteServico.rpc("consumir_token_redefinicao", {
      p_token: token,
    });

    if (error) {
      console.error(`consumir_token_redefinicao falhou [${error.code ?? ""}]: ${error.message}`);
      return responder(origem, 500, { ok: false, erro: "falha_troca" });
    }

    const linha = primeiraLinha<LinhaConsumo>(data);
    if (!linha || !linha.status) {
      console.error("consumir_token_redefinicao devolveu vazio.");
      return responder(origem, 500, { ok: false, erro: "falha_troca" });
    }

    if (linha.status === "invalido") {
      return responder(origem, 400, { ok: false, erro: "token_invalido" });
    }
    if (linha.status === "usado") {
      return responder(origem, 409, { ok: false, erro: "token_usado" });
    }
    if (linha.status === "expirado") {
      return responder(origem, 410, { ok: false, erro: "token_expirado" });
    }

    const userId = linha.user_id;
    if (!userId) {
      console.error("consumir_token_redefinicao devolveu 'ok' sem user_id.");
      return responder(origem, 500, { ok: false, erro: "falha_troca" });
    }

    // A troca em si — Admin API do GoTrue (SQL não escreve auth.users).
    const { error: erroSenha } = await clienteServico.auth.admin.updateUserById(userId, {
      password: novaSenha,
    });

    if (erroSenha) {
      // Reversão compensatória: o token foi consumido mas a senha não
      // mudou — devolver o used_at para o link continuar valendo.
      // (Escrita direta na tabela é precedente: `message_id` acima.)
      const hash = await sha256Hex(token);
      const { error: erroReversao } = await clienteServico
        .from("tokens_email")
        .update({ used_at: null })
        .eq("token_hash", hash);
      if (erroReversao) {
        console.error(`Reversão do token falhou: ${erroReversao.message}`);
      }

      // Política de senha do GoTrue (retaguarda do MIN_SENHA local).
      const status = (erroSenha as { status?: number }).status;
      const codigoGoTrue = (erroSenha as { code?: string }).code ?? "";
      if (status === 422 || codigoGoTrue === "weak_password") {
        return responder(origem, 400, {
          ok: false,
          erro: "senha_curta",
          minimo: MIN_SENHA,
          mensagem: "A senha não atende à política de segurança.",
        });
      }

      console.error(`updateUserById falhou [${codigoGoTrue}]: ${erroSenha.message}`);
      return responder(origem, 500, { ok: false, erro: "falha_troca" });
    }

    // Senha trocada. Daqui para baixo tudo é melhor-esforço: o desfecho
    // que importa já aconteceu e o usuário não pode ver erro por isso.

    // Nenhum outro link de redefinição em aberto sobrevive à troca.
    const { error: erroLimpeza } = await clienteServico
      .from("tokens_email")
      .update({ used_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("proposito", "redefinir_senha")
      .is("used_at", null);
    if (erroLimpeza) {
      console.error(`Limpeza de tokens abertos falhou: ${erroLimpeza.message}`);
    }

    // Derruba as sessões existentes (quem roubou a senha antiga cai).
    // O auth-js não expõe logout por user_id; endpoint REST do GoTrue.
    try {
      const respostaLogout = await fetch(
        `${SUPABASE_URL!.replace(/\/+$/, "")}/auth/v1/admin/users/${userId}/logout?scope=global`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${SERVICE_ROLE_KEY!}`,
            apikey: SERVICE_ROLE_KEY!,
          },
        },
      );
      if (!respostaLogout.ok && respostaLogout.status !== 404) {
        console.error(`Logout global devolveu HTTP ${respostaLogout.status}.`);
      }
    } catch (e) {
      console.error(`Logout global falhou: ${e instanceof Error ? e.message : e}`);
    }

    return responder(origem, 200, { ok: true });
  }

  return responder(origem, 400, { ok: false, erro: "corpo_invalido" });
});
