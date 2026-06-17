import { useEffect } from "react";
import { useNavigate, Outlet } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import type { UserRole } from "@/contexts/AuthContext";

type Props = {
  allowedRoles: UserRole[];
};

function redirectForRole(role: UserRole): string {
  if (role === "estudante") return "/estudante";
  if (role === "professor") return "/revisor";
  return "/dashboard";
}

export const ProtectedRoute = ({ allowedRoles }: Props) => {
  const { role, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (!role) { navigate("/login"); return; }
    if (!allowedRoles.includes(role)) {
      navigate(redirectForRole(role));
    }
  }, [role, loading, navigate, allowedRoles]);

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", fontSize: "14px", color: "var(--color-text-muted, #666)" }}>
        Verificando acesso...
      </div>
    );
  }

  if (!role || !allowedRoles.includes(role)) return null;
  return <Outlet />;
};
