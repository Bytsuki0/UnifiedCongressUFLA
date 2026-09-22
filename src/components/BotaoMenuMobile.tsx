import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";

/**
 * Abre e fecha o menu lateral no celular.
 *
 * Abaixo de 768px a `.sidebar` sai da tela (`translateX(-100%)`) e **não havia
 * nada que a trouxesse de volta**: o CSS declarava `.sidebar.open`, mas nenhum
 * componente punha essa classe, e o `<BotaoRecolherSidebar />` fica escondido
 * nessa faixa. Como o botão "Sair" mora dentro da barra, no celular não havia
 * como navegar nem deslogar. Este botão é o que faltava.
 *
 * O estado vive em `<body data-menu="aberto">`, e não numa classe repassada
 * para baixo, pelo mesmo motivo do `use-sidebar-recolhida`: os cinco layouts
 * desenham a mesma `.sidebar`, e um atributo no body deixa uma regra de CSS
 * atender todos de uma vez.
 *
 * Vai como primeiro filho da `.top-bar` de cada layout. Acima de 768px o CSS
 * o esconde — no desktop quem manda continua sendo o `<BotaoRecolherSidebar />`.
 */
export function BotaoMenuMobile() {
  const [aberto, setAberto] = useState(false);
  const { pathname } = useLocation();
  const rotulo = aberto ? "Fechar o menu" : "Abrir o menu";

  const fechar = useCallback(() => setAberto(false), []);

  // Marca o body: daqui para baixo é tudo CSS.
  useEffect(() => {
    if (!aberto) return;
    document.body.dataset.menu = "aberto";
    return () => {
      delete document.body.dataset.menu;
    };
  }, [aberto]);

  // Gaveta aberta cobre a tela inteira: rolar o conteúdo atrás dela é rolar
  // o que não se está vendo.
  useEffect(() => {
    if (!aberto) return;
    const anterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = anterior;
    };
  }, [aberto]);

  // Tocar num item de navegação troca de rota — a gaveta tem de sair da
  // frente sozinha, senão cobre a tela que a pessoa acabou de pedir.
  useEffect(() => {
    setAberto(false);
  }, [pathname]);

  useEffect(() => {
    if (!aberto) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAberto(false);
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [aberto]);

  // Girar o aparelho (ou abrir o devtools) pode passar de 768px com a gaveta
  // aberta: ali ela não existe mais, mas a trava de rolagem continuaria de pé.
  useEffect(() => {
    if (!aberto) return;
    const consulta = window.matchMedia("(min-width: 769px)");
    if (consulta.matches) {
      setAberto(false);
      return;
    }
    const aoMudar = (e: MediaQueryListEvent) => {
      if (e.matches) setAberto(false);
    };
    consulta.addEventListener("change", aoMudar);
    return () => consulta.removeEventListener("change", aoMudar);
  }, [aberto]);

  return (
    <>
      <button
        type="button"
        className="menu-mobile-toggle"
        onClick={() => setAberto(a => !a)}
        title={rotulo}
        aria-label={rotulo}
        aria-expanded={aberto}
        aria-controls="menu-lateral"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {aberto ? (
            <>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </>
          ) : (
            <>
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </>
          )}
        </svg>
      </button>

      {/* Portal para o body de propósito: a `.top-bar` é `sticky` com
          `z-index: 50` e cria contexto de empilhamento — um `position: fixed`
          filho dela ficaria preso abaixo de 50, e o `z-index: 99` do fundo
          não valeria nada contra o 100 da barra lateral. */}
      {aberto &&
        createPortal(
          <div className="menu-backdrop" onClick={fechar} aria-hidden="true" />,
          document.body,
        )}
    </>
  );
}
