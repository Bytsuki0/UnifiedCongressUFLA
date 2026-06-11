import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { PortaisNav } from "@/components/PortaisNav";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Submission = {
  id: string;
  titulo: string;
  autores: string;
  categoria_id: string | null;
  status: string;
  data_submissao: string;
  created_at: string;
};

type Categoria = { id: string; nome: string };

const Estudante = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [activeSection, setActiveSection] = useState("dashboard");
  const [trabalhos, setTrabalhos] = useState<Submission[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [loading, setLoading] = useState(true);

  const [form, setForm] = useState({
    titulo: "", resumo: "", categoria: "", orientador: "",
  });
  const [coauthors, setCoauthors] = useState([{ nome: "", email: "" }]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

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

  const catNome = (id: string | null) => id ? (categorias.find(c => c.id === id)?.nome ?? "—") : "—";

  const statusBadge = (s: string) => {
    const map: Record<string, string> = {
      pendente: "badge badge-amber",
      em_avaliacao: "badge badge-blue",
      aprovado: "badge badge-green",
      reprovado: "badge badge-red",
    };
    return map[s] ?? "badge badge-gray";
  };

  const statusLabel: Record<string, string> = {
    pendente: "Recebido",
    em_avaliacao: "Em Avaliação",
    aprovado: "Aprovado",
    reprovado: "Reprovado",
  };

  const handleSubmitWork = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.titulo || !form.resumo || !form.categoria) {
      toast.error("Preencha todos os campos obrigatórios.");
      return;
    }
    setSubmitting(true);
    const { data: { session } } = await supabase.auth.getSession();
    const autores = [
      user?.nome ?? "Autor",
      ...coauthors.filter(c => c.nome).map(c => c.nome),
    ].join(", ");

    const { error } = await supabase.from("trabalhos").insert({
      titulo: form.titulo,
      resumo: form.resumo,
      categoria_id: form.categoria || null,
      autores,
      data_submissao: new Date().toISOString().split("T")[0],
      status: "pendente",
    });

    if (error) {
      toast.error("Erro ao submeter trabalho. Tente novamente.");
    } else {
      toast.success("Trabalho submetido com sucesso!");
      setForm({ titulo: "", resumo: "", categoria: "", orientador: "" });
      setCoauthors([{ nome: "", email: "" }]);
      setSelectedFile(null);
      await loadData();
      setActiveSection("historico");
    }
    setSubmitting(false);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  const initials = (nome?: string) =>
    nome ? nome.split(" ").map(n => n[0]).slice(0, 2).join("").toUpperCase() : "U";

  const ativas = trabalhos.filter(t => t.status === "pendente" || t.status === "em_avaliacao");
  const emAvaliacao = trabalhos.filter(t => t.status === "em_avaliacao");
  const aprovadas = trabalhos.filter(t => t.status === "aprovado");

  return (
    <div>
      <aside className="sidebar">
        <a href="#" className="sidebar-logo" onClick={e => { e.preventDefault(); setActiveSection("dashboard"); }}>
          <div className="logo-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 20, height: 20 }}>
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
              <line x1="12" y1="6" x2="12" y2="13"/><line x1="9" y1="10" x2="15" y2="10"/>
            </svg>
          </div>
          <div>
            <div className="logo-text">NEXUS</div>
            <div className="logo-sub">Portal do Estudante</div>
          </div>
        </a>

        <nav className="sidebar-nav">
          {[
            { id: "dashboard", label: "Dashboard", icon: <><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></> },
            { id: "nova-submissao", label: "Nova Submissão", icon: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></> },
            { id: "historico", label: "Histórico", icon: <><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></> },
            { id: "templates", label: "Templates", icon: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></> },
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

          <PortaisNav currentPage="estudante" pushToBottom={true} />
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
          <span className="top-bar-title">PORTAL DO ESTUDANTE</span>
          <div className="user-info">
            <div className="user-details">
              <div className="user-name">{user?.nome}</div>
              <div className="user-meta">{user?.email}</div>
            </div>
            <div className="user-avatar purple">{initials(user?.nome)}</div>
          </div>
        </header>

        {/* DASHBOARD */}
        <div id="dashboard" className={`section${activeSection === "dashboard" ? " active" : ""}`}>
          <div className="content-area">
            <div className="dashboard-header-row">
              <div>
                <div className="page-overline">VISÃO GERAL</div>
                <h1 className="page-title" style={{ fontSize: "var(--fs-h1)" }}>Olá, {user?.nome?.split(" ")[0]}.</h1>
                <p style={{ fontSize: "var(--fs-sm)", color: "var(--color-text-secondary)" }}>Acompanhe suas submissões e gerencie seus trabalhos científicos.</p>
              </div>
              <button className="btn btn-primary" onClick={() => setActiveSection("nova-submissao")}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                NOVA SUBMISSÃO
              </button>
            </div>

            <div className="dashboard-stats-grid">
              {[
                { label: "SUBMISSÕES ATIVAS", value: ativas.length, color: "var(--color-primary)", bg: "var(--blue-50)", icon: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></> },
                { label: "EM AVALIAÇÃO", value: emAvaliacao.length, color: "var(--blue-700)", bg: "var(--blue-50)", icon: <><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></> },
                { label: "APROVADAS", value: aprovadas.length, color: "var(--color-success)", bg: "var(--green-50)", icon: <><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></> },
                { label: "TOTAL", value: trabalhos.length, color: "var(--color-secondary)", bg: "var(--blue-50)", icon: <><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/></> },
              ].map(s => (
                <div className="dashboard-stat-card" key={s.label}>
                  <div className="stat-card-header">
                    <span className="stat-card-title">{s.label}</span>
                    <div className="stat-card-icon" style={{ background: s.bg, color: s.color }}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18 }}>{s.icon}</svg>
                    </div>
                  </div>
                  <div className="stat-card-value" style={{ color: s.color }}>{loading ? "—" : s.value}</div>
                </div>
              ))}
            </div>

            <div className="dashboard-list-section">
              <div className="dashboard-list-header">
                <h2>Submissões Recentes</h2>
                <button className="btn-link-historico" onClick={() => setActiveSection("historico")}>VER HISTÓRICO COMPLETO</button>
              </div>
              {loading ? (
                <div style={{ padding: "48px", textAlign: "center", color: "var(--color-text-muted)", fontSize: "var(--fs-sm)" }}>Carregando...</div>
              ) : ativas.length === 0 ? (
                <div className="empty-state" style={{ padding: "48px" }}>
                  <div className="empty-state-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                  </div>
                  <h3 className="empty-state-title">Nenhuma submissão ativa</h3>
                  <p className="empty-state-description">Você ainda não tem trabalhos ativos. Submeta seu primeiro trabalho agora!</p>
                  <button className="btn btn-primary btn-sm" onClick={() => setActiveSection("nova-submissao")}>NOVA SUBMISSÃO</button>
                </div>
              ) : (
                <div className="table-container" style={{ borderRadius: 0, border: "none" }}>
                  <table className="table" style={{ width: "100%" }}>
                    <thead>
                      <tr>
                        <th>TÍTULO</th>
                        <th>CATEGORIA</th>
                        <th>STATUS</th>
                        <th>DATA</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ativas.map(t => (
                        <tr key={t.id}>
                          <td style={{ fontWeight: "var(--fw-semibold)" }}>{t.titulo}</td>
                          <td>{catNome(t.categoria_id)}</td>
                          <td><span className={statusBadge(t.status)}>{statusLabel[t.status] ?? t.status}</span></td>
                          <td>{new Date(t.data_submissao).toLocaleDateString("pt-BR")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* NOVA SUBMISSÃO */}
        <div className={`section${activeSection === "nova-submissao" ? " active" : ""}`}>
          <div className="content-area">
            <button className="back-link" onClick={() => setActiveSection("dashboard")}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
              Voltar
            </button>

            <div className="page-header">
              <div className="page-overline">Nova Submissão</div>
              <h1 className="page-title">Submeter trabalho científico</h1>
              <p style={{ fontSize: "var(--fs-sm)", color: "var(--color-text-secondary)" }}>Preencha todos os campos obrigatórios para enviar seu trabalho.</p>
            </div>

            <form onSubmit={handleSubmitWork}>
              <div className="step-card">
                <div className="step-card-header">
                  <div className="step-number">01</div>
                  <div>
                    <div className="step-title">Extração Automática</div>
                    <div className="step-subtitle">Opcional — Importe um arquivo .tex para preencher automaticamente</div>
                  </div>
                </div>
                <div className="import-row">
                  <div className="import-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 20, height: 20 }}>
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                  </div>
                  <div className="import-info">
                    <div className="import-label">Importar .TEX</div>
                    <div className="import-desc">Extraia título, resumo e autores do seu arquivo LaTeX</div>
                  </div>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => alert("Funcionalidade de importação .TEX em desenvolvimento")}>Selecionar</button>
                </div>
              </div>

              <div className="step-card">
                <div className="step-card-header">
                  <div className="step-number">02</div>
                  <div><div className="step-title">Informações do Trabalho</div></div>
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="titulo">Título do Trabalho *</label>
                  <input type="text" id="titulo" className="form-input" placeholder="Digite o título completo do trabalho" value={form.titulo} onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))} required />
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="resumo">Resumo *</label>
                  <textarea id="resumo" className="form-textarea" placeholder="Resumo de até 230 palavras..." rows={5} value={form.resumo} onChange={e => setForm(f => ({ ...f, resumo: e.target.value }))} />
                  <div className="char-counter">{form.resumo.split(/\s+/).filter(Boolean).length} / 230 palavras</div>
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="categoria">Categoria *</label>
                  <select id="categoria" className="form-select" value={form.categoria} onChange={e => setForm(f => ({ ...f, categoria: e.target.value }))}>
                    <option value="">Selecione a categoria</option>
                    {categorias.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                  </select>
                </div>
              </div>

              <div className="step-card">
                <div className="step-card-header">
                  <div className="step-number">03</div>
                  <div><div className="step-title">Autoria</div></div>
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="orientador">E-mail do Orientador</label>
                  <input type="email" id="orientador" className="form-input" placeholder="orientador@ufla.br" value={form.orientador} onChange={e => setForm(f => ({ ...f, orientador: e.target.value }))} />
                </div>

                <div className="coauthor-section">
                  <div className="coauthor-header">
                    <span className="coauthor-label">Coautores</span>
                    <button type="button" className="coauthor-add" onClick={() => setCoauthors(c => [...c, { nome: "", email: "" }])}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                      Adicionar
                    </button>
                  </div>
                  {coauthors.map((c, i) => (
                    <div className="coauthor-row" key={i}>
                      <input type="text" className="form-input" placeholder="Nome completo" value={c.nome} onChange={e => { const nc = [...coauthors]; nc[i].nome = e.target.value; setCoauthors(nc); }} />
                      <input type="email" className="form-input" placeholder="email@ufla.br" value={c.email} onChange={e => { const nc = [...coauthors]; nc[i].email = e.target.value; setCoauthors(nc); }} />
                      {coauthors.length > 1 && (
                        <button type="button" className="coauthor-remove" onClick={() => setCoauthors(coauthors.filter((_, j) => j !== i))}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16 }}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="step-card">
                <div className="step-card-header">
                  <div className="step-number">04</div>
                  <div>
                    <div className="step-title">Arquivo Final</div>
                    <div className="step-subtitle">Anexe o PDF do trabalho · Limite 10MB</div>
                  </div>
                </div>
                <div className="drop-zone" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setSelectedFile(f); }}>
                  <div className="drop-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 48, height: 48 }}>
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                  </div>
                  {selectedFile ? (
                    <div style={{ color: "var(--color-success)", fontSize: "var(--fs-sm)", display: "flex", alignItems: "center", gap: 8, justifyContent: "center" }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
                      {selectedFile.name}
                    </div>
                  ) : (
                    <>
                      <div className="drop-title">Arraste seu PDF aqui</div>
                      <div className="drop-subtitle">ou clique para selecionar do computador</div>
                      <label className="btn btn-primary btn-sm" style={{ cursor: "pointer" }}>
                        Selecionar Arquivo
                        <input type="file" accept=".pdf" style={{ display: "none" }} onChange={e => { if (e.target.files?.[0]) setSelectedFile(e.target.files[0]); }} />
                      </label>
                    </>
                  )}
                </div>
              </div>

              <div className="form-footer">
                <button type="button" className="btn btn-outline" onClick={() => toast.info("Rascunho salvo localmente.")}>Salvar Rascunho</button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? "Enviando..." : "Enviar Submissão"}</button>
              </div>
            </form>
          </div>
        </div>

        {/* HISTÓRICO */}
        <div className={`section${activeSection === "historico" ? " active" : ""}`}>
          <div className="content-area">
            <div className="page-header">
              <div className="page-overline">Submissões Concluídas</div>
              <h1 className="page-title">Histórico de Trabalhos</h1>
              <p style={{ fontSize: "var(--fs-sm)", color: "var(--color-text-secondary)" }}>Acompanhe todas as submissões realizadas e seus respectivos pareceres.</p>
            </div>

            {loading ? (
              <div style={{ textAlign: "center", padding: "48px", color: "var(--color-text-muted)" }}>Carregando...</div>
            ) : trabalhos.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 28, height: 28 }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                </div>
                <h3 className="empty-state-title">Nenhuma submissão realizada</h3>
                <p className="empty-state-description">Você ainda não submeteu nenhum trabalho. Quando enviar, você poderá acompanhar o status aqui.</p>
                <button className="btn btn-primary btn-sm" onClick={() => setActiveSection("nova-submissao")}>NOVA SUBMISSÃO</button>
              </div>
            ) : (
              <div className="table-container">
                <table className="table" style={{ width: "100%" }}>
                  <thead>
                    <tr>
                      <th>TÍTULO</th>
                      <th>AUTORES</th>
                      <th>CATEGORIA</th>
                      <th>STATUS</th>
                      <th>DATA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trabalhos.map(t => (
                      <tr key={t.id}>
                        <td style={{ fontWeight: "var(--fw-semibold)" }}>{t.titulo}</td>
                        <td style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.autores}</td>
                        <td>{catNome(t.categoria_id)}</td>
                        <td><span className={statusBadge(t.status)}>{statusLabel[t.status] ?? t.status}</span></td>
                        <td>{new Date(t.data_submissao).toLocaleDateString("pt-BR")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* TEMPLATES */}
        <div className={`section${activeSection === "templates" ? " active" : ""}`}>
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
      </main>
    </div>
  );
};

export default Estudante;
