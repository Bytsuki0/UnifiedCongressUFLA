/**
 * App.tsx — Raiz da aplicação: providers globais + mapa completo de rotas.
 *
 * O sistema é dividido em 5 áreas, cada uma com seu prefixo de URL e seu
 * conjunto de papéis autorizados:
 *
 *   /            → páginas públicas (landing, login, cadastro)
 *   /estudante   → submissão de trabalhos (autor); qualquer papel autenticado
 *   /revisor     → análise/avaliação de trabalhos (professor, avaliador, admin)
 *   /admin       → Portal Admin: papéis, conflitos, usuários (só admin)
 *   /dashboard…  → gestão de co-chairs: trabalhos, categorias, atribuições,
 *                  rankings (avaliador, admin)
 *   /congresso   → área do evento — CONGELADA, fora do escopo do projeto.
 *                  Só o admin enxerga; ninguém é redirecionado para lá.
 *
 * O controle de acesso é feito por <ProtectedRoute allowedRoles={[...]} />,
 * que envolve grupos de rotas. Isso é apenas a barreira de UI — a barreira
 * real de dados é o RLS no Supabase.
 *
 * Ordem dos providers (de fora para dentro):
 *   QueryClientProvider → cache de requisições (React Query)
 *   TooltipProvider     → contexto dos tooltips do shadcn/ui
 *   Toaster / Sonner    → as duas pilhas de notificação usadas no projeto
 *   AuthProvider        → sessão do Supabase + papel do usuário
 *   BrowserRouter       → roteamento
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { DocumentTitle } from "@/components/DocumentTitle";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Cadastro from "./pages/Cadastro";
import ConfirmarEmail from "./pages/ConfirmarEmail";
import VerifiqueEmail from "./pages/VerifiqueEmail";
import EsqueciSenha from "./pages/EsqueciSenha";
import RedefinirSenha from "./pages/RedefinirSenha";
import AdminPortal from "./pages/AdminPortal";
import NotFound from "./pages/NotFound.tsx";

// Portal do Estudante — uma página por função, sob /estudante.
// (Autor do trabalho: envia, acompanha e corrige submissões.)
import EstudanteLayout from "./components/estudante/Layout";
import EstudanteDashboard from "./pages/estudante/Dashboard";
import EstudanteNovaSubmissao from "./pages/estudante/NovaSubmissao";
import EstudanteHistorico from "./pages/estudante/Historico";
import EstudanteCorrecao from "./pages/estudante/Correcao";
import EstudanteEditar from "./pages/estudante/EditarSubmissao";
import EstudanteDetalhe from "./pages/estudante/DetalheTrabalho";
import EstudanteTemplates from "./pages/estudante/Templates";

// Painel do Revisor — uma página por função, sob /revisor
import RevisorLayout from "./components/revisor/Layout";
import RevisorAnalise from "./pages/revisor/Analise";
import RevisorAnaliseDetalhe from "./pages/revisor/AnaliseDetalhe";
import RevisorAtribuicoes from "./pages/revisor/Atribuicoes";
import RevisorAvaliacao from "./pages/revisor/Avaliacao";
import RevisorFormularios from "./pages/revisor/Formularios";
import RevisorArquivo from "./pages/revisor/Arquivo";

// Co-chairs ("Gestão de Co-Chairs") — agrupadas em co-chairs/.
// Atenção: as URLs aqui NÃO têm prefixo (/dashboard, /trabalhos, ...).
import Layout from "./components/co-chairs/Layout";
import Index from "./pages/co-chairs/Index.tsx";
import Avaliadores from "./pages/co-chairs/Avaliadores";
import AvaliadorForm from "./pages/co-chairs/AvaliadorForm";
import Trabalhos from "./pages/co-chairs/Trabalhos";
import TrabalhoForm from "./pages/co-chairs/TrabalhoForm";
import TrabalhoDetalhe from "./pages/co-chairs/TrabalhoDetalhe";
import Categorias from "./pages/co-chairs/Categorias";
import Atribuicoes from "./pages/co-chairs/Atribuicoes";
import Rankings from "./pages/co-chairs/Rankings";

// Páginas do evento (congresso) — todas sob /congresso, hoje só para admin.
// Mantidas importadas de propósito: a área está congelada, não removida.
import EventInformacoes from "./pages/event/Informacoes";
import EventProgramacao from "./pages/event/Programacao";
import EventVerificar from "./pages/event/Verificar";
import EventVerificarCodigo from "./pages/event/VerificarCodigo";
import EventDashboard from "./pages/event/Dashboard";
import EventInscricao from "./pages/event/Inscricao";
import EventMinicursos from "./pages/event/Minicursos";
import EventCertificados from "./pages/event/Certificados";
import EventPerfil from "./pages/event/Perfil";
import AdminIndex from "./pages/event/admin/AdminIndex";
import AdminInscricoes from "./pages/event/admin/AdminInscricoes";
import AdminMinicursos from "./pages/event/admin/AdminMinicursos";
import AdminProgramacao from "./pages/event/admin/AdminProgramacao";
import AdminCertificados from "./pages/event/admin/AdminCertificados";
import AdminVerificar from "./pages/event/admin/AdminVerificar";
import AdminNotificacoes from "./pages/event/admin/AdminNotificacoes";

// Cache compartilhado do React Query — instanciado uma única vez fora do
// componente para não ser recriado a cada render.
const queryClient = new QueryClient();

const ALL_ROLES = ["estudante", "professor", "avaliador", "admin", "externo"] as const;

// As telas de co-chairs moravam na raiz ("/dashboard", "/trabalhos", ...).
// Passaram para /co-chairs, como os demais portais; estas URLs antigas
// continuam funcionando para não quebrar favoritos e links já enviados.
const ROTAS_ANTIGAS_CO_CHAIRS = [
  "/dashboard",
  "/avaliadores",
  "/avaliadores/*",
  "/trabalhos",
  "/trabalhos/*",
  "/categorias",
  "/atribuicoes",
  "/rankings",
];

const RedirecionaCoChairs = () => {
  const { pathname, search, hash } = useLocation();
  return <Navigate to={`/co-chairs${pathname}${search}${hash}`} replace />;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AuthProvider>
        <BrowserRouter>
          {/* Ajusta o <title> a cada navegação (precisa estar dentro do Router). */}
          <DocumentTitle />
          <Routes>
            {/* Rotas públicas — sem autenticação. */}
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<Login />} />
            <Route path="/cadastro" element={<Cadastro />} />
            {/* Rotas antigas de cadastro (pré-cadastro / professor) foram
                unificadas em /cadastro. */}
            <Route path="/pre-cadastro" element={<Navigate to="/cadastro" replace />} />
            <Route path="/professor-cadastro" element={<Navigate to="/cadastro" replace />} />

            {/* Confirmação de e-mail: o link do e-mail costuma abrir no
                celular, sem sessão — a rota é pública e a RPC que ela chama
                é executável por `anon`. */}
            <Route path="/confirmar-email" element={<ConfirmarEmail />} />

            {/* Esqueci minha senha: fluxo anônimo por definição. O pedido e o
                link do e-mail abrem sem sessão — a autoridade é o token de
                uso único (Edge Function `redefinir-senha`). */}
            <Route path="/esqueci-senha" element={<EsqueciSenha />} />
            <Route path="/redefinir-senha" element={<RedefinirSenha />} />

            {/* Sala de espera de quem ainda não confirmou. Autenticada (o
                reenvio é sempre "para mim mesmo"), e a ÚNICA rota protegida
                que dispensa a confirmação — do contrário desviaria para si
                mesma em laço. */}
            <Route element={<ProtectedRoute allowedRoles={[...ALL_ROLES]} exigeEmailConfirmado={false} />}>
              <Route path="/verifique-email" element={<VerifiqueEmail />} />
            </Route>

            {/* Estudante: liberado para TODOS os papéis autenticados — um
                professor/avaliador também pode submeter trabalho, e o
                `externo` entrou aqui quando se decidiu que quem é de fora da
                universidade também publica. Nada disso precisou de migration:
                o RLS de `trabalhos` e do bucket `Pdfs` é por DONO
                (`owner_id = auth.uid()`), nunca por papel. */}
            <Route element={<ProtectedRoute allowedRoles={[...ALL_ROLES]} />}>
              <Route path="/estudante" element={<EstudanteLayout />}>
                <Route index element={<Navigate to="/estudante/dashboard" replace />} />
                <Route path="dashboard" element={<EstudanteDashboard />} />
                <Route path="nova-submissao" element={<EstudanteNovaSubmissao />} />
                <Route path="historico" element={<EstudanteHistorico />} />
                {/* Notas e comentários recebidos, em qualquer desfecho —
                    aprovado, com correções ou reprovado. */}
                <Route path="trabalho/:id" element={<EstudanteDetalhe />} />
                {/* Edição do próprio trabalho: só enquanto 'pendente' e
                    dentro do prazo de submissão (RPC editar_submissao). */}
                <Route path="editar/:id" element={<EstudanteEditar />} />
                {/* Rodada de correção — só abre quando os pareceres
                    consolidam em "aprovado com correções". É a ÚNICA
                    escrita do autor que sobrevive ao fim do prazo. */}
                <Route path="correcao/:id" element={<EstudanteCorrecao />} />
                <Route path="templates" element={<EstudanteTemplates />} />
              </Route>
            </Route>

            {/* Revisor: quem emite parecer. O papel "externo" fica de fora. */}
            <Route element={<ProtectedRoute allowedRoles={["professor", "avaliador", "admin"]} />}>
              <Route path="/revisor" element={<RevisorLayout />}>
                <Route index element={<Navigate to="/revisor/analise" replace />} />
                <Route path="analise" element={<RevisorAnalise />} />
                <Route path="analise/:id" element={<RevisorAnaliseDetalhe />} />
                <Route path="atribuicoes" element={<RevisorAtribuicoes />} />
                <Route path="avaliacao/:id" element={<RevisorAvaliacao />} />
                <Route path="formularios" element={<RevisorFormularios />} />
                <Route path="arquivo" element={<RevisorArquivo />} />
              </Route>
            </Route>

            {/* Admin portal: admin only. Cada seção tem URL própria
                (/admin/papeis, /admin/conflitos, ...). */}
            <Route element={<ProtectedRoute allowedRoles={["admin"]} />}>
              <Route path="/admin" element={<AdminPortal />} />
              <Route path="/admin/:secao" element={<AdminPortal />} />
            </Route>

            {/* Gestão de co-chairs (avaliador e admin): cadastro de trabalhos,
                categorias, distribuição de revisores e rankings finais. */}
            <Route element={<ProtectedRoute allowedRoles={["avaliador", "admin"]} />}>
              <Route path="/co-chairs" element={<Layout />}>
                <Route index element={<Navigate to="/co-chairs/dashboard" replace />} />
                <Route path="dashboard" element={<Index />} />
                <Route path="avaliadores" element={<Avaliadores />} />
                <Route path="avaliadores/novo" element={<AvaliadorForm />} />
                <Route path="trabalhos" element={<Trabalhos />} />
                <Route path="trabalhos/novo" element={<TrabalhoForm />} />
                <Route path="trabalhos/:id" element={<TrabalhoDetalhe />} />
                <Route path="trabalhos/:id/editar" element={<TrabalhoForm />} />
                <Route path="categorias" element={<Categorias />} />
                <Route path="atribuicoes" element={<Atribuicoes />} />
                <Route path="rankings" element={<Rankings />} />
              </Route>
            </Route>

            {/* URLs antigas da raiz -> /co-chairs/... */}
            {ROTAS_ANTIGAS_CO_CHAIRS.map((p) => (
              <Route key={p} path={p} element={<RedirecionaCoChairs />} />
            ))}

            {/* ===== Congresso — CONGELADO =====
                A área do evento saiu do escopo do projeto e não será
                desenvolvida até segunda ordem. O código fica no repositório
                porque ainda há telas que podem migrar para outros portais —
                mas /congresso inteiro passou a ser visível SÓ para o admin,
                inclusive o que antes era público (/informacoes, /programacao,
                /verificar). Ninguém mais é mandado para cá: `portalDoPapel`
                já não devolve /congresso para papel nenhum. */}
            <Route element={<ProtectedRoute allowedRoles={["admin"]} />}>
              <Route path="/congresso/informacoes" element={<EventInformacoes />} />
              <Route path="/congresso/programacao" element={<EventProgramacao />} />
              <Route path="/congresso/verificar" element={<EventVerificar />} />
              <Route path="/congresso/verificar/:codigo" element={<EventVerificarCodigo />} />
              <Route path="/congresso/dashboard" element={<EventDashboard />} />
              <Route path="/congresso/inscricao" element={<EventInscricao />} />
              <Route path="/congresso/minicursos" element={<EventMinicursos />} />
              <Route path="/congresso/certificados" element={<EventCertificados />} />
              <Route path="/congresso/perfil" element={<EventPerfil />} />
              <Route path="/congresso/admin" element={<AdminIndex />} />
              <Route path="/congresso/admin/inscricoes" element={<AdminInscricoes />} />
              <Route path="/congresso/admin/minicursos" element={<AdminMinicursos />} />
              <Route path="/congresso/admin/programacao" element={<AdminProgramacao />} />
              <Route path="/congresso/admin/certificados" element={<AdminCertificados />} />
              <Route path="/congresso/admin/verificar" element={<AdminVerificar />} />
              <Route path="/congresso/admin/notificacoes" element={<AdminNotificacoes />} />
            </Route>

            {/* Duas telas do congresso saíram de lá para o Portal Admin, que
                é onde a gestão de contas ficou concentrada: papéis (conceder
                avaliador/professor é o que monta o pool de revisores) e a
                lista de usuários. */}
            <Route path="/congresso/admin/papeis" element={<Navigate to="/admin/papeis" replace />} />
            <Route path="/congresso/admin/usuarios" element={<Navigate to="/admin/usuarios" replace />} />

            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
