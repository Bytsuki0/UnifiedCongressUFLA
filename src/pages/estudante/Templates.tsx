import { BotaoBaixar } from "@/components/BotaoBaixar";
import { useArquivosDownload } from "@/hooks/use-arquivos-download";

// `auto-fill` e não um número de colunas: a lista é editável desde a
// migration 20260830120000 e pode ter um arquivo ou dez. As duas seções
// que existiam aqui ("Artigos Científicos" e "Apresentação e Normas")
// eram recortes por índice de uma lista de quatro itens fixos — com a
// lista variável, o recorte passaria a agrupar arquivo por acaso.
const GRADE = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16 } as const;

const Templates = () => {
  const { arquivos, carregando } = useArquivosDownload("estudante");

  return (
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

        {/* Aqui a lista vazia AVISA, ao contrário da landing e do /login,
            onde a seção some. Esta tela existe só para os downloads: sem
            o aviso, o autor ficaria olhando uma página em branco sem
            saber se falhou o carregamento ou se não há nada publicado. */}
        {carregando ? (
          <div style={{ textAlign: "center", padding: 48, color: "var(--color-text-muted)" }}>Carregando modelos...</div>
        ) : arquivos.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 28, height: 28 }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            </div>
            <h3 className="empty-state-title">Nenhum modelo publicado</h3>
            <p className="empty-state-description">A organização ainda não disponibilizou arquivos para download.</p>
          </div>
        ) : (
          <div style={GRADE}>
            {arquivos.map(a => (
              <div className="template-card" key={a.id}>
                <div className="template-icon blue-800">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 22, height: 22 }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                </div>
                {a.formato && <div className="template-meta">{a.formato}</div>}
                <div className="template-name">{a.titulo}</div>
                <BotaoBaixar url={a.url} className="btn btn-primary btn-sm">Baixar</BotaoBaixar>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Templates;
