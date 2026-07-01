const Templates = () => (
  <div className="section active">
    <div className="content-area">
      <div className="page-header">
        <div className="page-overline">Central de Modelos</div>
        <h1 className="page-title">Templates Oficiais</h1>
        <p style={{ fontSize: "var(--fs-sm)", color: "var(--color-text-secondary)" }}>Baixe os modelos oficiais para formatar seu trabalho conforme as normas do programa.</p>
      </div>

      <div className="alert alert-warning mb-6">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18, flexShrink: 0, marginTop: 1 }}>
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
        <span>Atenção: os templates devem ser utilizados sem modificações estruturais. Alterações na formatação podem acarretar reprovação automática do trabalho.</span>
      </div>

      <div className="template-section-title">Artigos Científicos</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16, marginBottom: 24 }}>
        {[
          { ext: ".DOCX · 412 KB", name: "Artigo · Word", file: "template_artigo_word.docx" },
          { ext: ".TEX · 186 KB", name: "Artigo · LaTeX", file: "template_artigo_latex.tex" },
        ].map(t => (
          <div className="template-card" key={t.file}>
            <div className="template-icon blue-800">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 22, height: 22 }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            </div>
            <div className="template-meta">{t.ext}</div>
            <div className="template-name">{t.name}</div>
            <button className="btn btn-primary btn-sm" onClick={() => alert(`Download de ${t.file} (simulação)`)}>Baixar</button>
          </div>
        ))}
      </div>

      <div className="template-section-title">Apresentações de Slides</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16 }}>
        {[
          { ext: ".PPTX · 1.8 MB", name: "Slides · PowerPoint", file: "template_slides_powerpoint.pptx" },
          { ext: ".KEY · 2.1 MB", name: "Slides · Keynote", file: "template_slides_keynote.key" },
        ].map(t => (
          <div className="template-card" key={t.file}>
            <div className="template-icon blue-600">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 22, height: 22 }}><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/></svg>
            </div>
            <div className="template-meta">{t.ext}</div>
            <div className="template-name">{t.name}</div>
            <button className="btn btn-primary btn-sm" onClick={() => alert(`Download de ${t.file} (simulação)`)}>Baixar</button>
          </div>
        ))}
      </div>
    </div>
  </div>
);

export default Templates;
