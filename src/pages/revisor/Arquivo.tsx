import { toast } from "sonner";

const Arquivo = () => (
  <div className="section active">
    <div className="content-area">
      <div className="page-header">
        <div className="page-overline">ARQUIVO DE DOCUMENTOS</div>
        <h1 className="page-title">Documentos Oficiais</h1>
        <p className="page-description">Acesse o edital, manual de revisão e diretrizes da comissão avaliadora.</p>
      </div>

      <div className="table-container" style={{ marginTop: 24 }}>
        <table className="table" style={{ width: "100%" }}>
          <thead>
            <tr>
              <th>DOCUMENTO</th>
              <th>TIPO</th>
              <th>TAMANHO</th>
              <th>AÇÃO</th>
            </tr>
          </thead>
          <tbody>
            {[
              { name: "Edital do Congresso 2026", desc: "Regulamento completo e normas", type: "PDF", size: "312 KB" },
              { name: "Manual do Revisor", desc: "Orientações para avaliação duplo-cega", type: "PDF", size: "198 KB" },
              { name: "Diretrizes de Avaliação", desc: "Critérios e pontuações por categoria", type: "PDF", size: "156 KB" },
              { name: "Código de Ética", desc: "Normas de conduta e conflitos de interesse", type: "PDF", size: "98 KB" },
            ].map(d => (
              <tr key={d.name}>
                <td>
                  <div className="doc-title">{d.name}</div>
                  <div className="doc-description">{d.desc}</div>
                </td>
                <td><span className="badge badge-gray">{d.type}</span></td>
                <td className="doc-size">{d.size}</td>
                <td>
                  <button className="btn btn-outline btn-sm" onClick={() => toast.info(`Download de "${d.name}" em breve.`)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                    BAIXAR
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  </div>
);

export default Arquivo;
