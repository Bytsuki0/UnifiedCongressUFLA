import { BotaoBaixar } from "@/components/BotaoBaixar";
import { useLinksDownloads } from "@/hooks/use-links-downloads";
import { DOWNLOADS_REVISOR } from "@/lib/downloads";

const Arquivo = () => {
  const links = useLinksDownloads();

  return (
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
                <th>AÇÃO</th>
              </tr>
            </thead>
            <tbody>
              {DOWNLOADS_REVISOR.map(d => (
                <tr key={d.chave}>
                  <td>
                    <div className="doc-title">{d.nome}</div>
                    <div className="doc-description">{d.desc}</div>
                  </td>
                  <td><span className="badge badge-gray">{d.ext}</span></td>
                  <td>
                    <BotaoBaixar url={links[d.chave]} className="btn btn-outline btn-sm">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                        <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                      </svg>
                      BAIXAR
                    </BotaoBaixar>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Arquivo;
