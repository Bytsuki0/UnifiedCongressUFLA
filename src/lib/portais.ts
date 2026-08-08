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

/** Rota inicial do papel. `externo` só participa da área do congresso. */
export function portalDoPapel(papel: UserRole): string {
  switch (papel) {
    case "admin":
      return "/admin";
    case "avaliador":
      return "/co-chairs";
    case "professor":
      return "/revisor";
    case "externo":
      return "/congresso/dashboard";
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
      return "Bem-vindo ao Dashboard!";
    case "professor":
      return "Bem-vindo ao Portal Revisor!";
    case "externo":
      return "Bem-vindo ao Congresso!";
    default:
      return "Bem-vindo ao Portal Estudante!";
  }
}
