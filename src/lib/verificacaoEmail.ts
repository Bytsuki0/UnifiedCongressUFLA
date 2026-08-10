/**
 * Verificação de e-mail — lógica pura (sem rede, sem React, sem Supabase).
 *
 * Três traduções vivem aqui, e as duas primeiras existem para separar "deu
 * ruim de verdade" de "deu ruim na rede":
 *
 *   1. resultado da RPC `confirmar_email` → estado da tela /confirmar-email;
 *   2. resposta da Edge Function `enviar-email` → resultado do reenvio;
 *   3. resultado da RPC `liberar_email_nao_confirmado` → o que o /cadastro faz
 *      quando o e-mail está preso por uma conta que nunca confirmou.
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

// ------------------------------------------------------------
// 3. Liberação de e-mail preso (RPC `liberar_email_nao_confirmado`)
// ------------------------------------------------------------

/**
 * Um e-mail só fica ocupado de verdade quando alguém prova a posse da caixa
 * clicando no link. Antes disso a conta não pertence a ninguém, e o cadastro
 * seguinte com o mesmo endereço a substitui — senão qualquer pessoa tranca o
 * e-mail alheio para sempre digitando-o no /cadastro e nunca confirmando.
 * A regra inteira é da migration 20260808220000; aqui só a tradução.
 */
export const RESULTADOS_LIBERACAO = [
  "liberado",
  "confirmado",
  "inexistente",
  "tem_dados",
  "muitas_tentativas",
  "invalido",
] as const;

export type ResultadoLiberacao = (typeof RESULTADOS_LIBERACAO)[number];

/** Os da RPC + "rede": só ele significa "tente de novo", não "desista". */
export type EstadoLiberacao = ResultadoLiberacao | "rede";

/**
 * O GoTrue disse que este e-mail já tem conta?
 *
 * É o gatilho da liberação, então precisa ser específico: um erro de senha
 * fraca ou de e-mail malformado NÃO pode acabar apagando conta nenhuma. Por
 * isso casa o código estruturado quando ele existe e, só então, a mensagem.
 */
export function ehEmailJaCadastrado(erro: unknown): boolean {
  if (!erro || typeof erro !== "object") return false;

  const { code, message } = erro as { code?: unknown; message?: unknown };
  if (code === "user_already_exists" || code === "email_exists") return true;

  const texto = typeof message === "string" ? message.toLowerCase() : "";
  return texto.includes("already registered") || texto.includes("already exists");
}

function ehResultadoLiberacao(valor: unknown): valor is ResultadoLiberacao {
  return (
    typeof valor === "string" &&
    (RESULTADOS_LIBERACAO as readonly string[]).includes(valor)
  );
}

/**
 * Traduz (valor, erro) da RPC em estado. Mesma regra do `estadoDaConfirmacao`:
 * qualquer erro vira "rede", nunca um desfecho de negócio — não apagamos nem
 * recusamos conta com base num timeout.
 */
export function estadoDaLiberacao(valor: unknown, erro?: unknown): EstadoLiberacao {
  if (erro) return "rede";
  if (ehResultadoLiberacao(valor)) return valor;
  return "rede";
}

/**
 * Texto ao usuário. "liberado" não entra: nesse caso o cadastro simplesmente
 * segue e a pessoa não precisa saber que havia uma conta pendente ali.
 */
export const TEXTO_LIBERACAO: Record<Exclude<EstadoLiberacao, "liberado">, string> = {
  confirmado: "Este e-mail já tem uma conta confirmada. Entre com sua senha.",
  tem_dados: "Este e-mail já tem uma conta com trabalhos enviados. Entre em vez de criar outra.",
  muitas_tentativas: "Muitas tentativas a partir desta conexão. Aguarde alguns minutos e tente de novo.",
  invalido: "Informe um e-mail válido para continuar.",
  // O GoTrue disse "já cadastrado" e o banco diz que não existe conta: só
  // acontece em corrida com outro cadastro. Repetir resolve.
  inexistente: "Não foi possível concluir o cadastro agora. Tente novamente.",
  rede: "Não conseguimos falar com o servidor. Verifique sua conexão e tente de novo.",
};
