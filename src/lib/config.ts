/**
 * Validação das variáveis de ambiente e carimbo do build.
 *
 * A aplicação é 100% cliente: se uma VITE_* faltar, o Vite substitui por
 * `undefined` e o erro só aparece muito depois, como um "Failed to fetch"
 * sem contexto vindo do supabase-js. Falhar aqui, no import, transforma
 * isso num erro legível já no carregamento da página.
 *
 * Só valores públicos entram aqui. Nenhum segredo (service_role,
 * SUPABASE_ACCESS_TOKEN, senha do banco) pode ser lido pelo cliente —
 * qualquer coisa exposta como VITE_* vai inteira para o bundle.
 */

const obrigatoria = (nome: string, valor: string | undefined): string => {
  if (!valor) {
    throw new Error(
      `Variável de ambiente ausente: ${nome}. ` +
        `Copie .env.example para .env (ou .env.production no build de deploy) ` +
        `e preencha os valores do projeto Supabase.`
    );
  }
  return valor;
};

export const SUPABASE_URL = obrigatoria(
  "VITE_SUPABASE_URL",
  import.meta.env.VITE_SUPABASE_URL
);

export const SUPABASE_PUBLISHABLE_KEY = obrigatoria(
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
);

/** Bucket privado dos PDFs de trabalhos. Tem padrão, então não é obrigatória. */
export const PDF_BUCKET = import.meta.env.VITE_SUPABASE_PDF_BUCKET || "Pdfs";

/**
 * Identificador do build, injetado pelo Vite (ver `define` em vite.config.ts).
 *
 * Existe para responder "o que está no ar é o que eu acabei de subir?" sem
 * depender do dashboard: vai para <meta name="build-id"> no index.html e o
 * scripts/verify-deploy.js compara com o que a URL pública devolve. É o que
 * distingue "o build está errado" de "o cache da Cloudflare está velho".
 */
export const BUILD_ID: string = __BUILD_ID__;
