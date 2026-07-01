import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { PortaisNav } from "@/components/PortaisNav";

const Layout = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    toast.success("Sessão encerrada.");
    navigate("/login");
  };

  const navItem = (active: boolean) => `nav-item${active ? " active" : ""}`;

  const initials = (nome?: string) =>
    nome ? nome.split(" ").map(n => n[0]).slice(0, 2).join("").toUpperCase() : "NC";

  return (
    <div>
      <aside className="sidebar" style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
        <NavLink to="/dashboard" className="sidebar-logo">
          <div className="logo-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 20, height: 20 }}>
              <path d="M21.5 2v6h-6"/>
              <path d="M2.5 22v-6h6"/>
              <path d="M21.1 8A9 9 0 0 0 5.3 5.3L2.5 8"/>
              <path d="M2.9 16a9 9 0 0 0 15.8 2.7l2.8-2.7"/>
            </svg>
          </div>
          <div>
            <div className="logo-text">NEXUS</div>
            <div className="logo-sub">Gestão de Co-Chairs</div>
          </div>
        </NavLink>

        {/* TOP section - grows to fill available space */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          <div className="sidebar-section-label">PRINCIPAL</div>

          <nav className="sidebar-nav">
            <NavLink to="/dashboard" className={({ isActive }) => navItem(isActive)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18 }}>
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                <polyline points="9 22 9 12 15 12 15 22"/>
              </svg>
              Painel de Controle
            </NavLink>

            <NavLink to="/avaliadores" className={({ isActive }) => navItem(isActive)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18 }}>
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
              Co-chairs
            </NavLink>

            <NavLink to="/categorias" className={({ isActive }) => navItem(isActive)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18 }}>
                <rect x="3" y="3" width="7" height="7" rx="1"/>
                <rect x="14" y="3" width="7" height="7" rx="1"/>
                <rect x="3" y="14" width="7" height="7" rx="1"/>
                <rect x="14" y="14" width="7" height="7" rx="1"/>
              </svg>
              Categorias
            </NavLink>

            <NavLink to="/atribuicoes" className={({ isActive }) => navItem(isActive)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18 }}>
                <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
                <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
                <path d="M9 14l2 2 4-4"/>
              </svg>
              Atribuições
            </NavLink>

            <NavLink to="/rankings" className={({ isActive }) => navItem(isActive)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18 }}>
                <path d="M8 21h8"/>
                <path d="M12 17v4"/>
                <path d="M7 4h10v4a5 5 0 0 1-10 0V4z"/>
                <path d="M17 5h3a2 2 0 0 1-2 3h-1"/>
                <path d="M7 5H4a2 2 0 0 0 2 3h1"/>
              </svg>
              Rankings
            </NavLink>
          </nav>
        </div>

        {/* BOTTOM section - sticks to bottom */}
        <div>
          <nav className="sidebar-nav">
            <PortaisNav currentPage="dashboard" />
          </nav>

          <div className="sidebar-footer">
            <button className="nav-item" onClick={handleLogout} style={{ width: "100%", background: "none", border: "none", cursor: "pointer" }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18 }}>
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                <polyline points="16 17 21 12 16 7"/>
                <line x1="21" y1="12" x2="3" y2="12"/>
              </svg>
              Sair
            </button>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="top-bar">
          <span className="top-bar-title">CONGRESSO ACADÊMICO - GESTÃO DE CO-CHAIRS</span>
          <div className="user-info">
            <div className="user-details">
              <div className="user-name">{user?.nome || "Nexus Corp"}</div>
              <div className="user-meta">{user?.email || "Sistema de Submissões"}</div>
            </div>
            <div className="user-avatar">{initials(user?.nome)}</div>
          </div>
        </header>

        <div className="content-area">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

export default Layout;