import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppLayout } from "@/components/event/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, Trash2, Pencil, Users } from "lucide-react";

const sb = supabase as any;

type Form = {
  id?: string; nome: string; descricao: string; ministrante: string;
  data: string; horario_inicio: string; horario_fim: string;
  local: string; vagas: number; carga_horaria: number;
};

const empty: Form = {
  nome: "", descricao: "", ministrante: "", data: "", horario_inicio: "09:00",
  horario_fim: "11:00", local: "", vagas: 20, carga_horaria: 2,
};

export default function AdminMinicursos() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(empty);

  const list = useQuery({
    queryKey: ["admin-minis"],
    queryFn: async () => (await sb.from("minicourses").select("*").order("data")).data ?? [],
  });
  const regs = useQuery({
    queryKey: ["mini-counts"],
    queryFn: async () => {
      const { data } = await sb.from("minicourse_registrations").select("minicourse_id");
      const map: Record<string, number> = {};
      (data ?? []).forEach((r: any) => { map[r.minicourse_id] = (map[r.minicourse_id] ?? 0) + 1; });
      return map;
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const { id, ...rest } = form;
      if (id) {
        const { error } = await sb.from("minicourses").update(rest).eq("id", id);
        if (error) throw error;
      } else {
        const { error } = await sb.from("minicourses").insert(rest);
        if (error) throw error;
      }
    },
    onSuccess: () => { toast.success("Salvo"); setOpen(false); setForm(empty); qc.invalidateQueries({ queryKey: ["admin-minis"] }); qc.invalidateQueries({ queryKey: ["minicourses"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb.from("minicourses").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Removido"); qc.invalidateQueries({ queryKey: ["admin-minis"] }); },
  });

  return (
    <AppLayout>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-3xl font-extrabold"
            style={{ backgroundImage: "var(--gradient-primary)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            Gestão de Minicursos
          </h1>
          <button onClick={() => { setForm(empty); setOpen(true); }}
            className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white"
            style={{ backgroundImage: "var(--gradient-primary)" }}>
            <Plus className="h-4 w-4" /> Novo minicurso
          </button>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {list.data?.map((m: any) => (
            <div key={m.id} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-bold">{m.nome}</h3>
                  <p className="text-xs text-muted-foreground">{m.ministrante} • {m.data} {m.horario_inicio}–{m.horario_fim} • {m.local}</p>
                  <p className="mt-1 flex items-center gap-1 text-xs text-primary"><Users className="h-3 w-3" /> {regs.data?.[m.id] ?? 0}/{m.vagas} vagas</p>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => { setForm({ ...m, descricao: m.descricao ?? "" }); setOpen(true); }}
                    className="rounded-lg border border-border p-1.5 hover:bg-accent/30"><Pencil className="h-3.5 w-3.5" /></button>
                  <button onClick={() => confirm("Excluir?") && del.mutate(m.id)}
                    className="rounded-lg border border-destructive p-1.5 text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {open && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
            <div onClick={(e) => e.stopPropagation()} className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-card p-6 shadow-xl">
              <h2 className="text-xl font-bold">{form.id ? "Editar" : "Novo"} minicurso</h2>
              <div className="mt-4 flex flex-col gap-3">
                <FormField label="Nome"><input className={inp} value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></FormField>
                <FormField label="Descrição"><textarea className={inp} rows={3} value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} /></FormField>
                <FormField label="Ministrante"><input className={inp} value={form.ministrante} onChange={(e) => setForm({ ...form, ministrante: e.target.value })} /></FormField>
                <div className="grid grid-cols-3 gap-2">
                  <FormField label="Data"><input type="date" className={inp} value={form.data} onChange={(e) => setForm({ ...form, data: e.target.value })} /></FormField>
                  <FormField label="Início"><input type="time" className={inp} value={form.horario_inicio} onChange={(e) => setForm({ ...form, horario_inicio: e.target.value })} /></FormField>
                  <FormField label="Fim"><input type="time" className={inp} value={form.horario_fim} onChange={(e) => setForm({ ...form, horario_fim: e.target.value })} /></FormField>
                </div>
                <FormField label="Local"><input className={inp} value={form.local} onChange={(e) => setForm({ ...form, local: e.target.value })} /></FormField>
                <div className="grid grid-cols-2 gap-2">
                  <FormField label="Vagas"><input type="number" className={inp} value={form.vagas} onChange={(e) => setForm({ ...form, vagas: +e.target.value })} /></FormField>
                  <FormField label="Carga horária"><input type="number" className={inp} value={form.carga_horaria} onChange={(e) => setForm({ ...form, carga_horaria: +e.target.value })} /></FormField>
                </div>
                <div className="mt-2 flex justify-end gap-2">
                  <button onClick={() => setOpen(false)} className="rounded-xl border border-border px-4 py-2 text-sm">Cancelar</button>
                  <button onClick={() => save.mutate()} disabled={save.isPending}
                    className="rounded-xl px-4 py-2 text-sm font-semibold text-white" style={{ backgroundImage: "var(--gradient-primary)" }}>
                    {save.isPending ? "Salvando..." : "Salvar"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}

const inp = "w-full rounded-xl border border-input bg-background px-3 py-2 text-sm";
function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-1 text-sm"><span className="font-medium">{label}</span>{children}</label>;
}
