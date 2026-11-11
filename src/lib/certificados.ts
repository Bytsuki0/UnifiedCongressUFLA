import { trechosDaLinha, type Trecho } from "@/lib/avisos";

/**
 * Certificados (migration 20261111120000) — o lado puro.
 *
 * O modelo é um PNG mais uma lista de CAIXAS de texto. Posição, medidas e
 * tamanho de fonte são FRAÇÕES da imagem (x/l da largura; y/a/tamanho da
 * altura): a prévia reduzida e o arquivo final desenham igual, porque os
 * dois passam por `desenharCertificado` com um canvas de tamanho diferente.
 *
 * O texto de uma caixa quebra para BAIXO, nunca para o lado; se ainda
 * assim não couber na altura, a fonte encolhe (`ajustarTexto`).
 */

export const USOS = ["base", "primeiro", "segundo", "terceiro", "revisao", "avaliacao"] as const;
export type Uso = (typeof USOS)[number];

export const ROTULO_USO: Record<Uso, string> = {
  base: "Participação (todo trabalho aprovado)",
  primeiro: "1º lugar da categoria",
  segundo: "2º lugar da categoria",
  terceiro: "3º lugar da categoria",
  revisao: "Revisão (quem emitiu parecer)",
  avaliacao: "Avaliação (quem deu nota ao vivo)",
};

/** O nome curto, para o cartão de quem baixa. */
export const TITULO_USO: Record<Uso, string> = {
  base: "Certificado de participação",
  primeiro: "Certificado de 1º lugar",
  segundo: "Certificado de 2º lugar",
  terceiro: "Certificado de 3º lugar",
  revisao: "Certificado de revisão",
  avaliacao: "Certificado de avaliação",
};

const DO_TRABALHO = ["titulo", "autores", "categoria", "orientador"];
const DO_PODIO = [...DO_TRABALHO, "colocacao"];
const DA_PESSOA = ["nome", "quantidade"];

/** As variáveis que o servidor preenche em cada uso (`_certificados`). */
export const VARIAVEIS_DO_USO: Record<Uso, string[]> = {
  base: DO_TRABALHO,
  primeiro: DO_PODIO,
  segundo: DO_PODIO,
  terceiro: DO_PODIO,
  revisao: DA_PESSOA,
  avaliacao: DA_PESSOA,
};

export const USOS_DO_PODIO: Uso[] = ["primeiro", "segundo", "terceiro"];

export type Alinhamento = "left" | "center" | "right";

export type Caixa = {
  x: number;
  y: number;
  /** Largura e altura, em fração da imagem. */
  l: number;
  a: number;
  texto: string;
  /** Família embutida ("Georgia") ou caminho de fonte enviada ("fontes/Nome.ttf"). */
  fonte: string;
  /** Tamanho da fonte em fração da ALTURA da imagem. */
  tamanho: number;
  cor: string;
  alinhamento: Alinhamento;
};

export type Modelo = { largura: number; altura: number; caixas: Caixa[] };
export type Variaveis = Record<string, string>;

export const FONTES_EMBUTIDAS = ["Georgia", "Times New Roman", "Arial", "Verdana", "Courier New"];

export const caixaNova = (): Caixa => ({
  x: 0.2,
  y: 0.4,
  l: 0.6,
  a: 0.15,
  texto: "Texto com {variavel}",
  fonte: FONTES_EMBUTIDAS[0],
  tamanho: 0.04,
  cor: "#1f2937",
  alinhamento: "center",
});

/** "fontes/Minha Fonte.ttf" → "Minha Fonte"; família embutida passa direto. */
export const familiaDaFonte = (fonte: string) =>
  fonte.startsWith("fontes/") ? fonte.slice(7).replace(/\.\w+$/, "") : fonte;

/**
 * Troca `{nome}` pelo valor. Variável que o uso não tem fica ESCRITA como
 * está: na prévia, um `{titulo}` literal num certificado de professor
 * salta aos olhos; um vazio passaria por espaço em branco.
 */
export function substituirVariaveis(texto: string, variaveis: Variaveis): string {
  return texto.replace(/\{(\w+)\}/g, (inteiro, chave) => variaveis[chave] ?? inteiro);
}

/** Mede um pedaço de texto com a formatação dele, no tamanho dado. */
export type Medir = (texto: string, estilo: { negrito: boolean; italico: boolean }, px: number) => number;

const larguraDa = (linha: Trecho[], px: number, medir: Medir) =>
  linha.reduce((s, t) => s + medir(t.texto, t, px), 0);

/**
 * Quebra UMA linha de trechos em linhas que caibam na largura. Só quebra em
 * espaço: uma palavra maior que a caixa fica inteira na sua linha (quem
 * resolve é o encolhimento da fonte).
 */
export function quebrarLinha(trechos: Trecho[], larguraMax: number, px: number, medir: Medir): Trecho[][] {
  const linhas: Trecho[][] = [];
  let linha: Trecho[] = [];
  let largura = 0;
  let espaco: Trecho | null = null;

  for (const trecho of trechos) {
    for (const pedaco of trecho.texto.split(/(\s+)/)) {
      if (pedaco === "") continue;
      const item = { ...trecho, texto: pedaco };
      if (/^\s+$/.test(pedaco)) {
        // Espaço no começo da linha não desenha nem ocupa.
        if (linha.length > 0) espaco = { ...item, texto: " " };
        continue;
      }
      const w = medir(pedaco, trecho, px);
      const wEspaco = espaco ? medir(" ", espaco, px) : 0;
      if (espaco && largura + wEspaco + w > larguraMax) {
        linhas.push(linha);
        linha = [];
        largura = 0;
      } else if (espaco) {
        linha.push(espaco);
        largura += wEspaco;
      }
      espaco = null;
      linha.push(item);
      largura += w;
    }
  }
  linhas.push(linha);
  return linhas;
}

/** Altura de linha, em múltiplos do tamanho da fonte. */
export const ENTRELINHA = 1.25;
const PX_MINIMO = 6;

export type TextoAjustado = { linhas: Trecho[][]; px: number; encolheu: boolean };

/**
 * O texto da caixa pronto para desenhar: variáveis trocadas, linhas
 * quebradas e a fonte no maior tamanho (até o pedido) em que tudo cabe.
 *
 * ⚠ A marcação (`**negrito**`) é lida ANTES de trocar as variáveis: um
 * título com asterisco não pode ligar o itálico do certificado.
 */
export function ajustarTexto(
  texto: string,
  variaveis: Variaveis,
  larguraMax: number,
  alturaMax: number,
  pxPedido: number,
  medir: Medir,
): TextoAjustado {
  const paragrafos = texto
    .split("\n")
    .map((l) => trechosDaLinha(l).map((t) => ({ ...t, texto: substituirVariaveis(t.texto, variaveis) })));

  let px = pxPedido;
  for (;;) {
    const linhas = paragrafos.flatMap((p) => quebrarLinha(p, larguraMax, px, medir));
    const cabe =
      linhas.length * px * ENTRELINHA <= alturaMax &&
      linhas.every((l) => larguraDa(l, px, medir) <= larguraMax);
    if (cabe || px <= PX_MINIMO) return { linhas, px, encolheu: px < pxPedido };
    px = Math.max(PX_MINIMO, px * 0.95);
  }
}

const fonteCss = (t: { negrito: boolean; italico: boolean }, px: number, familia: string) =>
  `${t.italico ? "italic " : ""}${t.negrito ? "bold " : ""}${px}px "${familia}", serif`;

/** O texto de UMA caixa ajustado a um canvas de `largura × altura`. */
function ajustarCaixa(
  ctx: CanvasRenderingContext2D,
  caixa: Caixa,
  variaveis: Variaveis,
  largura: number,
  altura: number,
) {
  const familia = familiaDaFonte(caixa.fonte);
  const medir: Medir = (texto, estilo, px) => {
    ctx.font = fonteCss(estilo, px, familia);
    return ctx.measureText(texto).width;
  };
  const larguraMax = caixa.l * largura;
  const ajustado = ajustarTexto(
    caixa.texto,
    variaveis,
    larguraMax,
    caixa.a * altura,
    caixa.tamanho * altura,
    medir,
  );
  return { familia, medir, larguraMax, ajustado };
}

/**
 * Alguma caixa precisa encolher a fonte para este destinatário? Só mede,
 * não desenha — é o que deixa a tela de gestão conferir TODOS os
 * certificados sem renderizar um por um. Mede no tamanho do modelo.
 */
export function precisaEncolher(
  ctx: CanvasRenderingContext2D,
  modelo: Modelo,
  variaveis: Variaveis,
): boolean {
  return modelo.caixas.some(
    (c) => ajustarCaixa(ctx, c, variaveis, modelo.largura, modelo.altura).ajustado.encolheu,
  );
}

/**
 * Desenha o certificado inteiro no contexto, ocupando `largura × altura`
 * (as do canvas — a prévia passa as reduzidas, o download as do modelo).
 *
 * As fontes enviadas têm de estar carregadas ANTES (`carregarFontes`, no
 * service): canvas não espera fonte, desenha com a de reserva.
 */
export function desenharCertificado(
  ctx: CanvasRenderingContext2D,
  modelo: Modelo,
  imagem: CanvasImageSource,
  variaveis: Variaveis,
  largura: number,
  altura: number,
): void {
  ctx.clearRect(0, 0, largura, altura);
  ctx.drawImage(imagem, 0, 0, largura, altura);
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";

  for (const caixa of modelo.caixas) {
    const { familia, medir, larguraMax, ajustado } = ajustarCaixa(ctx, caixa, variaveis, largura, altura);
    ctx.fillStyle = caixa.cor;
    const passo = ajustado.px * ENTRELINHA;
    ajustado.linhas.forEach((linha, n) => {
      const sobra = larguraMax - larguraDa(linha, ajustado.px, medir);
      let x =
        caixa.x * largura +
        (caixa.alinhamento === "center" ? sobra / 2 : caixa.alinhamento === "right" ? sobra : 0);
      const y = caixa.y * altura + passo * (n + 0.5);
      for (const trecho of linha) {
        ctx.font = fonteCss(trecho, ajustado.px, familia);
        ctx.fillText(trecho.texto, x, y);
        x += ctx.measureText(trecho.texto).width;
      }
    });
  }
}

/** Nome do arquivo baixado: sem acento nem caractere que o Windows recuse. */
export function nomeDoArquivo(uso: Uso, variaveis: Variaveis): string {
  const alvo = (variaveis.titulo ?? variaveis.nome ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return `certificado-${uso}${alvo ? `-${alvo}` : ""}.png`;
}

/** O estado de liberação de um modelo, para o rótulo da tela de gestão. */
export type EstadoModelo = "rascunho" | "aguardando" | "liberado";

export function estadoDoModelo(
  m: { publicado_em: string | null; liberado_em: string | null } | undefined,
  dataChegou: boolean,
): EstadoModelo {
  if (!m?.publicado_em) return "rascunho";
  return m.liberado_em || dataChegou ? "liberado" : "aguardando";
}
