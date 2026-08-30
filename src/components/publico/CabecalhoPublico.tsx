import { useEffect } from "react";
import { Link, NavLink } from "react-router-dom";
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
 * A aba CRONOGRAMA é a única navegação de conteúdo daqui: o resto do
 * sistema exige login.
 */
export const CabecalhoPublico = () => {
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

  return (
    <header className="landing-header" id="landing-header">
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

      <nav className="header-nav">
        <NavLink
          to="/cronograma"
          className={({ isActive }) => `btn btn-ghost${isActive ? " ativo" : ""}`}
        >
          CRONOGRAMA
        </NavLink>
        <Link to="/login" className="btn btn-ghost">ENTRAR</Link>
        <Link to="/cadastro" className="btn btn-primary">CADASTRAR-SE</Link>
      </nav>
    </header>
  );
};

export default CabecalhoPublico;
