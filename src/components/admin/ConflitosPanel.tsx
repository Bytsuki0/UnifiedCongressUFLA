import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  carregarPainelConflitos,
  desfazerAssociacaoEmConflito,
  type LinhaConflito as Linha,
  type MotivoConflito,
} from "@/services/revisorService";

const MOTIVO_LABEL: Record<MotivoConflito, string> = {
  autor: "Autor",
  orientador: "Orientador",
  coautor: "Coautor",
};

/**
 * Conflitos de interesse. A regra é aplicada por trigger no banco
 * (`trg_conflito_revisor`), então uma associação em violação só existe
 * se o trabalho foi editado DEPOIS de o revisor ser associado — por
 * isso essas linhas ganham um botão para desfazer a associação.
 */
export function ConflitosPanel() {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-conflitos"],
    queryFn: carregarPainelConflitos,
  });

  const desfazer = useMutation({
    mutationFn: desfazerAssociacaoEmConflito,
    onSuccess: () => {
      toast.success("Associação em conflito removida.");
      qc.invalidateQueries({ queryKey: ["admin-conflitos"] });
    },
    onError: () => toast.error("Não foi possível remover a associação."),
  });

  const confirmarDesfazer = (l: Linha) => {
    if (!confirm(`Remover ${l.email} como revisor de "${l.titulo}"? O parecer já emitido por essa pessoa neste trabalho também será apagado.`)) return;
    desfazer.mutate(l);
  };

  const violacoes = data?.violacoes ?? [];
  const bloqueios = data?.bloqueios ?? [];

  return (
    <>
      <div className="alert alert-warning alert-admin">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18, flexShrink: 0, marginTop: 1 }}>
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <div>
          <strong>REGRA VIGENTE:</strong> quem submeteu o trabalho, o orientador informado e cada coautor com
          e-mail ficam impedidos de revisá-lo. O bloqueio é aplicado no banco de dados, vale para a associação
          manual, para a distribuição automática e para qualquer chamada direta à API.
        </div>
      </div>

      {isLoading ? (
        <div style={{ textAlign: "center", padding: 48, color: "var(--color-text-muted)" }}>Carregando conflitos...</div>
      ) : (
        <>
          <h2 style={{ fontSize: "var(--fs-lg)", fontWeight: "var(--fw-semibold)", marginBottom: 12 }}>
            Atribuições em violação
          </h2>
          {violacoes.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon" style={{ background: "var(--green-50)", color: "var(--green-700)" }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 28, height: 28 }}>
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
                </svg>
              </div>
              <h3 className="empty-state-title">Nenhuma atribuição em conflito</h3>
              <p className="empty-state-description">
                Todos os revisores associados estão em conformidade com a regra vigente.
              </p>
            </div>
          ) : (
            <div className="table-container">
              <table className="table" style={{ width: "100%" }}>
                <thead>
                  <tr>
                    <th>TRABALHO</th>
                    <th>REVISOR IMPEDIDO</th>
                    <th>VÍNCULO</th>
                    <th>AÇÃO</th>
                  </tr>
                </thead>
                <tbody>
                  {violacoes.map((l) => (
                    <tr key={l.associacaoId}>
                      <td style={{ fontWeight: "var(--fw-semibold)" }}>{l.titulo}</td>
                      <td>{l.email}</td>
                      <td><span className="badge badge-red">{MOTIVO_LABEL[l.motivo]}</span></td>
                      <td>
                        <button
                          className="btn btn-danger btn-sm"
                          style={{ padding: "4px 8px", fontSize: 11 }}
                          disabled={desfazer.isPending}
                          onClick={() => confirmarDesfazer(l)}
                        >
                          Remover atribuição
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h2 style={{ fontSize: "var(--fs-lg)", fontWeight: "var(--fw-semibold)", margin: "32px 0 12px" }}>
            Impedimentos ativos
          </h2>
          <p style={{ fontSize: "var(--fs-sm)", color: "var(--color-text-secondary)", marginBottom: 12 }}>
            E-mails que o sistema recusa como revisores de cada trabalho.
          </p>
          {bloqueios.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 28, height: 28 }}>
                  <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" />
                </svg>
              </div>
              <h3 className="empty-state-title">Nenhum impedimento registrado</h3>
              <p className="empty-state-description">
                Os trabalhos submetidos ainda não informaram orientador nem coautores com e-mail.
              </p>
            </div>
          ) : (
            <div className="table-container">
              <table className="table" style={{ width: "100%" }}>
                <thead>
                  <tr>
                    <th>TRABALHO</th>
                    <th>E-MAIL IMPEDIDO</th>
                    <th>VÍNCULO</th>
                  </tr>
                </thead>
                <tbody>
                  {bloqueios.map((l) => (
                    <tr key={`${l.trabalhoId}:${l.email}`}>
                      <td style={{ fontWeight: "var(--fw-semibold)" }}>{l.titulo}</td>
                      <td>{l.email}</td>
                      <td><span className="badge badge-gray">{MOTIVO_LABEL[l.motivo]}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
