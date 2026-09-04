import { openPdf } from "@/lib/pdfStorage";
import { toast } from "sonner";
import {
  anexosOrfaos,
  ordenarAnexos,
  valorAtual,
  type AnexoDaCategoria,
  type AnexoDoTrabalho,
  type RascunhoAnexos,
} from "@/lib/anexos";

/**
 * Os campos de anexo do formulário do autor, montados a partir do que a
 * CATEGORIA exige.
 *
 * É o mesmo bloco nas quatro telas do autor — submeter, editar, corrigir
 * e reenviar. Antes cada uma tinha a sua área de upload e o seu campo de
 * vídeo, escritos à mão e idênticos; com a quantidade vindo do banco,
 * quatro cópias divergiriam na primeira mudança.
 *
 * Enquanto nenhuma categoria estiver escolhida, `exigencias` chega vazia
 * e o componente não desenha nada — é o que faz as áreas aparecerem só
 * depois de o autor escolher a categoria.
 */
export function CamposAnexos({
  exigencias,
  rascunho,
  onMudar,
  atuais,
}: {
  exigencias: AnexoDaCategoria[];
  rascunho: RascunhoAnexos;
  onMudar: (rascunho: RascunhoAnexos) => void;
  /** O que o trabalho já entregou. Ausente nas submissões novas. */
  atuais?: AnexoDoTrabalho[];
}) {
  const definir = (anexoId: string, campos: { arquivo?: File | null; url?: string }) =>
    onMudar({ ...rascunho, [anexoId]: { ...(rascunho[anexoId] ?? {}), ...campos } });

  const orfaos = anexosOrfaos(atuais, exigencias);

  const verPdf = async (valor: string) => {
    if (!(await openPdf(valor))) toast.error("Não foi possível abrir o PDF.");
  };

  return (
    <>
      {ordenarAnexos(exigencias).map((exigencia) => {
        const item = rascunho[exigencia.id] ?? {};
        const gravado = valorAtual(atuais, exigencia.id);

        if (exigencia.tipo === "video") {
          return (
            <div className="form-group" key={exigencia.id}>
              <label className="form-label" htmlFor={`anexo-${exigencia.id}`}>
                {exigencia.titulo} *
              </label>
              <input
                type="url"
                id={`anexo-${exigencia.id}`}
                className="form-input"
                placeholder="https://www.youtube.com/watch?v=..."
                value={item.url ?? ""}
                onChange={(e) => definir(exigencia.id, { url: e.target.value })}
              />
              {exigencia.descricao && <div className="form-hint">{exigencia.descricao}</div>}
            </div>
          );
        }

        return (
          <div className="form-group" key={exigencia.id}>
            <label className="form-label">{exigencia.titulo} *</label>
            {exigencia.descricao && <div className="form-hint">{exigencia.descricao}</div>}

            {gravado && (
              <div className="import-row">
                <div className="import-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 20, height: 20 }}>
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                  </svg>
                </div>
                <div className="import-info">
                  <div className="import-label">Versão atual</div>
                  <div className="import-desc">Confira o arquivo que está registrado hoje</div>
                </div>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => verPdf(gravado)}>
                  Ver PDF
                </button>
              </div>
            )}

            <div
              className="drop-zone"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files[0];
                if (f) definir(exigencia.id, { arquivo: f });
              }}
            >
              <div className="drop-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 48, height: 48 }}>
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
              </div>
              {item.arquivo ? (
                <div style={{ color: "var(--color-success)", fontSize: "var(--fs-sm)", display: "flex", alignItems: "center", gap: 8, justifyContent: "center" }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
                  {item.arquivo.name}
                </div>
              ) : (
                <>
                  <div className="drop-title">Arraste o PDF aqui</div>
                  <div className="drop-subtitle">
                    {gravado
                      ? "Sem arquivo novo, o PDF atual é mantido"
                      : "ou clique para selecionar do computador · Limite 10MB"}
                  </div>
                  <label className="btn btn-primary btn-sm" style={{ cursor: "pointer" }}>
                    Selecionar Arquivo
                    <input
                      type="file"
                      accept=".pdf"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        if (e.target.files?.[0]) definir(exigencia.id, { arquivo: e.target.files[0] });
                      }}
                    />
                  </label>
                </>
              )}
            </div>
          </div>
        );
      })}

      {/* Entregas que a categoria não pede mais. Aparecem em modo leitura
          porque a próxima gravação as descarta (é o que `aplicar_anexos`
          faz) — sem este aviso o arquivo sumiria sem explicação. */}
      {orfaos.length > 0 && (
        <div className="alert alert-warning" style={{ marginTop: "var(--space-4)" }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18, flexShrink: 0, marginTop: 1 }}>
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <div>
            <strong>Estes anexos não fazem mais parte desta categoria</strong> e serão descartados
            quando você salvar: {orfaos.map((o) => o.titulo).join(", ")}.
          </div>
        </div>
      )}
    </>
  );
}
