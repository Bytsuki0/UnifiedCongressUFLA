import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
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
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/cadastro" element={<Cadastro />} />
          <Route path="/pre-cadastro" element={<PreCadastro />} />
          <Route path="/professor-cadastro" element={<ProfessorCadastro />} />
          <Route path="/estudante" element={<Estudante />} />
          <Route path="/revisor" element={<Revisor />} />
          <Route path="/admin" element={<AdminPortal />} />

          <Route element={<Layout />}>
            <Route path="/dashboard" element={<Index />} />
            <Route path="/avaliadores" element={<Avaliadores />} />
            <Route path="/avaliadores/novo" element={<AvaliadorForm />} />
            <Route path="/avaliadores/:id/editar" element={<AvaliadorForm />} />
            <Route path="/trabalhos" element={<Trabalhos />} />
            <Route path="/trabalhos/novo" element={<TrabalhoForm />} />
            <Route path="/trabalhos/:id" element={<TrabalhoDetalhe />} />
            <Route path="/trabalhos/:id/editar" element={<TrabalhoForm />} />
            <Route path="/categorias" element={<Categorias />} />
            <Route path="/atribuicoes" element={<Atribuicoes />} />
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
