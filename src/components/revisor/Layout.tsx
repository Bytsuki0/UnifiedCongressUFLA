import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { PortaisNav } from "@/components/PortaisNav";
import { supabase } from "@/integrations/supabase/client";
import { initials } from "@/pages/revisor/shared";

const NAV_ITEMS: { to: string; label: string; icon: React.ReactNode }[] = [
  { to: "/revisor/analise", label: "Análise de Trabalhos", icon: <><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/><path d="m9 14 2 2 4-4"/></> },
  { to: "/revisor/formularios", label: "Formulários", icon: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></> },
  { to: "/revisor/arquivo", label: "Arquivo", icon: <><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5" rx="1"/><line x1="10" y1="12" x2="14" y2="12"/></> },
];

const Layout = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  async function handleLogout() {
    await supabase.auth.signOut();
    navigate("/login");
  }

  return (
    <div>
      <aside className="sidebar">
        <NavLink to="/revisor/atribuicoes" className="sidebar-logo">
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
        </NavLink>

        <nav className="sidebar-nav">
          {NAV_ITEMS.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18 }}>{item.icon}</svg>
              {item.label}
            </NavLink>
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

        <Outlet />
      </main>
    </div>
  );
};

export default Layout;
