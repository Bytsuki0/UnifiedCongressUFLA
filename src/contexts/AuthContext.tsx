import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from "react";
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

  /** Conta cujo papel já está resolvido (ou em resolução neste instante). */
  const contaEmMemoria = useRef<string | null>(null);
  /** Ordena resoluções concorrentes: só a última pode escrever o estado. */
  const geracao = useRef(0);

  const applySession = useCallback(async (session: Session | null) => {
    const minhaGeracao = ++geracao.current;

    if (!session) {
      contaEmMemoria.current = null;
      setUser(null);
      setRole(null);
      setEmailConfirmado(null);
      setLoading(false);
      return;
    }
    const email = session.user.email!;
    const nome = session.user.user_metadata?.nome || email.split("@")[0];
    setUser({ id: session.user.id, email, nome });

    // Conta diferente da que está em memória (login recém-feito, troca de
    // usuário): o papel ainda NÃO vale. Voltar a `loading` é o que segura o
    // <ProtectedRoute> — sem isto ele lê `role === null` como "não
    // autenticado" e devolve para /login justamente quem acabou de entrar.
    // Em TOKEN_REFRESHED a conta é a mesma e nada disso acontece, senão a
    // tela piscaria "Verificando acesso..." a cada renovação de token.
    if (contaEmMemoria.current !== session.user.id) {
      contaEmMemoria.current = session.user.id;
      setRole(null);
      setEmailConfirmado(null);
      setLoading(true);
    }

    // As duas RPCs são independentes: em paralelo, para não somar as
    // latências antes de liberar a primeira tela.
    const [r, confirmado] = await Promise.all([resolveMyRole(), emailEstaConfirmado()]);
    // Chegou atrasada, já há resolução mais nova em voo: descartar. Escrever
    // aqui reporia o papel da sessão ANTERIOR por cima da atual.
    if (minhaGeracao !== geracao.current) return;
    setRole(r);
    setEmailConfirmado(confirmado);
    setLoading(false);
  }, []);

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
      // ⚠ O supabase-js chama este callback COM O LOCK do auth segurado.
      // Chamar supabase.rpc() aqui dentro trava até o lock ser liberado — e é
      // exatamente essa espera que abria a janela em que `role` ficava nulo
      // depois do login. O setTimeout joga o trabalho para a volta seguinte
      // do event loop, já sem o lock.
      setTimeout(() => { applySession(session); }, 0);
    });

    return () => subscription.unsubscribe();
  }, [applySession]);

  return (
    <AuthContext.Provider value={{ user, role, emailConfirmado, loading, revalidarEmailConfirmado }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
