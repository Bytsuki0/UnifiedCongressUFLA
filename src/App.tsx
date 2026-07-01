import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Cadastro from "./pages/Cadastro";
import AdminPortal from "./pages/AdminPortal";
import NotFound from "./pages/NotFound.tsx";

// Portal do Estudante — uma página por função, sob /estudante
import EstudanteLayout from "./components/estudante/Layout";
import EstudanteDashboard from "./pages/estudante/Dashboard";
import EstudanteNovaSubmissao from "./pages/estudante/NovaSubmissao";
import EstudanteHistorico from "./pages/estudante/Historico";
import EstudanteTemplates from "./pages/estudante/Templates";

// Painel do Revisor — uma página por função, sob /revisor
import RevisorLayout from "./components/revisor/Layout";
import RevisorAnalise from "./pages/revisor/Analise";
import RevisorAnaliseDetalhe from "./pages/revisor/AnaliseDetalhe";
import RevisorAtribuicoes from "./pages/revisor/Atribuicoes";
import RevisorAvaliacao from "./pages/revisor/Avaliacao";
import RevisorFormularios from "./pages/revisor/Formularios";
import RevisorArquivo from "./pages/revisor/Arquivo";

// Co-chairs (dashboard / "Gestão de Co-Chairs") — grouped under co-chairs/
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
import PreCadastro from "./pages/PreCadastro";
import ProfessorCadastro from "./pages/ProfessorCadastro";

// Event-management (QuadCode congress) pages — namespaced under /congresso
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
import AdminUsuarios from "./pages/event/admin/AdminUsuarios";
import AdminInscricoes from "./pages/event/admin/AdminInscricoes";
import AdminMinicursos from "./pages/event/admin/AdminMinicursos";
import AdminProgramacao from "./pages/event/admin/AdminProgramacao";
import AdminCertificados from "./pages/event/admin/AdminCertificados";
import AdminVerificar from "./pages/event/admin/AdminVerificar";
import AdminNotificacoes from "./pages/event/admin/AdminNotificacoes";

const queryClient = new QueryClient();

const ALL_ROLES = ["estudante", "professor", "avaliador", "admin"] as const;

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            {/* Public routes */}
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<Login />} />
            <Route path="/cadastro" element={<Cadastro />} />
            <Route path="/pre-cadastro" element={<PreCadastro />} />
            <Route path="/professor-cadastro" element={<ProfessorCadastro />} />

            {/* Estudante: accessible by all authenticated roles */}
            <Route element={<ProtectedRoute allowedRoles={["estudante", "professor", "avaliador", "admin"]} />}>
              <Route path="/estudante" element={<EstudanteLayout />}>
                <Route index element={<Navigate to="/estudante/dashboard" replace />} />
                <Route path="dashboard" element={<EstudanteDashboard />} />
                <Route path="nova-submissao" element={<EstudanteNovaSubmissao />} />
                <Route path="historico" element={<EstudanteHistorico />} />
                <Route path="templates" element={<EstudanteTemplates />} />
              </Route>
            </Route>

            {/* Revisor: professor, avaliador, admin */}
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

            {/* Admin portal: admin only */}
            <Route element={<ProtectedRoute allowedRoles={["admin"]} />}>
              <Route path="/admin" element={<AdminPortal />} />
            </Route>

            {/* Dashboard/Layout routes: avaliador and admin */}
            <Route element={<ProtectedRoute allowedRoles={["avaliador", "admin"]} />}>
              <Route element={<Layout />}>
                <Route path="/dashboard" element={<Index />} />
                <Route path="/avaliadores" element={<Avaliadores />} />
                <Route path="/avaliadores/novo" element={<AvaliadorForm />} />
                <Route path="/trabalhos" element={<Trabalhos />} />
                <Route path="/trabalhos/novo" element={<TrabalhoForm />} />
                <Route path="/trabalhos/:id" element={<TrabalhoDetalhe />} />
                <Route path="/trabalhos/:id/editar" element={<TrabalhoForm />} />
                <Route path="/categorias" element={<Categorias />} />
                <Route path="/atribuicoes" element={<Atribuicoes />} />
                <Route path="/rankings" element={<Rankings />} />
              </Route>
            </Route>

            {/* ===== Congresso (event management) — public pages ===== */}
            <Route path="/congresso/informacoes" element={<EventInformacoes />} />
            <Route path="/congresso/programacao" element={<EventProgramacao />} />
            <Route path="/congresso/verificar" element={<EventVerificar />} />
            <Route path="/congresso/verificar/:codigo" element={<EventVerificarCodigo />} />

            {/* Congresso — logged-in pages: all four profiles */}
            <Route element={<ProtectedRoute allowedRoles={[...ALL_ROLES]} />}>
              <Route path="/congresso/dashboard" element={<EventDashboard />} />
              <Route path="/congresso/inscricao" element={<EventInscricao />} />
              <Route path="/congresso/minicursos" element={<EventMinicursos />} />
              <Route path="/congresso/certificados" element={<EventCertificados />} />
              <Route path="/congresso/perfil" element={<EventPerfil />} />
            </Route>

            {/* Congresso — co-chairs (avaliador) and admin */}
            <Route element={<ProtectedRoute allowedRoles={["avaliador", "admin"]} />}>
              <Route path="/congresso/admin" element={<AdminIndex />} />
              <Route path="/congresso/admin/usuarios" element={<AdminUsuarios />} />
              <Route path="/congresso/admin/inscricoes" element={<AdminInscricoes />} />
              <Route path="/congresso/admin/minicursos" element={<AdminMinicursos />} />
              <Route path="/congresso/admin/programacao" element={<AdminProgramacao />} />
              <Route path="/congresso/admin/certificados" element={<AdminCertificados />} />
              <Route path="/congresso/admin/verificar" element={<AdminVerificar />} />
              <Route path="/congresso/admin/notificacoes" element={<AdminNotificacoes />} />
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
