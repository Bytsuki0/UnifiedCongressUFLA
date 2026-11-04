/**
 * Cronograma de apresentações (migration 20261104120000) — o lado puro.
 *
 * Quem entra no cronograma, o que é público e quem recebe e-mail é regra do
 * servidor (`salvar_cronograma_apresentacoes`, `apresentacoes_publicas`,
 * `apresentacoes_devidas`). Daqui saem os rótulos de dia e horário, a
 * validação de cortesia do AdminCA e um ESPELHO da régua do e-mail — só
 * para o diálogo de confirmação dizer quantos autores vão ser avisados antes
 * de o e-mail sair, que é o que não tem volta.
 *
 * ⚠ Dia e hora trafegam como texto ('AAAA-MM-DD', 'HH:MM:SS') e ficam texto:
 * nunca passam por `new Date` (ver src/lib/cronograma.ts). Zero-padded, a
 * comparação de texto já é a cronológica.
 */

import { rotuloDia } from "@/lib/cronograma";
import { normalizar } from "@/lib/avaliacaoEvento";

/** Uma linha de `apresentacoes_publicas()`. */
export type ApresentacaoPublica = {
  id: string;
  titulo: string;
  autores: string;
  categoria_id: string | null;
  categoria: string;
  /** O formato, herdado da categoria. Vazio = ainda não definido. */
  tipo: string;
  data: string;
  hora_inicio: string;
  hora_fim: string;
  sala: string;
  /** O trabalho é de quem está logado (o dono). Sem sessão, sempre false. */
  meu: boolean;
};

/** O que o AdminCA edita em cada trabalho. Tudo vazio = fora do cronograma. */
export type Agenda = {
  data: string;
  hora_inicio: string;
  hora_fim: string;
  sala: string;
};

export const AGENDA_VAZIA: Agenda = { data: "", hora_inicio: "", hora_fim: "", sala: "" };

/** 'HH:MM:SS' (como o Postgres devolve `time`) → 'HH:MM'. */
export const hora = (t: string): string => (t ?? "").slice(0, 5);

/** "14:00 às 14:15". */
export function rotuloHorario(inicio: string, fim: string): string {
  return `${hora(inicio)} às ${hora(fim)}`;
}

/** "20 de novembro de 2026" — o mesmo rótulo do cronograma do evento. */
export const rotuloData = (data: string): string => rotuloDia(data);

/**
 * Em que pé está uma linha do AdminCA. É a mesma validação do servidor, que
 * é quem recusa de verdade — aqui ela só impede o Salvar de sair com uma
 * linha que voltaria recusada (e levaria o lote inteiro junto).
 *
 *   vazia              nada preenchido
 *   igual              igual ao gravado
 *   nova               agendada agora
 *   alterada           diferente do gravado
 *   removida           estava gravada e foi esvaziada
 *   incompleta         preenchida pela metade
 *   horario_invertido  o fim não vem depois do início
 */
export type EstadoLinha =
  | "vazia"
  | "igual"
  | "nova"
  | "alterada"
  | "removida"
  | "incompleta"
  | "horario_invertido";

/** Compara o que o servidor compara: dia, horas (sem os segundos) e a sala aparada. */
function mesmaAgenda(a: Agenda, b: Agenda): boolean {
  return (
    a.data === b.data &&
    hora(a.hora_inicio) === hora(b.hora_inicio) &&
    hora(a.hora_fim) === hora(b.hora_fim) &&
    a.sala.trim() === b.sala.trim()
  );
}

export function estadoLinha(gravada: Agenda | undefined, editada: Agenda): EstadoLinha {
  const campos = [editada.data, editada.hora_inicio, editada.hora_fim, editada.sala.trim()];
  if (campos.every((c) => !c)) return gravada ? "removida" : "vazia";
  if (!campos.every(Boolean)) return "incompleta";
  if (hora(editada.hora_fim) <= hora(editada.hora_inicio)) return "horario_invertido";
  if (!gravada) return "nova";
  return mesmaAgenda(gravada, editada) ? "igual" : "alterada";
}

/** Um item de `_apresentacoes`, como a RPC o espera. */
export type ItemSalvar =
  | ({ trabalho_id: string } & Agenda)
  | { trabalho_id: string; remover: true };

export type MudancasCronograma = {
  /** Para `_apresentacoes`: agendas novas e alteradas, e as remoções. */
  itens: ItemSalvar[];
  /** Para `_tipos`: só as categorias cujo tipo mudou. */
  tipos: { categoria_id: string; tipo: string }[];
  /** Os trabalhos que o servidor vai pôr na fila do e-mail. */
  avisados: string[];
  /** Os que saem do cronograma (sem e-mail). */
  removidos: string[];
  /** Linhas pela metade ou com o horário invertido: o Salvar não sai. */
  invalidos: string[];
};

/**
 * O que o Salvar vai mandar, e quem vai ser avisado.
 *
 * `avisados` ESPELHA a régua de `salvar_cronograma_apresentacoes`: trabalho
 * agendado agora, agenda alterada, ou — quando o tipo da categoria mudou —
 * todo trabalho que já estava gravado nela e não está saindo. Quem decide
 * de verdade é o servidor, e o número que ele devolve é o que vai no aviso
 * final; este só abastece a confirmação.
 *
 * `gravadas` são as agendas do banco (só de trabalho listado no AdminCA);
 * `editadas`, o formulário, com uma entrada por trabalho listado.
 */
export function calcularMudancas(entrada: {
  gravadas: Record<string, Agenda>;
  editadas: Record<string, Agenda>;
  categoriaDe: Record<string, string | null>;
  tiposGravados: Record<string, string>;
  tiposEditados: Record<string, string>;
}): MudancasCronograma {
  const { gravadas, editadas, categoriaDe, tiposGravados, tiposEditados } = entrada;
  const itens: ItemSalvar[] = [];
  const avisados = new Set<string>();
  const removidos: string[] = [];
  const invalidos: string[] = [];

  for (const [trabalhoId, editada] of Object.entries(editadas)) {
    const estado = estadoLinha(gravadas[trabalhoId], editada);
    if (estado === "removida") {
      itens.push({ trabalho_id: trabalhoId, remover: true });
      removidos.push(trabalhoId);
    } else if (estado === "incompleta" || estado === "horario_invertido") {
      invalidos.push(trabalhoId);
    } else if (estado === "nova" || estado === "alterada") {
      itens.push({
        trabalho_id: trabalhoId,
        data: editada.data,
        hora_inicio: hora(editada.hora_inicio),
        hora_fim: hora(editada.hora_fim),
        sala: editada.sala.trim(),
      });
      avisados.add(trabalhoId);
    }
  }

  const tipos = Object.entries(tiposEditados)
    .map(([categoria_id, tipo]) => ({ categoria_id, tipo: tipo.trim() }))
    .filter(({ categoria_id, tipo }) => tipo !== (tiposGravados[categoria_id] ?? "").trim());

  const mudouTipo = new Set(tipos.map((t) => t.categoria_id));
  const saindo = new Set(removidos);
  for (const trabalhoId of Object.keys(gravadas)) {
    const categoria = categoriaDe[trabalhoId];
    if (categoria && mudouTipo.has(categoria) && !saindo.has(trabalhoId)) avisados.add(trabalhoId);
  }

  return { itens, tipos, avisados: [...avisados], removidos, invalidos };
}

/** Uma linha de `envios_apresentacoes`, como o AdminCA a lê. */
export type EnvioApresentacao = {
  id: string;
  trabalhos_ids: string[];
  status: "reservado" | "enviado" | "falha";
  erro: string | null;
  criado_em: string;
  concluido_em: string | null;
};

/**
 * O envio mais recente de cada trabalho — é ele que diz em que pé está o
 * e-mail daquele trabalho. Falha seguida de envio bem-sucedido fica como
 * histórico, e contá-la mentiria sobre um e-mail que chegou.
 */
export function ultimoEnvioPorTrabalho(
  envios: EnvioApresentacao[],
): Map<string, EnvioApresentacao> {
  const ultimo = new Map<string, EnvioApresentacao>();
  for (const e of envios) {
    for (const id of e.trabalhos_ids) {
      const atual = ultimo.get(id);
      if (!atual || Date.parse(e.criado_em) > Date.parse(atual.criado_em)) ultimo.set(id, e);
    }
  }
  return ultimo;
}

/** Quantas falhas a fila tolera desde o último Salvar — o `< 3` de `apresentacoes_devidas`. */
export const MAX_FALHAS_AVISO = 3;

/**
 * O e-mail de um trabalho ainda por sair, como `apresentacoes_devidas` o
 * enxerga: na fila, ou abandonado depois de {@link MAX_FALHAS_AVISO} falhas
 * desde o último Salvar (aí só salvar de novo o devolve). `null` = nada
 * pendente — quem diz o resto é o último envio.
 *
 * Os carimbos aqui TÊM fuso (timestamptz), então `Date.parse` é seguro — a
 * proibição de `new Date` vale para a data sem hora.
 */
export function avisoPendente(
  apresentacao: { aviso_solicitado_em: string | null; aviso_reservado_em: string | null },
  enviosDoTrabalho: EnvioApresentacao[],
): "na_fila" | "desistiu" | null {
  const { aviso_solicitado_em: solicitado, aviso_reservado_em: reservado } = apresentacao;
  if (!solicitado || reservado) return null;
  const falhas = enviosDoTrabalho.filter(
    (e) => e.status === "falha" && Date.parse(e.criado_em) >= Date.parse(solicitado),
  ).length;
  return falhas >= MAX_FALHAS_AVISO ? "desistiu" : "na_fila";
}

// ------------------------------------------------------------
// Importar CSV no AdminCA
// ------------------------------------------------------------
// O CSV só PREENCHE o formulário: nada é gravado e nenhum e-mail sai até o
// Salvar, que passa pela confirmação de sempre. Colunas por posição:
// título; dia (DD/MM/AAAA); início; fim; sala (HH:MM, 24h).

/** Uma linha do CSV com o número da linha do arquivo onde ela começa (para o aviso). */
export type LinhaCsv = { numero: number; campos: string[] };

/**
 * CSV com aspas (`"a; b"`, `""` dentro de aspas), CRLF e linhas em branco
 * puladas. O separador é `;` quando a 1ª linha tem mais `;` que `,` — o
 * Excel em pt-BR salva com `;`, e título de trabalho vive cheio de vírgula.
 */
export function linhasCsv(texto: string): LinhaCsv[] {
  if (texto.charCodeAt(0) === 0xfeff) texto = texto.slice(1); // BOM
  const primeira = texto.split(/\r?\n/, 1)[0] ?? "";
  const sep = (primeira.split(";").length > primeira.split(",").length) ? ";" : ",";

  const linhas: LinhaCsv[] = [];
  let campos: string[] = [];
  let campo = "";
  let aspas = false;
  let numero = 1;
  let inicio = 1;
  const fecharLinha = () => {
    campos.push(campo);
    if (campos.some((c) => c.trim())) linhas.push({ numero: inicio, campos });
    campos = [];
    campo = "";
  };

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (c === '"') aspas = false;
      else {
        if (c === "\n") numero++;
        campo += c;
      }
    } else if (c === '"') aspas = true;
    else if (c === sep) {
      campos.push(campo);
      campo = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      fecharLinha();
      inicio = ++numero;
    } else campo += c;
  }
  fecharLinha();
  return linhas;
}

/**
 * 'D/M/AAAA' → 'AAAA-MM-DD', ou null se o dia não existe (31/02). A
 * conferência é por `Date.UTC`, nunca `new Date('AAAA-MM-DD')` (ver o topo).
 */
export function dataDeBr(texto: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(texto.trim());
  if (!m) return null;
  const [d, mes, ano] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const utc = new Date(Date.UTC(ano, mes - 1, d));
  if (utc.getUTCFullYear() !== ano || utc.getUTCMonth() !== mes - 1 || utc.getUTCDate() !== d) return null;
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

/** 'H:MM', 'HH:MM' ou 'HH:MM:SS' (o Excel às vezes põe os segundos), 24h → 'HH:MM'. */
export function horaDe(texto: string): string | null {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(texto.trim());
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

/** Uma linha do CSV que não preencheu nada: o trabalho fica para a mão. */
export type PendenteCsv = { linha: number; titulo: string; motivo: string };

/** Título comparável: sem acento, sem caixa, espaços colapsados. */
const chaveTitulo = (t: string) => normalizar(t).replace(/\s+/g, " ").trim();

/** O teto da sala no CHECK da coluna: passar dele derrubaria o lote inteiro no Salvar. */
const MAX_SALA = 120;

/**
 * Casa cada linha do CSV com um trabalho listado no AdminCA (só aprovados)
 * pelo título EXATO, tirados acento, caixa e espaços. Nada de aproximação:
 * casar errado agendaria — e mandaria e-mail para — o autor errado.
 *
 * Fim antes do início entra como veio: o `estadoLinha` da tela já pinta a
 * linha e trava o Salvar, não precisa de regra nova aqui.
 */
export function importarCsvAgenda(
  texto: string,
  trabalhos: { id: string; titulo: string }[],
): { agendas: Record<string, Agenda>; pendentes: PendenteCsv[] } {
  const porTitulo = new Map<string, string[]>();
  for (const t of trabalhos) {
    const chave = chaveTitulo(t.titulo);
    porTitulo.set(chave, [...(porTitulo.get(chave) ?? []), t.id]);
  }

  const linhas = linhasCsv(texto);
  // Cabeçalho: a 1ª linha cujo "dia" não é data.
  if (linhas.length > 0 && !dataDeBr(linhas[0].campos[1] ?? "")) linhas.shift();

  const agendas: Record<string, Agenda> = {};
  const pendentes: PendenteCsv[] = [];
  const vistos = new Set<string>();

  for (const { numero, campos } of linhas) {
    const [titulo = "", dia = "", inicio = "", fim = "", sala = ""] = campos.map((c) => c.trim());
    const pendente = (motivo: string) => pendentes.push({ linha: numero, titulo, motivo });
    const ids = porTitulo.get(chaveTitulo(titulo)) ?? [];
    if (ids.length === 0) {
      pendente("título não encontrado entre os trabalhos aprovados");
      continue;
    }
    if (ids.length > 1) {
      pendente("título igual ao de mais de um trabalho");
      continue;
    }
    // Repetido conta mesmo se a 1ª linha era inválida: não dá para saber qual das duas valia.
    if (vistos.has(ids[0])) {
      pendente("título repetido no CSV");
      continue;
    }
    vistos.add(ids[0]);

    const data = dataDeBr(dia);
    const horaInicio = horaDe(inicio);
    const horaFim = horaDe(fim);
    if (!data) pendente("dia inválido (use DD/MM/AAAA)");
    else if (!horaInicio || !horaFim) pendente("horário inválido (use HH:MM, 24h)");
    else if (!sala) pendente("sala vazia");
    else if (sala.length > MAX_SALA) pendente(`sala com mais de ${MAX_SALA} caracteres`);
    else agendas[ids[0]] = { data, hora_inicio: horaInicio, hora_fim: horaFim, sala };
  }

  return { agendas, pendentes };
}
