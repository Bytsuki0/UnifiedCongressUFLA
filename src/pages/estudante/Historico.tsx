import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { openPdf } from "@/lib/pdfStorage";
import {
  AGUARDANDO_CORRECAO,
  PENDENTE,
  STATUS_COM_PARECER,
  formatarData,
  statusBadge,
  statusLabel,
  usePrazo,
  useTrabalhos,
} from "./shared";

const Historico = () => {
  const navigate = useNavigate();
  const { trabalhos, loading, catNome } = useTrabalhos();
  const { prazo, aberto } = usePrazo();
  const aguardandoCorrecao = trabalhos.filter((t) => t.status === AGUARDANDO_CORRECAO);

  // O bucket de PDFs é privado: o acesso é feito por URL assinada,
  // resolvida no momento do clique.
  const verPdf = async (stored: string) => {
    const ok = await openPdf(stored);
    if (!ok) toast.error("Não foi possível abrir o PDF.");
  };

  return (
    <div className="section active">
      <div className="content-area">
        <div className="page-header">
          <div className="page-overline">Submissões Concluídas</div>
          <h1 className="page-title">Histórico de Trabalhos</h1>
          <p style={{ fontSize: "var(--fs-sm)", color: "var(--color-text-secondary)" }}>Acompanhe todas as submissões realizadas e seus respectivos pareceres.</p>
        </div>

        {aberto === false && (
          <div className="alert alert-warning" style={{ marginBottom: "var(--space-4)" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18, flexShrink: 0, marginTop: 1 }}>
              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
            </svg>
            <div>
              <strong>Prazo de submissão encerrado{prazo?.encerramento ? ` em ${formatarData(prazo.encerramento)}` : ""}.</strong>{" "}
              Não é mais possível enviar nem editar trabalhos, exceto os aprovados com correções,
              que continuam podendo ser corrigidos.
            </div>
          </div>
        )}

        {aguardandoCorrecao.length > 0 && (
          <div className="alert alert-warning" style={{ marginBottom: "var(--space-4)" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18, flexShrink: 0, marginTop: 1 }}>
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            <div>
              <strong>{aguardandoCorrecao.length === 1 ? "1 trabalho aprovado com correções." : `${aguardandoCorrecao.length} trabalhos aprovados com correções.`}</strong>{" "}
              Reenvie o PDF corrigido para concluir a aprovação, use o botão “Corrigir” na tabela abaixo.
            </div>
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: "center", padding: "48px", color: "var(--color-text-muted)" }}>Carregando...</div>
        ) : trabalhos.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 28, height: 28 }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            </div>
            <h3 className="empty-state-title">Nenhuma submissão realizada</h3>
            <p className="empty-state-description">Você ainda não submeteu nenhum trabalho. Quando enviar, você poderá acompanhar o status aqui.</p>
            <button className="btn btn-primary btn-sm" onClick={() => navigate("/estudante/nova-submissao")}>NOVA SUBMISSÃO</button>
          </div>
        ) : (
          <div className="table-container">
            <table className="table" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th>TÍTULO</th>
                  <th>AUTORES</th>
                  <th>CATEGORIA</th>
                  <th>STATUS</th>
                  <th>DATA</th>
                  <th>ARQUIVO</th>
                  <th>AÇÕES</th>
                </tr>
              </thead>
              <tbody>
                {trabalhos.map(t => {
                  const podeVerParecer = STATUS_COM_PARECER.includes(t.status);
                  // `aberto === null` é "não sei" (falha de rede) e não
                  // esconde o botão — quem recusa é a RPC editar_submissao.
                  const podeEditar = t.status === PENDENTE && aberto !== false;
                  const podeCorrigir = t.status === AGUARDANDO_CORRECAO;
                  const semAcao = !podeVerParecer && !podeEditar && !podeCorrigir;
                  return (
                  <tr key={t.id}>
                    <td style={{ fontWeight: "var(--fw-semibold)" }}>{t.titulo}</td>
                    <td style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.autores}</td>
                    <td>{catNome(t.categoria_id)}</td>
                    <td><span className={statusBadge(t.status)}>{statusLabel[t.status] ?? t.status}</span></td>
                    <td>{new Date(t.data_submissao).toLocaleDateString("pt-BR")}</td>
                    <td>{t.pdf_url ? <button type="button" onClick={() => verPdf(t.pdf_url!)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--color-primary)", fontWeight: "var(--fw-semibold)" }}>Ver PDF</button> : "—"}</td>
                    <td>
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {/* Notas e comentários: para TODO desfecho, não só
                            para quem tem correção a fazer. Quem foi
                            reprovado é quem mais precisa ler o porquê. */}
                        {podeVerParecer && (
                          <button
                            className="btn btn-outline btn-sm"
                            style={{ padding: "4px 10px", fontSize: 11 }}
                            onClick={() => navigate(`/estudante/trabalho/${t.id}`)}
                          >
                            Ver pareceres
                          </button>
                        )}
                        {podeEditar && (
                          <button
                            className="btn btn-outline btn-sm"
                            style={{ padding: "4px 10px", fontSize: 11 }}
                            onClick={() => navigate(`/estudante/editar/${t.id}`)}
                          >
                            Editar
                          </button>
                        )}
                        {podeCorrigir && (
                          <button
                            className="btn btn-primary btn-sm"
                            style={{ padding: "4px 10px", fontSize: 11 }}
                            onClick={() => navigate(`/estudante/correcao/${t.id}`)}
                          >
                            Corrigir
                          </button>
                        )}
                        {semAcao && "—"}
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default Historico;
