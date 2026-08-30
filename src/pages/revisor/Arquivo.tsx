import { BotaoBaixar } from "@/components/BotaoBaixar";
import { useArquivosDownload } from "@/hooks/use-arquivos-download";

const Arquivo = () => {
  const { arquivos, carregando } = useArquivosDownload("revisor");

  return (
    <div className="section active">
      <div className="content-area">
        <div className="page-header">
          <div className="page-overline">ARQUIVO DE DOCUMENTOS</div>
          <h1 className="page-title">Documentos Oficiais</h1>
          <p className="page-description">Acesse o edital, manual de revisão e diretrizes da comissão avaliadora.</p>
        </div>

        {/* Grupo 'revisor' da migration 20260830120000: outro acervo, e
            é o `grupo` que o mantém separado dos modelos de submissão —
            sem ele, publicar o Manual do Revisor o jogaria na página
            inicial do congresso. */}
        {carregando ? (
          <div style={{ textAlign: "center", padding: 48, color: "var(--color-text-muted)" }}>Carregando documentos...</div>
        ) : arquivos.length === 0 ? (
          <div className="empty-state" style={{ marginTop: 24 }}>
            <div className="empty-state-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 28, height: 28 }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            </div>
            <h3 className="empty-state-title">Nenhum documento publicado</h3>
            <p className="empty-state-description">A organização ainda não disponibilizou documentos para download.</p>
          </div>
        ) : (
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
                {arquivos.map(a => (
                  <tr key={a.id}>
                    <td>
                      <div className="doc-title">{a.titulo}</div>
                      {a.descricao && <div className="doc-description">{a.descricao}</div>}
                    </td>
                    <td>{a.formato ? <span className="badge badge-gray">{a.formato}</span> : "—"}</td>
                    <td>
                      <BotaoBaixar url={a.url} className="btn btn-outline btn-sm">
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
        )}
      </div>
    </div>
  );
};

export default Arquivo;
