/// <reference types="vite/client" />

/**
 * Carimbo do build injetado pelo `define` do Vite (vite.config.ts).
 * Declarado aqui porque não é uma variável de ambiente — é uma constante
 * substituída em tempo de build, e sem esta declaração o TypeScript não
 * conhece o identificador.
 */
declare const __BUILD_ID__: string;

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string;
  readonly VITE_SUPABASE_PDF_BUCKET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
