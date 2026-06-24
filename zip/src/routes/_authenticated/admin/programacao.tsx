import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, Trash2, Pencil } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/programacao")({
  head: () => ({ meta: [{ title: "Programação — Admin" }] }),
  component: AdminProg,
});

type Form = {
  id?: string; titulo: string; descricao: string; categoria: string;
  data: string; horario_inicio: string; horario_fim: string; local: string; palestrante: string;
};
const empty: Form = {
  titulo: "", descricao: "", categoria: "Palestra", data: "",
  horario_inicio: "09:00", horario_fim: "10:00", local: "", palestrante: "",
};

function AdminProg() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(empty);

  const list = useQuery({
    queryKey: ["admin-sched"],
    queryFn: async () => (await supabase.from("schedule").select("*").order("data").order("horario_inicio")).data ?? [],
  });
  const save = useMutation({
    mutationFn: async () => {
      const { id, ...rest } = form;
      if (id) { const { error } = await supabase.from("schedule").update(rest).eq("id", id); if (error) throw error; }
      else { const { error } = await supabase.from("schedule").insert(rest); if (error) throw error; }
    },
    onSuccess: () => { toast.success("Salvo"); setOpen(false); setForm(empty); qc.invalidateQueries(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("schedule").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { toast.success("Removido"); qc.invalidateQueries(); },
  });

  return (
    <AppLayout>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-3xl font-extrabold"
            style={{ backgroundImage: "var(--gradient-primary)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            Gestão da Programação
          </h1>
          <button onClick={() => { setForm(empty); setOpen(true); }}
            className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white"
            style={{ backgroundImage: "var(--gradient-primary)" }}>
            <Plus className="h-4 w-4" /> Nova atividade
          </button>
        </div>

        <div className="flex flex-col gap-2">
          {list.data?.map((s) => (
            <div key={s.id} className="flex items-center justify-between rounded-2xl border border-border bg-card p-4">
              <div>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">{s.categoria}</span>
                <p className="mt-1 font-semibold">{s.titulo}</p>
                <p className="text-xs text-muted-foreground">{s.data} • {s.horario_inicio}–{s.horario_fim} • {s.local} {s.palestrante && `• ${s.palestrante}`}</p>
              </div>
              <div className="flex gap-1">
                <button onClick={() => { setForm({ ...s, descricao: s.descricao ?? "", palestrante: s.palestrante ?? "" }); setOpen(true); }}
                  className="rounded-lg border border-border p-1.5"><Pencil className="h-3.5 w-3.5" /></button>
                <button onClick={() => confirm("Excluir?") && del.mutate(s.id)}
                  className="rounded-lg border border-destructive p-1.5 text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </div>
          ))}
        </div>

        {open && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
            <div onClick={(e) => e.stopPropagation()} className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-card p-6 shadow-xl">
              <h2 className="text-xl font-bold">{form.id ? "Editar" : "Nova"} atividade</h2>
              <div className="mt-4 flex flex-col gap-3">
                <FormField label="Título"><input className={inp} value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} /></FormField>
                <FormField label="Descrição"><textarea className={inp} rows={3} value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} /></FormField>
                <FormField label="Categoria">
                  <select className={inp} value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })}>
                    <option>Palestra</option><option>Oficina</option><option>Minicurso</option><option>Mesa redonda</option><option>Cerimônia</option>
                  </select>
                </FormField>
                <div className="grid grid-cols-3 gap-2">
                  <FormField label="Data"><input type="date" className={inp} value={form.data} onChange={(e) => setForm({ ...form, data: e.target.value })} /></FormField>
                  <FormField label="Início"><input type="time" className={inp} value={form.horario_inicio} onChange={(e) => setForm({ ...form, horario_inicio: e.target.value })} /></FormField>
                  <FormField label="Fim"><input type="time" className={inp} value={form.horario_fim} onChange={(e) => setForm({ ...form, horario_fim: e.target.value })} /></FormField>
                </div>
                <FormField label="Local"><input className={inp} value={form.local} onChange={(e) => setForm({ ...form, local: e.target.value })} /></FormField>
                <FormField label="Palestrante"><input className={inp} value={form.palestrante} onChange={(e) => setForm({ ...form, palestrante: e.target.value })} /></FormField>
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
