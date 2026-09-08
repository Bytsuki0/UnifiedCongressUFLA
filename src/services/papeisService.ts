import { supabase } from "@/integrations/supabase/client";
import type { UserRole } from "@/contexts/AuthContext";

/**
 * Papéis das contas (`user_roles`) — o que a tela de Papéis do Admin edita,
 * mais a resolução do papel de quem está logado.
 *
 * A escrita é restrita ao admin pela policy `user_roles write`
 * (is_app_admin()). Estas funções não checam papel nenhum de propósito:
 * quem autoriza é o banco, e duplicar a regra aqui só criaria uma segunda
 * fonte de verdade para sair de sincronia.
 */

export type Conta = {
  id: string;
  nome: string | null;
  email: string | null;
  roles: UserRole[];
};

/**
 * Lista as contas com seus papéis.
 *
 * `profiles` e `user_roles` são lidas separadamente e cruzadas aqui: não
 * há relacionamento declarado entre elas no PostgREST, então um embed
 * não é possível sem criar uma view.
 */
export async function listarContasComPapeis(): Promise<Conta[]> {
  const [profiles, roles] = await Promise.all([
    supabase.from("profiles").select("id, nome, email").order("nome"),
    supabase.from("user_roles").select("user_id, role"),
  ]);
  if (profiles.error || roles.error) throw profiles.error ?? roles.error;

  const porUsuario = new Map<string, UserRole[]>();
  for (const r of (roles.data ?? []) as { user_id: string; role: UserRole }[]) {
    porUsuario.set(r.user_id, [...(porUsuario.get(r.user_id) ?? []), r.role]);
  }

  return (profiles.data ?? []).map((p) => ({
    ...p,
    roles: porUsuario.get(p.id) ?? [],
  }));
}

export async function concederPapel(userId: string, role: UserRole): Promise<void> {
  const { error } = await supabase.from("user_roles").insert({ user_id: userId, role });
  if (error) throw error;
}

export async function revogarPapel(userId: string, role: UserRole): Promise<void> {
  const { error } = await supabase
    .from("user_roles")
    .delete()
    .eq("user_id", userId)
    .eq("role", role);
  if (error) throw error;
}

/**
 * Ordem de precedência quando a conta tem mais de um papel.
 *
 * A interface só sabe lidar com UM papel (é ele que escolhe o portal
 * inicial e o que o `<ProtectedRoute>` compara), então uma conta que é
 * professor E avaliador precisa de um desempate estável. O maior
 * privilégio ganha.
 *
 * ⚠ Isto é navegação, não autorização. Quem recorta dado é o RLS, que
 * enxerga o CONJUNTO inteiro de papéis — é por isso que `meus_avisos()`
 * compara contra `papeis_efetivos()` no servidor e não contra este valor:
 * um professor que também é avaliador perderia o aviso dos professores se
 * o recorte saísse daqui.
 */
const ROLE_PRIORITY: UserRole[] = ["admin", "avaliador", "professor", "estudante", "externo"];

/**
 * Papel do usuário logado, resolvido no servidor (`public.user_roles` via
 * `get_my_roles`). A autorização real é aplicada por RLS no banco — este
 * valor só orienta a navegação da interface.
 *
 * Morava no `AuthContext`, e veio para cá por duas razões: é uma consulta
 * ao banco (a regra do projeto é que RPC vive em `src/services/`, e o
 * Login a chamava direto de um contexto), e exportá-la ao lado do
 * `AuthProvider` custava um aviso de `react-refresh` — arquivo que exporta
 * componente deve exportar só componente.
 */
export async function resolveMyRole(): Promise<UserRole> {
  const { data, error } = await supabase.rpc("get_my_roles");
  if (!error && Array.isArray(data)) {
    for (const role of ROLE_PRIORITY) {
      if (data.includes(role)) return role;
    }
  }
  // Sem papel resolvido, assume o menor privilégio. `papeis_efetivos()` faz
  // a MESMA suposição no servidor (migration 20260908120000) — as duas
  // pontas têm de concordar, senão uma conta sem papel cairia em
  // /estudante sem receber os avisos endereçados a `externo`.
  return "externo";
}
