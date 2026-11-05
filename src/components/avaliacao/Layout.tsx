import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { estadoDoPeriodo, rotuloPeriodo } from "@/lib/cronograma";
import { carregarPeriodoAvaliacao, type PeriodoAvaliacao } from "@/services/avaliacaoEventoService";
import { useAuth } from "@/contexts/AuthContext";
import { PortaisNav } from "@/components/PortaisNav";
import { BotaoRecolherSidebar } from "@/components/BotaoRecolherSidebar";
import { BotaoMenuMobile } from "@/components/BotaoMenuMobile";
import { supabase } from "@/integrations/supabase/client";
import { initials } from "@/pages/revisor/shared";
import { BotaoSuporte } from "@/components/BotaoSuporte";
import { BotaoNotificacoes } from "@/components/BotaoNotificacoes";
import { APP_SHORT } from "@/lib/brand";

const NAV_ITEMS: { to: string; label: string; icon: React.ReactNode }[] = [
  { to: "/avaliacao/minhas", label: "Minhas Avaliações", icon: <><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/><path d="m9 14 2 2 4-4"/></> },
  { to: "/avaliacao/buscar", label: "Buscar Trabalhos", icon: <><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></> },
];

/**
 * Fora da janela (`/admin/configuracoes`) o portal não mostra nada: a lista
 * traz título e autores, e um professor revisor acharia ali quem escreveu o
 * trabalho que está revisando às cegas. Isto é cortesia — quem fecha é
 * `trabalhos_para_avaliacao()`, que fora da janela não devolve nada.
 */
function PortalFechado({ periodo }: { periodo: PeriodoAvaliacao }) {
  const { abertura, encerramento, hoje } = periodo;
  let frase = "A organização ainda não definiu o período de avaliação.";
  if (abertura && encerramento) {
    frase = hoje && estadoDoPeriodo(abertura, encerramento, hoje) === "encerrado"
      ? `O período de avaliação foi de ${rotuloPeriodo(abertura, encerramento)} e já foi encerrado.`
      : `O período de avaliação ainda não começou. Ele vai de ${rotuloPeriodo(abertura, encerramento)}.`;
  }
  return (
    <div className="section active">
      <div className="content-area">
        <div className="empty-state">
          <h3 className="empty-state-title">Avaliação fechada</h3>
          <p className="empty-state-description">{frase}</p>
        </div>
      </div>
    </div>
  );
}

const Layout = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [periodo, setPeriodo] = useState<PeriodoAvaliacao | null>(null);

  useEffect(() => {
    let vivo = true;
    carregarPeriodoAvaliacao().then((p) => vivo && setPeriodo(p));
    return () => {
      vivo = false;
    };
  }, []);

  async function handleLogout() {
    await supabase.auth.signOut();
    navigate("/login");
  }

  return (
    <div>
      <aside className="sidebar" id="menu-lateral">
        <BotaoRecolherSidebar />

        <NavLink to="/avaliacao" className="sidebar-logo">
          <div className="logo-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 20, height: 20 }}>
              <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
              <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
            </svg>
          </div>
          <div>
            <div className="logo-text">{APP_SHORT}</div>
            <div className="logo-sub">Avaliação</div>
          </div>
        </NavLink>

        <nav className="sidebar-nav">
          {NAV_ITEMS.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              title={item.label}
              className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18 }}>{item.icon}</svg>
              {item.label}
            </NavLink>
          ))}

          <PortaisNav currentPage="avaliacao" pushToBottom={true} />
        </nav>

        <div className="sidebar-footer">
          <button className="nav-item" onClick={handleLogout} title="Sair" style={{ width: "100%" }}>
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
          <BotaoMenuMobile />
          <span className="top-bar-title">AVALIAÇÃO</span>
          <div className="user-info">
            <div className="user-details rotulo-icone">
              <div className="user-name">{user?.nome}</div>
              <div className="user-meta">{user?.email}</div>
            </div>
            <div className="user-avatar" style={{ background: "var(--color-primary)" }}>{initials(user?.nome)}</div>
            <BotaoNotificacoes />
            <BotaoSuporte />
          </div>
        </header>

        {periodo === null ? null : periodo.aberto === false ? <PortalFechado periodo={periodo} /> : <Outlet />}
      </main>
    </div>
  );
};

export default Layout;
