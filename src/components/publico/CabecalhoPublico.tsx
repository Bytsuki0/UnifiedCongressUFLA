import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { APP_MARK, APP_TAGLINE } from "@/lib/brand";

/**
 * Barra superior das páginas públicas (landing e /cronograma).
 *
 * Nasceu como cópia: a landing tinha este cabeçalho inline, e a página
 * de cronograma precisava do mesmo — inclusive do efeito de sombra ao
 * rolar, que morava num useEffect da landing procurando por
 * `#landing-header`. Duas cópias divergiriam no primeiro item de menu
 * novo, então o efeito veio junto e o id ficou local ao componente.
 *
 * CRONOGRAMA, ANAIS e PITCHES são a navegação de conteúdo daqui — as
 * três rotas públicas que mostram algo em vez de pedir login. O resto do
 * sistema exige sessão.
 *
 * No celular os cinco botões viram uma gaveta: enfileirados eles pedem
 * ~640px numa tela de 360px, e `.btn` é `white-space: nowrap`, então não
 * havia quebra — a barra simplesmente estourava. Os rótulos ficam por
 * extenso mesmo lá dentro, porque são CONTROLES: texto interativo não
 * vira ícone (ver a regra do `.rotulo-icone` no index.css).
 */
export const CabecalhoPublico = () => {
  const [menuAberto, setMenuAberto] = useState(false);
  const cabecalho = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  const rotulo = menuAberto ? "Fechar o menu" : "Abrir o menu";

  useEffect(() => {
    const header = document.getElementById("landing-header");
    if (!header) return;

    const aoRolar = () => header.classList.toggle("scrolled", window.scrollY > 10);
    // Chamada direta: quem entra em /cronograma por um link com âncora,
    // ou volta com a página já rolada, tem de ver a barra no estado
    // certo antes do primeiro scroll.
    aoRolar();

    window.addEventListener("scroll", aoRolar);
    return () => window.removeEventListener("scroll", aoRolar);
  }, []);

  // Navegou: a gaveta sai da frente da página que a pessoa acabou de pedir.
  useEffect(() => {
    setMenuAberto(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuAberto) return;

    // `pointerdown` e não `click`: cobre toque e mouse com um ouvinte só.
    const aoApontarFora = (e: PointerEvent) => {
      if (!cabecalho.current?.contains(e.target as Node)) setMenuAberto(false);
    };
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuAberto(false);
    };

    document.addEventListener("pointerdown", aoApontarFora);
    window.addEventListener("keydown", aoTeclar);
    return () => {
      document.removeEventListener("pointerdown", aoApontarFora);
      window.removeEventListener("keydown", aoTeclar);
    };
  }, [menuAberto]);

  return (
    <header className="landing-header" id="landing-header" ref={cabecalho}>
      <Link to="/" className="header-logo">
        <div className="logo-icon">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.5 2v6h-6"/><path d="M2.5 22v-6h6"/>
            <path d="M21.1 8A9 9 0 0 0 5.3 5.3L2.5 8"/>
            <path d="M2.9 16a9 9 0 0 0 15.8 2.7l2.8-2.7"/>
          </svg>
        </div>
        <div className="logo-text-group">
          <span className="logo-title">{APP_MARK}</span>
          <span className="logo-subtitle">{APP_TAGLINE}</span>
        </div>
      </Link>

      <button
        type="button"
        className="header-menu-toggle"
        onClick={() => setMenuAberto(a => !a)}
        title={rotulo}
        aria-label={rotulo}
        aria-expanded={menuAberto}
        aria-controls="menu-publico"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {menuAberto ? (
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

      <nav className={`header-nav${menuAberto ? " aberta" : ""}`} id="menu-publico">
        <NavLink
          to="/cronograma"
          className={({ isActive }) => `btn btn-ghost${isActive ? " ativo" : ""}`}
        >
          CRONOGRAMA
        </NavLink>
        <NavLink
          to="/anais"
          className={({ isActive }) => `btn btn-ghost${isActive ? " ativo" : ""}`}
        >
          ANAIS
        </NavLink>
        <NavLink
          to="/pitches"
          className={({ isActive }) => `btn btn-ghost${isActive ? " ativo" : ""}`}
        >
          PITCHES
        </NavLink>
        <Link to="/login" className="btn btn-ghost">ENTRAR</Link>
        <Link to="/cadastro" className="btn btn-primary">CADASTRAR-SE</Link>
      </nav>
    </header>
  );
};

export default CabecalhoPublico;
