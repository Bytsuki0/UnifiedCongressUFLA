import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  // `src/lib/config.ts` lê este define, injetado pelo Vite no build. Sem
  // ele aqui, qualquer teste que alcance esse módulo (ainda que de longe,
  // via um service) morre no import com "__BUILD_ID__ is not defined".
  define: { __BUILD_ID__: JSON.stringify("test") },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
