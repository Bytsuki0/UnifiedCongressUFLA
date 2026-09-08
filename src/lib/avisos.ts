/**
 * Avisos de login o lado puro (migration 20260908120000).
 *
 * Duas coisas moram aqui, e as duas são função pura de propósito: são o
 * que os testes cobrem sem montar tela nenhuma
 * (`src/test/avisos.test.ts`).
 *
 *   1. A MARCAÇÃO do aviso de texto. O corpo é guardado como texto com
 *      um subconjunto mínimo de Markdown `**negrito**`, `*itálico*` e
 *      "- " para item de lista e `blocosDoTexto` o converte numa
 *      árvore de blocos que o componente percorre montando elementos
 *      React.
 *
 *      ⚠ É por isso que NÃO existe HTML em lugar nenhum deste caminho.
 *      O aviso é o único texto do sistema escrito por uma pessoa que
 *      aparece no navegador de TODAS as outras sem que ninguém tenha
 *      clicado em nada guardar HTML e injetá-lo com
 *      `dangerouslySetInnerHTML` transformaria uma conta de co-chair
 *      comprometida num `<script>` na tela do congresso inteiro. Uma
 *      árvore de blocos não tem como virar marcação: o pior que um
 *      texto malicioso consegue é ficar em negrito.
 *
 *   2. As EDIÇÕES da barra de ferramentas (negrito, itálico, lista).
 *      Recebem o texto e a seleção, devolvem o texto e a seleção novos
 *      o componente só repassa para o <textarea>. Sem isto a lógica
 *      ficaria presa num manipulador de evento, e o caso que mais
 *      quebra (alternar a marcação de volta, com a seleção já marcada)
 *      não teria como ser testado.
 */

/** Os cinco papéis que podem receber um aviso. Espelha o CHECK da tabela. */
export const PAPEIS_AVISO = [
  "estudante",
  "externo",
  "professor",
  "avaliador",
  "admin",
] as const;

export type PapelAviso = (typeof PAPEIS_AVISO)[number];

/**
 * Como cada papel é chamado na tela de quem publica.
 *
 * `estudante` e `externo` aparecem juntos na interface porque têm a
 * mesma alçada de autor (os dois caem em /estudante), mas continuam
 * sendo DOIS papéis no banco: quem quiser falar só com quem é de fora
 * da UFLA marca só um.
 */
export const ROTULO_PAPEL: Record<PapelAviso, string> = {
  estudante: "Estudantes",
  externo: "Participantes externos",
  professor: "Professores",
  avaliador: "Avaliadores (co-chairs)",
  admin: "Administradores",
};

/* ------------------------------------------------------------------
 * 1. A marcação
 * ----------------------------------------------------------------- */

/** Um pedaço de linha com a formatação que vale nele. */
export type Trecho = {
  texto: string;
  negrito: boolean;
  italico: boolean;
};

/**
 * Um bloco do aviso.
 *
 * ⚠ A união discrimina por STRING (`tipo`), nunca por um booleano:
 * `tsconfig.app.json` tem `strict: false`, e sem `strictNullChecks` o
 * TypeScript não estreita união por discriminante booleano o campo do
 * outro ramo ficaria inacessível (TS2339). Ver CLAUDE.md.
 */
export type BlocoAviso =
  | { tipo: "paragrafo"; linhas: Trecho[][] }
  | { tipo: "lista"; itens: Trecho[][] };

/** O marcador de item de lista, na escrita e na leitura. */
export const MARCADOR_ITEM = "- ";

/**
 * Existe um fechamento para este marcador mais à frente na linha?
 *
 * Sem esta pergunta, um asterisco solto ("5 * 3", "nota final*") ligaria
 * o itálico e ele valeria até o fim da linha o autor do aviso veria a
 * metade do recado torta e não teria como adivinhar por quê. Com ela, um
 * marcador sem par é apenas o caractere que ele é.
 */
function temFechamento(linha: string, inicio: number, duplo: boolean): boolean {
  for (let i = inicio; i < linha.length; i++) {
    if (linha[i] !== "*") continue;
    const eDuplo = linha[i + 1] === "*";
    if (eDuplo === duplo) return true;
    // Um `**` encontrado enquanto se procura por um `*` simples conta
    // como um marcador só: pular o par evita que a segunda metade dele
    // se passe pelo fechamento procurado.
    if (eDuplo) i++;
  }
  return false;
}

/**
 * Quebra uma linha nos trechos formatados.
 *
 * Os marcadores são alternadores: `**` liga e desliga o negrito, `*`
 * liga e desliga o itálico, e os dois podem se sobrepor
 * (`**muito *importante* mesmo**`). Marcador sem fechamento na linha
 * vira texto literal ver `temFechamento`.
 */
export function trechosDaLinha(linha: string): Trecho[] {
  const trechos: Trecho[] = [];
  let negrito = false;
  let italico = false;
  let buffer = "";

  const fechar = () => {
    if (buffer) trechos.push({ texto: buffer, negrito, italico });
    buffer = "";
  };

  for (let i = 0; i < linha.length; i++) {
    if (linha[i] !== "*") {
      buffer += linha[i];
      continue;
    }

    const duplo = linha[i + 1] === "*";
    const ligado = duplo ? negrito : italico;

    // Desligar é sempre possível o par já está aberto. Ligar exige
    // fechamento à frente, senão o marcador é texto.
    if (!ligado && !temFechamento(linha, i + (duplo ? 2 : 1), duplo)) {
      buffer += linha[i];
      continue;
    }

    fechar();
    if (duplo) {
      negrito = !negrito;
      i++;
    } else {
      italico = !italico;
    }
  }

  fechar();
  return trechos;
}

/**
 * Converte o corpo do aviso em blocos.
 *
 * Linhas consecutivas que não são item de lista formam UM parágrafo com
 * quebras dentro (e não um parágrafo por linha): é o que faz um endereço
 * ou uma assinatura de três linhas continuarem juntos. Linha em branco
 * fecha o bloco corrente; itens de lista consecutivos formam uma lista
 * só.
 */
export function blocosDoTexto(texto: string): BlocoAviso[] {
  const blocos: BlocoAviso[] = [];
  let paragrafo: Trecho[][] = [];
  let itens: Trecho[][] = [];

  const fecharParagrafo = () => {
    if (paragrafo.length > 0) blocos.push({ tipo: "paragrafo", linhas: paragrafo });
    paragrafo = [];
  };
  const fecharLista = () => {
    if (itens.length > 0) blocos.push({ tipo: "lista", itens });
    itens = [];
  };

  for (const bruta of (texto ?? "").split("\n")) {
    const linha = bruta.replace(/\r$/, "");
    const semEspacos = linha.trim();

    if (semEspacos === "") {
      fecharLista();
      fecharParagrafo();
      continue;
    }

    // "-" sozinho não abre lista: é um travessão que alguém digitou.
    if (semEspacos.startsWith(MARCADOR_ITEM)) {
      fecharParagrafo();
      itens.push(trechosDaLinha(semEspacos.slice(MARCADOR_ITEM.length).trim()));
      continue;
    }

    fecharLista();
    paragrafo.push(trechosDaLinha(linha));
  }

  fecharLista();
  fecharParagrafo();
  return blocos;
}

/** O aviso tem texto de verdade? Espelha o `btrim(corpo) <> ''` do banco. */
export function temConteudo(texto: string): boolean {
  return (texto ?? "").trim() !== "";
}

/* ------------------------------------------------------------------
 * 2. A barra de ferramentas
 * ----------------------------------------------------------------- */

/** Texto e seleção depois de uma edição da barra. */
export type EdicaoTexto = {
  texto: string;
  inicio: number;
  fim: number;
};

/**
 * Envolve (ou desenvolve) a seleção com um marcador.
 *
 * Três casos, e o terceiro é o que costuma ser esquecido:
 *
 *   · nada selecionado → insere o par vazio e deixa o cursor no meio,
 *     para quem clica no botão antes de digitar;
 *   · seleção crua → recebe o marcador dos dois lados;
 *   · seleção JÁ marcada → perde o marcador. Sem isto o botão só sabe
 *     ligar, e clicar duas vezes produz `****negrito****`, que a
 *     marcação lê como texto literal com asteriscos.
 */
export function envolverSelecao(
  texto: string,
  inicio: number,
  fim: number,
  marcador: string,
): EdicaoTexto {
  const antes = texto.slice(0, inicio);
  const selecao = texto.slice(inicio, fim);
  const depois = texto.slice(fim);
  const n = marcador.length;

  // Já marcado por dentro da seleção: **texto** selecionado inteiro.
  if (
    selecao.length >= n * 2 &&
    selecao.startsWith(marcador) &&
    selecao.endsWith(marcador)
  ) {
    const nu = selecao.slice(n, selecao.length - n);
    return { texto: antes + nu + depois, inicio, fim: inicio + nu.length };
  }

  // Já marcado por fora da seleção: **[texto]** com só o miolo selecionado.
  if (antes.endsWith(marcador) && depois.startsWith(marcador)) {
    return {
      texto: antes.slice(0, -n) + selecao + depois.slice(n),
      inicio: inicio - n,
      fim: fim - n,
    };
  }

  const novo = antes + marcador + selecao + marcador + depois;
  return selecao
    ? { texto: novo, inicio: inicio + n, fim: fim + n }
    : { texto: novo, inicio: inicio + n, fim: inicio + n };
}

/**
 * Liga ou desliga o marcador de lista nas linhas que a seleção toca.
 *
 * Opera em LINHAS INTEIRAS, e não no recorte exato da seleção: um item
 * de lista é a linha, e marcar meia linha produziria um "- " no meio
 * dela. Se todas as linhas alcançadas já são itens, o botão desmarca
 * mesma reversibilidade de `envolverSelecao`.
 */
export function alternarLista(texto: string, inicio: number, fim: number): EdicaoTexto {
  const inicioLinha = texto.lastIndexOf("\n", inicio - 1) + 1;
  const quebraFinal = texto.indexOf("\n", fim);
  const fimLinha = quebraFinal === -1 ? texto.length : quebraFinal;

  const alvo = texto.slice(inicioLinha, fimLinha);
  const linhas = alvo.split("\n");
  const todasSaoItens = linhas.every((l) => l.trim().startsWith(MARCADOR_ITEM));

  const convertidas = linhas.map((l) => {
    if (todasSaoItens) return l.replace(/^(\s*)- /, "$1");
    // Linha em branco no meio da seleção não vira um item vazio.
    return l.trim() === "" ? l : MARCADOR_ITEM + l;
  });

  const novoAlvo = convertidas.join("\n");
  return {
    texto: texto.slice(0, inicioLinha) + novoAlvo + texto.slice(fimLinha),
    inicio: inicioLinha,
    fim: inicioLinha + novoAlvo.length,
  };
}
