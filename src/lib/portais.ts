/**
 * Para onde cada papel vai depois de entrar.
 *
 * Este mapeamento morava duplicado em dois lugares — a cadeia de `if` do
 * Login.tsx e o `redirectForRole` do ProtectedRoute — e os dois já haviam
 * divergido. Agora que a confirmação de e-mail também precisa mandar o
 * usuário "para o portal dele" depois do clique no link, virou um lugar só.
 *
 * É só navegação de interface: quem autoriza de fato é o RLS no Supabase.
 */
import type { UserRole } from "@/contexts/AuthContext";

/**
 * Rota inicial do papel.
 *
 * `externo` cai no Portal do Estudante junto com `estudante`: ficou decidido
 * que quem é de fora da universidade também submete trabalho, então o papel
 * passou a ter a mesma alçada de autor. Não há caso `externo` aqui de
 * propósito — ele cai no `default`, como o estudante.
 */
export function portalDoPapel(papel: UserRole): string {
  switch (papel) {
    case "admin":
      return "/admin";
    case "avaliador":
      return "/co-chairs";
    case "professor":
      return "/revisor";
    default:
      return "/estudante";
  }
}

/** Saudação do login, na voz de cada portal. */
export function saudacaoDoPapel(papel: UserRole): string {
  switch (papel) {
    case "admin":
      return "Bem-vindo, Administrador!";
    case "avaliador":
      return "Bem-vindo ao Gerenciamento!";
    case "professor":
      return "Bem-vindo à Revisão!";
    default:
      return "Bem-vindo à Submissão!";
  }
}
