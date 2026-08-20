import { useSidebarRecolhida } from "@/hooks/use-sidebar-recolhida";

/**
 * Botão que recolhe o menu lateral, deixando só os ícones.
 *
 * Vai dentro do `<aside className="sidebar">` de cada layout; fica meio para
 * fora da borda direita de propósito, porque assim não disputa espaço com a
 * marca nem com os itens de navegação em nenhum dos dois estados.
 */
export function BotaoRecolherSidebar() {
  const [recolhida, alternar] = useSidebarRecolhida();
  const rotulo = recolhida ? "Expandir menu lateral" : "Recolher menu lateral";

  return (
    <button
      type="button"
      className="sidebar-toggle"
      onClick={alternar}
      title={rotulo}
      aria-label={rotulo}
      aria-expanded={!recolhida}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="m15 18-6-6 6-6"/>
      </svg>
    </button>
  );
}
