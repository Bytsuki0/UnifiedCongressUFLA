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
    // `replace` nos três: são desvios, não navegação do usuário. Empilhados,
    // o "voltar" do navegador devolveria para a rota barrada, que desvia de
    // novo — o botão vira um laço.
    if (!role) { navigate("/login", { replace: true }); return; }
    if (faltaConfirmar) { navigate("/verifique-email", { replace: true }); return; }
    if (!allowedRoles.includes(role)) {
      navigate(portalDoPapel(role), { replace: true });
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
