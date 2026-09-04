import { supabase } from "@/integrations/supabase/client";
import { PDF_BUCKET } from "@/lib/config";
import type { AnexoDaCategoria, RascunhoAnexos } from "@/lib/anexos";
import {
  caminhosDevolvidos,
  descartarDoStorage,
  prepararAnexos,
} from "@/services/anexosService";
import type { Trabalho, Categoria } from "@/lib/types";

/**
 * Trabalhos submetidos: leitura, cadastro e edição.
 *
 * O recorte de quem enxerga o quê é do RLS, não daqui — a policy
 * `trabalhos select` libera para a organização, para o dono e para o
 * revisor associado. As funções abaixo que filtram por dono
 * (`listarTrabalhosDoAutor`) filtram por conta da SEMÂNTICA da tela
 * ("as minhas submissões"), não por segurança: sem o filtro, um
 * professor veria aqui os trabalhos de todo mundo, que é o que o RLS
 * legitimamente permite a ele.
 */

export type Coautor = { nome?: string; email?: string };

export type NovoTrabalho = {
  titulo: string;
  /** Termos livres, na ordem em que o autor os digitou. */
  palavrasChave: string[];
  categoriaId: string;
  autores: string;
  orientadorEmail: string | null;
  coautores: Coautor[];
  ownerId: string;
  /** O que a categoria escolhida exige. Pode ser lista vazia. */
  exigencias: AnexoDaCategoria[];
  /** O que o autor preencheu para cada exigência. */
  anexos: RascunhoAnexos;
};

/** Lista todos os trabalhos — a RLS decide quantos de fato voltam. */
export async function listarTrabalhos(): Promise<Trabalho[]> {
  const { data, error } = await supabase
    .from("trabalhos")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Trabalhos de um autor específico, mais recentes primeiro. */
export async function listarTrabalhosDoAutor(ownerId: string): Promise<Trabalho[]> {
  const { data, error } = await supabase
    .from("trabalhos")
    .select("*")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function obterTrabalho(id: string): Promise<Trabalho | null> {
  const { data, error } = await supabase
    .from("trabalhos")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function obterCategoria(id: string): Promise<Categoria | null> {
  const { data, error } = await supabase
    .from("categorias")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Trabalhos + categorias juntos, para as telas que mostram os dois. */
export async function listarTrabalhosComCategorias(): Promise<{
  trabalhos: Trabalho[];
  categorias: Categoria[];
}> {
  const [t, c] = await Promise.all([
    supabase.from("trabalhos").select("*").order("created_at", { ascending: false }),
    supabase.from("categorias").select("*").order("nome"),
  ]);
  if (t.error || c.error) throw t.error ?? c.error;
  return { trabalhos: t.data ?? [], categorias: c.data ?? [] };
}

/**
 * Mesma combinação, mas recortada por autor. `ownerId` nulo devolve lista
 * vazia de trabalhos sem ir ao banco — é o estado "sessão ainda
 * resolvendo" do Portal do Estudante.
 */
export async function listarTrabalhosDoAutorComCategorias(ownerId: string | null): Promise<{
  trabalhos: Trabalho[];
  categorias: Categoria[];
}> {
  const [t, c] = await Promise.all([
    ownerId
      ? supabase
          .from("trabalhos")
          .select("*")
          .eq("owner_id", ownerId)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    supabase.from("categorias").select("*").order("nome"),
  ]);
  if (t.error || c.error) throw t.error ?? c.error;
  return { trabalhos: t.data ?? [], categorias: c.data ?? [] };
}

/**
 * Campos que a organização edita pelo formulário de co-chairs. `status`
 * fica de fora: quem o move é a decisão consolidada dos pareceres, no
 * servidor — não este formulário.
 */
export type PayloadTrabalho = {
  titulo: string;
  resumo: string;
  autores: string;
  categoria_id: string;
  data_submissao: string;
};

export async function criarTrabalhoPelaOrganizacao(payload: PayloadTrabalho): Promise<void> {
  const { error } = await supabase.from("trabalhos").insert(payload);
  if (error) throw error;
}

export async function atualizarTrabalho(
  id: string,
  payload: PayloadTrabalho,
): Promise<void> {
  const { error } = await supabase.from("trabalhos").update(payload).eq("id", id);
  if (error) throw error;
}

/*
 * `atualizarStatusDoTrabalho` foi removida em 20260820140000.
 *
 * Ela gravava `trabalhos.status` cru a partir dos botões do Portal Admin
 * — sem autor, sem justificativa e sem data — e o parecer seguinte a
 * sobrescrevia em silêncio. Era o único override humano que existia, e
 * agora existe um caminho próprio para isso: `registrar_parecer_editorial`,
 * que exige comentário e deixa rastro em `decisoes_editoriais`.
 *
 * Se um dia voltar a fazer falta um "mover status na marra", ele tem de
 * nascer como RPC auditada, não como UPDATE solto.
 */

/**
 * Caminho do objeto dentro do bucket de PDFs, a partir do que está
 * gravado em `trabalho_anexos.valor`.
 *
 * O formato novo já é o caminho (`<owner_id>/arquivo.pdf`), mas linhas
 * antigas guardam a URL pública inteira, de quando o bucket ainda era
 * público — e `storage.remove()` não entende URL. Devolve null quando a
 * URL aponta para outro bucket ou para fora do Storage: melhor deixar um
 * arquivo órfão do que apagar o objeto errado.
 */
function caminhoNoBucket(pdfUrl: string | null | undefined): string | null {
  if (!pdfUrl) return null;
  if (!/^https?:\/\//i.test(pdfUrl)) return pdfUrl;
  const m = pdfUrl.match(/\/object\/(?:public|sign|authenticated)\/([^/]+)\/([^?]+)/);
  if (!m || m[1] !== PDF_BUCKET) return null;
  return decodeURIComponent(m[2]);
}

/**
 * Os caminhos de PDF dos trabalhos indicados, LIDOS ANTES do DELETE.
 *
 * A ordem é obrigatória: `trabalho_anexos` sai por ON DELETE CASCADE
 * junto com o trabalho, então depois do DELETE não há mais o que
 * consultar. Antes desta tabela o caminho vinha da própria linha de
 * `trabalhos`, e a leitura prévia era só conveniência; agora é a única
 * chance de saber quais blobs apagar.
 */
async function caminhosDosAnexos(ids: string[]): Promise<Map<string, string[]>> {
  const porTrabalho = new Map<string, string[]>();
  if (ids.length === 0) return porTrabalho;

  const { data } = await supabase
    .from("trabalho_anexos")
    .select("trabalho_id, valor")
    .in("trabalho_id", ids)
    .eq("tipo", "pdf");

  for (const linha of data ?? []) {
    const caminho = caminhoNoBucket(linha.valor);
    if (caminho) {
      const lista = porTrabalho.get(linha.trabalho_id) ?? [];
      lista.push(caminho);
      porTrabalho.set(linha.trabalho_id, lista);
    }
  }
  return porTrabalho;
}

/**
 * Exclui um trabalho e os PDFs que vieram com ele.
 *
 * A linha sai primeiro porque é ela a autoridade: `pareceres`,
 * `avaliacoes`, `trabalho_revisores` e `trabalho_anexos` acompanham por
 * ON DELETE CASCADE. O blob do Storage **não** sai por SQL — exige esta
 * segunda chamada. Na ordem inversa, um erro no DELETE deixaria um
 * trabalho apontando para arquivos que não existem mais; nesta, o pior
 * caso é um arquivo órfão.
 *
 * Quem autoriza é o RLS (`trabalhos delete` e `pdfs owner delete` já
 * liberam a organização), nunca a interface que chama.
 */
export async function excluirTrabalho(id: string): Promise<void> {
  const caminhos = (await caminhosDosAnexos([id])).get(id) ?? [];

  const { error } = await supabase.from("trabalhos").delete().eq("id", id);
  if (error) throw error;

  if (caminhos.length > 0) await supabase.storage.from(PDF_BUCKET).remove(caminhos);
}

/**
 * Exclusão em lote — a limpeza de fim de edição do Portal Admin.
 *
 * Devolve quantos trabalhos o banco de fato apagou, que pode ser menos
 * do que o pedido: o RLS recusa em silêncio o que o usuário não pode
 * apagar, e um DELETE parcial não vira erro. Quem chama compara com o
 * total e avisa o usuário.
 */
export async function excluirTrabalhos(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;

  const porTrabalho = await caminhosDosAnexos(ids);

  const { data: apagados, error } = await supabase
    .from("trabalhos")
    .delete()
    .in("id", ids)
    .select("id");
  if (error) throw error;

  // Só os PDFs dos trabalhos que de fato saíram: o RLS recusa em
  // silêncio, e apagar o arquivo de um trabalho que continua vivo o
  // deixaria sem anexo.
  const saiu = new Set((apagados ?? []).map((t) => t.id));
  const caminhos = [...saiu].flatMap((id) => porTrabalho.get(id) ?? []);
  if (caminhos.length > 0) await supabase.storage.from(PDF_BUCKET).remove(caminhos);

  return saiu.size;
}

/**
 * Submissão do autor: sobe os PDFs para a pasta do próprio usuário
 * (exigida pela policy do Storage) e grava o trabalho com os anexos.
 *
 * ⚠ É uma RPC, e não mais um `.insert()`, desde 20260904. Com o trabalho
 * numa tabela e os anexos em outra, dois requests significariam "criou o
 * trabalho, perdeu os arquivos"; a RPC é uma transação só. Se ela
 * recusar, os uploads desta tentativa são apagados — nada aponta para
 * eles.
 *
 * ⚠ O trabalho nasce SEM revisores, e é de propósito. Até 20260820 esta
 * função chamava `distribuir_revisores` logo depois do INSERT, então o
 * autor apertava "Enviar" e o banco já escolhia até 3 revisores sem que
 * ninguém da organização autorizasse. Agora quem distribui é um co-chair,
 * em /co-chairs/atribuicoes, revisando a proposta antes de confirmá-la.
 * A migration 20260820120000 fechou o portão do outro lado: a RPC deixou
 * de aceitar o dono do trabalho, então nem por chamada direta à API o
 * autor consegue se atribuir revisores.
 */
export async function submeterTrabalho(input: NovoTrabalho): Promise<string> {
  const { payload, enviados } = await prepararAnexos({
    exigencias: input.exigencias,
    rascunho: input.anexos,
    ownerId: input.ownerId,
  });

  const { data, error } = await supabase.rpc("submeter_trabalho", {
    _titulo: input.titulo,
    _palavras_chave: input.palavrasChave,
    _categoria_id: input.categoriaId,
    _autores: input.autores,
    _orientador_email: input.orientadorEmail,
    _coautores: input.coautores,
    _anexos: payload,
  });

  if (error || !data) {
    await descartarDoStorage(enviados);
    throw new Error(error?.message ?? "Erro ao submeter trabalho. Tente novamente.");
  }

  return data as string;
}

export type EditarSubmissaoInput = {
  trabalhoId: string;
  ownerId: string;
  titulo: string;
  palavrasChave: string[];
  /** O que a categoria do trabalho exige. */
  exigencias: AnexoDaCategoria[];
  /** O que o autor preencheu. PDF sem arquivo novo = manter o atual. */
  anexos: RascunhoAnexos;
};

/**
 * Edição da submissão pelo próprio autor, antes de a avaliação começar.
 *
 * Espelha `enviarCorrecao` (correcaoService) de propósito — mesma ordem
 * de operações, mesmo contrato: sobe os PDFs novos, grava pela RPC e só
 * então apaga os antigos. Se a gravação falhar, a tabela continua
 * apontando para os arquivos velhos e o que sobra é upload órfão, que é
 * melhor do que um trabalho sem PDF.
 *
 * Quem recusa fora do prazo, fora do status 'pendente' ou de dono
 * errado é a RPC `editar_submissao`, não esta função.
 */
export async function editarSubmissao(input: EditarSubmissaoInput): Promise<void> {
  const { payload, enviados } = await prepararAnexos({
    exigencias: input.exigencias,
    rascunho: input.anexos,
    ownerId: input.ownerId,
  });

  const { data, error } = await supabase.rpc("editar_submissao", {
    _trabalho_id: input.trabalhoId,
    _titulo: input.titulo,
    _palavras_chave: input.palavrasChave,
    _anexos: payload,
  });
  if (error) {
    await descartarDoStorage(enviados);
    throw new Error(error.message ?? "Não foi possível salvar as alterações.");
  }

  // A RPC devolve os caminhos que deixaram de ser referenciados. Falha ao
  // apagar não invalida a edição: o registro já está certo.
  await descartarDoStorage(caminhosDevolvidos(data));
}

/**
 * Trabalho do próprio autor, para a tela de correção.
 *
 * O filtro por `owner_id` é redundante com o RLS na leitura, mas garante
 * que a tela nunca abra o trabalho de outra pessoa para um usuário da
 * organização — que PODE lê-lo, e não deveria corrigi-lo por aqui.
 */
export async function obterMeuTrabalho(
  id: string,
  ownerId: string,
): Promise<Trabalho | null> {
  const { data, error } = await supabase
    .from("trabalhos")
    .select("*")
    .eq("id", id)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (error) throw error;
  return data;
}
