import { NavLink, useNavigate, useLocation, type To } from "react-router-dom";
import {
  LayoutDashboard, Calendar, GraduationCap, IdCard, Info, UserCircle2,
  Ticket, Shield, Bell, Users, QrCode, ChevronRight, X,
} from "lucide-react";
import { NotificationsBell } from "./NotificationsBell";
import { PortaisNav } from "@/components/PortaisNav";
import { e, EVENT_BASE } from "./paths";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { useState, type ReactNode } from "react";

type Item = { to: string; label: string; icon: React.ComponentType<{ size?: number }>; end?: boolean };

const ADMIN_OPEN_KEY = "congresso:adminOpen";
const ADMIN_PREFIX = `${EVENT_BASE}/admin`;

const participantItems: Item[] = [
  { to: e("/dashboard"), label: "Início", icon: LayoutDashboard },
  { to: e("/inscricao"), label: "Inscrição", icon: Ticket },
  { to: e("/programacao"), label: "Programação", icon: Calendar },
  { to: e("/minicursos"), label: "Minicursos", icon: GraduationCap },
  { to: e("/certificados"), label: "Certificados", icon: IdCard },
  { to: e("/perfil"), label: "Perfil", icon: UserCircle2 },
  { to: e("/informacoes"), label: "Informações", icon: Info },
];

const adminItems: Item[] = [
  { to: e("/admin"), label: "Painel do Congresso", icon: Shield, end: true },
  { to: e("/admin/usuarios"), label: "Usuários", icon: Users },
  { to: e("/admin/inscricoes"), label: "Inscrições", icon: Ticket },
  { to: e("/admin/minicursos"), label: "Minicursos", icon: GraduationCap },
  { to: e("/admin/programacao"), label: "Programação", icon: Calendar },
  { to: e("/admin/certificados"), label: "Certificados", icon: IdCard },
  { to: e("/admin/verificar"), label: "Presença & QR", icon: QrCode },
  { to: e("/admin/notificacoes"), label: "Notificações", icon: Bell },
];

const navItemClass = ({ isActive }: { isActive: boolean }) => `nav-item${isActive ? " active" : ""}`;

function NavItems({ items }: { items: Item[] }) {
  return (
    <nav className="sidebar-nav">
      {items.map((item) => (
        <NavLink key={item.to} to={item.to as To} end={item.end} className={navItemClass}>
          <item.icon size={18} />
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}

// Read the persisted open-state synchronously so there is no flash on remount.
function readInitialOpen(pathname: string) {
  if (pathname.startsWith(ADMIN_PREFIX)) return true; // always open while inside the admin area
  try {
    return localStorage.getItem(ADMIN_OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function AppLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { user, role } = useAuth();
  const canAdmin = role === "avaliador" || role === "admin";

  const [adminOpen, setAdminOpen] = useState(() => readInitialOpen(pathname));
  const onAdminArea = pathname.startsWith(ADMIN_PREFIX);
  const subnavOpen = canAdmin && adminOpen;

  const persist = (open: boolean) => {
    try { localStorage.setItem(ADMIN_OPEN_KEY, open ? "1" : "0"); } catch { /* ignore */ }
  };
  const toggleAdmin = () => setAdminOpen((v) => { persist(!v); return !v; });
  const closeAdmin = () => { persist(false); setAdminOpen(false); };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    toast.success("Sessão encerrada.");
    navigate("/login");
  };

  const initials = (nome?: string) =>
    nome ? nome.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase() : "CU";

  return (
    <div>
      <aside className="sidebar" style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
        <NavLink to={e("/dashboard")} className="sidebar-logo">
          <div className="logo-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 20, height: 20 }}>
              <path d="M8 2v4" /><path d="M16 2v4" />
              <rect width="18" height="18" x="3" y="4" rx="2" /><path d="M3 10h18" />
            </svg>
          </div>
          <div>
            <div className="logo-text">Congresso</div>
            <div className="logo-sub">UFLA Paraíso</div>
          </div>
        </NavLink>

        <div style={{ flex: 1, overflowY: "auto" }}>
          <div className="sidebar-section-label">PARTICIPANTE</div>
          <NavItems items={participantItems} />

          {canAdmin && (
            <>
              <div className="sidebar-section-label" style={{ marginTop: "var(--space-4)" }}>GESTÃO</div>
              <nav className="sidebar-nav">
                <button
                  type="button"
                  onClick={toggleAdmin}
                  className={`nav-item${subnavOpen ? " active" : ""}`}
                  style={{ width: "100%", border: "none", cursor: "pointer", textAlign: "left" }}
                >
                  <Shield size={18} />
                  Administração
                  <ChevronRight
                    size={16}
                    style={{ marginLeft: "auto", transition: "transform 150ms", transform: subnavOpen ? "rotate(90deg)" : "none" }}
                  />
                </button>
              </nav>
            </>
          )}
        </div>

        <div>
          <nav className="sidebar-nav">
            <PortaisNav currentPage="congresso" />
          </nav>

          <div className="sidebar-footer">
            <button className="nav-item" onClick={handleLogout} style={{ width: "100%", background: "none", border: "none", cursor: "pointer" }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18 }}>
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="3" y2="12" />
              </svg>
              Sair
            </button>
          </div>
        </div>
      </aside>

      {subnavOpen && (
        <aside className="sidebar sidebar-subnav" style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
          <div className="sidebar-subnav-header">
            <div className="logo-text">Administração</div>
            {!onAdminArea && (
              <button type="button" className="sidebar-subnav-close" onClick={closeAdmin} aria-label="Fechar administração">
                <X size={18} />
              </button>
            )}
          </div>
          <div style={{ flex: 1, overflowY: "auto" }}>
            <NavItems items={adminItems} />
          </div>
        </aside>
      )}

      <main className={`main-content${subnavOpen ? " with-subnav" : ""}`}>
        <header className="top-bar">
          <span className="top-bar-title">CONGRESSO UNIFICADO UFLA PARAÍSO</span>
          <div className="user-info">
            <NotificationsBell />
            <div className="user-details">
              <div className="user-name">{user?.nome || "Visitante"}</div>
              <div className="user-meta">{user?.email || "Congresso Unificado"}</div>
            </div>
            <div className="user-avatar purple">{initials(user?.nome)}</div>
          </div>
        </header>

        <div className="content-area">{children}</div>
      </main>
    </div>
  );
}
