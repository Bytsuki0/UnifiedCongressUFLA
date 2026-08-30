import { APP_NAME, SUPPORT_EMAIL } from "@/lib/brand";

/** Rodapé das páginas públicas. Idêntico na landing e em /cronograma. */
export const RodapePublico = () => (
  <footer className="landing-footer">
    <div>© 2026 {APP_NAME} · Universidade Federal de Lavras</div>
    <div>
      Suporte: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
    </div>
  </footer>
);

export default RodapePublico;
