import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { PortaisNav } from "@/components/PortaisNav";
import { supabase } from "@/integrations/supabase/client";

const NAV_ITEMS: { to: string; label: string; icon: React.ReactNode }[] = [
  { to: "/estudante/dashboard", label: "Dashboard", icon: <><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></> },
  { to: "/estudante/nova-submissao", label: "Nova Submissão", icon: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></> },
  { to: "/estudante/historico", label: "Histórico", icon: <><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></> },
  { to: "/estudante/templates", label: "Templates", icon: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></> },
];

const Layout = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  const initials = (nome?: string) =>
    nome ? nome.split(" ").map(n => n[0]).slice(0, 2).join("").toUpperCase() : "U";

  return (
    <div>
      <aside className="sidebar">
        <NavLink to="/estudante/dashboard" className="sidebar-logo">
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

        <Outlet />
      </main>
    </div>
  );
};

export default Layout;
