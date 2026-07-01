import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { statusBadge, statusLabel, useTrabalhos } from "./shared";

const Dashboard = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { trabalhos, loading, catNome } = useTrabalhos();

  const ativas = trabalhos.filter(t => t.status === "pendente" || t.status === "em_avaliacao");
  const emAvaliacao = trabalhos.filter(t => t.status === "em_avaliacao");
  const aprovadas = trabalhos.filter(t => t.status === "aprovado");

  return (
    <div className="section active">
      <div className="content-area">
        <div className="dashboard-header-row">
          <div>
            <div className="page-overline">VISÃO GERAL</div>
            <h1 className="page-title" style={{ fontSize: "var(--fs-h1)" }}>Olá, {user?.nome?.split(" ")[0]}.</h1>
            <p style={{ fontSize: "var(--fs-sm)", color: "var(--color-text-secondary)" }}>Acompanhe suas submissões e gerencie seus trabalhos científicos.</p>
          </div>
          <button className="btn btn-primary" onClick={() => navigate("/estudante/nova-submissao")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            NOVA SUBMISSÃO
          </button>
        </div>

        <div className="dashboard-stats-grid">
          {[
            { label: "SUBMISSÕES ATIVAS", value: ativas.length, color: "var(--color-primary)", bg: "var(--blue-50)", icon: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></> },
            { label: "EM AVALIAÇÃO", value: emAvaliacao.length, color: "var(--blue-700)", bg: "var(--blue-50)", icon: <><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></> },
            { label: "APROVADAS", value: aprovadas.length, color: "var(--color-success)", bg: "var(--green-50)", icon: <><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></> },
            { label: "TOTAL", value: trabalhos.length, color: "var(--color-secondary)", bg: "var(--blue-50)", icon: <><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/></> },
          ].map(s => (
            <div className="dashboard-stat-card" key={s.label}>
              <div className="stat-card-header">
                <span className="stat-card-title">{s.label}</span>
                <div className="stat-card-icon" style={{ background: s.bg, color: s.color }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18 }}>{s.icon}</svg>
                </div>
              </div>
              <div className="stat-card-value" style={{ color: s.color }}>{loading ? "—" : s.value}</div>
            </div>
          ))}
        </div>

        <div className="dashboard-list-section">
          <div className="dashboard-list-header">
            <h2>Submissões Recentes</h2>
            <button className="btn-link-historico" onClick={() => navigate("/estudante/historico")}>VER HISTÓRICO COMPLETO</button>
          </div>
          {loading ? (
            <div style={{ padding: "48px", textAlign: "center", color: "var(--color-text-muted)", fontSize: "var(--fs-sm)" }}>Carregando...</div>
          ) : ativas.length === 0 ? (
            <div className="empty-state" style={{ padding: "48px" }}>
              <div className="empty-state-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              </div>
              <h3 className="empty-state-title">Nenhuma submissão ativa</h3>
              <p className="empty-state-description">Você ainda não tem trabalhos ativos. Submeta seu primeiro trabalho agora!</p>
              <button className="btn btn-primary btn-sm" onClick={() => navigate("/estudante/nova-submissao")}>NOVA SUBMISSÃO</button>
            </div>
          ) : (
            <div className="table-container" style={{ borderRadius: 0, border: "none" }}>
              <table className="table" style={{ width: "100%" }}>
                <thead>
                  <tr>
                    <th>TÍTULO</th>
                    <th>CATEGORIA</th>
                    <th>STATUS</th>
                    <th>DATA</th>
                  </tr>
                </thead>
                <tbody>
                  {ativas.map(t => (
                    <tr key={t.id}>
                      <td style={{ fontWeight: "var(--fw-semibold)" }}>{t.titulo}</td>
                      <td>{catNome(t.categoria_id)}</td>
                      <td><span className={statusBadge(t.status)}>{statusLabel[t.status] ?? t.status}</span></td>
                      <td>{new Date(t.data_submissao).toLocaleDateString("pt-BR")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
