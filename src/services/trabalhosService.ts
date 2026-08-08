import { supabase } from "@/integrations/supabase/client";
import { PDF_BUCKET } from "@/lib/config";
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
  resumo: string;
  categoriaId: string;
  autores: string;
  orientadorEmail: string | null;
  coautores: Coautor[];
  /** PDF já validado (application/pdf, ≤ 10 MB) pelo chamador. */
  arquivo: File;
  ownerId: string;
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

/**
 * Move o status manualmente (Portal Admin). É a saída de emergência: o
 * caminho normal é a decisão consolidada dos pareceres definir o status
 * no servidor.
 */
export async function atualizarStatusDoTrabalho(id: string, status: string): Promise<void> {
  const { error } = await supabase.from("trabalhos").update({ status }).eq("id", id);
  if (error) throw error;
}

export async function excluirTrabalho(id: string): Promise<void> {
  const { error } = await supabase.from("trabalhos").delete().eq("id", id);
  if (error) throw error;
}

/**
 * Submissão do autor: sobe o PDF para a pasta do próprio usuário (exigida
 * pela policy do Storage), grava o trabalho e dispara a distribuição
 * automática de revisores.
 *
 * A distribuição é best-effort de propósito: roda numa RPC SECURITY
 * DEFINER porque o estudante não tem acesso às tabelas de revisores, e
 * uma falha ali não pode invalidar uma submissão já gravada.
 */
export async function submeterTrabalho(input: NovoTrabalho): Promise<string> {
  const nomeSeguro = input.arquivo.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const caminho = `${input.ownerId}/${Date.now()}-${nomeSeguro}`;

  const { error: erroUpload } = await supabase.storage
    .from(PDF_BUCKET)
    .upload(caminho, input.arquivo, {
      contentType: "application/pdf",
      upsert: false,
    });
  if (erroUpload) throw new Error("Erro ao enviar o PDF. Tente novamente.");

  const { data: novo, error } = await supabase
    .from("trabalhos")
    .insert({
      titulo: input.titulo,
      resumo: input.resumo,
      categoria_id: input.categoriaId,
      autores: input.autores,
      orientador_email: input.orientadorEmail,
      coautores: input.coautores,
      pdf_url: caminho,
      data_submissao: new Date().toISOString().split("T")[0],
      status: "pendente",
    })
    .select("id")
    .single();

  if (error || !novo) throw new Error("Erro ao submeter trabalho. Tente novamente.");

  try {
    await supabase.rpc("distribuir_revisores", { _trabalho_id: novo.id });
  } catch {
    /* distribuição automática silenciosa — não bloqueia o envio */
  }

  return novo.id;
}
