/**
 * Divulgação dos resultados (migration 20261027120000) — o lado puro.
 *
 * Quem decide quem recebe o e-mail de resultado, e quando, é
 * `resultados_devidos()` no servidor. Daqui só sai um ESPELHO de parte da
 * regra, para o card do admin dizer quantos autores ainda estão sendo
 * segurados: o e-mail espera a última decisão do autor, e sem esse número
 * um trabalho esquecido em avaliação seguraria o e-mail de alguém em
 * silêncio.
 */

/** Os desfechos que contam como decisão — o mesmo CASE de `resultados_devidos`. */
export const DESFECHOS_DECIDIDOS = ["resubmeter", "aprovado_correcoes", "aprovado", "reprovado"];

/**
 * Autores que o e-mail de resultado ainda está esperando: têm ao menos um
 * trabalho sem decisão e não receberam (nem estão recebendo) o e-mail.
 *
 * `jaRecebeu` são os autores com envio 'enviado' ou 'reservado' — os mesmos
 * que o índice único do servidor tira da fila. Quem já recebeu não conta
 * mais: o e-mail é um só, mesmo que um trabalho reenviado volte a ficar sem
 * decisão depois.
 */
export function autoresAguardandoDecisao(
  trabalhos: { owner_id: string | null; status: string }[],
  jaRecebeu: ReadonlySet<string>,
): number {
  const segurados = new Set<string>();
  for (const t of trabalhos) {
    if (!t.owner_id || jaRecebeu.has(t.owner_id)) continue;
    if (!DESFECHOS_DECIDIDOS.includes(t.status)) segurados.add(t.owner_id);
  }
  return segurados.size;
}

/**
 * O envio mais recente de cada autor — é ele que diz em que pé o autor está.
 * Uma falha seguida de reenvio bem-sucedido fica no registro como histórico,
 * e contá-la como "falha" mentiria sobre um e-mail que chegou.
 */
export function ultimoEnvioPorAutor<T extends { autor_id: string; criado_em: string }>(
  envios: T[],
): T[] {
  const ultimo = new Map<string, T>();
  for (const e of envios) {
    const atual = ultimo.get(e.autor_id);
    if (!atual || e.criado_em > atual.criado_em) ultimo.set(e.autor_id, e);
  }
  return [...ultimo.values()];
}

/**
 * "Agora" em Lavras no formato do `datetime-local` ('AAAA-MM-DDTHH:MM').
 *
 * O momento gravado não tem fuso, então nunca passa por `new Date` (o
 * navegador o leria no fuso dele). Em vez disso o relógio é que vem para o
 * formato do campo: strings zero-padded assim se comparam com `<`, como as
 * datas do prazo. Só serve para AVISAR na tela — quem decide se já é a hora
 * é `resultados_divulgados()`, no servidor.
 */
export function agoraEmLavras(agora = new Date()): string {
  return agora
    .toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" })
    .replace(" ", "T")
    .slice(0, 16);
}
