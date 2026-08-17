import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { PortaisNav } from "@/components/PortaisNav";
import { BotaoSuporte } from "@/components/BotaoSuporte";
import { ConflitosPanel } from "@/components/admin/ConflitosPanel";
import { PapeisPanel } from "@/components/admin/PapeisPanel";
import { UsuariosPanel } from "@/components/admin/UsuariosPanel";
import { supabase } from "@/integrations/supabase/client";
import {
  atualizarStatusDoTrabalho,
  excluirTrabalho,
  excluirTrabalhos,
  listarTrabalhosComCategorias,
} from "@/services/trabalhosService";
import {
  carregarConfiguracoes,
  salvarConfiguracoes,
  type Configuracoes,
} from "@/services/configuracoesService";
import { toast } from "sonner";
import { APP_SHORT } from "@/lib/brand";

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

// Cada seção tem URL própria (/admin/<secao>) para poder ser linkada
// de fora — foi assim que as antigas /congresso/admin/papeis e
// /congresso/admin/usuarios migraram (as duas continuam redirecionando).
const SECOES = ["auditoria", "conflitos", "papeis", "usuarios", "configuracoes", "notificacoes"] as const;
type Secao = (typeof SECOES)[number];
const secaoValida = (s?: string): Secao =>
  SECOES.includes(s as Secao) ? (s as Secao) : "auditoria";

const AdminPortal = () => {
  const navigate = useNavigate();
  const { secao } = useParams();
  const activeSection = secaoValida(secao);
  const setActiveSection = (s: Secao) => navigate(s === "auditoria" ? "/admin" : `/admin/${s}`);
  const [trabalhos, setTrabalhos] = useState<Trabalho[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Exclusão de submissões (limpeza de fim de edição). A seleção guarda
  // ids soltos, mas tudo que age sobre ela é recortado pela lista
  // FILTRADA — selecionar, buscar outra coisa e apagar não pode levar
  // junto o que saiu da tela.
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [excluindo, setExcluindo] = useState(false);

  // Configurações: o que está no banco (linha única de `configuracoes`).
  // Antes isto era estado local com valores inventados e o SALVAR só
  // emitia um toast — as datas de prazo agora são regra de servidor.
  const [config, setConfig] = useState<Configuracoes | null>(null);
  const [salvandoConfig, setSalvandoConfig] = useState(false);
  const setCampo = <K extends keyof Configuracoes>(campo: K, valor: Configuracoes[K]) =>
    setConfig((c) => (c ? { ...c, [campo]: valor } : c));

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate("/login"); return; }
      await loadData();
      try {
        setConfig(await carregarConfiguracoes());
      } catch {
        toast.error("Não foi possível carregar as configurações.");
      }
    };
    init();
  }, [navigate]);

  const loadData = async () => {
    setLoading(true);
    try {
      const dados = await listarTrabalhosComCategorias();
      setTrabalhos(dados.trabalhos);
      setCategorias(dados.categorias);
    } catch {
      toast.error("Erro ao carregar dados");
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  const catNome = (id: string | null) => id ? (categorias.find(c => c.id === id)?.nome ?? "—") : "—";

  const statusBadge: Record<string, string> = {
    pendente: "badge badge-amber",
    em_avaliacao: "badge badge-blue",
    aprovado_correcoes: "badge badge-amber",
    aprovado: "badge badge-green",
    reprovado: "badge badge-red",
  };

  const statusLabel: Record<string, string> = {
    pendente: "Recebido",
    em_avaliacao: "Em Análise",
    aprovado_correcoes: "Aprovado c/ correções",
    aprovado: "Aprovado",
    reprovado: "Reprovado",
  };

  const filtered = trabalhos.filter(t =>
    !search || t.titulo.toLowerCase().includes(search.toLowerCase()) || t.autores.toLowerCase().includes(search.toLowerCase())
  );

  // O que a exclusão em lote enxerga: a interseção da seleção com o que
  // está na tela. É também o que o contador do botão mostra.
  const selecionadosVisiveis = filtered.filter(t => selecionados.has(t.id));
  const todosVisiveisMarcados = filtered.length > 0 && selecionadosVisiveis.length === filtered.length;

  const updateStatus = async (id: string, status: string) => {
    try {
      await atualizarStatusDoTrabalho(id, status);
      toast.success("Status atualizado");
      await loadData();
    } catch {
      toast.error("Erro ao atualizar status");
    }
  };

  const alternarSelecao = (id: string) =>
    setSelecionados(atual => {
      const proximo = new Set(atual);
      if (!proximo.delete(id)) proximo.add(id);
      return proximo;
    });

  const excluirUm = async (t: Trabalho) => {
    if (!confirm(
      `Excluir "${t.titulo}"?\n\n` +
      "Saem junto os pareceres, as avaliações, a atribuição dos revisores e o PDF. " +
      "A ação não pode ser desfeita."
    )) return;

    setExcluindo(true);
    try {
      await excluirTrabalho(t.id);
      setSelecionados(atual => {
        const proximo = new Set(atual);
        proximo.delete(t.id);
        return proximo;
      });
      toast.success("Trabalho excluído");
      await loadData();
    } catch {
      toast.error("Não foi possível excluir o trabalho.");
    } finally {
      setExcluindo(false);
    }
  };

  const excluirSelecionados = async () => {
    const alvos = selecionadosVisiveis.map(t => t.id);
    if (alvos.length === 0) return;
    if (!confirm(
      `Excluir ${alvos.length} trabalho(s)?\n\n` +
      "Saem junto os pareceres, as avaliações, a atribuição dos revisores e os PDFs. " +
      "A ação não pode ser desfeita."
    )) return;

    setExcluindo(true);
    try {
      const apagados = await excluirTrabalhos(alvos);
      if (apagados < alvos.length) {
        toast.warning(`${apagados} de ${alvos.length} trabalhos excluídos, o restante foi recusado pelo banco.`);
      } else {
        toast.success(`${apagados} trabalho(s) excluído(s)`);
      }
      setSelecionados(new Set());
      await loadData();
    } catch {
      toast.error("Não foi possível excluir os trabalhos.");
    } finally {
      setExcluindo(false);
    }
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

  const saveConfig = async () => {
    if (!config) return;
    // O CHECK do banco recusa janela invertida; avisar antes evita a
    // mensagem crua do Postgres.
    if (config.submissoes_abertura && config.submissoes_encerramento
        && config.submissoes_abertura > config.submissoes_encerramento) {
      toast.error("O encerramento não pode ser anterior à abertura.");
      return;
    }
    setSalvandoConfig(true);
    try {
      await salvarConfiguracoes(config);
      toast.success("Configurações salvas. O prazo passa a valer imediatamente.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setSalvandoConfig(false);
    }
  };

  const stats = {
    total: trabalhos.length,
    avaliacao: trabalhos.filter(t => t.status === "em_avaliacao").length,
    correcoes: trabalhos.filter(t => t.status === "aprovado_correcoes").length,
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
            <div className="logo-text">{APP_SHORT}</div>
            <div className="logo-sub">Comissão Organizadora</div>
          </div>
        </a>

        <nav className="sidebar-nav">
          {([
            { id: "auditoria", label: "Auditoria", icon: <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></> },
            { id: "conflitos", label: "Conflitos", icon: <><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></> },
            { id: "papeis", label: "Papéis", icon: <><path d="M2 18v3h3l8.5-8.5a3.5 3.5 0 10-3-3L2 18z"/><circle cx="16.5" cy="7.5" r="1.5"/></> },
            { id: "usuarios", label: "Usuários", icon: <><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></> },
            { id: "configuracoes", label: "Configurações", icon: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></> },
            { id: "notificacoes", label: "Notificações", icon: <><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></> },
          ] as { id: Secao; label: string; icon: React.ReactNode }[]).map(item => (
            <button
              key={item.id}
              className={`nav-item${activeSection === item.id ? " active" : ""}`}
              onClick={() => setActiveSection(item.id)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18 }}>{item.icon}</svg>
              {item.label}
            </button>
          ))}

          <PortaisNav currentPage="admin" pushToBottom={true} borderColor="rgba(255,255,255,0.12)" />
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
            <BotaoSuporte />
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
                { label: "Aguardando correção", value: stats.correcoes, bar: "bar-blue" },
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
              {selecionadosVisiveis.length > 0 && (
                <button className="btn btn-danger btn-sm" onClick={excluirSelecionados} disabled={excluindo}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                  </svg>
                  {excluindo ? "EXCLUINDO..." : `EXCLUIR SELECIONADOS (${selecionadosVisiveis.length})`}
                </button>
              )}
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
                      <th style={{ width: 36 }}>
                        <input
                          type="checkbox"
                          aria-label="Selecionar todos os trabalhos listados"
                          checked={todosVisiveisMarcados}
                          onChange={e => {
                            const marcar = e.target.checked;
                            setSelecionados(atual => {
                              const proximo = new Set(atual);
                              filtered.forEach(t => marcar ? proximo.add(t.id) : proximo.delete(t.id));
                              return proximo;
                            });
                          }}
                        />
                      </th>
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
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Selecionar "${t.titulo}"`}
                            checked={selecionados.has(t.id)}
                            onChange={() => alternarSelecao(t.id)}
                          />
                        </td>
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
                            {/* Abre a rodada de correção para o autor sem
                                esperar os 3 pareceres (override manual). */}
                            {t.status !== "aprovado_correcoes" && (
                              <button className="btn btn-outline btn-sm" style={{ padding: "4px 8px", fontSize: 11 }} onClick={() => updateStatus(t.id, "aprovado_correcoes")}>Aprovar c/ correções</button>
                            )}
                            {t.status !== "reprovado" && (
                              <button className="btn btn-danger btn-sm" style={{ padding: "4px 8px", fontSize: 11 }} onClick={() => updateStatus(t.id, "reprovado")}>Reprovar</button>
                            )}
                            {/* Exclusão definitiva — leva pareceres,
                                avaliações, revisores e o PDF junto. É a
                                limpeza de fim de edição. */}
                            <button
                              className="btn btn-sm"
                              style={{ padding: "4px 8px", fontSize: 11, background: "transparent", color: "var(--color-danger)", border: "1px solid var(--color-danger)" }}
                              disabled={excluindo}
                              onClick={() => excluirUm(t)}
                            >
                              Excluir
                            </button>
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
            {activeSection === "conflitos" && <ConflitosPanel />}
          </div>

          {/* PAPÉIS */}
          <div className={`section${activeSection === "papeis" ? " active" : ""}`}>
            <div className="page-header">
              <div className="page-overline">CONTROLE DE ACESSO</div>
              <h1 className="page-title">Papéis das contas.</h1>
              <p style={{ fontSize: "var(--fs-sm)", color: "var(--color-text-secondary)" }}>Conceda ou remova qualquer papel de qualquer conta.</p>
            </div>
            {activeSection === "papeis" && <PapeisPanel />}
          </div>

          {/* USUÁRIOS */}
          <div className={`section${activeSection === "usuarios" ? " active" : ""}`}>
            <div className="page-header">
              <div className="page-overline">CONTAS CADASTRADAS</div>
              <h1 className="page-title">Usuários da plataforma.</h1>
              <p style={{ fontSize: "var(--fs-sm)", color: "var(--color-text-secondary)" }}>Estudantes, professores, avaliadores e participantes externos. Contas de administrador não são listadas.</p>
            </div>
            {activeSection === "usuarios" && <UsuariosPanel />}
          </div>

          {/* CONFIGURAÇÕES */}
          <div className={`section${activeSection === "configuracoes" ? " active" : ""}`}>
            <div className="page-header">
              <div className="page-overline">CONFIGURAÇÕES DO CONGRESSO</div>
              <h1 className="page-title">Parâmetros operacionais.</h1>
              <p style={{ fontSize: "var(--fs-sm)", color: "var(--color-text-secondary)" }}>Defina prazos, regras de submissão e alertas automáticos.</p>
            </div>

            {!config ? (
              <div style={{ textAlign: "center", padding: 48, color: "var(--color-text-muted)" }}>Carregando configurações...</div>
            ) : (
            <div className="config-cards">
              <div className="config-card">
                <div className="config-card-header">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 20, height: 20 }}>
                    <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                  </svg>
                  <span className="config-title">Prazos da Edição</span>
                </div>

                <div className="alert alert-warning alert-admin" style={{ marginBottom: "var(--space-4)" }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18, flexShrink: 0, marginTop: 1 }}>
                    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                  </svg>
                  <div>
                    <strong>ESTE PRAZO É APLICADO DE VERDADE.</strong> Fora da janela, o banco recusa
                    novas submissões e a edição de trabalhos ainda pendentes. As duas pontas são
                    inclusivas, um encerramento em 31/05 aceita envio durante todo o dia 31, no
                    horário de Brasília. <strong>Campo vazio = sem prazo</strong>, e trabalhos
                    <strong> aprovados com correções continuam editáveis</strong> mesmo depois do
                    encerramento.
                  </div>
                </div>

                <div className="config-row">
                  <div className="form-group">
                    <label className="form-label" htmlFor="cfg-abertura">Abertura de Submissões</label>
                    <input
                      type="date"
                      id="cfg-abertura"
                      className="form-input"
                      value={config.submissoes_abertura ?? ""}
                      onChange={e => setCampo("submissoes_abertura", e.target.value || null)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="cfg-encerramento">Encerramento</label>
                    <input
                      type="date"
                      id="cfg-encerramento"
                      className="form-input"
                      value={config.submissoes_encerramento ?? ""}
                      onChange={e => setCampo("submissoes_encerramento", e.target.value || null)}
                    />
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
                  <label className="form-label" htmlFor="cfg-alerta">Antecedência de Alerta (Horas)</label>
                  <input type="number" id="cfg-alerta" className="form-input" value={config.alerta_horas} min={1} style={{ maxWidth: 200 }} onChange={e => setCampo("alerta_horas", Number(e.target.value))} />
                  <div className="config-display">EQUIVALE A {config.alerta_horas}h ≈ {(config.alerta_horas / 24).toFixed(1)} dias</div>
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
                {/* ⚠ Diferente do prazo acima, estes três são apenas
                    GRAVADOS: ainda não há regra de servidor aplicando
                    nenhum deles. Usar um exige escrever a trava em SQL. */}
                <div className="config-row">
                  <div className="form-group">
                    <label className="form-label" htmlFor="cfg-min-parecer">Tamanho Mínimo do Parecer (Caracteres)</label>
                    <input type="number" id="cfg-min-parecer" className="form-input" value={config.parecer_min_caracteres} min={100} onChange={e => setCampo("parecer_min_caracteres", Number(e.target.value))} />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="cfg-max-coautores">Máximo de Coautores</label>
                    <input type="number" id="cfg-max-coautores" className="form-input" value={config.max_coautores} min={1} onChange={e => setCampo("max_coautores", Number(e.target.value))} />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="cfg-edital">Mensagem do Edital</label>
                  <textarea id="cfg-edital" className="form-textarea" value={config.edital} onChange={e => setCampo("edital", e.target.value)} rows={4} />
                </div>
              </div>

              <div className="config-card">
                <div className="config-card-header">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 20, height: 20 }}>
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
                  </svg>
                  <span className="config-title">Links de Downloads (Google Drive)</span>
                </div>
                {/* Estes links alimentam TODOS os botões BAIXAR do site.
                    Campo vazio deixa o botão correspondente desabilitado —
                    é o estado normal enquanto o arquivo não foi publicado. */}
                <p style={{ fontSize: "var(--fs-caption)", color: "var(--color-text-secondary)", marginBottom: 16 }}>
                  Cole o link de compartilhamento do Drive. Os quatro primeiros aparecem na página
                  inicial, na tela de login e em Templates; os demais, no arquivo do revisor.
                  Lembre-se de deixar o arquivo acessível a quem tem o link.
                </p>

                <div style={{ fontWeight: "var(--fw-bold)", fontSize: "var(--fs-caption)", letterSpacing: "var(--ls-label)", color: "var(--color-text-secondary)", marginBottom: 8 }}>
                  PORTAL DO ESTUDANTE E PÁGINAS PÚBLICAS
                </div>
                <div className="config-row">
                  <div className="form-group">
                    <label className="form-label" htmlFor="cfg-word">Modelo de artigo · Word (DOCX)</label>
                    <input type="url" id="cfg-word" className="form-input" value={config.link_template_word} onChange={e => setCampo("link_template_word", e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="cfg-latex">Modelo de artigo · LaTeX (TEX)</label>
                    <input type="url" id="cfg-latex" className="form-input" value={config.link_template_latex} onChange={e => setCampo("link_template_latex", e.target.value)} />
                  </div>
                </div>
                <div className="config-row">
                  <div className="form-group">
                    <label className="form-label" htmlFor="cfg-slides">Modelo dos slides (PPTX)</label>
                    <input type="url" id="cfg-slides" className="form-input" value={config.link_template_slides} onChange={e => setCampo("link_template_slides", e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="cfg-normas">Normas de formatação (PDF)</label>
                    <input type="url" id="cfg-normas" className="form-input" value={config.link_normas_formatacao} onChange={e => setCampo("link_normas_formatacao", e.target.value)} />
                  </div>
                </div>

                <div style={{ fontWeight: "var(--fw-bold)", fontSize: "var(--fs-caption)", letterSpacing: "var(--ls-label)", color: "var(--color-text-secondary)", margin: "16px 0 8px" }}>
                  PAINEL DO REVISOR
                </div>
                <div className="config-row">
                  <div className="form-group">
                    <label className="form-label" htmlFor="cfg-edital-link">Edital do Congresso (PDF)</label>
                    <input type="url" id="cfg-edital-link" className="form-input" value={config.link_edital_congresso} onChange={e => setCampo("link_edital_congresso", e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="cfg-manual">Manual do Revisor (PDF)</label>
                    <input type="url" id="cfg-manual" className="form-input" value={config.link_manual_revisor} onChange={e => setCampo("link_manual_revisor", e.target.value)} />
                  </div>
                </div>
                <div className="config-row">
                  <div className="form-group">
                    <label className="form-label" htmlFor="cfg-diretrizes">Diretrizes de Avaliação (PDF)</label>
                    <input type="url" id="cfg-diretrizes" className="form-input" value={config.link_diretrizes_avaliacao} onChange={e => setCampo("link_diretrizes_avaliacao", e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="cfg-etica">Código de Ética (PDF)</label>
                    <input type="url" id="cfg-etica" className="form-input" value={config.link_codigo_etica} onChange={e => setCampo("link_codigo_etica", e.target.value)} />
                  </div>
                </div>
              </div>
            </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 24 }}>
              <button className="btn btn-primary" onClick={saveConfig} disabled={!config || salvandoConfig}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                {salvandoConfig ? "SALVANDO..." : "SALVAR CONFIGURAÇÕES"}
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
                    <div className="notification-desc">{t.titulo}, por {t.autores}</div>
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
