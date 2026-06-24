import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Calendar,
  GraduationCap,
  IdCard,
  Info,
  UserCircle2,
  LogOut,
  Ticket,
  Shield,
  Menu,
  X,
  Bell,
} from "lucide-react";
import { Logo } from "./Logo";
import { DecorativeBg } from "./DecorativeBg";
import { NotificationsBell } from "./NotificationsBell";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { useState, type ReactNode } from "react";

const participantItems = [
  { to: "/dashboard", label: "Início", icon: LayoutDashboard },
  { to: "/inscricao", label: "Inscrição", icon: Ticket },
  { to: "/programacao", label: "Programação", icon: Calendar },
  { to: "/minicursos", label: "Minicursos", icon: GraduationCap },
  { to: "/certificados", label: "Certificados", icon: IdCard },
  { to: "/perfil", label: "Perfil", icon: UserCircle2 },
  { to: "/informacoes", label: "Informações", icon: Info },
];

const adminItems = [
  { to: "/admin", label: "Painel Admin", icon: Shield },
  { to: "/admin/usuarios", label: "Usuários", icon: UserCircle2 },
  { to: "/admin/inscricoes", label: "Inscrições", icon: Ticket },
  { to: "/admin/minicursos", label: "Minicursos", icon: GraduationCap },
  { to: "/admin/programacao", label: "Programação", icon: Calendar },
  { to: "/admin/certificados", label: "Certificados", icon: IdCard },
  { to: "/admin/verificar", label: "Verificar QR", icon: Shield },
  { to: "/admin/notificacoes", label: "Notificações", icon: Bell },
];

export function AppLayout({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const { user, isAdmin, signOut } = useAuth();
  const isAdminArea = pathname.startsWith("/admin");
  const items = isAdminArea ? adminItems : participantItems;
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    toast.success("Sessão encerrada");
    navigate({ to: "/" });
  };

  const NavList = ({ onNavigate }: { onNavigate?: () => void }) => (
    <nav className="flex flex-col gap-1.5">
      {items.map((item) => {
        const active =
          pathname === item.to ||
          (item.to !== "/admin" && pathname.startsWith(item.to + "/"));
        return (
          <Link
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            className={`flex items-center gap-3 rounded-xl border px-4 py-2.5 text-sm font-medium transition-all ${
              active
                ? "border-transparent text-primary shadow-[var(--shadow-soft)]"
                : "border-border bg-background/60 text-foreground hover:bg-accent/40"
            }`}
            style={active ? { backgroundImage: "var(--gradient-soft)" } : undefined}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </Link>
        );
      })}
      {isAdmin && !isAdminArea && (
        <Link to="/admin" onClick={onNavigate}
          className="mt-2 flex items-center gap-3 rounded-xl border border-primary/40 px-4 py-2.5 text-sm font-medium text-primary hover:bg-primary/5">
          <Shield className="h-4 w-4" /> Painel Admin
        </Link>
      )}
      {isAdminArea && (
        <Link to="/dashboard" onClick={onNavigate}
          className="mt-2 flex items-center gap-3 rounded-xl border border-border px-4 py-2.5 text-sm font-medium hover:bg-accent/40">
          <LayoutDashboard className="h-4 w-4" /> Voltar ao app
        </Link>
      )}
    </nav>
  );

  const UserCard = () => (
    <div className="mt-auto rounded-2xl p-4" style={{ backgroundImage: "var(--gradient-soft)" }}>
      <div className="flex items-center gap-2 text-sm font-semibold text-primary">
        <UserCircle2 className="h-5 w-5" />
        <span className="truncate">{user?.email ?? "Visitante"}</span>
      </div>
      <button onClick={handleSignOut}
        className="mt-2 flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-primary">
        <LogOut className="h-3 w-3" /> Sair
      </button>
    </div>
  );

  return (
    <div className="relative min-h-screen bg-background">
      <DecorativeBg />
      <div className="relative mx-auto flex max-w-7xl gap-6 p-4 md:p-6">
        <aside className="hidden md:flex w-64 shrink-0 flex-col gap-3 rounded-3xl bg-card p-5 shadow-[var(--shadow-card)]">
          <div className="px-2 py-3"><Logo /></div>
          <NavList />
          <UserCard />
        </aside>

        <main className="flex-1 min-w-0 rounded-3xl bg-card p-6 md:p-10 shadow-[var(--shadow-card)]">
          <div className="mb-4 flex items-center justify-between gap-2">
            <div className="md:hidden"><Logo /></div>
            <div className="hidden md:block flex-1" />
            <div className="flex items-center gap-2">
              <NotificationsBell />
              <button onClick={() => setMobileOpen(true)}
                className="md:hidden rounded-xl border border-border p-2"
                aria-label="Abrir menu">
                <Menu className="h-5 w-5" />
              </button>
            </div>
          </div>
          {children}
        </main>
      </div>

      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/40" onClick={() => setMobileOpen(false)} />
          <aside className="flex w-72 max-w-[85vw] flex-col gap-3 bg-card p-5 shadow-xl overflow-y-auto">
            <div className="flex items-center justify-between">
              <Logo />
              <button onClick={() => setMobileOpen(false)} aria-label="Fechar menu"
                className="rounded-lg border border-border p-1.5">
                <X className="h-4 w-4" />
              </button>
            </div>
            <NavList onNavigate={() => setMobileOpen(false)} />
            <UserCard />
          </aside>
        </div>
      )}
    </div>
  );
}
