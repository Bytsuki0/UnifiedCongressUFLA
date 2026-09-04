/**
 * Datas do cronograma.
 *
 * O cronograma é uma LISTA de períodos: cada item tem uma data de início
 * e uma de término. O que este arquivo faz é transformar essas duas
 * strings num rótulo em pt-BR e dizer se o período já passou, está
 * acontecendo ou ainda vem.
 *
 * ⚠ Tudo aqui trabalha com a string 'AAAA-MM-DD', nunca com `Date`.
 * `new Date("2026-08-01")` é interpretado como meia-noite UTC; no fuso de
 * Lavras (UTC-3) isso é 31/07 às 21h, e o item apareceria começando um
 * dia antes do que a organização cadastrou. Como a string é de tamanho
 * fixo e zero-padded, comparar duas delas com `<` e `>` JÁ é comparação
 * cronológica — não há aritmética de data para fazer.
 */

export const NOMES_MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
] as const;

/** 'AAAA-MM-DD' a partir de ano/mês/dia. */
export const chaveDia = (ano: number, mes: number, dia: number): string =>
  `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;

/** As três partes de 'AAAA-MM-DD', como números. */
const partes = (chave: string): [number, number, number] => {
  const [ano, mes, dia] = String(chave ?? "").split("-").map(Number);
  return [ano, mes, dia];
};

/** "12 de agosto de 2026". */
export function rotuloDia(chave: string): string {
  const [ano, mes, dia] = partes(chave);
  if (!ano || !mes || !dia) return "";
  return `${dia} de ${NOMES_MESES[mes - 1].toLowerCase()} de ${ano}`;
}

/**
 * O período de um item, sem repetir o que os dois extremos têm em comum:
 *
 *   mesmo dia      "12 de agosto de 2026"
 *   mesmo mês      "12 a 16 de agosto de 2026"
 *   mesmo ano      "31 de agosto a 2 de setembro de 2026"
 *   anos distintos "28 de dezembro de 2026 a 3 de janeiro de 2027"
 *
 * Repetir mês e ano nos dois lados ("12 de agosto de 2026 a 16 de agosto
 * de 2026") é o que faz uma lista de datas virar um paredão ilegível.
 */
export function rotuloPeriodo(inicio: string, fim: string): string {
  if (!fim || fim === inicio) return rotuloDia(inicio);

  const [anoI, mesI, diaI] = partes(inicio);
  const [anoF, mesF] = partes(fim);
  if (!anoI || !mesI || !diaI || !anoF || !mesF) return rotuloDia(inicio);

  if (anoI !== anoF) return `${rotuloDia(inicio)} a ${rotuloDia(fim)}`;
  if (mesI !== mesF) {
    return `${diaI} de ${NOMES_MESES[mesI - 1].toLowerCase()} a ${rotuloDia(fim)}`;
  }
  return `${diaI} a ${rotuloDia(fim)}`;
}

/** Quantos dias o período cobre, contando as duas pontas. */
export function diasNoPeriodo(inicio: string, fim: string): number {
  const [aI, mI, dI] = partes(inicio);
  const [aF, mF, dF] = partes(fim || inicio);
  if (!aI || !aF) return 0;
  const umDia = 86_400_000;
  return Math.round((Date.UTC(aF, mF - 1, dF) - Date.UTC(aI, mI - 1, dI)) / umDia) + 1;
}

/**
 * Em que pé o período está. String, e não um par de booleanos: o
 * `tsconfig.app.json` roda com `strict: false`, e sem `strictNullChecks`
 * o TypeScript não estreita união por discriminante booleano.
 */
export type EstadoPeriodo = "futuro" | "andamento" | "encerrado";

export function estadoDoPeriodo(inicio: string, fim: string, hoje: string): EstadoPeriodo {
  const termino = fim || inicio;
  if (hoje < inicio) return "futuro";
  if (hoje > termino) return "encerrado";
  return "andamento";
}

/**
 * Hoje, segundo o RELÓGIO DO NAVEGADOR — e é aceitável que seja.
 * Diferente do prazo de submissão, que vem do servidor porque um
 * computador adiantado reabriria o envio, aqui o pior caso de um relógio
 * errado é o selo "em andamento" aparecer um dia antes ou depois. Nada de
 * autorização depende disto.
 */
export function hojeLocal(): string {
  const agora = new Date();
  return chaveDia(agora.getFullYear(), agora.getMonth() + 1, agora.getDate());
}

/**
 * Paleta sugerida para os itens. São as cores do próprio design system
 * (`--qc-*` e as semânticas), em HEX porque a coluna `cor` do banco
 * guarda hex e o CHECK da migration recusa qualquer outra coisa — um
 * `var(--qc-blue)` gravado ali não passaria, e no `style` de um <span>
 * ele também não resolveria contra a paleta certa em toda tela.
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
 * texto branco e a data some dentro da própria etiqueta.
 */
export function corDoTexto(hex: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  // Coeficientes de luminância do sRGB (ITU-R BT.601).
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#1C1917" : "#ffffff";
}
