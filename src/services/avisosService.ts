import { supabase } from "@/integrations/supabase/client";
import type { PapelAviso } from "@/lib/avisos";

/**
 * Avisos de login (migration 20260908120000).
 *
 * A organização cadastra recados endereçados a papéis em
 * /co-chairs/avisos; quem entra recebe os seus num diálogo, logo depois
 * do login.
 *
 * Duas leituras, com políticas de ERRO opostas a mesma dupla de
 * `carregarArquivosDownload` / `listarArquivosDownload`:
 *
 *   · `carregarMeusAvisos()` o que o diálogo mostra. Falha devolve
 *     lista VAZIA. Um aviso é cortesia da organização; uma consulta que
 *     não respondeu não pode segurar a entrada de ninguém no portal.
 *     (É o inverso do prazo de submissão, que falha ABERTO porque lá
 *     quem recusa de verdade é o banco.)
 *   · `listarAvisos()` a tela de gestão. Falha PROPAGA: quem publica
 *     não pode receber lista vazia por falha de rede e concluir que não
 *     há aviso nenhum no ar.
 *
 * ⚠ O ENDEREÇAMENTO é do servidor, sempre. `meus_avisos()` compara os
 * papéis do aviso com os papéis reais da conta (`papeis_efetivos()`), e
 * não com o papel único que o AuthContext guarda esse é só o de maior
 * privilégio, e um professor que também é avaliador perderia o aviso
 * dos professores se o recorte fosse daqui. O cliente não filtra nada.
 */

export type TipoAviso = "texto" | "banner";

/** Um aviso como o destinatário o recebe: sem `papeis`, sem `ordem`. */
export type Aviso = {
  id: string;
  tipo: TipoAviso;
  titulo: string;
  /** Corpo com marcação leve. Vazio quando `tipo === "banner"`. */
  corpo: string;
  /** Caminho no bucket privado. Vazio quando `tipo === "texto"`. */
  imagem: string;
};

/** O mesmo aviso do ponto de vista de quem publica. */
export type AvisoAdmin = Aviso & {
  papeis: PapelAviso[];
  ordem: number;
};

/** O que a tela de gestão manda para criar. */
export type NovoAviso = {
  tipo: TipoAviso;
  titulo: string;
  corpo: string;
  imagem: string;
  papeis: PapelAviso[];
  ordem: number;
};

const COLUNAS = "id, tipo, titulo, corpo, imagem, papeis, ordem";

/** Bucket PRIVADO dos banners a imagem sai por URL assinada. */
const BUCKET_AVISOS = "avisos";

/** Uma hora, como nos PDFs (`pdfStorage.ts`). */
const URL_ASSINADA_SEGUNDOS = 60 * 60;

/**
 * Os avisos endereçados a quem está logado, na ordem em que devem
 * aparecer. Falha silenciosa ver o cabeçalho.
 */
export async function carregarMeusAvisos(): Promise<Aviso[]> {
  const { data, error } = await supabase.rpc("meus_avisos");
  if (error || !data) return [];
  return data as Aviso[];
}

/** Todos os avisos pela TABELA, para a tela de gestão. Aqui o erro aparece. */
export async function listarAvisos(): Promise<AvisoAdmin[]> {
  const { data, error } = await supabase
    .from("avisos")
    .select(COLUNAS)
    .order("ordem")
    .order("criado_em");
  if (error) throw new Error(error.message);
  return (data ?? []) as AvisoAdmin[];
}

/**
 * Publica um aviso. `criado_por` NÃO vai no corpo: a coluna tem
 * `DEFAULT auth.uid()`, então o autor é carimbado pelo banco. A RLS
 * recusa quem não é da organização, e os dois CHECK recusam aviso sem
 * conteúdo e aviso sem destinatário.
 */
export async function criarAviso(entrada: NovoAviso): Promise<AvisoAdmin> {
  const { data, error } = await supabase
    .from("avisos")
    .insert({
      tipo: entrada.tipo,
      titulo: entrada.titulo.trim(),
      corpo: entrada.corpo.trim(),
      imagem: entrada.imagem.trim(),
      papeis: entrada.papeis,
      ordem: entrada.ordem,
    })
    .select(COLUNAS)
    .single();
  if (error) throw new Error(error.message);
  return data as AvisoAdmin;
}

/**
 * Corrige um aviso já no ar.
 *
 * `tipo` não está em `Partial<...>` por acaso: trocar o tipo de um aviso
 * já criado deixaria a imagem pendurada no bucket sem nada apontando
 * para ela (o blob não sai por SQL). Quem quer mudar de forma exclui e
 * cadastra de novo mesma regra de `categoria_anexos.tipo`.
 */
export async function atualizarAviso(
  id: string,
  campos: Partial<Omit<NovoAviso, "tipo">>,
): Promise<void> {
  const { error } = await supabase.from("avisos").update(campos).eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Tira o aviso do ar é isto que faz o pop-up parar de aparecer.
 *
 * ⚠ Lê o caminho da imagem ANTES do DELETE, como `excluirTrabalho`:
 * depois a linha não existe mais e não há como saber o que apagar do
 * Storage. Devolve o caminho (vazio quando é aviso de texto) para o
 * chamador descartar o blob.
 */
export async function removerAviso(id: string): Promise<string> {
  const { data } = await supabase.from("avisos").select("imagem").eq("id", id).maybeSingle();
  const imagem = (data?.imagem ?? "") as string;

  const { error } = await supabase.from("avisos").delete().eq("id", id);
  if (error) throw new Error(error.message);
  return imagem;
}

/* ------------------------------------------------------------------
 * O banner
 * ----------------------------------------------------------------- */

/**
 * Sobe a imagem do banner e devolve o CAMINHO dentro do bucket (nunca
 * uma URL: o bucket é privado, e uma URL gravada expiraria junto com a
 * assinatura).
 *
 * A pasta é o id de quem subiu, como no bucket `Pdfs`. Aqui ela não é
 * barreira de segurança a policy do Storage exige `is_event_staff()`
 * para escrever, não a pasta, é só o que mantém os arquivos
 * separáveis por autor quando alguém for olhar o bucket.
 */
export async function enviarBanner(arquivo: File, autorId: string): Promise<string> {
  const nomeSeguro = arquivo.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const caminho = `${autorId}/${Date.now()}-${nomeSeguro}`;

  const { error } = await supabase.storage.from(BUCKET_AVISOS).upload(caminho, arquivo, {
    contentType: arquivo.type,
    upsert: false,
  });
  if (error) throw new Error("Não foi possível enviar a imagem do banner.");
  return caminho;
}

/**
 * Apaga do Storage um banner que deixou de ser referenciado o aviso
 * foi excluído, ou a imagem foi trocada por outra.
 *
 * Best-effort de propósito, como `descartarDoStorage`: o registro já
 * está certo, e falhar aqui só deixa um arquivo órfão. Caminho vazio
 * (aviso de texto) e URL completa são ignorados `remove()` não
 * entende URL e apagaria o objeto errado.
 */
export async function descartarBanner(caminho: string): Promise<void> {
  if (!caminho || /^https?:\/\//i.test(caminho)) return;
  await supabase.storage.from(BUCKET_AVISOS).remove([caminho]);
}

/**
 * Resolve o caminho gravado para uma URL temporária assinada, como
 * `resolvePdfUrl` faz com os PDFs. `null` quando a assinatura falha o
 * diálogo mostra o título e o aviso de que a imagem não carregou, em vez
 * de um retângulo quebrado sem explicação.
 */
export async function resolverBanner(caminho: string): Promise<string | null> {
  if (!caminho) return null;
  if (/^https?:\/\//i.test(caminho)) return caminho;

  const { data, error } = await supabase.storage
    .from(BUCKET_AVISOS)
    .createSignedUrl(caminho, URL_ASSINADA_SEGUNDOS);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
