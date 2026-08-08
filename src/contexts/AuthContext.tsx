import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { emailEstaConfirmado } from "@/services/verificacaoEmailService";

export type UserRole = "estudante" | "professor" | "avaliador" | "admin" | "externo";

export type AuthUser = {
  id: string;
  email: string;
  nome: string;
};

type AuthContextType = {
  user: AuthUser | null;
  role: UserRole | null;
  /**
   * `true`/`false` conforme o banco; `null` = ainda não sabemos (sem sessão
   * ou a RPC falhou). A interface só desvia quem for `false` — tratar `null`
   * como "não confirmado" trancaria o usuário para fora por causa de uma
   * falha de rede, e a barreira de verdade é o RLS, não esta tela.
   */
  emailConfirmado: boolean | null;
  loading: boolean;
  /** Relê `email_confirmado()` — usado após o clique no link de confirmação. */
  revalidarEmailConfirmado: () => Promise<boolean | null>;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  role: null,
  emailConfirmado: null,
  loading: true,
  revalidarEmailConfirmado: async () => null,
});

const ROLE_PRIORITY: UserRole[] = ["admin", "avaliador", "professor", "estudante", "externo"];

/**
 * Papel do usuário logado, resolvido no servidor (public.user_roles via
 * get_my_roles). A autorização real é aplicada por RLS no banco — este
 * valor só orienta a navegação da interface.
 */
export async function resolveMyRole(): Promise<UserRole> {
  const { data, error } = await supabase.rpc("get_my_roles");
  if (!error && Array.isArray(data)) {
    for (const role of ROLE_PRIORITY) {
      if (data.includes(role)) return role;
    }
  }
  // Sem papel resolvido, assume o menor privilégio.
  return "externo";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  const [emailConfirmado, setEmailConfirmado] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  const applySession = async (session: Session | null) => {
    if (!session) {
      setUser(null);
      setRole(null);
      setEmailConfirmado(null);
      setLoading(false);
      return;
    }
    const email = session.user.email!;
    const nome = session.user.user_metadata?.nome || email.split("@")[0];
    setUser({ id: session.user.id, email, nome });
    // As duas RPCs são independentes: em paralelo, para não somar as
    // latências antes de liberar a primeira tela.
    const [r, confirmado] = await Promise.all([resolveMyRole(), emailEstaConfirmado()]);
    setRole(r);
    setEmailConfirmado(confirmado);
    setLoading(false);
  };

  /**
   * Relê a confirmação sem recarregar a página. Necessário porque quem
   * acabou de confirmar em /confirmar-email ainda carrega o `false` antigo
   * em memória — sem isto, o ProtectedRoute devolveria a pessoa recém
   * confirmada para /verifique-email.
   */
  const revalidarEmailConfirmado = useCallback(async () => {
    const confirmado = await emailEstaConfirmado();
    setEmailConfirmado(confirmado);
    return confirmado;
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      applySession(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      applySession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ user, role, emailConfirmado, loading, revalidarEmailConfirmado }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
