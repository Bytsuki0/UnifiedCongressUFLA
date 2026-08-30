// Regras de cadastro compartilhadas entre a página de cadastro e o
// restante do app. O perfil é DERIVADO DO DOMÍNIO do e-mail — a mesma
// regra é reaplicada no servidor pelo trigger handle_new_user, então o
// que é decidido aqui é apenas a interface (SEC-07).

export type PerfilCadastro = "estudante" | "professor" | "externo";

const ESTUDANTE_SUFFIX = "@estudante.ufla.br";
const PROFESSOR_SUFFIXES = ["@ufla.br", "@ufla-br", "@ufla_br"];

/**
 * Perfil correspondente ao e-mail informado, ou null enquanto o
 * endereço ainda não estiver completo o bastante para classificar.
 *
 *   @estudante.ufla.br            -> estudante
 *   @ufla.br / @ufla-br / @ufla_br -> professor
 *   qualquer outro domínio         -> externo (participante do congresso)
 */
export function classifyEmail(email: string): PerfilCadastro | null {
  const e = email.trim().toLowerCase();
  // Domínios institucionais sem ponto (@ufla-br) também são aceitos,
  // por isso a validação de formato é intencionalmente permissiva.
  if (!/^[^\s@]+@[^\s@]+$/.test(e)) return null;
  if (e.endsWith(ESTUDANTE_SUFFIX)) return "estudante";
  if (PROFESSOR_SUFFIXES.some((s) => e.endsWith(s))) return "professor";
  return "externo";
}

/** Áreas da UFLA — servem tanto como curso (estudante) quanto como departamento (professor). */
export const AREAS = [
  { value: "BICT", label: "BICT — Bacharelado Interdisciplinar em Ciência, Tecnologia e Inovação" },
  { value: "Engenharia de Software", label: "Engenharia de Software" },
  { value: "Engenharia de Produção", label: "Engenharia de Produção" },
  { value: "Engenharia Elétrica", label: "Engenharia Elétrica" },
] as const;

export const PERIODOS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** Tamanho mínimo de senha (espelha a política do Supabase Auth — SEC-11). */
export const MIN_SENHA = 8;

export const PERFIL_INFO: Record<PerfilCadastro, { overline: string; titulo: string; descricao: string }> = {
  estudante: {
    overline: "CADASTRO DE ESTUDANTE",
    titulo: "Criar conta institucional.",
    descricao: "Identificamos um e-mail de estudante da UFLA. Informe seus dados acadêmicos para submeter trabalhos e participar do congresso.",
  },
  professor: {
    overline: "CADASTRO DE PROFESSOR / REVISOR",
    titulo: "Criar conta institucional.",
    descricao: "Identificamos um e-mail de professor da UFLA. Sua conta dá acesso ao painel de revisão de trabalhos.",
  },
  externo: {
    overline: "CADASTRO EXTERNO",
    titulo: "Criar conta de participante.",
    descricao: "Você não está usando um e-mail institucional da UFLA. Sua conta dá acesso à programação, inscrição em minicursos e emissão de certificados.",
  },
};
