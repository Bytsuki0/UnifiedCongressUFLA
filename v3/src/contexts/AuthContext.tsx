import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

export type UserRole = "estudante" | "professor" | "avaliador" | "admin";

export type AuthUser = {
  id: string;
  email: string;
  nome: string;
};

type AuthContextType = {
  user: AuthUser | null;
  role: UserRole | null;
  loading: boolean;
};

const AuthContext = createContext<AuthContextType>({ user: null, role: null, loading: true });

const ADMIN_EMAIL = "bytsuki066@gmail.com";

async function resolveRole(email: string): Promise<UserRole> {
  if (email === ADMIN_EMAIL) return "admin";

  const { data: avaliador } = await supabase
    .from("avaliadores")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (avaliador) return "avaliador";

  const { data: professor } = await (supabase.from("professores" as never) as any)
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (professor) return "professor";

  return "estudante";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  const [loading, setLoading] = useState(true);

  const applySession = async (session: any) => {
    if (!session) {
      setUser(null);
      setRole(null);
      setLoading(false);
      return;
    }
    const email = session.user.email!;
    const nome = session.user.user_metadata?.nome || email.split("@")[0];
    setUser({ id: session.user.id, email, nome });
    const r = await resolveRole(email);
    setRole(r);
    setLoading(false);
  };

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
    <AuthContext.Provider value={{ user, role, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
