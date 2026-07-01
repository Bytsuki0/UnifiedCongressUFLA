import { toast } from "sonner";

const Formularios = () => (
  <div className="section active">
    <div className="content-area">
      <div className="page-header">
        <div className="page-overline">BIBLIOTECA DE FORMULÁRIOS</div>
        <h1 className="page-title">Modelos de Avaliação</h1>
        <p className="page-description">Utilize os formulários padronizados como referência para cada modalidade de submissão.</p>
      </div>

      <div style={{ marginTop: 24, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "var(--space-4)" }}>
        {[
          { type: "PESQUISA", name: "Formulário · Pesquisa (PIBIC)", color: "var(--color-primary)", criteria: ["Clareza e originalidade do problema", "Rigor metodológico", "Consistência dos resultados", "Aderência ao referencial teórico", "Qualidade da redação científica"] },
          { type: "EXTENSÃO", name: "Formulário · Extensão", color: "var(--color-secondary)", criteria: ["Impacto social mensurável", "Articulação universidade-comunidade", "Pertinência territorial", "Indicadores de continuidade", "Participação ativa dos beneficiários"] },
          { type: "ENSINO", name: "Formulário · Ensino", color: "var(--color-tertiary)", criteria: ["Inovação didática e criatividade", "Alinhamento com o projeto pedagógico", "Avaliação e acompanhamento", "Replicabilidade da prática", "Engajamento discente gerado"] },
        ].map(f => (
          <div key={f.type} style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", overflow: "hidden", background: "white", display: "flex", flexDirection: "column" }}>
            <div style={{ background: f.color, color: "white", padding: 16, display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ background: "rgba(0,0,0,0.15)", borderRadius: "var(--radius-md)", width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              </div>
              <div>
                <div style={{ fontSize: 10, opacity: 0.8, letterSpacing: 1, marginBottom: 2 }}>{f.type}</div>
                <div style={{ fontWeight: "bold", fontSize: 15 }}>{f.name}</div>
              </div>
            </div>
            <div style={{ padding: 24, flexGrow: 1 }}>
              <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginBottom: 16, fontWeight: "bold", letterSpacing: "0.5px" }}>PRINCIPAIS CRITÉRIOS</div>
              <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: 13, display: "flex", flexDirection: "column", gap: 12 }}>
                {f.criteria.map(c => (
                  <li key={c} style={{ display: "flex", gap: 8, color: "var(--color-text-secondary)" }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={f.color} strokeWidth="2" style={{ flexShrink: 0 }}><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                    {c}
                  </li>
                ))}
              </ul>
            </div>
            <div style={{ padding: "16px 24px 24px" }}>
              <button className="btn btn-primary" style={{ width: "100%", background: f.color, borderColor: f.color }} onClick={() => toast.info("Formulário de modelo disponível em breve.")}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                VISUALIZAR MODELO
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  </div>
);

export default Formularios;
