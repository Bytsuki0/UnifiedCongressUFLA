import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  excluirConta,
  listarContasDoEvento,
  type ContaListada,
} from "@/services/usuariosService";
import { toast } from "sonner";

/**
 * Lista de contas cadastradas. Morava em /congresso/admin/usuarios; veio
 * para o Portal Admin quando a área do congresso saiu do escopo — a tela
 * não é do evento, é de gestão de contas, e é vizinha natural de Papéis.
 *
 * O serviço por trás continua sendo o `usuariosService`, que costura as
 * quatro origens de conta (estudantes, professores, avaliadores e os
 * externos, que só existem em `profiles` + `user_roles`). Admins ficam
 * fora da lista de propósito: esta tela remove contas, e não deve ser um
 * caminho para derrubar a própria organização.
 *
 * Quem autoriza o DELETE é o RLS, não esta interface.
 */
const badgePorTipo: Record<ContaListada["tipo"], string> = {
  Estudante: "badge badge-gray",
  Professor: "badge badge-blue",
  Avaliador: "badge badge-green",
  Externo: "badge badge-amber",
};

export function UsuariosPanel() {
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");

  const { data: contas, isLoading } = useQuery<ContaListada[]>({
    queryKey: ["admin-users"],
    queryFn: listarContasDoEvento,
  });

  const remover = useMutation({
    mutationFn: excluirConta,
    onSuccess: (_d, conta) => {
      toast.success(`Removido: ${conta.email || conta.nome}`);
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      qc.invalidateQueries({ queryKey: ["admin-papeis"] });
    },
    onError: (e: Error) => toast.error(e.message || "Não foi possível remover a conta."),
  });

  const termo = busca.trim().toLowerCase();
  const lista = (contas ?? []).filter(
    (c) => !termo || c.email.toLowerCase().includes(termo) || c.nome.toLowerCase().includes(termo),
  );

  const exportarCSV = () => {
    const linhas = [["Nome", "E-mail", "Curso/Departamento", "Perfil"]];
    lista.forEach((c) => linhas.push([c.nome, c.email, c.detalhe, c.tipo]));
    const csv = linhas.map((l) => l.map((v) => `"${v}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "usuarios.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
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
        <button className="btn btn-outline btn-sm" onClick={exportarCSV} disabled={lista.length === 0}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
            <polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          EXPORTAR CSV
        </button>
      </div>

      <div className="table-container">
        <table className="table" style={{ width: "100%" }}>
          <thead>
            <tr>
              <th>CONTA</th>
              <th>CURSO / DEPARTAMENTO</th>
              <th>PERFIL</th>
              <th>AÇÕES</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={4} style={{ textAlign: "center", color: "var(--color-text-muted)" }}>
                  Carregando…
                </td>
              </tr>
            )}
            {!isLoading && lista.length === 0 && (
              <tr>
                <td colSpan={4} style={{ textAlign: "center", color: "var(--color-text-muted)" }}>
                  Nenhuma conta encontrada.
                </td>
              </tr>
            )}
            {lista.map((c) => (
              <tr key={`${c.source}-${c.id}`}>
                <td>
                  <div style={{ fontWeight: "var(--fw-semibold)" }}>{c.nome || "—"}</div>
                  <div style={{ fontSize: "var(--fs-caption)", color: "var(--color-text-muted)" }}>{c.email}</div>
                </td>
                <td>{c.detalhe || "—"}</td>
                <td><span className={badgePorTipo[c.tipo]}>{c.tipo}</span></td>
                <td>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    style={{ padding: "4px 8px", fontSize: 11 }}
                    disabled={remover.isPending}
                    onClick={() => {
                      if (confirm(`Excluir ${c.nome || c.email}? A ação não pode ser desfeita.`)) {
                        remover.mutate(c);
                      }
                    }}
                  >
                    Excluir
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
