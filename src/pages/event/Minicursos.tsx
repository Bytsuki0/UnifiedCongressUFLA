import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/event/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Clock, MapPin, User, Users, CheckCircle2, XCircle } from "lucide-react";

const sb = supabase as any;

export default function Minicursos() {
  const { user } = useAuth();
  const uid = user!.id;
  const qc = useQueryClient();

  const list = useQuery({
    queryKey: ["minicourses"],
    queryFn: async () => (await sb.from("minicourses").select("*").order("data").order("horario_inicio")).data ?? [],
  });
  const myRegs = useQuery({
    queryKey: ["my-mini-regs", uid],
    queryFn: async () => (await sb.from("minicourse_registrations").select("minicourse_id").eq("user_id", uid)).data ?? [],
  });
  const counts = useQuery({
    queryKey: ["mini-counts"],
    queryFn: async () => {
      const { data } = await sb.from("minicourse_registrations").select("minicourse_id");
      const map: Record<string, number> = {};
      (data ?? []).forEach((r: any) => { map[r.minicourse_id] = (map[r.minicourse_id] ?? 0) + 1; });
      return map;
    },
  });

  const subscribe = useMutation({
    mutationFn: async (minicourse_id: string) => {
      const { error } = await sb.from("minicourse_registrations").insert({ user_id: uid, minicourse_id });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Inscrição confirmada!"); qc.invalidateQueries(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const unsub = useMutation({
    mutationFn: async (minicourse_id: string) => {
      const { error } = await sb.from("minicourse_registrations").delete().eq("user_id", uid).eq("minicourse_id", minicourse_id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Inscrição cancelada"); qc.invalidateQueries(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const enrolled = new Set(((myRegs.data ?? []) as any[]).map((r) => r.minicourse_id));

  return (
    <AppLayout>
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-3xl md:text-4xl font-extrabold"
            style={{ backgroundImage: "var(--gradient-primary)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            Minicursos
          </h1>
          <p className="mt-1 text-muted-foreground">Escolha seus minicursos. Conflitos de horário e vagas são validados automaticamente.</p>
        </div>

        {list.isLoading && <p className="text-muted-foreground">Carregando...</p>}
        {list.data?.length === 0 && <p className="text-muted-foreground">Nenhum minicurso cadastrado.</p>}

        <div className="grid gap-4 md:grid-cols-2">
          {list.data?.map((m: any) => {
            const taken = counts.data?.[m.id] ?? 0;
            const left = m.vagas - taken;
            const isIn = enrolled.has(m.id);
            return (
              <div key={m.id} className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5">
                <h3 className="text-lg font-bold">{m.nome}</h3>
                <p className="text-sm text-muted-foreground line-clamp-3">{m.descricao}</p>
                <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><User className="h-3 w-3" /> {m.ministrante}</span>
                  <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {m.data} {m.horario_inicio}</span>
                  <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {m.local}</span>
                  <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {left} vagas restantes</span>
                </div>
                {isIn ? (
                  <button onClick={() => unsub.mutate(m.id)} className="mt-2 flex items-center justify-center gap-2 rounded-xl border border-destructive px-4 py-2 text-sm text-destructive hover:bg-destructive/5">
                    <XCircle className="h-4 w-4" /> Cancelar inscrição
                  </button>
                ) : (
                  <button
                    onClick={() => subscribe.mutate(m.id)} disabled={left <= 0}
                    className="mt-2 flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    style={{ backgroundImage: "var(--gradient-primary)" }}
                  >
                    <CheckCircle2 className="h-4 w-4" /> {left <= 0 ? "Esgotado" : "Inscrever-se"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </AppLayout>
  );
}
