import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Cadastro from "./pages/Cadastro";
import Estudante from "./pages/Estudante";
import AdminPortal from "./pages/AdminPortal";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";
import Layout from "./components/Layout";
import Avaliadores from "./pages/Avaliadores";
import AvaliadorForm from "./pages/AvaliadorForm";
import Trabalhos from "./pages/Trabalhos";
import TrabalhoForm from "./pages/TrabalhoForm";
import TrabalhoDetalhe from "./pages/TrabalhoDetalhe";
import Categorias from "./pages/Categorias";
import Atribuicoes from "./pages/Atribuicoes";
import Revisor from "./pages/Revisor";
import PreCadastro from "./pages/PreCadastro";
import ProfessorCadastro from "./pages/ProfessorCadastro";

const queryClient = new QueryClient();

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
              <Route path="/estudante" element={<Estudante />} />
            </Route>

            {/* Revisor: professor, avaliador, admin */}
            <Route element={<ProtectedRoute allowedRoles={["professor", "avaliador", "admin"]} />}>
              <Route path="/revisor" element={<Revisor />} />
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
              </Route>
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
