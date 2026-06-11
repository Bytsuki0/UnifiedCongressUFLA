import { useState, useEffect, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { PortaisNav } from "@/components/PortaisNav";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Submissao = {
  id: string;
  titulo: string;
  categoria: string;
  status: string;
  dataSubmissao: string;
  ultimaAtualizacao?: string;
  revisorEmail?: string;
  rodadas: Rodada[];
  orientador?: string;
  coautores?: { email?: string }[];
  statusHistory?: { statusAnterior: string; statusNovo: string; dataHora: string; justificativa: string }[];
};

type Rodada = {
  rodada: number;
  pdfName: string;
  pdfData?: string;
  parecer: string;
  comentarios: string;
  dataEnvio: string;
  dataAvaliacao?: string;
  ratings?: Record<string, string>;
  status?: string;
};

const LS = {
  get<T>(key: string, def: T): T {
    try {
      const v = localStorage.getItem(key);
      return v ? (JSON.parse(v) as T) : def;
    } catch {
      return def;
    }
  },
  set(key: string, val: unknown) {
    localStorage.setItem(key, JSON.stringify(val));
  },
};

const CRITERIA: Record<string, string[]> = {
  pibic: ["Clareza e originalidade do tema", "Rigor metodológico aplicado", "Consistência dos resultados alcançados", "Aderência ao referencial teórico", "Qualidade geral da redação científica"],
  "bic-junior": ["Clareza e originalidade do tema", "Rigor metodológico aplicado", "Consistência dos resultados alcançados", "Aderência ao referencial teórico", "Qualidade geral da redação científica"],
  extensao: ["Impacto social e transformador mensurável", "Articulação ativa universidade-comunidade", "Pertinência territorial do projeto", "Indicadores claros de continuidade", "Participação efetiva dos beneficiários"],
};
const DEFAULT_CRITERIA = ["Inovação didática e criatividade", "Alinhamento com o projeto pedagógico", "Avaliação e acompanhamento da aprendizagem", "Replicabilidade e escalabilidade da prática", "Engajamento e interesse discente gerado"];

const REVIEWER_EMAIL = "prof.almeida@ufla.br";

function initials(name?: string) {
  if (!name) return "PR";
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : parts[0][0].toUpperCase();
}

function deadlineOf(sub: Submissao) {
  const ref = new Date(sub.ultimaAtualizacao || sub.dataSubmissao);
  ref.setDate(ref.getDate() + 7);
  return ref;
}

const Revisor = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [section, setSection] = useState<"atribuicoes" | "avaliacao" | "formularios" | "arquivo" | "portais">("atribuicoes");
  const [subs, setSubs] = useState<Submissao[]>([]);
  const [activeSubId, setActiveSubId] = useState<string | null>(null);

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

  const reviewerEmail = user?.email || REVIEWER_EMAIL;

  const myAssignments = subs
    .filter(s => s.status === "Em Avaliação" && s.revisorEmail === reviewerEmail)
    .map(sub => {
      const dl = deadlineOf(sub);
      const now = new Date();
      const diffMs = dl.getTime() - now.getTime();
      const diffDays = Math.ceil(diffMs / 86400000);
      const hoursRem = Math.max(0, Math.ceil(diffMs / 3600000));
      const latest = sub.rodadas?.[sub.rodadas.length - 1] ?? null;
      return { sub, dl, diffDays, hoursRem, isEval: !!latest?.parecer };
    })
    .sort((a, b) => a.dl.getTime() - b.dl.getTime());

  const alertHours = parseInt(localStorage.getItem("nexus_config_alert_hours") || "48");
  const stats = {
    total: myAssignments.length,
    pending: myAssignments.filter(x => !x.isEval).length,
    done: myAssignments.filter(x => x.isEval).length,
    critical: myAssignments.filter(x => !x.isEval && x.hoursRem <= alertHours).length,
  };

  const activeSub = subs.find(s => s.id === activeSubId) ?? null;
  const latestRound = activeSub?.rodadas?.[activeSub.rodadas.length - 1] ?? null;
  const isLocked = !!(latestRound?.parecer);
  const criteria = activeSub ? (CRITERIA[activeSub.categoria?.toLowerCase()] ?? DEFAULT_CRITERIA) : [];

  function openEval(subId: string) {
    setActiveSubId(subId);
    setActiveTab("avaliacao");
    setSection("avaliacao");
    setResultado("");
    setComentarios("");
    setRatings({});
    const drafts = LS.get<Record<string, { resultado: string; comentarios: string; ratings: Record<string, string> }>>("nexus_revisor_drafts", {});
    const draft = drafts[subId];
    if (draft) {
      setResultado(draft.resultado || "");
      setComentarios(draft.comentarios || "");
      setRatings(draft.ratings || {});
    }
  }

  function saveDraft() {
    if (!activeSubId) return;
    const drafts = LS.get<Record<string, unknown>>("nexus_revisor_drafts", {});
    drafts[activeSubId] = { resultado, comentarios, ratings };
    LS.set("nexus_revisor_drafts", drafts);
    toast.success("Rascunho salvo com sucesso!");
  }

  function submitParecer() {
    if (!activeSubId || !activeSub) return;
    if (!resultado) { toast.error("Selecione o resultado final."); return; }
    if (!comentarios.trim()) { toast.error("Os comentários são obrigatórios."); return; }
    const allRated = criteria.every((_, i) => ratings[`crit-${i}`]);
    if (!allRated) { toast.error("Avalie todos os critérios obrigatórios."); return; }

    const all = LS.get<Submissao[]>("nexus_submissoes", []);
    const idx = all.findIndex(s => s.id === activeSubId);
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
    delete drafts[activeSubId];
    LS.set("nexus_revisor_drafts", drafts);

    const notifs = LS.get<unknown[]>("nexus_notificacoes", []);
    notifs.unshift({ tipo: "PARECER", title: "Parecer técnico emitido", desc: `Parecer "${resultado}" para "${sub.titulo}".`, time: "agora", unread: true, timestamp: new Date().toISOString() });
    LS.set("nexus_notificacoes", notifs);

    toast.success("Parecer definitivo enviado!");
    setSubs([...all]);
    setSection("atribuicoes");
    setActiveSubId(null);
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    navigate("/login");
  }

  const DL = ({ sub, diffDays, hoursRem, isEval }: { sub: Submissao; diffDays: number; hoursRem: number; isEval: boolean }) => {
    const dl = deadlineOf(sub);
    const urgent = !isEval && hoursRem <= alertHours;
    let rem = diffDays < 0 ? "Atrasado" : diffDays === 0 ? `Hoje (${hoursRem}h)` : `${diffDays} dias restantes`;
    return (
      <div className="work-card-deadline">
        <div className="deadline-date">Prazo: {dl.toLocaleDateString("pt-BR")}</div>
        <div className={`deadline-remaining${urgent ? " danger" : ""}`}>{rem}</div>
      </div>
    );
  };

  return (
    <div>
      <aside className="sidebar">
        <a href="#" className="sidebar-logo" onClick={e => { e.preventDefault(); setSection("atribuicoes"); }}>
          <div className="logo-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 20, height: 20 }}>
              <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
              <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
            </svg>
          </div>
          <div>
            <div className="logo-text">NEXUS</div>
            <div className="logo-sub">Revisor</div>
          </div>
        </a>

        <nav className="sidebar-nav">
          {([
            { id: "atribuicoes", label: "Atribuições", icon: <><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></> },
            { id: "formularios", label: "Formulários", icon: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></> },
            { id: "arquivo", label: "Arquivo", icon: <><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5" rx="1"/><line x1="10" y1="12" x2="14" y2="12"/></> },
          ] as { id: string; label: string; icon: React.ReactNode }[]).map(item => (
            <button
              key={item.id}
              className={`nav-item${section === item.id ? " active" : ""}`}
              onClick={() => setSection(item.id as typeof section)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18 }}>{item.icon}</svg>
              {item.label}
            </button>
          ))}

          <PortaisNav currentPage="revisor" pushToBottom={true} />
        </nav>

        <div className="sidebar-footer">
          <button className="nav-item" onClick={handleLogout} style={{ width: "100%" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            Sair
          </button>
        </div>
      </aside>

      <main className="main-content">
        <header className="top-bar">
          <span className="top-bar-title">PAINEL DO REVISOR</span>
          <div className="user-info">
            <div className="user-details">
              <div className="user-name">{user?.nome}</div>
              <div className="user-meta">{user?.email}</div>
            </div>
            <div className="user-avatar" style={{ background: "var(--color-primary)" }}>{initials(user?.nome)}</div>
          </div>
        </header>

        {/* ============ ATRIBUIÇÕES ============ */}
        <div className={`section${section === "atribuicoes" ? " active" : ""}`}>
          <div className="content-area">
            <div className="page-header">
              <div className="page-overline">DASHBOARD DE ATRIBUIÇÕES</div>
              <h1 className="page-title">Trabalhos para Avaliação</h1>
              <p className="page-subtitle">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
                Modo Double-Blind ativo · identidade dos autores ocultada em todas as rodadas.
              </p>
            </div>

            <div className="stats-grid">
              {[
                { label: "ATRIBUÍDOS", value: stats.total, cls: "" },
                { label: "PENDENTES", value: stats.pending, cls: "amber" },
                { label: "AVALIADOS", value: stats.done, cls: "" },
                { label: "PRAZO CRÍTICO", value: stats.critical || "-", cls: "red" },
              ].map((s, i) => (
                <div className="stat-card" key={i}>
                  <div>
                    <div className="stat-label">{s.label}</div>
                    <div className={`stat-value${s.cls ? " " + s.cls : ""}`}>{s.value}</div>
                  </div>
                  <div className={`stat-icon${s.cls ? " " + s.cls : ""}`}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      {i === 0 && <><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></>}
                      {i === 1 && <><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></>}
                      {i === 2 && <><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M9 16l2 2 4-4"/></>}
                      {i === 3 && <><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></>}
                    </svg>
                  </div>
                </div>
              ))}
            </div>

            <div className="work-list-header">
              <h3>Trabalhos Atribuídos</h3>
              <span className="sort-label">ORDENADOS POR PRAZO</span>
            </div>

            {myAssignments.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
                    <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
                  </svg>
                </div>
                <h3 className="empty-state-title">Nenhum trabalho atribuído</h3>
                <p className="empty-state-description">Você não possui trabalhos pendentes para avaliação no momento. Assim que a comissão organizadora distribuir novas submissões, elas aparecerão aqui.</p>
              </div>
            ) : (
              <div className="work-cards">
                {myAssignments.map(({ sub, diffDays, hoursRem, isEval }) => {
                  const urgent = !isEval && hoursRem <= alertHours;
                  const latest = sub.rodadas?.[sub.rodadas.length - 1];
                  return (
                    <div
                      key={sub.id}
                      className={`work-card${urgent ? " urgent" : ""}`}
                      onClick={() => openEval(sub.id)}
                    >
                      <div className="work-card-left">
                        <div className="work-card-meta">
                          <span className="work-card-id">{sub.id}</span>
                          <span className="badge badge-gray">{sub.categoria?.toUpperCase()}</span>
                          {urgent && <span className="work-card-flag">⚠ URGENTE</span>}
                        </div>
                        <div className="work-card-title">{sub.titulo}</div>
                      </div>
                      <div className="work-card-right">
                        <DL sub={sub} diffDays={diffDays} hoursRem={hoursRem} isEval={isEval} />
                        {isEval
                          ? <span className={`badge ${latest?.parecer === "Reprovado" || latest?.parecer === "Desclassificado" ? "badge-solid-red" : latest?.parecer?.includes("Correções") ? "badge-solid-blue" : "badge-solid-green"}`}>{latest?.parecer}</span>
                          : <span className="badge badge-solid-amber">PENDENTE</span>
                        }
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ============ AVALIAÇÃO ============ */}
        <div className={`section${section === "avaliacao" ? " active" : ""}`}>
          <div className="avaliacao-subheader">
            <button className="back-btn" onClick={() => { setSection("atribuicoes"); setActiveSubId(null); }}>
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

        {/* ============ FORMULÁRIOS ============ */}
        <div className={`section${section === "formularios" ? " active" : ""}`}>
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

        {/* ============ ARQUIVO ============ */}
        <div className={`section${section === "arquivo" ? " active" : ""}`}>
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
      </main>
    </div>
  );
};

export default Revisor;
