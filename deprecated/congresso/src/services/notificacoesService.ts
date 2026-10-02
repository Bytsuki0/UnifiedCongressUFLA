import { supabase } from "@/integrations/supabase/client";

/**
 * Notificações do congresso e o controle de lidas por usuário.
 *
 * `notifications` é escrita só pela organização; `notification_reads`
 * guarda uma linha por (usuário, notificação) e é do próprio usuário —
 * ambas as regras são do RLS.
 */

export type Notificacao = {
  id: string;
  title: string;
  body: string;
  link: string | null;
  audience: "user" | "all";
  created_at: string;
};

/** Últimas notificações + o conjunto de ids que este usuário já leu. */
export async function carregarNotificacoes(userId: string): Promise<{
  itens: Notificacao[];
  lidas: Set<string>;
}> {
  const [notificacoes, lidas] = await Promise.all([
    supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(30),
    supabase.from("notification_reads").select("notification_id").eq("user_id", userId),
  ]);
  if (notificacoes.error || lidas.error) throw notificacoes.error ?? lidas.error;
  return {
    itens: (notificacoes.data ?? []) as Notificacao[],
    lidas: new Set((lidas.data ?? []).map((x) => x.notification_id)),
  };
}

export async function marcarComoLida(userId: string, notificacaoId: string): Promise<void> {
  const { error } = await supabase
    .from("notification_reads")
    .insert({ user_id: userId, notification_id: notificacaoId });
  if (error) throw error;
}

export async function marcarVariasComoLidas(
  userId: string,
  notificacaoIds: string[],
): Promise<void> {
  if (notificacaoIds.length === 0) return;
  const { error } = await supabase
    .from("notification_reads")
    .insert(notificacaoIds.map((id) => ({ user_id: userId, notification_id: id })));
  if (error) throw error;
}

/**
 * Assina mudanças em `notifications` e chama `aoMudar` a cada evento.
 * Devolve a função de cancelamento, para o efeito do React desmontar
 * o canal.
 */
export function assinarNotificacoes(aoMudar: () => void): () => void {
  const canal = supabase
    .channel("notifications-bell")
    .on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, aoMudar)
    .subscribe();
  return () => {
    supabase.removeChannel(canal);
  };
}

// ---------------------------------------------------------------------
// Lado da organização
// ---------------------------------------------------------------------

/** Últimas notificações enviadas, para o painel admin. */
export async function listarNotificacoesAdmin(): Promise<Notificacao[]> {
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as Notificacao[];
}

export type EnvioParaTodos = {
  alvo: "todos";
  titulo: string;
  corpo: string;
  link: string | null;
  autorId: string;
};

export type EnvioParaEvento = {
  alvo: "minicourse" | "schedule";
  eventoId: string;
  titulo: string;
  corpo: string;
  link: string | null;
  autorId: string;
};

/** Erro de "não há para quem enviar", para o chamador avisar sem estourar. */
export class SemDestinatariosError extends Error {
  constructor() {
    super("Nenhum participante para esse evento");
    this.name = "SemDestinatariosError";
  }
}

/**
 * Envia uma notificação para todos ou para os inscritos num evento.
 *
 * Para "todos" grava UMA linha com audience 'all' — não uma por usuário.
 * Para um evento, resolve os inscritos e grava uma linha por pessoa,
 * porque é assim que o sino sabe o que é dela.
 */
export async function enviarNotificacao(
  envio: EnvioParaTodos | EnvioParaEvento,
): Promise<void> {
  const base = {
    title: envio.titulo,
    body: envio.corpo,
    link: envio.link,
    created_by: envio.autorId,
  };

  if (envio.alvo === "todos") {
    const { error } = await supabase
      .from("notifications")
      .insert({ ...base, audience: "all" });
    if (error) throw error;
    return;
  }

  const inscritos =
    envio.alvo === "minicourse"
      ? await supabase
          .from("minicourse_registrations")
          .select("user_id")
          .eq("minicourse_id", envio.eventoId)
          .neq("status", "cancelled")
      : await supabase.from("congress_registrations").select("user_id");
  if (inscritos.error) throw inscritos.error;

  const userIds = Array.from(
    new Set((inscritos.data ?? []).map((r) => r.user_id)),
  ).filter(Boolean);
  if (userIds.length === 0) throw new SemDestinatariosError();

  const { error } = await supabase
    .from("notifications")
    .insert(userIds.map((id) => ({ ...base, audience: "user", user_id: id })));
  if (error) throw error;
}

export async function excluirNotificacao(id: string): Promise<void> {
  const { error } = await supabase.from("notifications").delete().eq("id", id);
  if (error) throw error;
}
