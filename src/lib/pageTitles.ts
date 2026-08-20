import { matchPath } from "react-router-dom";
import { APP_NAME } from "./brand";

/**
 * Título da aba por rota.
 *
 * A ORDEM IMPORTA: o primeiro padrão que casar vence. Rotas com
 * segmento fixo ("trabalhos/novo") precisam vir ANTES das que têm
 * parâmetro ("trabalhos/:id"), senão ":id" captura "novo". Há teste
 * cobrindo exatamente esse caso em src/test/pageTitles.test.ts.
 */
export const TITULOS: ReadonlyArray<readonly [string, string]> = [
  // Públicas
  ["/", "Início"],
  ["/login", "Entrar"],
  ["/cadastro", "Criar conta"],
  ["/confirmar-email", "Confirmar e-mail"],
  ["/esqueci-senha", "Esqueci minha senha"],
  ["/redefinir-senha", "Redefinir senha"],

  // Autenticada, mas sem portal: a sala de espera de quem não confirmou.
  ["/verifique-email", "Confirme seu e-mail"],

  // Portal do Estudante (Painel + Histórico viraram "Papéis Submetidos";
  // /estudante/dashboard e /estudante/historico só redirecionam para cá)
  ["/estudante/papeis-submetidos", "Papéis submetidos"],
  ["/estudante/nova-submissao", "Nova submissão"],
  ["/estudante/correcao/:id", "Enviar correção"],
  ["/estudante/editar/:id", "Editar submissão"],
  ["/estudante/reenvio/:id", "Reenviar trabalho"],
  ["/estudante/trabalho/:id", "Resultado da avaliação"],
  ["/estudante/templates", "Templates"],

  // Painel do Revisor
  ["/revisor/analise/:id", "Analisar trabalho"],
  ["/revisor/analise", "Trabalhos para análise"],
  ["/revisor/atribuicoes", "Minhas atribuições"],
  ["/revisor/avaliacao/:id", "Avaliação"],
  ["/revisor/arquivo", "Arquivo"],

  // Portal Admin
  ["/admin/papeis", "Papéis de acesso"],
  ["/admin/usuarios", "Usuários"],
  ["/admin/conflitos", "Conflitos de interesse"],
  ["/admin/configuracoes", "Configurações"],
  ["/admin/notificacoes", "Notificações"],
  ["/admin", "Auditoria"],

  // Co-chairs
  ["/co-chairs/dashboard", "Painel de co-chairs"],
  ["/co-chairs/avaliadores/novo", "Novo avaliador"],
  ["/co-chairs/avaliadores", "Avaliadores"],
  ["/co-chairs/trabalhos/novo", "Novo trabalho"],
  ["/co-chairs/trabalhos/:id/editar", "Editar trabalho"],
  ["/co-chairs/trabalhos/:id", "Detalhe do trabalho"],
  ["/co-chairs/trabalhos", "Trabalhos"],
  ["/co-chairs/categorias", "Categorias"],
  ["/co-chairs/atribuicoes", "Atribuição de revisores"],
  ["/co-chairs/parecer-editorial/:id", "Analisar trabalho"],
  ["/co-chairs/parecer-editorial", "Parecer editorial"],
  ["/co-chairs/rankings", "Rankings"],
  ["/co-chairs", "Painel de co-chairs"],

  // Congresso — área congelada, hoje visível só para o admin.
  ["/congresso/informacoes", "Informações do congresso"],
  ["/congresso/programacao", "Programação"],
  ["/congresso/verificar/:codigo", "Verificação de certificado"],
  ["/congresso/verificar", "Verificar certificado"],
  ["/congresso/dashboard", "Painel do congresso"],
  ["/congresso/inscricao", "Inscrição"],
  ["/congresso/minicursos", "Minicursos"],
  ["/congresso/certificados", "Certificados"],
  ["/congresso/perfil", "Meu perfil"],
  // /congresso/admin/{papeis,usuarios} não entram: as duas migraram para o
  // Portal Admin e as URLs antigas só redirecionam.
  ["/congresso/admin/inscricoes", "Inscrições"],
  ["/congresso/admin/minicursos", "Gestão de minicursos"],
  ["/congresso/admin/programacao", "Gestão da programação"],
  ["/congresso/admin/certificados", "Emissão de certificados"],
  ["/congresso/admin/verificar", "Conferir certificados"],
  ["/congresso/admin/notificacoes", "Enviar notificações"],
  ["/congresso/admin", "Administração do congresso"],
];

/** Título completo da aba para um caminho. Sem correspondência, só a marca. */
export function tituloDaRota(pathname: string): string {
  const achado = TITULOS.find(([padrao]) =>
    matchPath({ path: padrao, end: true }, pathname),
  );
  return achado ? `${achado[1]} · ${APP_NAME}` : APP_NAME;
}
