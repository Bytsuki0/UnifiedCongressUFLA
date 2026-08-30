import { useEffect } from "react";
import { Link } from "react-router-dom";
import { APP_NAME } from "@/lib/brand";
import { CabecalhoPublico } from "@/components/publico/CabecalhoPublico";
import { CarrosselTemplates } from "@/components/publico/CarrosselTemplates";
import { RodapePublico } from "@/components/publico/RodapePublico";
import { CalendarioCronograma } from "@/components/cronograma/CalendarioCronograma";
import { useCronograma } from "@/hooks/use-cronograma";
import { useArquivosDownload } from "@/hooks/use-arquivos-download";

const Landing = () => {
  const { arquivos } = useArquivosDownload("estudante");
  const { cronograma, carregando } = useCronograma();

  // O efeito de sombra da barra superior mudou de dono: mora em
  // <CabecalhoPublico>, que /cronograma também usa. Aqui ficou só a
  // animação de entrada dos blocos, que é da landing.
  useEffect(() => {
    const reveals = document.querySelectorAll(".reveal");
    const observer = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) e.target.classList.add("revealed"); }),
      { threshold: 0.1 }
    );
    reveals.forEach((r) => observer.observe(r));

    return () => observer.disconnect();
    // Depende do cronograma: a seção dele só entra no DOM quando a busca
    // volta, e o observer é montado uma vez. Sem reobservar, os blocos
    // `.reveal` de lá ficariam parados em opacity 0 — invisíveis para
    // sempre. Quem já revelou mantém a classe.
  }, [cronograma]);

  return (
    <div style={{ fontFamily: "var(--font-family)", background: "#fff" }}>
      <CabecalhoPublico />

      <section className="hero">
        <div className="hero-inner">
          <div className="hero-text">
            <span className="hero-overline">UNIVERSIDADE FEDERAL DE LAVRAS · ICTIN</span>
            <h1 className="hero-title">O congresso unificado do nosso campus Paraiso.</h1>
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

      {/* Cronograma — some inteiro quando a organização ainda não
          publicou mês nenhum. Um calendário vazio na página inicial diria
          menos que nada: sugeriria que o congresso não tem datas. */}
      {!carregando && cronograma.meses.length > 0 && (
        <section className="cronograma-section" id="cronograma">
          <div className="cronograma-inner">
            <div className="reveal">
              <div className="section-overline">📅 DATAS IMPORTANTES</div>
              <h2 className="section-title">Cronograma do congresso.</h2>
              <p className="section-description">
                Prazos de submissão, avaliação e realização do evento. Clique em um dia marcado
                para ver o que acontece nele.
              </p>
            </div>

            <div className="reveal">
              <CalendarioCronograma meses={cronograma.meses} marcacoes={cronograma.marcacoes} />
            </div>
          </div>
        </section>
      )}

      {/* A seção inteira sai do ar quando não há arquivo publicado: um
          bloco "Templates oficiais." vazio parece página quebrada, e a
          lista agora pode legitimamente estar vazia. */}
      {arquivos.length > 0 && (
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

            <CarrosselTemplates arquivos={arquivos} />
          </div>
        </section>
      )}

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

      <RodapePublico />
    </div>
  );
};

export default Landing;
