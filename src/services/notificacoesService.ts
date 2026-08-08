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
