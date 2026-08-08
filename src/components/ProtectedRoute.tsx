import { useEffect } from "react";
import { useNavigate, Outlet } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import type { UserRole } from "@/contexts/AuthContext";
import { portalDoPapel } from "@/lib/portais";

type Props = {
  allowedRoles: UserRole[];
  /**
   * Desvia para /verifique-email quem ainda não confirmou o e-mail.
   * Só a própria /verifique-email passa `false` — do contrário ela
   * desviaria para si mesma em laço.
   *
   * É cortesia de interface, não segurança: a conta não confirmada que
   * driblar isto continua batendo no RLS, que recusa os dados gateados.
   */
  exigeEmailConfirmado?: boolean;
};

export const ProtectedRoute = ({ allowedRoles, exigeEmailConfirmado = true }: Props) => {
  const { role, emailConfirmado, loading } = useAuth();
  const navigate = useNavigate();

  // `null` significa "não sabemos" (RPC falhou) — não bloqueia.
  const faltaConfirmar = exigeEmailConfirmado && emailConfirmado === false;

  useEffect(() => {
    if (loading) return;
    if (!role) { navigate("/login"); return; }
    if (faltaConfirmar) { navigate("/verifique-email"); return; }
    if (!allowedRoles.includes(role)) {
      navigate(portalDoPapel(role));
    }
  }, [role, faltaConfirmar, loading, navigate, allowedRoles]);

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", fontSize: "14px", color: "var(--color-text-muted, #666)" }}>
        Verificando acesso...
      </div>
    );
  }

  if (!role || faltaConfirmar || !allowedRoles.includes(role)) return null;
  return <Outlet />;
};
