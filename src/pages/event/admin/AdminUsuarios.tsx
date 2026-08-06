import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/event/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Trash2, Download } from "lucide-react";

const sb = supabase;

// Participante externo: sem tabela institucional, vive só em profiles.
type ExternoRow = {
  id: string;
  nome: string | null;
  email: string | null;
  instituicao: string | null;
  created_at?: string;
};

type Row = {
  id: string;
  nome: string;
  email: string;
  detalhe: string; // curso / departamento / instituição
  tipo: "Estudante" | "Professor" | "Avaliador" | "Externo";
  source: "estudantes" | "professores" | "avaliadores" | "profiles";
  created_at?: string;
};

export default function AdminUsuarios() {
  const qc = useQueryClient();
  const { data: users } = useQuery<Row[]>({
    queryKey: ["admin-users"],
    queryFn: async () => {
      // Contas de administrador vêm de user_roles (não de e-mail
      // hardcoded) e nunca são listadas aqui. Contas externas não têm
      // tabela de perfil institucional — vêm de profiles + user_roles.
      const [est, prof, aval, admins, externoRoles] = await Promise.all([
        sb.from("estudantes").select("id, user_id, nome, email, curso, created_at"),
        sb.from("professores").select("id, user_id, nome, email, departamento, created_at"),
        sb.from("avaliadores").select("id, nome, email, instituicao, created_at"),
        sb.from("user_roles").select("user_id").eq("role", "admin"),
        sb.from("user_roles").select("user_id").eq("role", "externo"),
      ]);
      const adminIds = new Set(((admins.data ?? []) as { user_id: string }[]).map((r) => r.user_id));

      // user_roles não tem FK para profiles (ambos apontam para auth.users),
      // então os dados do participante externo vêm em uma segunda consulta.
      const externoIds = ((externoRoles.data ?? []) as { user_id: string }[])
        .map((r) => r.user_id)
        .filter((id) => !adminIds.has(id));
      const externos: ExternoRow[] = externoIds.length
        ? (await sb.from("profiles").select("id, nome, email, instituicao, created_at").in("id", externoIds)).data ?? []
        : [];
      const rows: Row[] = [
        ...(est.data ?? [])
          .filter((u) => !adminIds.has(u.user_id))
          .map((u) => ({
            id: u.id, nome: u.nome, email: u.email, detalhe: u.curso ?? "",
            tipo: "Estudante" as const, source: "estudantes" as const, created_at: u.created_at,
          })),
        ...(prof.data ?? [])
          .filter((u) => !adminIds.has(u.user_id))
          .map((u) => ({
            id: u.id, nome: u.nome, email: u.email, detalhe: u.departamento ?? "",
            tipo: "Professor" as const, source: "professores" as const, created_at: u.created_at,
          })),
        ...(aval.data ?? []).map((u) => ({
          id: u.id, nome: u.nome, email: u.email, detalhe: u.instituicao ?? "",
          tipo: "Avaliador" as const, source: "avaliadores" as const, created_at: u.created_at,
        })),
        ...externos.map((u) => ({
          id: u.id, nome: u.nome ?? "", email: u.email ?? "", detalhe: u.instituicao ?? "",
          tipo: "Externo" as const, source: "profiles" as const, created_at: u.created_at,
        })),
      ];
      return rows.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
    },
  });

  const del = useMutation({
    mutationFn: async (u: Row) => {
      const { error } = await sb.from(u.source).delete().eq("id", u.id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Usuário removido"); qc.invalidateQueries({ queryKey: ["admin-users"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const exportCsv = () => {
    if (!users) return;
    const headers = ["nome", "email", "tipo", "detalhe"];
    const rows = users.map((u) => headers.map((h) => `"${(u as Record<string, unknown>)[h] ?? ""}"`).join(","));
    const csv = headers.join(",") + "\n" + rows.join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "usuarios.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const tipoBadge = (tipo: Row["tipo"]) => {
    const map: Record<Row["tipo"], string> = {
      Estudante: "bg-muted",
      Professor: "bg-primary/15 text-primary",
      Avaliador: "bg-success/15 text-success",
      Externo: "bg-accent/40",
    };
    return map[tipo];
  };

  return (
    <AppLayout>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl font-extrabold"
              style={{ backgroundImage: "var(--gradient-primary)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              Usuários
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {users ? `${users.length} usuário(s) cadastrado(s)` : "Carregando..."}
            </p>
          </div>
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
                <th className="p-3 text-left">Curso / Departamento</th>
                <th className="p-3 text-left">Perfil</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {users?.map((u) => (
                <tr key={`${u.source}-${u.id}`} className="border-t border-border">
                  <td className="p-3">{u.nome}</td>
                  <td className="p-3 text-muted-foreground">{u.email}</td>
                  <td className="p-3">{u.detalhe || "—"}</td>
                  <td className="p-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${tipoBadge(u.tipo)}`}>{u.tipo}</span>
                  </td>
                  <td className="p-3 text-right">
                    <button
                      onClick={() => confirm(`Excluir ${u.nome}?`) && del.mutate(u)}
                      className="inline-flex items-center gap-1 rounded-lg border border-destructive px-2 py-1 text-xs text-destructive hover:bg-destructive/5"
                    >
                      <Trash2 className="h-3 w-3" /> Excluir
                    </button>
                  </td>
                </tr>
              ))}
              {users && users.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-muted-foreground">Nenhum usuário cadastrado.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AppLayout>
  );
}
