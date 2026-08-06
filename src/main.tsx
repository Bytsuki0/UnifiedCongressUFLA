/**
 * main.tsx — Ponto de entrada do bundle da aplicação (Vite).
 *
 * Responsabilidade única: montar o componente <App /> dentro da div #root
 * declarada em `index.html` e carregar o CSS global (Tailwind + tema).
 * Toda a configuração de rotas, autenticação e providers fica em `App.tsx`.
 */
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// O "!" garante ao TypeScript que #root existe — ele é estático em index.html.
createRoot(document.getElementById("root")!).render(<App />);
