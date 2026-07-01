import { useNavigate } from "react-router-dom";
import { statusBadge, statusLabel, useTrabalhos } from "./shared";

const Historico = () => {
  const navigate = useNavigate();
  const { trabalhos, loading, catNome } = useTrabalhos();

  return (
    <div className="section active">
      <div className="content-area">
        <div className="page-header">
          <div className="page-overline">Submissões Concluídas</div>
          <h1 className="page-title">Histórico de Trabalhos</h1>
          <p style={{ fontSize: "var(--fs-sm)", color: "var(--color-text-secondary)" }}>Acompanhe todas as submissões realizadas e seus respectivos pareceres.</p>
        </div>

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
                </tr>
              </thead>
              <tbody>
                {trabalhos.map(t => (
                  <tr key={t.id}>
                    <td style={{ fontWeight: "var(--fw-semibold)" }}>{t.titulo}</td>
                    <td style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.autores}</td>
                    <td>{catNome(t.categoria_id)}</td>
                    <td><span className={statusBadge(t.status)}>{statusLabel[t.status] ?? t.status}</span></td>
                    <td>{new Date(t.data_submissao).toLocaleDateString("pt-BR")}</td>
                    <td>{t.pdf_url ? <a href={t.pdf_url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--color-primary)", fontWeight: "var(--fw-semibold)" }}>Ver PDF</a> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default Historico;
