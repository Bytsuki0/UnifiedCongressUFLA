import { supabase } from "@/integrations/supabase/client";
import {
  interpretarRespostaSolicitacao,
  interpretarRespostaTroca,
  type RespostaSolicitacao,
  type RespostaTroca,
} from "@/lib/redefinirSenha";

/**
 * Esqueci minha senha — as chamadas de servidor da feature.
 *
 * A regra inteira mora no banco (migration 20260814120000) e na Edge
 * Function `redefinir-senha`; aqui não há decisão de negócio — só o
 * transporte e a tradução dos erros.
 *
 * O fluxo é ANÔNIMO: sem sessão, o `functions.invoke` manda a chave
 * `sb_publishable_` como Authorization. Ela não é um JWT — por isso a
 * function é publicada com `verify_jwt: false` (ver
 * scripts/deploy-functions.js) e ignora o cabeçalho por completo.
 *
 * ⚠ ARMADILHA DO `functions.invoke` (a mesma de verificacaoEmailService):
 * em status fora de 2xx o supabase-js NÃO devolve o corpo em `data`.
 * Devolve `error` (um `FunctionsHttpError`) com a `Response` original
 * pendurada em `error.context` — é de `await error.context.json()` que
 * saem o código de erro e o `segundos` do 429.
 */

/** Pede o e-mail com o link de redefinição. Nunca lança. */
export async function solicitarRedefinicao(email: string): Promise<RespostaSolicitacao> {
  try {
    const { data, error } = await supabase.functions.invoke("redefinir-senha", {
      body: { acao: "solicitar", email },
    });

    if (error) {
      const contexto = (error as { context?: unknown }).context;
      if (contexto instanceof Response) {
        const corpo = await contexto.json().catch(() => null);
        return interpretarRespostaSolicitacao(contexto.status, corpo);
      }
      // FunctionsFetchError / FunctionsRelayError: não houve resposta HTTP.
      return { estado: "falha", erro: "rede", segundos: null };
    }

    return interpretarRespostaSolicitacao(200, data);
  } catch {
    return { estado: "falha", erro: "rede", segundos: null };
  }
}

/**
 * Consome o token do link e grava a senha nova. Nunca lança: todo
 * desfecho é um estado de tela. Falha de rede NUNCA vira veredito
 * sobre o token — o usuário jogaria fora um link bom.
 */
export async function trocarSenha(token: string, novaSenha: string): Promise<RespostaTroca> {
  try {
    const { data, error } = await supabase.functions.invoke("redefinir-senha", {
      body: { acao: "trocar", token, novaSenha },
    });

    if (error) {
      const contexto = (error as { context?: unknown }).context;
      if (contexto instanceof Response) {
        const corpo = await contexto.json().catch(() => null);
        return interpretarRespostaTroca(contexto.status, corpo);
      }
      return { estado: "falha", erro: "rede" };
    }

    return interpretarRespostaTroca(200, data);
  } catch {
    return { estado: "falha", erro: "rede" };
  }
}
