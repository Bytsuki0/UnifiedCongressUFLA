import { useEffect, useState } from "react";
import { Bell, Check, X } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const sb = supabase as any;

type Notif = {
  id: string;
  title: string;
  body: string;
  link: string | null;
  audience: "user" | "all";
  created_at: string;
};

export function NotificationsBell() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notif[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());

  const load = async () => {
    if (!user) return;
    const [{ data: n }, { data: r }] = await Promise.all([
      sb.from("notifications").select("*").order("created_at", { ascending: false }).limit(30),
      sb.from("notification_reads").select("notification_id").eq("user_id", user.id),
    ]);
    setItems((n ?? []) as Notif[]);
    setReadIds(new Set((r ?? []).map((x: any) => x.notification_id)));
  };

  useEffect(() => {
    if (!user) return;
    load();
    const ch = supabase
      .channel("notifications-bell")
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const unread = items.filter((i) => !readIds.has(i.id));

  const markRead = async (id: string) => {
    if (!user) return;
    setReadIds((s) => new Set(s).add(id));
    await sb.from("notification_reads").insert({ user_id: user.id, notification_id: id });
  };

  const markAll = async () => {
    if (!user) return;
    const toInsert = unread.map((i) => ({ user_id: user.id, notification_id: i.id }));
    if (toInsert.length === 0) return;
    setReadIds(new Set([...readIds, ...toInsert.map((x) => x.notification_id)]));
    await sb.from("notification_reads").insert(toInsert);
  };

  if (!user) return null;

  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)}
        className="relative rounded-xl border border-border bg-card p-2 hover:bg-accent/40">
        <Bell className="h-5 w-5" />
        {unread.length > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full bg-destructive px-1 text-[10px] font-bold text-white flex items-center justify-center">
            {unread.length > 9 ? "9+" : unread.length}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 w-80 max-h-[70vh] overflow-y-auto rounded-2xl border border-border bg-card shadow-lg z-50">
            <div className="flex items-center justify-between p-3 border-b border-border">
              <span className="font-semibold text-sm">Notificações</span>
              <div className="flex items-center gap-2">
                {unread.length > 0 && (
                  <button onClick={markAll} className="text-xs text-primary hover:underline flex items-center gap-1">
                    <Check className="h-3 w-3" /> Marcar todas
                  </button>
                )}
                <button onClick={() => setOpen(false)} className="text-muted-foreground">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            {items.length === 0 && (
              <div className="p-6 text-center text-sm text-muted-foreground">Nada por aqui ainda.</div>
            )}
            <ul className="divide-y divide-border">
              {items.map((n) => {
                const isUnread = !readIds.has(n.id);
                const content = (
                  <div className={`p-3 ${isUnread ? "bg-primary/5" : ""}`}>
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium text-sm">{n.title}</span>
                      {isUnread && <span className="h-2 w-2 rounded-full bg-primary shrink-0 mt-1.5" />}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">{n.body}</p>
                    <p className="text-[10px] text-muted-foreground mt-2">
                      {new Date(n.created_at).toLocaleString("pt-BR")}
                    </p>
                  </div>
                );
                return (
                  <li key={n.id} onClick={() => markRead(n.id)}>
                    {n.link ? <Link to={n.link} onClick={() => setOpen(false)}>{content}</Link> : content}
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
