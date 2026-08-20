import { useEffect } from "react";
import { Link } from "react-router-dom";
import { APP_MARK, APP_NAME, APP_TAGLINE, SUPPORT_EMAIL } from "@/lib/brand";
import { BotaoBaixar } from "@/components/BotaoBaixar";
import { useLinksDownloads } from "@/hooks/use-links-downloads";
import { DOWNLOADS_ESTUDANTE } from "@/lib/downloads";

/** Cores dos ícones, na ordem dos cards. */
const CORES_TEMPLATE = ["blue-800", "blue-700", "blue-600", "blue-500"];

const Landing = () => {
  const links = useLinksDownloads();


  useEffect(() => {
    const header = document.getElementById("landing-header");
    const handleScroll = () => {
      if (header) {
        if (window.scrollY > 10) header.classList.add("scrolled");
        else header.classList.remove("scrolled");
      }
    };
    window.addEventListener("scroll", handleScroll);

    const reveals = document.querySelectorAll(".reveal");
    const observer = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) e.target.classList.add("revealed"); }),
      { threshold: 0.1 }
    );
    reveals.forEach((r) => observer.observe(r));

    return () => {
      window.removeEventListener("scroll", handleScroll);
      observer.disconnect();
    };
  }, []);

  return (
    <div style={{ fontFamily: "var(--font-family)", background: "#fff" }}>
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
          <Link to="/login" className="btn btn-ghost">ENTRAR</Link>
          <Link to="/cadastro" className="btn btn-primary">CADASTRAR-SE</Link>
          <Link to="/admin" className="btn btn-outline btn-hide-mobile" style={{ display: "none" }}>ADMIN</Link>
        </nav>
      </header>

      <section className="hero">
        <div className="hero-inner">
          <div className="hero-text">
            <span className="hero-overline">UNIVERSIDADE FEDERAL DE LAVRAS · ICTIN</span>
            <h1 className="hero-title">O congresso anual CIUFLA campus ICTIN.</h1>
            <p className="hero-description">
              Sistema oficial do {APP_NAME}.
            </p>
            <div className="hero-actions">
              <Link to="/cadastro" className="btn btn-outline-white">
                COMEÇAR SUBMISSÃO
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>
                </svg>
              </Link>
              <Link to="/login" className="btn btn-outline-white">JÁ TENHO CONTA</Link>
            </div>
          </div>

          {/* Selo institucional. Ocupa a coluna onde ficavam três cartões de
              recurso ("double-blind", "tempo real", "múltiplas categorias") que
              anunciavam o que o sistema não entrega. */}
          <div className="hero-brand">
            <img
              className="hero-brand-logo"
              src="/imagens/logo-ufla-branca.png"
              alt="Universidade Federal de Lavras"
              width={753}
              height={317}
            />
          </div>
        </div>
      </section>

      <section className="templates-section" id="templates">
        <div className="templates-inner">
          <div className="reveal">
            <div className="section-overline">↓ DOWNLOADS RÁPIDOS</div>
            <h2 className="section-title">Templates oficiais.</h2>
            <p className="section-description">
              Baixe os modelos padronizados para submissão do seu trabalho. Todos os templates seguem
              as normas do congresso e são atualizados a cada edição.
            </p>
          </div>

          <div className="templates-grid">
            {DOWNLOADS_ESTUDANTE.map((t, i) => (
              <div className={`template-card reveal reveal-delay-${i + 1}`} key={t.chave}>
                <div className={`template-icon ${CORES_TEMPLATE[i]}`}>
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
                    <polyline points="14 2 14 8 20 8"/>
                  </svg>
                </div>
                <div className="template-type" style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                  <span className="template-ext">{t.ext}</span>
                </div>
                <div className="template-name">{t.nome}</div>
                <BotaoBaixar url={links[t.chave]} className="btn btn-primary btn-sm">BAIXAR</BotaoBaixar>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="cta-banner">
        <div className="cta-inner reveal">
          <div className="cta-text">
            <div className="cta-overline">PRONTO PARA SUBMETER?</div>
            <h2 className="cta-title">Crie sua conta institucional e envie seu trabalho.</h2>
          </div>
          <div style={{ flexShrink: 0 }}>
            <Link to="/cadastro" className="btn btn-outline-white">
              CADASTRAR-SE AGORA
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>
              </svg>
            </Link>
          </div>
        </div>
      </section>

      <footer className="landing-footer">
        <div>© 2026 {APP_NAME} · Universidade Federal de Lavras</div>
        <div>Suporte: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a></div>
      </footer>
    </div>
  );
};

export default Landing;
