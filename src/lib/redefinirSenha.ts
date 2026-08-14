import { MIN_SENHA } from "@/lib/cadastro";

/**
 * Esqueci minha senha — lógica pura (sem rede, sem React, sem Supabase).
 *
 * Duas traduções vivem aqui, no mesmo espírito de verificacaoEmail.ts:
 *
 *   1. resposta da Edge Function `redefinir-senha` (acao "solicitar")
 *      → o que a tela /esqueci-senha mostra;
 *   2. resposta da mesma function (acao "trocar")
 *      → o que a tela /redefinir-senha mostra.
 *
 * Regras de ouro herdadas: falha de rede NUNCA vira veredito sobre o
 * link ("inválido" só quem tem autoridade — o servidor — pode dizer),
 * e o `segundos` do 429 chega à UI para o cooldown não nascer cego.
 *
 * Anti-enumeração (decisão aprovada): o servidor responde `{ok:true}`
 * genérico mesmo quando não envia nada (conta inexistente, não
 * confirmada ou em cooldown de 2 h). Aqui isso significa que "enviado"
 * é, na verdade, "aceito" — o texto da tela é condicional de propósito.
 */

// ------------------------------------------------------------
// 1. Solicitar o link (acao "solicitar")
// ------------------------------------------------------------

/** Cooldown padrão quando o 429 por IP chega sem o campo `segundos`. */
export const COOLDOWN_IP_SEGUNDOS = 3600;

/**
 * Códigos de erro do pedido. Os seis primeiros são o campo `erro` do
 * corpo devolvido pela function; "rede" e "desconhecido" nascem no
 * cliente, quando nem chegamos a ter um corpo para ler.
 */
export type CodigoSolicitacao =
  | "aguarde"
  | "email_invalido"
  | "corpo_invalido"
  | "falha_envio"
  | "config_ausente"
  | "falha_token"
  | "rede"
  | "desconhecido";

/**
 * Desfecho do pedido. Discriminante em STRING, não boolean: o projeto
 * compila com `strict: false` e sem `strictNullChecks` o TypeScript não
 * estreita união por discriminante booleano (mesma nota de verificacaoEmail.ts).
 */
export type RespostaSolicitacao =
  | { estado: "aceito" }
  | { estado: "falha"; erro: CodigoSolicitacao; segundos: number | null };

const CODIGOS_SOLICITACAO: readonly string[] = [
  "aguarde",
  "email_invalido",
  "corpo_invalido",
  "falha_envio",
  "config_ausente",
  "falha_token",
];

/** Fallback quando o corpo não traz `erro` (ex.: resposta que não é a nossa). */
function codigoSolicitacaoPeloStatus(status: number): CodigoSolicitacao {
  if (status === 429) return "aguarde";
  if (status === 400) return "email_invalido";
  if (status === 502 || status === 503 || status === 504) return "falha_envio";
  return "desconhecido";
}

/** Traduz (status HTTP, corpo JSON) do "solicitar" na resposta que a UI consome. */
export function interpretarRespostaSolicitacao(
  status: number,
  corpo: unknown,
): RespostaSolicitacao {
  const objeto = (corpo ?? {}) as Record<string, unknown>;

  if (status >= 200 && status < 300) {
    return { estado: "aceito" };
  }

  const bruto = objeto.erro;
  const erro: CodigoSolicitacao =
    typeof bruto === "string" && CODIGOS_SOLICITACAO.includes(bruto)
      ? (bruto as CodigoSolicitacao)
      : codigoSolicitacaoPeloStatus(status);

  // O 429 aqui é SEMPRE o limite por IP (o cooldown por conta é
  // silencioso, por anti-enumeração); o número vem do servidor.
  const segundos =
    erro === "aguarde"
      ? typeof objeto.segundos === "number" && objeto.segundos > 0
        ? Math.ceil(objeto.segundos)
        : COOLDOWN_IP_SEGUNDOS
      : null;

  return { estado: "falha", erro, segundos };
}

/**
 * O texto do sucesso genérico — dito assim de propósito: a mesma frase
 * para conta existente, inexistente, não confirmada ou em cooldown.
 */
export const TEXTO_SOLICITACAO_ACEITA =
  "Se este e-mail pertencer a uma conta confirmada, você receberá um link de redefinição em instantes. Confira também a caixa de spam.";

export const TEXTO_ERRO_SOLICITACAO: Record<Exclude<CodigoSolicitacao, "aguarde">, string> = {
  email_invalido: "Informe um e-mail válido para continuar.",
  corpo_invalido: "Não foi possível enviar o pedido. Avise a organização do congresso.",
  falha_envio: "Não conseguimos enviar o e-mail agora. Tente novamente em instantes.",
  config_ausente: "A redefinição de senha está indisponível no momento. Avise a organização do congresso.",
  falha_token: "Não foi possível gerar o link de redefinição. Tente novamente.",
  rede: "Não conseguimos falar com o servidor. Verifique sua conexão e tente de novo.",
  desconhecido: "Algo deu errado no pedido. Tente novamente em instantes.",
};

/** Frase pronta para qualquer código, inclusive o "aguarde" com contagem. */
export function mensagemDoErroSolicitacao(
  erro: CodigoSolicitacao,
  segundos: number | null,
): string {
  if (erro === "aguarde") {
    const s = segundos ?? COOLDOWN_IP_SEGUNDOS;
    // Acima de uma hora a contagem em segundos vira ruído.
    if (s >= 3600) {
      const horas = Math.ceil(s / 3600);
      return `Muitas tentativas a partir desta conexão. Aguarde ${horas} hora${horas === 1 ? "" : "s"} e tente de novo.`;
    }
    if (s >= 60) {
      const minutos = Math.ceil(s / 60);
      return `Muitas tentativas a partir desta conexão. Aguarde ${minutos} minuto${minutos === 1 ? "" : "s"} e tente de novo.`;
    }
    return `Muitas tentativas a partir desta conexão. Aguarde ${s} segundo${s === 1 ? "" : "s"} e tente de novo.`;
  }
  return TEXTO_ERRO_SOLICITACAO[erro];
}

// ------------------------------------------------------------
// 2. Trocar a senha (acao "trocar")
// ------------------------------------------------------------

export type CodigoTroca =
  | "senha_curta"
  | "token_invalido"
  | "token_usado"
  | "token_expirado"
  | "corpo_invalido"
  | "falha_troca"
  | "config_ausente"
  | "rede"
  | "desconhecido";

export type RespostaTroca =
  | { estado: "trocada" }
  | { estado: "falha"; erro: CodigoTroca };

const CODIGOS_TROCA: readonly string[] = [
  "senha_curta",
  "token_invalido",
  "token_usado",
  "token_expirado",
  "corpo_invalido",
  "falha_troca",
  "config_ausente",
];

/**
 * Fallback pelo status. Repare que nenhum status vira `token_invalido`
 * sem o código explícito no corpo: um 400 de origem desconhecida não
 * pode condenar um link que talvez esteja bom.
 */
function codigoTrocaPeloStatus(status: number): CodigoTroca {
  if (status === 409) return "token_usado";
  if (status === 410) return "token_expirado";
  return "desconhecido";
}

/** Traduz (status HTTP, corpo JSON) do "trocar" na resposta que a UI consome. */
export function interpretarRespostaTroca(status: number, corpo: unknown): RespostaTroca {
  const objeto = (corpo ?? {}) as Record<string, unknown>;

  if (status >= 200 && status < 300) {
    return { estado: "trocada" };
  }

  const bruto = objeto.erro;
  const erro: CodigoTroca =
    typeof bruto === "string" && CODIGOS_TROCA.includes(bruto)
      ? (bruto as CodigoTroca)
      : codigoTrocaPeloStatus(status);

  return { estado: "falha", erro };
}

export const TEXTO_ERRO_TROCA: Record<CodigoTroca, string> = {
  senha_curta: `A senha precisa ter pelo menos ${MIN_SENHA} caracteres.`,
  token_invalido:
    "Não reconhecemos este link. Confira se o endereço foi copiado inteiro do e-mail ou peça um novo.",
  token_usado: "Este link já foi usado. Se precisar, peça um novo e-mail de redefinição.",
  token_expirado: "Este link não vale mais — ele expira em 2 horas. Peça um novo e-mail.",
  corpo_invalido: "Não foi possível trocar a senha. Avise a organização do congresso.",
  falha_troca: "Não conseguimos trocar sua senha agora. Seu link continua válido, tente de novo.",
  config_ausente: "A redefinição de senha está indisponível no momento. Avise a organização do congresso.",
  rede: "Não conseguimos falar com o servidor. Verifique sua conexão e tente de novo.",
  desconhecido: "Algo deu errado na troca. Tente novamente em instantes.",
};

// ------------------------------------------------------------
// 3. Validação do formulário de nova senha
// ------------------------------------------------------------

/**
 * Valida o par (senha, confirmação) ANTES de gastar a viagem ao servidor.
 * Devolve a mensagem de erro em pt-BR, ou null quando está tudo certo.
 * O servidor revalida o tamanho — aqui é só para o formulário responder
 * na hora e nunca queimar um token com senha que seria recusada.
 */
export function validarNovaSenha(senha: string, confirmacao: string): string | null {
  if (senha.length === 0) return "Informe a nova senha.";
  if (senha.length < MIN_SENHA) {
    return `A senha precisa ter pelo menos ${MIN_SENHA} caracteres.`;
  }
  if (senha !== confirmacao) return "As senhas não coincidem.";
  return null;
}
