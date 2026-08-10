import { supabase } from "@/integrations/supabase/client";
import {
  estadoDaConfirmacao,
  estadoDaLiberacao,
  interpretarRespostaEnvio,
  type EstadoConfirmacao,
  type EstadoLiberacao,
  type RespostaEnvio,
} from "@/lib/verificacaoEmail";

/**
 * Verificação de e-mail — as chamadas de servidor da feature.
 *
 * A regra inteira mora no banco (migration 20260806140000): `criar_token_email`
 * só o service_role executa, `confirmar_email` é idempotente e `email_confirmado()`
 * é a MESMA função que as policies de RLS chamam. Aqui não há decisão de
 * negócio — só o transporte e a tradução dos erros.
 */

/**
 * O e-mail da sessão atual está confirmado?
 *
 * Lê do banco, não de claim do JWT: confirmar vale na hora, sem esperar o
 * refresh de 1 h do token. Sem sessão (ou com a RPC fora do ar) devolve
 * `null` — "não sei" é diferente de "não confirmado", e a interface não
 * pode trancar ninguém para fora por causa de um erro de rede. Quem tranca
 * de verdade é o RLS.
 */
export async function emailEstaConfirmado(): Promise<boolean | null> {
  const { data, error } = await supabase.rpc("email_confirmado");
  if (error) return null;
  return data === true;
}

/** Consome o token do link. Nunca lança: todo desfecho é um estado de tela. */
export async function confirmarEmailComToken(token: string): Promise<EstadoConfirmacao> {
  try {
    const { data, error } = await supabase.rpc("confirmar_email", { p_token: token });
    return estadoDaConfirmacao(data, error);
  } catch {
    // fetch morto / offline — jamais "invalido".
    return "rede";
  }
}

/**
 * Pede à Edge Function um novo e-mail de confirmação, para o dono da sessão.
 * A function ignora qualquer destinatário no corpo — a identidade sai do JWT.
 *
 * ⚠ ARMADILHA DO `functions.invoke`: em status fora de 2xx o supabase-js NÃO
 * devolve o corpo em `data`. Devolve `error` (um `FunctionsHttpError`) com a
 * `Response` original pendurada em `error.context` — é de
 * `await error.context.json()` que sai o `segundos` do 429. Sem isso o
 * throttle vira "erro genérico" e o cooldown do botão nasce cego.
 */
export async function enviarEmailDeVerificacao(): Promise<RespostaEnvio> {
  try {
    const { data, error } = await supabase.functions.invoke("enviar-email", {
      body: { proposito: "verificacao_email" },
    });

    if (error) {
      const contexto = (error as { context?: unknown }).context;
      if (contexto instanceof Response) {
        const corpo = await contexto.json().catch(() => null);
        return interpretarRespostaEnvio(contexto.status, corpo);
      }
      // FunctionsFetchError / FunctionsRelayError: não houve resposta HTTP.
      return { estado: "falha", erro: "rede", segundos: null };
    }

    return interpretarRespostaEnvio(200, data);
  } catch {
    return { estado: "falha", erro: "rede", segundos: null };
  }
}

/**
 * Libera um e-mail preso por uma conta que nunca confirmou, apagando-a.
 *
 * Chamada SÓ depois de o GoTrue recusar o cadastro com "já registrado" — no
 * caminho feliz ela nem existe. Manter assim é o que segura a enumeração:
 * quem quiser sondar endereços tem de chamar a RPC na mão, e lá esperam dois
 * limites — 5 chamadas / 10 min por IP e 5 REMOÇÕES / hora por e-mail alvo.
 * O segundo é o que importa: IP se troca, e o ataque com dano real é apagar
 * a conta pendente da MESMA vítima até ela nunca conseguir confirmar.
 *
 * Quem decide se pode apagar é o banco, nunca esta função: aqui não há
 * checagem de "está confirmado?" que possa divergir da do servidor.
 */
export async function liberarEmailNaoConfirmado(email: string): Promise<EstadoLiberacao> {
  try {
    const { data, error } = await supabase.rpc("liberar_email_nao_confirmado", {
      p_email: email,
    });
    return estadoDaLiberacao(data, error);
  } catch {
    return "rede";
  }
}
