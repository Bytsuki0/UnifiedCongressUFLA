import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Shield, ShieldOff, Trash2, Download } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/usuarios")({
  head: () => ({ meta: [{ title: "Usuários — Admin" }] }),
  component: AdminUsuarios,
});

function AdminUsuarios() {
  const qc = useQueryClient();
  const { data: users } = useQuery({
    queryKey: ["admin-users"],
    queryFn: async () => {
      const [{ data: profiles }, { data: roles }] = await Promise.all([
        supabase.from("profiles").select("*").order("created_at", { ascending: false }),
        supabase.from("user_roles").select("user_id, role"),
      ]);
      const map = new Map<string, string[]>();
      (roles ?? []).forEach((r) => {
        const arr = map.get(r.user_id) ?? [];
        arr.push(r.role); map.set(r.user_id, arr);
      });
      return (profiles ?? []).map((p) => ({ ...p, roles: map.get(p.id) ?? [] }));
    },
  });

  const toggleAdmin = useMutation({
    mutationFn: async ({ uid, makeAdmin }: { uid: string; makeAdmin: boolean }) => {
      if (makeAdmin) {
        const { error } = await supabase.from("user_roles").insert({ user_id: uid, role: "admin" });
        if (error) throw error;
      } else {
        const { error } = await supabase.from("user_roles").delete().eq("user_id", uid).eq("role", "admin");
        if (error) throw error;
      }
    },
    onSuccess: () => { toast.success("Permissão atualizada"); qc.invalidateQueries({ queryKey: ["admin-users"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: async (uid: string) => {
      const { error } = await supabase.from("profiles").delete().eq("id", uid);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Usuário removido"); qc.invalidateQueries({ queryKey: ["admin-users"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const exportCsv = () => {
    if (!users) return;
    const headers = ["nome", "cpf", "email", "telefone", "instituicao", "curso"];
    const rows = users.map((u) => headers.map((h) => `"${(u as Record<string, unknown>)[h] ?? ""}"`).join(","));
    const csv = headers.join(",") + "\n" + rows.join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "usuarios.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AppLayout>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-3xl font-extrabold"
            style={{ backgroundImage: "var(--gradient-primary)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            Usuários
          </h1>
          <button onClick={exportCsv} className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm hover:bg-accent/30">
            <Download className="h-4 w-4" /> Exportar CSV
          </button>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase">
              <tr>
                <th className="p-3 text-left">Nome</th>
                <th className="p-3 text-left">E-mail</th>
                <th className="p-3 text-left">Instituição</th>
                <th className="p-3 text-left">Papel</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {users?.map((u) => {
                const isAdmin = u.roles.includes("admin");
                return (
                  <tr key={u.id} className="border-t border-border">
                    <td className="p-3">{u.nome}</td>
                    <td className="p-3 text-muted-foreground">{u.email}</td>
                    <td className="p-3">{u.instituicao}</td>
                    <td className="p-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${isAdmin ? "bg-primary/15 text-primary" : "bg-muted"}`}>
                        {isAdmin ? "Admin" : "Participante"}
                      </span>
                    </td>
                    <td className="p-3 text-right">
                      <button
                        onClick={() => toggleAdmin.mutate({ uid: u.id, makeAdmin: !isAdmin })}
                        className="mr-2 inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs hover:bg-accent/30"
                      >
                        {isAdmin ? <><ShieldOff className="h-3 w-3" /> Remover admin</> : <><Shield className="h-3 w-3" /> Tornar admin</>}
                      </button>
                      <button
                        onClick={() => confirm("Excluir usuário?") && del.mutate(u.id)}
                        className="inline-flex items-center gap-1 rounded-lg border border-destructive px-2 py-1 text-xs text-destructive hover:bg-destructive/5"
                      >
                        <Trash2 className="h-3 w-3" /> Excluir
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </AppLayout>
  );
}
