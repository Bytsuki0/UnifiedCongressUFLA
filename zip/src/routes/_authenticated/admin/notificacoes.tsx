import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Bell, Send, Trash2, Users, User as UserIcon } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/notificacoes")({
  head: () => ({ meta: [{ title: "Notificações — Admin" }] }),
  component: AdminNotif,
});

function AdminNotif() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [link, setLink] = useState("");
  const [audience, setAudience] = useState<"all" | "event">("all");
  const [eventType, setEventType] = useState<"minicourse" | "schedule">("minicourse");
  const [eventId, setEventId] = useState("");
  const [sending, setSending] = useState(false);

  const { data: list } = useQuery({
    queryKey: ["admin-notifs"],
    queryFn: async () =>
      (await supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(100)).data ?? [],
  });

  const { data: minicourses } = useQuery({
    queryKey: ["mc-list"],
    queryFn: async () => {
      const { data } = await supabase.from("minicourses").select("id, nome");
      return (data ?? []).map((m: any) => ({ id: m.id, titulo: m.nome }));
    },
  });
  const { data: schedule } = useQuery({
    queryKey: ["sch-list"],
    queryFn: async () => (await supabase.from("schedule").select("id, titulo")).data ?? [],
  });

  const send = async () => {
    if (!title.trim() || !body.trim()) { toast.error("Preencha título e corpo"); return; }
    setSending(true);
    try {
      if (audience === "all") {
        const { error } = await supabase.from("notifications").insert({
          title, body, link: link || null, audience: "all", created_by: user!.id,
        });
        if (error) throw error;
      } else {
        if (!eventId) { toast.error("Selecione o evento"); setSending(false); return; }
        const regsRes = eventType === "minicourse"
          ? await supabase.from("minicourse_registrations").select("user_id").eq("minicourse_id", eventId).neq("status", "cancelled")
          : await supabase.from("congress_registrations").select("user_id");
        if (regsRes.error) throw regsRes.error;
        const userIds = Array.from(new Set((regsRes.data ?? []).map((r: any) => r.user_id))).filter(Boolean);
        if (userIds.length === 0) { toast.error("Nenhum participante para esse evento"); setSending(false); return; }
        const rows = userIds.map((uid) => ({
          title, body, link: link || null, audience: "user", user_id: uid, created_by: user!.id,
        }));
        const { error } = await supabase.from("notifications").insert(rows);
        if (error) throw error;
      }
      toast.success("Notificação enviada");
      setTitle(""); setBody(""); setLink("");
      qc.invalidateQueries({ queryKey: ["admin-notifs"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao enviar");
    } finally {
      setSending(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Excluir esta notificação?")) return;
    const { error } = await supabase.from("notifications").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Excluída");
    qc.invalidateQueries({ queryKey: ["admin-notifs"] });
  };

  return (
    <AppLayout>
      <div className="flex flex-col gap-6 max-w-3xl">
        <div>
          <h1 className="text-3xl font-extrabold"
            style={{ backgroundImage: "var(--gradient-primary)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            Notificações
          </h1>
          <p className="text-sm text-muted-foreground">Envie avisos in-app para todos ou para inscritos de um evento.</p>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
          <div className="flex gap-2">
            <button onClick={() => setAudience("all")}
              className={`flex-1 flex items-center justify-center gap-2 rounded-xl border p-2 text-sm ${audience === "all" ? "border-primary bg-primary/10 text-primary" : "border-border"}`}>
              <Users className="h-4 w-4" /> Todos
            </button>
            <button onClick={() => setAudience("event")}
              className={`flex-1 flex items-center justify-center gap-2 rounded-xl border p-2 text-sm ${audience === "event" ? "border-primary bg-primary/10 text-primary" : "border-border"}`}>
              <UserIcon className="h-4 w-4" /> Inscritos de um evento
            </button>
          </div>

          {audience === "event" && (
            <div className="grid grid-cols-2 gap-2">
              <select value={eventType} onChange={(e) => { setEventType(e.target.value as any); setEventId(""); }}
                className="rounded-xl border border-input bg-background px-3 py-2 text-sm">
                <option value="minicourse">Minicurso</option>
                <option value="schedule">Programação (congresso)</option>
              </select>
              <select value={eventId} onChange={(e) => setEventId(e.target.value)}
                className="rounded-xl border border-input bg-background px-3 py-2 text-sm">
                <option value="">Selecione…</option>
                {eventType === "minicourse"
                  ? (minicourses ?? []).map((m: any) => <option key={m.id} value={m.id}>{m.titulo}</option>)
                  : (schedule ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.titulo}</option>)}
              </select>
              {eventType === "schedule" && (
                <p className="col-span-2 text-xs text-muted-foreground">A programação envia para todos os inscritos no congresso.</p>
              )}
            </div>
          )}

          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título"
            className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm" />
          <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Mensagem" rows={4}
            className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm resize-none" />
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Link opcional (ex: /programacao)"
            className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm" />

          <button onClick={send} disabled={sending}
            className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
            style={{ backgroundImage: "var(--gradient-primary)" }}>
            <Send className="h-4 w-4" /> {sending ? "Enviando…" : "Enviar"}
          </button>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5">
          <h2 className="font-semibold mb-3 flex items-center gap-2"><Bell className="h-4 w-4" /> Enviadas</h2>
          {(!list || list.length === 0) && <p className="text-sm text-muted-foreground">Nenhuma notificação ainda.</p>}
          <ul className="divide-y divide-border">
            {list?.map((n: any) => (
              <li key={n.id} className="py-3 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{n.title}</span>
                    <span className="text-[10px] rounded-full bg-muted px-2 py-0.5">
                      {n.audience === "all" ? "Todos" : "Inscritos"}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{n.body}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">{new Date(n.created_at).toLocaleString("pt-BR")}</p>
                </div>
                <button onClick={() => remove(n.id)} className="text-destructive hover:opacity-70">
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </AppLayout>
  );
}
