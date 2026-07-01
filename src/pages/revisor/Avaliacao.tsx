import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import {
  CRITERIA,
  DEFAULT_CRITERIA,
  LS,
  Submissao,
  deadlineOf,
} from "./shared";

const Avaliacao = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [subs, setSubs] = useState<Submissao[]>([]);

  const [resultado, setResultado] = useState("");
  const [comentarios, setComentarios] = useState("");
  const [ratings, setRatings] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<"avaliacao" | "historico">("avaliacao");

  const loadSubs = useCallback(() => {
    const all = LS.get<Submissao[]>("nexus_submissoes", []);
    setSubs(all);
  }, []);

  useEffect(() => {
    loadSubs();
    const interval = setInterval(loadSubs, 4000);
    return () => clearInterval(interval);
  }, [loadSubs]);

  // Recupera um eventual rascunho salvo para esta submissão.
  useEffect(() => {
    if (!id) return;
    const drafts = LS.get<Record<string, { resultado: string; comentarios: string; ratings: Record<string, string> }>>("nexus_revisor_drafts", {});
    const draft = drafts[id];
    if (draft) {
      setResultado(draft.resultado || "");
      setComentarios(draft.comentarios || "");
      setRatings(draft.ratings || {});
    }
  }, [id]);

  const activeSub = subs.find(s => s.id === id) ?? null;
  const latestRound = activeSub?.rodadas?.[activeSub.rodadas.length - 1] ?? null;
  const isLocked = !!(latestRound?.parecer);
  const criteria = activeSub ? (CRITERIA[activeSub.categoria?.toLowerCase()] ?? DEFAULT_CRITERIA) : [];

  function saveDraft() {
    if (!id) return;
    const drafts = LS.get<Record<string, unknown>>("nexus_revisor_drafts", {});
    drafts[id] = { resultado, comentarios, ratings };
    LS.set("nexus_revisor_drafts", drafts);
    toast.success("Rascunho salvo com sucesso!");
  }

  function submitParecer() {
    if (!id || !activeSub) return;
    if (!resultado) { toast.error("Selecione o resultado final."); return; }
    if (!comentarios.trim()) { toast.error("Os comentários são obrigatórios."); return; }
    const allRated = criteria.every((_, i) => ratings[`crit-${i}`]);
    if (!allRated) { toast.error("Avalie todos os critérios obrigatórios."); return; }

    const all = LS.get<Submissao[]>("nexus_submissoes", []);
    const idx = all.findIndex(s => s.id === id);
    if (idx === -1) return;

    const sub = all[idx];
    const latest = sub.rodadas?.[sub.rodadas.length - 1];
    if (latest) {
      latest.parecer = resultado;
      latest.comentarios = comentarios;
      latest.status = resultado;
      latest.dataAvaliacao = new Date().toISOString();
      latest.ratings = ratings;
    }
    const prev = sub.status;
    sub.status = resultado;
    sub.ultimaAtualizacao = new Date().toISOString();
    sub.statusHistory = sub.statusHistory || [];
    sub.statusHistory.push({ statusAnterior: prev, statusNovo: resultado, dataHora: new Date().toISOString(), justificativa: `Parecer registrado pelo revisor.` });
    all[idx] = sub;
    LS.set("nexus_submissoes", all);

    const drafts = LS.get<Record<string, unknown>>("nexus_revisor_drafts", {});
    delete drafts[id];
    LS.set("nexus_revisor_drafts", drafts);

    const notifs = LS.get<unknown[]>("nexus_notificacoes", []);
    notifs.unshift({ tipo: "PARECER", title: "Parecer técnico emitido", desc: `Parecer "${resultado}" para "${sub.titulo}".`, time: "agora", unread: true, timestamp: new Date().toISOString() });
    LS.set("nexus_notificacoes", notifs);

    toast.success("Parecer definitivo enviado!");
    navigate("/revisor/atribuicoes");
  }

  return (
    <div className="section active">
      <div className="avaliacao-subheader">
        <button className="back-btn" onClick={() => navigate("/revisor/atribuicoes")}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          VOLTAR ÀS ATRIBUIÇÕES
        </button>
        <span className="sub-id">
          {activeSub ? `${activeSub.id} · ${activeSub.categoria?.toUpperCase()} · Prazo: ${deadlineOf(activeSub).toLocaleDateString("pt-BR")}` : "—"}
        </span>
        <span className="auto-save">
          <span className="dot" />
          SALVAMENTO AUTOMÁTICO ATIVO
        </span>
      </div>

      <div className="double-blind-banner">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16 }}>
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
        MODO DOUBLE-BLIND ATIVADO · Identificação de autores e orientador oculta
      </div>

      <div className="avaliacao-layout">
        <div className="pdf-viewer">
          {latestRound?.pdfData ? (
            <iframe src={latestRound.pdfData} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", border: "none", zIndex: 5 }} />
          ) : (
            <>
              <svg className="pdf-viewer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 64, height: 64, color: "var(--gray-400)" }}>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
              </svg>
              <div className="pdf-viewer-filename">{latestRound?.pdfName || "TRABALHO.PDF"}</div>
              <div className="pdf-viewer-description">Visualizador de PDF embutido · 12 páginas</div>
              <div className="pdf-progress-bar"><div className="pdf-progress-fill" /></div>
            </>
          )}
        </div>

        <div className="review-panel">
          <div className="tabs">
            <button className={`tab-btn${activeTab === "avaliacao" ? " active" : ""}`} onClick={() => setActiveTab("avaliacao")}>AVALIAÇÃO ATUAL</button>
            <button className={`tab-btn${activeTab === "historico" ? " active" : ""}`} onClick={() => setActiveTab("historico")}>HISTÓRICO DE RODADAS</button>
          </div>

          {activeTab === "avaliacao" && (
            <div className="review-panel-body">
              <div className="review-section-overline">PARECER TÉCNICO</div>
              <div className="review-section-title">
                Avaliação — Rodada {String(activeSub?.rodadas?.length || 1).padStart(2, "0")}
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="resultadoFinal">RESULTADO FINAL</label>
                <select className="form-select" id="resultadoFinal" value={resultado} onChange={e => setResultado(e.target.value)} disabled={isLocked}>
                  <option value="">Selecione o resultado</option>
                  <option value="Aprovado">Aprovado</option>
                  <option value="Aprovado com Correções">Aprovado com Correções</option>
                  <option value="Correções Necessárias">Correções Necessárias</option>
                  <option value="Reprovado">Reprovado</option>
                  <option value="Desclassificado">Desclassificado</option>
                </select>
              </div>

              {criteria.length > 0 && (
                <>
                  <div className="review-section-overline" style={{ marginTop: "var(--space-4)", marginBottom: "var(--space-2)" }}>Critérios de Avaliação (Obrigatórios)</div>
                  {criteria.map((crit, i) => (
                    <div className="form-group" style={{ marginBottom: "var(--space-3)" }} key={i}>
                      <label className="form-label" style={{ fontSize: 11, fontWeight: "var(--fw-semibold)", color: "var(--color-text-secondary)", textTransform: "none", letterSpacing: "normal" }} htmlFor={`crit-${i}`}>{crit}</label>
                      <select className="form-select criteria-rating" id={`crit-${i}`} value={ratings[`crit-${i}`] || ""} onChange={e => setRatings(r => ({ ...r, [`crit-${i}`]: e.target.value }))} disabled={isLocked}>
                        <option value="">Nota (1 a 5)</option>
                        <option value="1">1 - Insuficiente</option>
                        <option value="2">2 - Regular</option>
                        <option value="3">3 - Bom</option>
                        <option value="4">4 - Muito Bom</option>
                        <option value="5">5 - Excelente</option>
                      </select>
                    </div>
                  ))}
                </>
              )}

              <div className="form-group">
                <label className="form-label" htmlFor="parecerTexto">COMENTÁRIOS E CORREÇÕES</label>
                <textarea className="form-textarea" id="parecerTexto" rows={8} placeholder="Descreva os pontos fortes, fragilidades e sugestões de correção..." value={comentarios} onChange={e => setComentarios(e.target.value)} disabled={isLocked} />
                <div className="char-counter">{comentarios.length} / 1000 min.</div>
              </div>

              {!isLocked && (
                <div className="alert alert-warning">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18, flexShrink: 0 }}>
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                    <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                  </svg>
                  <span>Após o envio definitivo, o parecer não poderá ser editado nem revertido.</span>
                </div>
              )}

              {isLocked ? (
                <div className="alert" style={{ background: "var(--green-50)", border: "1px solid var(--green-200)", color: "var(--green-700)", display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  Parecer definitivo já enviado para este trabalho.
                </div>
              ) : (
                <div className="review-actions mt-6">
                  <button className="btn btn-outline" onClick={saveDraft}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                      <polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>
                    </svg>
                    SALVAR RASCUNHO
                  </button>
                  <button className="btn btn-primary" onClick={submitParecer}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    ENVIAR PARECER DEFINITIVO
                  </button>
                </div>
              )}
            </div>
          )}

          {activeTab === "historico" && (
            <div style={{ padding: "var(--space-4)" }}>
              {(!activeSub?.rodadas || activeSub.rodadas.length <= 1 && !latestRound?.parecer) ? (
                <div className="empty-state" style={{ border: "none", padding: "var(--space-6) var(--space-4)", margin: 0, background: "transparent" }}>
                  <div className="empty-state-icon" style={{ width: 48, height: 48, marginBottom: "var(--space-3)", background: "var(--gray-100)" }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 24, height: 24 }}>
                      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                    </svg>
                  </div>
                  <h4 className="empty-state-title" style={{ fontSize: "var(--fs-sm)", marginBottom: 4 }}>Sem rodadas anteriores</h4>
                  <p className="empty-state-description" style={{ fontSize: "var(--fs-xs)", maxWidth: 280, marginBottom: 0, lineHeight: "var(--lh-normal)" }}>Este trabalho está em sua primeira rodada de avaliação.</p>
                </div>
              ) : (
                activeSub?.rodadas.map((r, i) => (
                  <div key={i} style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", padding: "var(--space-4)", marginBottom: "var(--space-4)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-2)" }}>
                      <strong style={{ fontSize: "var(--fs-sm)" }}>Rodada {r.rodada}</strong>
                      <span style={{ fontSize: "var(--fs-xs)", color: "var(--color-text-secondary)" }}>{new Date(r.dataEnvio).toLocaleDateString("pt-BR")}</span>
                    </div>
                    <div style={{ fontSize: "var(--fs-xs)", color: "var(--color-text-secondary)" }}>
                      <div><strong>PDF:</strong> {r.pdfName}</div>
                      {r.parecer ? (
                        <>
                          <div style={{ marginTop: 4 }}><strong>Resultado:</strong> {r.parecer}</div>
                          <div style={{ marginTop: 4, padding: 6, background: "var(--gray-50)", borderRadius: 4 }}><em>"{r.comentarios}"</em></div>
                        </>
                      ) : <div style={{ marginTop: 4, color: "var(--amber-600)" }}>Pendente de avaliação nesta rodada</div>}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Avaliacao;
