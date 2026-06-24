import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Check, X, Trash2, Download } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/inscricoes")({
  head: () => ({ meta: [{ title: "Inscrições — Admin" }] }),
  component: AdminInscricoes,
});

function AdminInscricoes() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["admin-regs"],
    queryFn: async () =>
      (await supabase
        .from("congress_registrations")
        .select("id, status, created_at, profiles(nome, email, instituicao)")
        .order("created_at", { ascending: false })).data ?? [],
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "approved" | "cancelled" | "pending" }) => {
      const { error } = await supabase.from("congress_registrations").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Atualizado"); qc.invalidateQueries({ queryKey: ["admin-regs"] }); },
  });
  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("congress_registrations").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Removido"); qc.invalidateQueries({ queryKey: ["admin-regs"] }); },
  });

  const exportCsv = () => {
    const rows = (data ?? []).map((r) => `"${r.profiles?.nome ?? ""}","${r.profiles?.email ?? ""}","${r.status}"`);
    const csv = "nome,email,status\n" + rows.join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "inscricoes.csv"; a.click();
  };

  return (
    <AppLayout>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-3xl font-extrabold"
            style={{ backgroundImage: "var(--gradient-primary)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            Inscrições no Congresso
          </h1>
          <button onClick={exportCsv} className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm hover:bg-accent/30">
            <Download className="h-4 w-4" /> Exportar CSV
          </button>
        </div>
        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase">
              <tr>
                <th className="p-3 text-left">Participante</th>
                <th className="p-3 text-left">E-mail</th>
                <th className="p-3 text-left">Instituição</th>
                <th className="p-3 text-left">Status</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {data?.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="p-3">{r.profiles?.nome}</td>
                  <td className="p-3 text-muted-foreground">{r.profiles?.email}</td>
                  <td className="p-3">{r.profiles?.instituicao}</td>
                  <td className="p-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${
                      r.status === "approved" ? "bg-success/30 text-success-foreground" :
                      r.status === "cancelled" ? "bg-destructive/15 text-destructive" : "bg-muted"
                    }`}>{r.status}</span>
                  </td>
                  <td className="p-3 text-right">
                    <button onClick={() => setStatus.mutate({ id: r.id, status: "approved" })} className="mr-1 inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs"><Check className="h-3 w-3" /></button>
                    <button onClick={() => setStatus.mutate({ id: r.id, status: "cancelled" })} className="mr-1 inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs"><X className="h-3 w-3" /></button>
                    <button onClick={() => del.mutate(r.id)} className="inline-flex items-center gap-1 rounded-lg border border-destructive px-2 py-1 text-xs text-destructive"><Trash2 className="h-3 w-3" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppLayout>
  );
}
