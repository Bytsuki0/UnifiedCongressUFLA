import { supabase } from "@/integrations/supabase/client";
import type { UserRole } from "@/contexts/AuthContext";

/**
 * Papéis das contas (`user_roles`) — o que a tela de Papéis do Admin edita.
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
