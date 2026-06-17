import { useEffect } from "react";
import { Link } from "react-router-dom";

const Landing = () => {
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
            <span className="logo-title">NEXUS CORP</span>
            <span className="logo-subtitle">Submissões Científicas</span>
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
            <span className="hero-overline">CONGRESSO UFLA · EDIÇÃO 2026</span>
            <h1 className="hero-title">Pesquisa que move o conhecimento.</h1>
            <p className="hero-description">
              Submeta seus trabalhos acadêmicos de forma simples e acompanhe cada etapa
              do processo de avaliação em tempo real, com total transparência.
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

          <div className="hero-features">
            <div className="feature-card">
              <div className="feature-icon">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                  <path d="m9 12 2 2 4-4"/>
                </svg>
              </div>
              <div className="feature-content">
                <div className="feature-title">Avaliação Double-Blind</div>
                <div className="feature-desc">Anonimato garantido em todas as rodadas</div>
              </div>
            </div>

            <div className="feature-card">
              <div className="feature-icon">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                </svg>
              </div>
              <div className="feature-content">
                <div className="feature-title">Acompanhamento em Tempo Real</div>
                <div className="feature-desc">Status atualizado a cada minuto</div>
              </div>
            </div>

            <div className="feature-card">
              <div className="feature-icon">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
                  <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
                </svg>
              </div>
              <div className="feature-content">
                <div className="feature-title">Múltiplas Categorias</div>
                <div className="feature-desc">PIBIC, BIC Jr, Extensão e mais</div>
              </div>
            </div>
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
            {[
              { icon: "blue-800", ext: ".DOCX", size: "245 KB", name: "Artigo · Word", file: "template_artigo_word.docx" },
              { icon: "blue-700", ext: ".TEX", size: "128 KB", name: "Artigo · LaTeX", file: "template_artigo_latex.tex" },
              { icon: "blue-600", ext: ".PPTX", size: "1.8 MB", name: "Slides · PowerPoint", file: "template_slides_powerpoint.pptx" },
              { icon: "blue-500", ext: ".KEY", size: "2.1 MB", name: "Slides · Keynote", file: "template_slides_keynote.key" },
            ].map((t, i) => (
              <div className={`template-card reveal reveal-delay-${i + 1}`} key={t.file}>
                <div className={`template-icon ${t.icon}`}>
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
                    <polyline points="14 2 14 8 20 8"/>
                  </svg>
                </div>
                <div className="template-type" style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                  <span className="template-ext">{t.ext}</span>
                  <span className="template-size">{t.size}</span>
                </div>
                <div className="template-name">{t.name}</div>
                <button className="btn btn-primary btn-sm" onClick={() => alert(`Download de ${t.file} (simulação)`)}>BAIXAR</button>
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
        <div>© 2026 Nexus Corp · Universidade Federal de Lavras</div>
        <div>Suporte: <a href="mailto:nexus@ufla.br">nexus@ufla.br</a></div>
      </footer>
    </div>
  );
};

export default Landing;
