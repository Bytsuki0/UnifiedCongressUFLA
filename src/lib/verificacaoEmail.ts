/**
 * Verificação de e-mail — lógica pura (sem rede, sem React, sem Supabase).
 *
 * Duas traduções vivem aqui, e as duas existem para separar "deu ruim de
 * verdade" de "deu ruim na rede":
 *
 *   1. resultado da RPC `confirmar_email` → estado da tela /confirmar-email;
 *   2. resposta da Edge Function `enviar-email` → resultado do reenvio.
 *
 * Por que puras: falha de rede NUNCA pode ser apresentada como "link
 * inválido" (o usuário jogaria fora um link bom), e o `segundos` do 429
 * precisa chegar à UI para o cooldown do botão não nascer cego. Ambas as
 * regras são testáveis sem subir componente — ver src/test/verificacaoEmail.test.ts.
 */

// ------------------------------------------------------------
// 1. Confirmação (RPC `confirmar_email`)
// ------------------------------------------------------------

/** Os quatro valores que a RPC devolve. Ela é idempotente e nunca lança. */
export const RESULTADOS_CONFIRMACAO = [
  "confirmado",
  "ja_confirmado",
  "expirado",
  "invalido",
] as const;

export type ResultadoConfirmacao = (typeof RESULTADOS_CONFIRMACAO)[number];

/** Estados da tela: os da RPC + "rede", que é o único com botão de repetir. */
export type EstadoConfirmacao = ResultadoConfirmacao | "rede";

function ehResultadoConhecido(valor: unknown): valor is ResultadoConfirmacao {
  return (
    typeof valor === "string" &&
    (RESULTADOS_CONFIRMACAO as readonly string[]).includes(valor)
  );
}

/**
 * Traduz o par (valor, erro) devolvido pela chamada da RPC em um estado.
 *
 * Qualquer erro — fetch morto, offline, PostgREST reclamando — vira "rede",
 * nunca "invalido": só o banco tem autoridade para dizer que um token não
 * presta. Valor inesperado (null, string desconhecida) cai no mesmo lugar,
 * porque também significa "não obtivemos resposta da autoridade".
 */
export function estadoDaConfirmacao(valor: unknown, erro?: unknown): EstadoConfirmacao {
  if (erro) return "rede";
  if (ehResultadoConhecido(valor)) return valor;
  return "rede";
}

// ------------------------------------------------------------
// 2. Reenvio (Edge Function `enviar-email`)
// ------------------------------------------------------------

/**
 * Códigos de erro do reenvio. Os oito primeiros são o campo `erro` do corpo
 * devolvido pela function (contrato da Etapa 2); "rede" e "desconhecido"
 * nascem no cliente, quando nem chegamos a ter um corpo para ler.
 */
export type CodigoEnvio =
  | "aguarde"
  | "ja_confirmado"
  | "sem_sessao"
  | "usuario_invalido"
  | "proposito_invalido"
  | "corpo_invalido"
  | "falha_envio"
  | "config_ausente"
  | "falha_token"
  | "rede"
  | "desconhecido";

/**
 * Desfecho do reenvio.
 *
 * O discriminante é a STRING `estado`, não um `ok: boolean`: o projeto
 * compila com `strict: false` (tsconfig.app.json), e sem `strictNullChecks`
 * o TypeScript não estreita união por discriminante booleano — `if (r.ok)`
 * deixaria `r.erro` inacessível. Com string funciona em qualquer strictness.
 */
export type RespostaEnvio =
  | { estado: "enviado"; messageId: string | null }
  | { estado: "falha"; erro: CodigoEnvio; segundos: number | null };

/** Cooldown padrão quando o 429 chega sem o campo `segundos`. */
export const COOLDOWN_PADRAO_SEGUNDOS = 60;

const CODIGOS_CONHECIDOS: readonly string[] = [
  "aguarde",
  "ja_confirmado",
  "sem_sessao",
  "usuario_invalido",
  "proposito_invalido",
  "corpo_invalido",
  "falha_envio",
  "config_ausente",
  "falha_token",
];

/** Fallback quando o corpo não traz `erro` (ex.: 401 do gateway da plataforma). */
function codigoPeloStatus(status: number): CodigoEnvio {
  if (status === 401) return "sem_sessao";
  if (status === 409) return "ja_confirmado";
  if (status === 429) return "aguarde";
  if (status === 404) return "usuario_invalido";
  if (status === 502 || status === 503 || status === 504) return "falha_envio";
  return "desconhecido";
}

/**
 * Traduz (status HTTP, corpo JSON) na resposta que a UI consome.
 *
 * Aceita corpo `null` de propósito: o gateway da plataforma responde 401 com
 * um JSON que não é o nosso, e a tela ainda assim precisa dizer "sua sessão
 * caiu" em vez de "erro desconhecido".
 */
export function interpretarRespostaEnvio(status: number, corpo: unknown): RespostaEnvio {
  const objeto = (corpo ?? {}) as Record<string, unknown>;

  if (status >= 200 && status < 300) {
    return {
      estado: "enviado",
      messageId: typeof objeto.message_id === "string" ? objeto.message_id : null,
    };
  }

  const bruto = objeto.erro;
  const erro: CodigoEnvio =
    typeof bruto === "string" && CODIGOS_CONHECIDOS.includes(bruto)
      ? (bruto as CodigoEnvio)
      : codigoPeloStatus(status);

  // O throttle de 60 s é imposto pela RPC; o número vem de lá, não daqui.
  const segundos =
    erro === "aguarde"
      ? typeof objeto.segundos === "number" && objeto.segundos > 0
        ? Math.ceil(objeto.segundos)
        : COOLDOWN_PADRAO_SEGUNDOS
      : null;

  return { estado: "falha", erro, segundos };
}

/**
 * Texto ao usuário por código de erro. "aguarde" não entra: a tela monta a
 * frase com o número de segundos que veio do servidor.
 */
export const TEXTO_ERRO_ENVIO: Record<Exclude<CodigoEnvio, "aguarde">, string> = {
  ja_confirmado: "Seu e-mail já está confirmado.",
  sem_sessao: "Sua sessão expirou. Entre novamente para reenviar o e-mail.",
  usuario_invalido: "Não encontramos sua conta. Entre novamente.",
  proposito_invalido: "Não foi possível enviar o e-mail. Avise a organização do congresso.",
  corpo_invalido: "Não foi possível enviar o e-mail. Avise a organização do congresso.",
  falha_envio: "Não conseguimos enviar o e-mail agora. Tente novamente em instantes.",
  config_ausente: "O envio de e-mails está indisponível no momento. Avise a organização do congresso.",
  falha_token: "Não foi possível gerar o link de confirmação. Tente novamente.",
  rede: "Não conseguimos falar com o servidor. Verifique sua conexão e tente de novo.",
  desconhecido: "Algo deu errado no envio. Tente novamente em instantes.",
};

/** Frase pronta para qualquer código, inclusive o "aguarde" com contagem. */
export function mensagemDoErroEnvio(erro: CodigoEnvio, segundos: number | null): string {
  if (erro === "aguarde") {
    const s = segundos ?? COOLDOWN_PADRAO_SEGUNDOS;
    return `Aguarde ${s} segundo${s === 1 ? "" : "s"} para pedir outro e-mail.`;
  }
  return TEXTO_ERRO_ENVIO[erro];
}
