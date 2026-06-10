import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Trabalho = {
  id: string;
  titulo: string;
  autores: string;
  categoria_id: string | null;
  status: string;
  data_submissao: string;
  created_at: string;
};

type Categoria = { id: string; nome: string };

const AdminPortal = () => {
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState("auditoria");
  const [trabalhos, setTrabalhos] = useState<Trabalho[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [alertHours, setAlertHours] = useState(48);
  const [config, setConfig] = useState({
    abertura: "2026-01-04",
    encerramento: "2026-05-31",
    minChars: 1000,
    maxCoauthors: 5,
    edital: "Prezados participantes, o Congresso de Iniciação Científica 2026 da UFLA receberá submissões nas modalidades PIBIC, BIC Jr, Ensino e Extensão.",
    linkTemplateWord: "https://example.com/template.docx",
    linkTemplateLaTeX: "https://example.com/template.zip",
  });

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate("/login"); return; }
      await loadData();
    };
    init();
  }, [navigate]);

  const loadData = async () => {
    setLoading(true);
    const [{ data: t }, { data: c }] = await Promise.all([
      supabase.from("trabalhos").select("*").order("created_at", { ascending: false }),
      supabase.from("categorias").select("*").order("nome"),
    ]);
    setTrabalhos(t ?? []);
    setCategorias(c ?? []);
    setLoading(false);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  const catNome = (id: string | null) => id ? (categorias.find(c => c.id === id)?.nome ?? "—") : "—";

  const statusBadge: Record<string, string> = {
    pendente: "badge badge-amber",
    em_avaliacao: "badge badge-blue",
    aprovado: "badge badge-green",
    reprovado: "badge badge-red",
  };

  const statusLabel: Record<string, string> = {
    pendente: "Recebido",
    em_avaliacao: "Em Análise",
    aprovado: "Aprovado",
    reprovado: "Reprovado",
  };

  const filtered = trabalhos.filter(t =>
    !search || t.titulo.toLowerCase().includes(search.toLowerCase()) || t.autores.toLowerCase().includes(search.toLowerCase())
  );

  const updateStatus = async (id: string, status: string) => {
    const { error } = await supabase.from("trabalhos").update({ status }).eq("id", id);
    if (error) toast.error("Erro ao atualizar status");
    else { toast.success("Status atualizado"); await loadData(); }
  };

  const exportCSV = () => {
    const rows = [["ID", "Título", "Autores", "Categoria", "Status", "Data"]];
    filtered.forEach(t => rows.push([t.id, t.titulo, t.autores, catNome(t.categoria_id), t.status, t.data_submissao]));
    const csv = rows.map(r => r.map(c => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "auditoria.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const saveConfig = () => toast.success("Configurações salvas com sucesso!");

  const stats = {
    total: trabalhos.length,
    avaliacao: trabalhos.filter(t => t.status === "em_avaliacao").length,
    aprovadas: trabalhos.filter(t => t.status === "aprovado").length,
    reprovadas: trabalhos.filter(t => t.status === "reprovado").length,
  };

  return (
    <div>
      <aside className="sidebar sidebar-dark">
        <a href="#" className="sidebar-logo" onClick={e => { e.preventDefault(); setActiveSection("auditoria"); }}>
          <div className="logo-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 20, height: 20 }}>
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
            </svg>
          </div>
          <div>
            <div className="logo-text">NEXUS ADMIN</div>
            <div className="logo-sub">Comissão Organizadora</div>
          </div>
        </a>

        <nav className="sidebar-nav">
          {[
            { id: "auditoria", label: "Auditoria", icon: <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></> },
            { id: "conflitos", label: "Conflitos", icon: <><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></> },
            { id: "configuracoes", label: "Configurações", icon: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></> },
            { id: "notificacoes", label: "Notificações", icon: <><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></> },
          ].map(item => (
            <button
              key={item.id}
              className={`nav-item${activeSection === item.id ? " active" : ""}`}
              onClick={() => setActiveSection(item.id)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18 }}>{item.icon}</svg>
              {item.label}
            </button>
          ))}

          <div style={{ marginTop: "auto", paddingTop: "var(--space-4)", borderTop: "1px solid rgba(255,255,255,0.12)" }}>
            <a
              href="/dashboard"
              className="nav-item"
              style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", textDecoration: "none" }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18 }}>
                <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
              </svg>
              Ir para Dashboard
            </a>
          </div>
        </nav>

        <div className="sidebar-footer">
          <button className="nav-item" onClick={handleLogout} style={{ width: "100%" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/>
              <polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            Sair
          </button>
        </div>
      </aside>

      <main className="main-content">
        <header className="top-bar">
          <span className="top-bar-title">PORTAL DA COMISSÃO ORGANIZADORA</span>
          <div className="user-info">
            <div className="user-details">
              <div className="user-name">Administrador</div>
              <div className="user-meta">Coord. Comissão · UFLA</div>
            </div>
            <div className="user-avatar admin">AD</div>
          </div>
        </header>

        <div className="content-area">

          {/* AUDITORIA */}
          <div className={`section${activeSection === "auditoria" ? " active" : ""}`}>
            <div className="page-header">
              <div className="page-overline">AUDITORIA E CONTROLE</div>
              <h1 className="page-title">Rastreabilidade Global.</h1>
              <p style={{ fontSize: "var(--fs-sm)", color: "var(--color-text-secondary)" }}>Visualize todas as submissões, acompanhe pareceres e gerencie cada etapa do processo.</p>
            </div>

            <div className="stats-grid">
              {[
                { label: "Total", value: stats.total, bar: "bar-blue" },
                { label: "Em Avaliação", value: stats.avaliacao, bar: "bar-blue" },
                { label: "Aprovadas", value: stats.aprovadas, bar: "bar-green" },
                { label: "Reprovadas", value: stats.reprovadas, bar: "bar-dark" },
              ].map(s => (
                <div className="stat-card-admin" key={s.label}>
                  <div className="stat-label">{s.label}</div>
                  <div className="stat-value">{loading ? "—" : s.value}</div>
                  <div className={`stat-bar ${s.bar}`} />
                </div>
              ))}
            </div>

            <div className="toolbar">
              <div className="search-wrapper">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16 }}>
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                <input type="text" className="search-input" placeholder="Buscar por título, autor..." value={search} onChange={e => setSearch(e.target.value)} />
              </div>
              <button className="btn btn-outline btn-sm" onClick={exportCSV}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                EXPORTAR CSV
              </button>
            </div>

            {loading ? (
              <div style={{ textAlign: "center", padding: "48px", color: "var(--color-text-muted)" }}>Carregando dados...</div>
            ) : filtered.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 28, height: 28 }}><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/></svg>
                </div>
                <h3 className="empty-state-title">Nenhuma submissão registrada</h3>
                <p className="empty-state-description">Ainda não há trabalhos submetidos no sistema. As submissões aparecerão aqui assim que forem enviadas pelos estudantes.</p>
              </div>
            ) : (
              <div className="table-container">
                <table className="table" style={{ width: "100%" }}>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>TRABALHO E AUTOR</th>
                      <th>CATEGORIA</th>
                      <th>STATUS</th>
                      <th>DATA</th>
                      <th>AÇÕES</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(t => (
                      <tr key={t.id}>
                        <td style={{ fontFamily: "monospace", fontSize: "var(--fs-caption)", color: "var(--color-text-muted)" }}>{t.id.slice(0, 8)}…</td>
                        <td>
                          <div style={{ fontWeight: "var(--fw-semibold)" }}>{t.titulo}</div>
                          <div style={{ fontSize: "var(--fs-caption)", color: "var(--color-text-muted)" }}>{t.autores}</div>
                        </td>
                        <td>{catNome(t.categoria_id)}</td>
                        <td><span className={statusBadge[t.status] ?? "badge badge-gray"}>{statusLabel[t.status] ?? t.status}</span></td>
                        <td>{new Date(t.data_submissao).toLocaleDateString("pt-BR")}</td>
                        <td>
                          <div style={{ display: "flex", gap: 4 }}>
                            {t.status !== "em_avaliacao" && (
                              <button className="btn btn-primary btn-sm" style={{ padding: "4px 8px", fontSize: 11 }} onClick={() => updateStatus(t.id, "em_avaliacao")}>Analisar</button>
                            )}
                            {t.status !== "aprovado" && (
                              <button className="btn btn-sm" style={{ background: "var(--color-success)", color: "#fff", border: "none", padding: "4px 8px", fontSize: 11 }} onClick={() => updateStatus(t.id, "aprovado")}>Aprovar</button>
                            )}
                            {t.status !== "reprovado" && (
                              <button className="btn btn-danger btn-sm" style={{ padding: "4px 8px", fontSize: 11 }} onClick={() => updateStatus(t.id, "reprovado")}>Reprovar</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* CONFLITOS */}
          <div className={`section${activeSection === "conflitos" ? " active" : ""}`}>
            <div className="page-header">
              <div className="page-overline">GESTÃO DE CONFLITOS</div>
              <h1 className="page-title">Atribuições bloqueadas automaticamente.</h1>
              <p style={{ fontSize: "var(--fs-sm)", color: "var(--color-text-secondary)" }}>Revise conflitos de interesse detectados pelo sistema.</p>
            </div>
            <div className="alert alert-warning alert-admin">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18, flexShrink: 0, marginTop: 1 }}>
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
              <div><strong>REGRAS VIGENTES:</strong> Bloqueio automático para orientação direta, coautoria nos últimos 24 meses e vínculo de programa de pós-graduação.</div>
            </div>
            <div className="empty-state">
              <div className="empty-state-icon" style={{ background: "var(--green-50)", color: "var(--green-700)" }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 28, height: 28 }}>
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
                </svg>
              </div>
              <h3 className="empty-state-title">Nenhum conflito identificado</h3>
              <p className="empty-state-description">Todos os revisores e atribuições estão em conformidade com as regras vigentes.</p>
            </div>
          </div>

          {/* CONFIGURAÇÕES */}
          <div className={`section${activeSection === "configuracoes" ? " active" : ""}`}>
            <div className="page-header">
              <div className="page-overline">CONFIGURAÇÕES DO CONGRESSO</div>
              <h1 className="page-title">Parâmetros operacionais.</h1>
              <p style={{ fontSize: "var(--fs-sm)", color: "var(--color-text-secondary)" }}>Defina prazos, regras de submissão e alertas automáticos.</p>
            </div>

            <div className="config-cards">
              <div className="config-card">
                <div className="config-card-header">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 20, height: 20 }}>
                    <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                  </svg>
                  <span className="config-title">Prazos da Edição</span>
                </div>
                <div className="config-row">
                  <div className="form-group">
                    <label className="form-label">Abertura de Submissões</label>
                    <input type="date" className="form-input" value={config.abertura} onChange={e => setConfig(c => ({ ...c, abertura: e.target.value }))} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Encerramento</label>
                    <input type="date" className="form-input" value={config.encerramento} onChange={e => setConfig(c => ({ ...c, encerramento: e.target.value }))} />
                  </div>
                </div>
              </div>

              <div className="config-card border-left-green">
                <div className="config-card-header">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 20, height: 20 }}>
                    <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/>
                  </svg>
                  <span className="config-title">Alertas para Revisores</span>
                </div>
                <div className="form-group">
                  <label className="form-label">Antecedência de Alerta (Horas)</label>
                  <input type="number" className="form-input" value={alertHours} min={1} style={{ maxWidth: 200 }} onChange={e => setAlertHours(Number(e.target.value))} />
                  <div className="config-display">EQUIVALE A {alertHours}h ≈ {(alertHours / 24).toFixed(1)} dias</div>
                </div>
                <div className="config-toggle-row">
                  <div className="config-toggle-info">
                    <div className="toggle-title">Reenviar alerta a cada 24h após o vencimento</div>
                    <div className="toggle-desc">Envia lembretes recorrentes ao revisor enquanto o parecer não for registrado.</div>
                  </div>
                  <label className="toggle"><input type="checkbox" defaultChecked /><span className="toggle-slider" /></label>
                </div>
                <div className="config-toggle-row">
                  <div className="config-toggle-info">
                    <div className="toggle-title">Notificar Comissão quando revisor exceder 72h em atraso</div>
                    <div className="toggle-desc">Alerta a coordenação para intervenção manual quando o prazo de tolerância for ultrapassado.</div>
                  </div>
                  <label className="toggle"><input type="checkbox" defaultChecked /><span className="toggle-slider" /></label>
                </div>
              </div>

              <div className="config-card">
                <div className="config-card-header">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 20, height: 20 }}>
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
                  </svg>
                  <span className="config-title">Regras de Submissão</span>
                </div>
                <div className="config-row">
                  <div className="form-group">
                    <label className="form-label">Tamanho Mínimo do Parecer (Caracteres)</label>
                    <input type="number" className="form-input" value={config.minChars} min={100} onChange={e => setConfig(c => ({ ...c, minChars: Number(e.target.value) }))} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Máximo de Coautores</label>
                    <input type="number" className="form-input" value={config.maxCoauthors} min={1} onChange={e => setConfig(c => ({ ...c, maxCoauthors: Number(e.target.value) }))} />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Mensagem do Edital</label>
                  <textarea className="form-textarea" value={config.edital} onChange={e => setConfig(c => ({ ...c, edital: e.target.value }))} rows={4} />
                </div>
              </div>

              <div className="config-card">
                <div className="config-card-header">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 20, height: 20 }}>
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
                  </svg>
                  <span className="config-title">Links de Templates</span>
                </div>
                <div className="config-row">
                  <div className="form-group">
                    <label className="form-label">Link Template Word (DOCX)</label>
                    <input type="url" className="form-input" value={config.linkTemplateWord} onChange={e => setConfig(c => ({ ...c, linkTemplateWord: e.target.value }))} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Link Template LaTeX</label>
                    <input type="url" className="form-input" value={config.linkTemplateLaTeX} onChange={e => setConfig(c => ({ ...c, linkTemplateLaTeX: e.target.value }))} />
                  </div>
                </div>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 24 }}>
              <button className="btn btn-primary" onClick={saveConfig}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                SALVAR CONFIGURAÇÕES
              </button>
            </div>
          </div>

          {/* NOTIFICAÇÕES */}
          <div className={`section${activeSection === "notificacoes" ? " active" : ""}`}>
            <div className="page-header">
              <div className="page-overline">CENTRAL DE NOTIFICAÇÕES</div>
              <h1 className="page-title">Alertas do sistema.</h1>
              <p style={{ fontSize: "var(--fs-sm)", color: "var(--color-text-secondary)" }}>Acompanhe eventos automáticos, alertas de prazo e atividades recentes.</p>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {trabalhos.slice(0, 5).map(t => (
                <div className="notification-item" key={t.id}>
                  <div className="notification-icon" style={{ background: "var(--blue-50)", color: "var(--color-primary)" }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18 }}>
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/>
                    </svg>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div className="notification-title">Nova submissão recebida</div>
                    <div className="notification-desc">{t.titulo} — por {t.autores}</div>
                    <div className="notification-time">{new Date(t.created_at).toLocaleString("pt-BR")}</div>
                  </div>
                  <span className={`badge ${t.status === "aprovado" ? "badge-green" : t.status === "reprovado" ? "badge-red" : "badge-blue"}`}>
                    {t.status}
                  </span>
                </div>
              ))}
              {trabalhos.length === 0 && (
                <div className="empty-state">
                  <div className="empty-state-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 28, height: 28 }}><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>
                  </div>
                  <h3 className="empty-state-title">Nenhuma notificação</h3>
                  <p className="empty-state-description">Não há eventos recentes para exibir.</p>
                </div>
              )}
            </div>
          </div>

        </div>
      </main>
    </div>
  );
};

export default AdminPortal;
