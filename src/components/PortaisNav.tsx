import { NavLink } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import type { UserRole } from "@/contexts/AuthContext";

type CurrentPage = "estudante" | "revisor" | "admin" | "dashboard" | "congresso";

const NAV_ITEMS: Record<string, { label: string; to: string; icon: React.ReactNode }> = {
  estudante: {
    label: "Portal Estudante",
    to: "/estudante",
    icon: (
      <>
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
      </>
    ),
  },
  revisor: {
    label: "Portal Revisor",
    to: "/revisor",
    icon: (
      <>
        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
      </>
    ),
  },
  dashboard: {
    label: "Portal Controle",
    to: "/dashboard",
    icon: (
      <>
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
        <polyline points="9 22 9 12 15 12 15 22"/>
      </>
    ),
  },
  admin: {
    label: "Portal Admin",
    to: "/admin",
    icon: (
      <>
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
      </>
    ),
  },
  congresso: {
    label: "Congresso",
    to: "/congresso/dashboard",
    icon: (
      <>
        <path d="M8 2v4"/>
        <path d="M16 2v4"/>
        <rect width="18" height="18" x="3" y="4" rx="2"/>
        <path d="M3 10h18"/>
      </>
    ),
  },
};

function getPortaisItems(role: UserRole): string[] {
  // Fixed, canonical order per role. The current page is NOT removed — it stays
  // in place (marked active) so the portal buttons never shift position.
  const byRole: Record<UserRole, string[]> = {
    estudante: ["congresso"],
    professor: ["estudante", "revisor", "congresso"],
    avaliador: ["dashboard", "estudante", "revisor", "congresso"],
    admin: ["dashboard", "estudante", "revisor", "admin", "congresso"],
  };
  return byRole[role] || [];
}

type Props = {
  currentPage: CurrentPage;
  pushToBottom?: boolean;
  borderColor?: string;
};

export function PortaisNav({ currentPage, pushToBottom = false, borderColor = "var(--color-border)" }: Props) {
  const { role } = useAuth();
  if (!role) return null;

  const items = getPortaisItems(role);
  if (items.length === 0) return null;

  const content = (
    <>
      <div style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.1em", color: "var(--color-text-muted)", padding: "0 0 var(--space-2) 0", textTransform: "uppercase" }}>
        PORTAIS
      </div>
      {items.map(key => {
        const item = NAV_ITEMS[key];
        const isCurrent = key === currentPage;
        return (
          <NavLink
            key={key}
            to={item.to}
            className={`nav-item${isCurrent ? " active" : ""}`}
            aria-current={isCurrent ? "page" : undefined}
            style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", textDecoration: "none" }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18 }}>
              {item.icon}
            </svg>
            {item.label}
          </NavLink>
        );
      })}
    </>
  );

  if (pushToBottom) {
    return (
      <div style={{ marginTop: "auto", paddingTop: "var(--space-4)", borderTop: `1px solid ${borderColor}` }}>
        {content}
      </div>
    );
  }

  return <div>{content}</div>;
}
