import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import type { UserRole } from "@/contexts/AuthContext";

// integrations/supabase/types.ts é anterior às migrações de segurança
// (user_roles.role virou TEXT), por isso o acesso destas tabelas é destipado.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

// Papéis atribuíveis. Precisa bater com o CHECK de public.user_roles.
const ROLES: { value: UserRole; label: string; hint: string }[] = [
  { value: "admin", label: "Admin", hint: "Acesso total, incluindo esta tela" },
  { value: "avaliador", label: "Avaliador", hint: "Co-chair: gestão do congresso e rankings" },
  { value: "professor", label: "Professor", hint: "Painel de revisão de trabalhos" },
  { value: "estudante", label: "Estudante", hint: "Portal de submissões" },
  { value: "externo", label: "Externo", hint: "Somente a área do congresso" },
];

type Conta = {
  id: string;
  nome: string | null;
  email: string | null;
  roles: UserRole[];
};

/**
 * Gestão de papéis. Vive no Portal Admin (/admin/papeis) porque conceder
 * `avaliador`/`professor` é o que coloca a conta no pool de revisores —
 * as telas de Atribuições e o portal do revisor leem de `user_roles`.
 */
export function PapeisPanel() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");

  const { data: contas, isLoading } = useQuery<Conta[]>({
    queryKey: ["admin-papeis"],
    queryFn: async () => {
      const [{ data: profiles }, { data: roles }] = await Promise.all([
        sb.from("profiles").select("id, nome, email").order("nome"),
        sb.from("user_roles").select("user_id, role"),
      ]);
      const porUsuario = new Map<string, UserRole[]>();
      ((roles ?? []) as { user_id: string; role: UserRole }[]).forEach((r) => {
        porUsuario.set(r.user_id, [...(porUsuario.get(r.user_id) ?? []), r.role]);
      });
      return ((profiles ?? []) as Omit<Conta, "roles">[]).map((p) => ({
        ...p,
        roles: porUsuario.get(p.id) ?? [],
      }));
    },
  });

  // A gravação em user_roles é restrita ao admin por RLS — a interface
  // apenas reflete isso; quem manda é o banco.
  const alternar = useMutation({
    mutationFn: async ({ conta, role, tinha }: { conta: Conta; role: UserRole; tinha: boolean }) => {
      if (tinha) {
        const { error } = await sb.from("user_roles").delete().eq("user_id", conta.id).eq("role", role);
        if (error) throw error;
      } else {
        const { error } = await sb.from("user_roles").insert({ user_id: conta.id, role });
        if (error) throw error;
      }
    },
    onSuccess: (_d, v) => {
      toast.success(`${v.tinha ? "Removido" : "Concedido"}: ${v.role} · ${v.conta.email ?? v.conta.id}`);
      qc.invalidateQueries({ queryKey: ["admin-papeis"] });
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (e: Error) => toast.error(e.message || "Não foi possível alterar o papel."),
  });

  const onToggle = (conta: Conta, role: UserRole, tinha: boolean) => {
    // Remover o próprio admin tira o acesso a esta tela — exige confirmação.
    if (tinha && role === "admin" && conta.id === user?.id) {
      if (!confirm("Remover SEU próprio papel de admin? Você perderá o acesso a esta tela imediatamente.")) return;
    }
    alternar.mutate({ conta, role, tinha });
  };

  const termo = busca.trim().toLowerCase();
  const lista = (contas ?? []).filter(
    (c) => !termo || (c.email ?? "").toLowerCase().includes(termo) || (c.nome ?? "").toLowerCase().includes(termo),
  );

  return (
    <>
      <div className="alert alert-warning alert-admin">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18, flexShrink: 0, marginTop: 1 }}>
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <div>
          <strong>ALTERAÇÕES VALEM IMEDIATAMENTE:</strong> o papel é lido do banco a cada carregamento de sessão —
          a pessoa afetada só precisa recarregar a página. <strong>Avaliador</strong> e <strong>Professor</strong>{" "}
          colocam a conta no pool de revisores (Atribuições e distribuição automática). Um usuário pode acumular
          papéis; vale sempre o de maior privilégio.
        </div>
      </div>

      <div className="toolbar">
        <div className="search-wrapper">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16 }}>
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            className="search-input"
            placeholder="Buscar por nome ou e-mail..."
            value={busca}
            onChange={(ev) => setBusca(ev.target.value)}
          />
        </div>
      </div>

      <div className="table-container">
        <table className="table" style={{ width: "100%" }}>
          <thead>
            <tr>
              <th>CONTA</th>
              {ROLES.map((r) => (
                <th key={r.value} style={{ textAlign: "center" }} title={r.hint}>{r.label.toUpperCase()}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={ROLES.length + 1} style={{ textAlign: "center", color: "var(--color-text-muted)" }}>
                  Carregando…
                </td>
              </tr>
            )}
            {!isLoading && lista.length === 0 && (
              <tr>
                <td colSpan={ROLES.length + 1} style={{ textAlign: "center", color: "var(--color-text-muted)" }}>
                  Nenhuma conta encontrada.
                </td>
              </tr>
            )}
            {lista.map((c) => (
              <tr key={c.id}>
                <td>
                  <div style={{ fontWeight: "var(--fw-semibold)" }}>
                    {c.nome || "—"}
                    {c.id === user?.id && <span className="badge badge-blue" style={{ marginLeft: 8 }}>você</span>}
                  </div>
                  <div style={{ fontSize: "var(--fs-caption)", color: "var(--color-text-muted)" }}>{c.email ?? c.id}</div>
                </td>
                {ROLES.map((r) => {
                  const tinha = c.roles.includes(r.value);
                  return (
                    <td key={r.value} style={{ textAlign: "center" }}>
                      <button
                        type="button"
                        disabled={alternar.isPending}
                        onClick={() => onToggle(c, r.value, tinha)}
                        aria-pressed={tinha}
                        title={`${tinha ? "Remover" : "Conceder"} ${r.label}`}
                        className={`btn btn-sm ${tinha ? "" : "btn-outline"}`}
                        style={{
                          padding: "4px 12px",
                          fontSize: 11,
                          ...(tinha
                            ? { background: "var(--color-success)", color: "#fff", border: "none" }
                            : {}),
                        }}
                      >
                        {tinha ? "Sim" : "—"}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
