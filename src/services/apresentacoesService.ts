import { supabase } from "@/integrations/supabase/client";
import type {
  Agenda,
  ApresentacaoPublica,
  EnvioApresentacao,
  ItemSalvar,
} from "@/lib/apresentacoes";

/**
 * Cronograma de apresentações (migration 20261104120000): dia, horário,
 * sala e formato de cada trabalho aprovado.
 *
 * Duas leituras, como no cronograma do evento:
 *
 *   · `carregarApresentacoesPublicas()` — a landing (SEM sessão),
 *     /apresentacoes e /estudante/apresentacoes. Vai pela RPC
 *     `apresentacoes_publicas()`, aberta a `anon`; as tabelas continuam
 *     fechadas para quem não é da organização. Com sessão, a RPC diz em
 *     `meu` quais trabalhos são de quem está logado.
 *   · `carregarAdminCA()` — só o AdminCA. Lê as TABELAS, porque quem edita
 *     precisa que um erro apareça.
 *
 * E uma escrita só, `salvarCronogramaApresentacoes()`: o botão Salvar
 * inteiro numa RPC, que é também quem decide quais autores recebem e-mail.
 */

/** Os status que se apresentam — a mesma régua das RPCs. */
export const STATUS_APRESENTAVEIS = ["aprovado", "aprovado_correcoes"];

/**
 * O cronograma como o visitante o vê, em ordem de dia, início e sala (a
 * ordem vem da RPC).
 *
 * Falha devolve lista vazia, e não um erro na tela: é conteúdo informativo
 * da landing, e uma consulta que não respondeu não pode derrubar a página
 * inicial — a seção simplesmente não aparece. (Mesma escolha de
 * `carregarCronogramaPublico`.)
 */
export async function carregarApresentacoesPublicas(): Promise<ApresentacaoPublica[]> {
  const { data, error } = await supabase.rpc("apresentacoes_publicas");
  if (error) return [];
  return data ?? [];
}

/** Um trabalho aprovado, como o AdminCA o lista. Sem `owner_id` = sem a quem avisar. */
export type TrabalhoAgendavel = {
  id: string;
  titulo: string;
  autores: string;
  categoria_id: string | null;
  owner_id: string | null;
};

/** Uma agenda gravada, com as duas marcas do e-mail. Horas como o banco devolve. */
export type ApresentacaoGravada = Agenda & {
  id: string;
  trabalho_id: string;
  aviso_solicitado_em: string | null;
  aviso_reservado_em: string | null;
};

export type CategoriaComTipo = { id: string; nome: string; tipo_apresentacao: string };

export type DadosAdminCA = {
  trabalhos: TrabalhoAgendavel[];
  categorias: CategoriaComTipo[];
  apresentacoes: ApresentacaoGravada[];
  envios: EnvioApresentacao[];
};

/**
 * Tudo o que o AdminCA mostra, numa tacada. A RLS só entrega isto à
 * organização.
 *
 * Os envios vêm limitados aos mais recentes: o PostgREST corta em 1000
 * linhas, e para o selo de cada trabalho só o último envio dele importa.
 */
export async function carregarAdminCA(): Promise<DadosAdminCA> {
  const [t, c, a, e] = await Promise.all([
    supabase
      .from("trabalhos")
      .select("id, titulo, autores, categoria_id, owner_id")
      .in("status", STATUS_APRESENTAVEIS)
      .order("titulo"),
    supabase.from("categorias").select("id, nome, tipo_apresentacao").order("nome"),
    supabase
      .from("apresentacoes")
      .select("id, trabalho_id, data, hora_inicio, hora_fim, sala, aviso_solicitado_em, aviso_reservado_em"),
    supabase
      .from("envios_apresentacoes")
      .select("id, trabalhos_ids, status, erro, criado_em, concluido_em")
      .order("criado_em", { ascending: false })
      .limit(1000),
  ]);

  if (t.error || c.error || a.error || e.error) {
    throw t.error ?? c.error ?? a.error ?? e.error;
  }

  return {
    trabalhos: t.data ?? [],
    categorias: c.data ?? [],
    apresentacoes: a.data ?? [],
    envios: (e.data ?? []) as EnvioApresentacao[],
  };
}

/**
 * O botão Salvar do AdminCA: os tipos que mudaram e as agendas novas,
 * alteradas ou removidas, numa transação só. Devolve quantos trabalhos
 * ficaram com informação nova — os e-mails que vão sair.
 *
 * Recusa (trabalho não aprovado, horário invertido, quem chama não é da
 * organização) sobe como `Error` com a frase do banco, que diz QUAL trabalho;
 * nada é gravado nesse caso.
 */
export async function salvarCronogramaApresentacoes(
  tipos: { categoria_id: string; tipo: string }[],
  itens: ItemSalvar[],
): Promise<number> {
  const { data, error } = await supabase.rpc("salvar_cronograma_apresentacoes", {
    _tipos: tipos,
    _apresentacoes: itens,
  });
  if (error) throw new Error(error.message);
  return data ?? 0;
}
