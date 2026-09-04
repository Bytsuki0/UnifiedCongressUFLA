import { supabase } from "@/integrations/supabase/client";
import { PDF_BUCKET } from "@/lib/config";
import {
  ordenarAnexos,
  type AnexoDaCategoria,
  type AnexoDoTrabalho,
  type AnexoParaEnvio,
  type RascunhoAnexos,
} from "@/lib/anexos";

/**
 * O lado de rede dos anexos: subir os PDFs, montar o corpo `_anexos` das
 * RPCs e apagar do Storage o que deixou de ser referenciado.
 *
 * Vive num serviço próprio porque as quatro escritas do autor moram em
 * três serviços diferentes (`trabalhosService`, `correcaoService`,
 * `parecerEditorialService`) e todas fazem exatamente a mesma dança.
 * Antes desta tabela cada uma tinha a sua cópia — com um arquivo só dava
 * para conviver; com N não daria.
 */

/** As colunas de `trabalho_anexos` que as telas leem. */
export const COLUNAS_ANEXO = "id, anexo_id, tipo, titulo, ordem, valor";

/** Anexos entregues por um trabalho, na ordem em que as telas os mostram. */
export async function listarAnexosDoTrabalho(
  trabalhoId: string,
): Promise<AnexoDoTrabalho[]> {
  const { data, error } = await supabase
    .from("trabalho_anexos")
    .select(COLUNAS_ANEXO)
    .eq("trabalho_id", trabalhoId);
  if (error) throw error;
  return ordenarAnexos((data ?? []) as AnexoDoTrabalho[]);
}

/** Os mesmos anexos, para vários trabalhos de uma vez, indexados por trabalho. */
export async function anexosPorTrabalho(
  ids: string[],
): Promise<Record<string, AnexoDoTrabalho[]>> {
  if (ids.length === 0) return {};
  const { data, error } = await supabase
    .from("trabalho_anexos")
    .select(`trabalho_id, ${COLUNAS_ANEXO}`)
    .in("trabalho_id", ids);
  if (error) throw error;

  const porTrabalho: Record<string, AnexoDoTrabalho[]> = {};
  for (const linha of (data ?? []) as (AnexoDoTrabalho & { trabalho_id: string })[]) {
    (porTrabalho[linha.trabalho_id] ??= []).push(linha);
  }
  for (const chave of Object.keys(porTrabalho)) {
    porTrabalho[chave] = ordenarAnexos(porTrabalho[chave]);
  }
  return porTrabalho;
}

export type AnexosPreparados = {
  /** O corpo `_anexos` da RPC. */
  payload: AnexoParaEnvio[];
  /**
   * Caminhos subidos AGORA. Se a RPC recusar, é o que precisa sair do
   * Storage — senão cada tentativa recusada deixa um arquivo pago para
   * trás.
   */
  enviados: string[];
};

/**
 * Sobe os PDFs novos e monta o corpo da RPC.
 *
 * O caminho é `<owner_id>/<timestamp>-<nome>`, a mesma forma de sempre:
 * é a pasta que a policy `pdfs owner insert` exige e que
 * `aplicar_anexos` reconfere no servidor.
 *
 * Exigência de PDF sem arquivo novo vira `valor: null`, que a RPC lê como
 * "mantém o que está gravado". É o que preserva o comportamento antigo,
 * em que o PDF só era revalidado quando o autor trocava o arquivo.
 */
export async function prepararAnexos(args: {
  exigencias: AnexoDaCategoria[];
  rascunho: RascunhoAnexos;
  ownerId: string;
}): Promise<AnexosPreparados> {
  const { exigencias, rascunho, ownerId } = args;
  const payload: AnexoParaEnvio[] = [];
  const enviados: string[] = [];

  for (const exigencia of ordenarAnexos(exigencias)) {
    const item = rascunho[exigencia.id] ?? {};

    if (exigencia.tipo === "video") {
      const url = (item.url ?? "").trim();
      payload.push({ anexo_id: exigencia.id, valor: url || null });
      continue;
    }

    const arquivo = item.arquivo ?? null;
    if (!arquivo) {
      payload.push({ anexo_id: exigencia.id, valor: null });
      continue;
    }

    const nomeSeguro = arquivo.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const caminho = `${ownerId}/${Date.now()}-${nomeSeguro}`;
    const { error } = await supabase.storage.from(PDF_BUCKET).upload(caminho, arquivo, {
      contentType: "application/pdf",
      upsert: false,
    });
    if (error) {
      // O que já subiu nesta tentativa sai antes de a mensagem chegar à
      // tela: o trabalho não foi gravado, então nada aponta para eles.
      await descartarDoStorage(enviados);
      throw new Error(`Não foi possível enviar o PDF de "${exigencia.titulo}".`);
    }
    enviados.push(caminho);
    payload.push({ anexo_id: exigencia.id, valor: caminho });
  }

  return { payload, enviados };
}

/**
 * Apaga do Storage os arquivos que deixaram de ser referenciados — o que
 * as RPCs devolvem depois de gravar.
 *
 * Best-effort de propósito: o registro já está certo, e falhar aqui só
 * deixa um arquivo órfão. URLs completas (formato legado, de quando o
 * bucket era público) são puladas — `storage.remove()` não entende URL, e
 * apagar às cegas alcançaria o objeto errado em outro bucket.
 */
export async function descartarDoStorage(caminhos: string[]): Promise<void> {
  const alvos = caminhos.filter((c) => c && !/^https?:\/\//i.test(c));
  if (alvos.length === 0) return;
  await supabase.storage.from(PDF_BUCKET).remove(alvos);
}

/**
 * O que uma RPC de escrita devolveu, normalizado.
 *
 * As quatro devolvem `text[]`. A conferência existe porque um bundle
 * velho falando com um banco novo (ou o contrário) devolveria outra
 * coisa, e `.filter` num não-array derruba a tela DEPOIS de a gravação
 * ter dado certo.
 */
export function caminhosDevolvidos(data: unknown): string[] {
  if (!Array.isArray(data)) return [];
  return data.filter((c): c is string => typeof c === "string" && c.length > 0);
}
