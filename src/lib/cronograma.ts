import type { MarcacaoCronograma, MesCronograma } from "@/services/cronogramaService";

/**
 * Aritmética de calendário para o cronograma.
 *
 * ⚠ Tudo aqui trabalha com a string 'AAAA-MM-DD', nunca com `Date`.
 * `new Date("2026-08-01")` é interpretado como meia-noite UTC; no fuso
 * de Lavras (UTC-3) isso é 31/07 às 21h, e o dia 1 do calendário sairia
 * pintado na casa do dia 31. Somar dias com `Date` tem o mesmo problema
 * ao voltar para string. Os cálculos abaixo usam `Date.UTC`, que é
 * estável, e só formatam de volta em UTC.
 */

export const NOMES_MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
] as const;

/** Iniciais na ordem em que a grade desenha (domingo primeiro). */
export const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"] as const;

/** 'AAAA-MM-DD' a partir de ano/mês/dia. */
export const chaveDia = (ano: number, mes: number, dia: number): string =>
  `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;

/** Chave do mês, para casar aba com marcação. */
export const chaveMes = (m: MesCronograma): string => `${m.ano}-${String(m.mes).padStart(2, "0")}`;

/** Rótulo humano: "Agosto de 2026". */
export const rotuloMes = (m: MesCronograma): string => `${NOMES_MESES[m.mes - 1]} de ${m.ano}`;

/** "12 de agosto" — para listar os dias de uma marcação. */
export function rotuloDiaCurto(chave: string): string {
  const [, mes, dia] = chave.split("-").map(Number);
  return `${dia} de ${NOMES_MESES[mes - 1].toLowerCase()}`;
}

/** Quantos dias tem o mês. Dia 0 do mês seguinte é o último deste. */
export const diasNoMes = (ano: number, mes: number): number =>
  new Date(Date.UTC(ano, mes, 0)).getUTCDate();

/** Dia da semana do dia 1 (0 = domingo), para saber quantas casas pular. */
export const primeiroDiaSemana = (ano: number, mes: number): number =>
  new Date(Date.UTC(ano, mes - 1, 1)).getUTCDay();

/**
 * As casas da grade: `null` nos vazios antes do dia 1 e depois do
 * último, para que a semana feche em 7 colunas.
 */
export function gradeDoMes(ano: number, mes: number): (number | null)[] {
  const total = diasNoMes(ano, mes);
  const vazios = primeiroDiaSemana(ano, mes);
  const casas: (number | null)[] = Array(vazios).fill(null);
  for (let d = 1; d <= total; d++) casas.push(d);
  while (casas.length % 7 !== 0) casas.push(null);
  return casas;
}

/**
 * Índice dia -> marcações daquele dia, na ordem em que vieram do
 * servidor (a mais antiga primeiro; é ela que dá a cor de fundo).
 */
export function marcacoesPorDia(
  marcacoes: MarcacaoCronograma[],
): Record<string, MarcacaoCronograma[]> {
  const mapa: Record<string, MarcacaoCronograma[]> = {};
  for (const m of marcacoes) {
    for (const dia of m.dias) (mapa[dia] ??= []).push(m);
  }
  return mapa;
}

/** As marcações que tocam um mês — a legenda embaixo do calendário. */
export function marcacoesDoMes(
  marcacoes: MarcacaoCronograma[],
  { ano, mes }: MesCronograma,
): MarcacaoCronograma[] {
  const prefixo = `${ano}-${String(mes).padStart(2, "0")}-`;
  return marcacoes.filter((m) => m.dias.some((d) => d.startsWith(prefixo)));
}

/**
 * Hoje, segundo o RELÓGIO DO NAVEGADOR — e é aceitável que seja.
 * Diferente do prazo de submissão, que vem do servidor porque um
 * computador adiantado reabriria o envio, aqui o pior caso de um
 * relógio errado é a borda de "hoje" na casa vizinha. Nada de
 * autorização depende disto.
 */
export function hojeLocal(): string {
  const agora = new Date();
  return chaveDia(agora.getFullYear(), agora.getMonth() + 1, agora.getDate());
}

/**
 * Paleta sugerida para as marcações. São as cores do próprio design
 * system (`--qc-*` e as semânticas), em HEX porque a coluna `cor` do
 * banco guarda hex e o CHECK da migration recusa qualquer outra coisa —
 * um `var(--qc-blue)` gravado ali não passaria, e no `style` de um
 * <div> ele também não resolveria contra a paleta certa em toda tela.
 */
export const CORES_SUGERIDAS: ReadonlyArray<{ hex: string; nome: string }> = [
  { hex: "#2563EB", nome: "Azul" },
  { hex: "#7C3AED", nome: "Roxo" },
  { hex: "#06B6D4", nome: "Ciano" },
  { hex: "#10B981", nome: "Verde" },
  { hex: "#F59E0B", nome: "Âmbar" },
  { hex: "#EF4444", nome: "Vermelho" },
  { hex: "#EC4899", nome: "Rosa" },
  { hex: "#64748B", nome: "Cinza" },
];

/**
 * Preto ou branco por cima da cor escolhida, pela luminância relativa.
 * A organização escolhe cor livre no seletor; sem isto, "Âmbar" ganha
 * texto branco e o nome do evento some dentro da própria etiqueta.
 */
export function corDoTexto(hex: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  // Coeficientes de luminância do sRGB (ITU-R BT.601).
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#1C1917" : "#ffffff";
}
