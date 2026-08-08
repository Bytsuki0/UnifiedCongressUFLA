import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// Carimbo do build: identifica exatamente qual bundle está no ar.
// Gerado uma vez por execução do Vite e usado em dois lugares — a constante
// __BUILD_ID__ (src/lib/config.ts) e a <meta name="build-id"> do index.html,
// que é o que o scripts/verify-deploy.js consegue ler de fora.
const BUILD_ID = new Date().toISOString().replace(/[:.]/g, "-");

/** Injeta a <meta name="build-id"> no index.html gerado. */
const carimbarBuildId = () => ({
  name: "carimbar-build-id",
  transformIndexHtml(html: string) {
    return html.replace(
      "</head>",
      `  <meta name="build-id" content="${BUILD_ID}" />\n  </head>`
    );
  },
});

export default defineConfig({
  server: {
    host: "0.0.0.0",
    port: 5000,
    allowedHosts: true,
    hmr: {
      overlay: false,
    },
  },
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  plugins: [react(), carimbarBuildId()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
});
