import { Link } from "react-router-dom";
import { CabecalhoPublico } from "@/components/publico/CabecalhoPublico";
import { RodapePublico } from "@/components/publico/RodapePublico";
import { GradePitches } from "@/components/publico/GradePitches";
import { usePitches } from "@/hooks/use-pitches";

/**
 * Pitches — página pública, aberta ANTES do login.
 *
 * A vitrine de vídeos de apresentação: os dos trabalhos APROVADOS desta
 * edição, que entram sozinhos assim que a decisão editorial sai, e os das
 * edições anteriores, que a organização cadastra em /co-chairs/pitches.
 * As duas fontes chegam numa lista só, já ordenada pela RPC.
 *
 * Categoria que não exige vídeo não aparece aqui, e isso não é um filtro:
 * um trabalho de Extensão simplesmente não tem vídeo entre os anexos que
 * entregou. Ver `services/pitchesService.ts`.
 *
 * Como /cronograma e /anais, a seção NÃO some quando está vazia: quem
 * clicou em "Pitches" pediu esta informação. A <GradePitches> cuida da
 * mensagem, e também da paginação — a página vive na query string.
 */
const Pitches = () => {
  const { pitches, carregando } = usePitches();

  return (
    <div style={{ fontFamily: "var(--font-family)", background: "#fff", minHeight: "100vh" }}>
      <CabecalhoPublico />

      <section className="cronograma-pagina">
        <div className="pitches-inner">
          <div className="section-overline">▶ VÍDEOS DE APRESENTAÇÃO</div>
          <h1 className="section-title">Pitches do congresso.</h1>
          <p className="section-description">
            As apresentações em vídeo dos trabalhos aprovados, desta edição e das anteriores.
          </p>

          <GradePitches pitches={pitches} carregando={carregando} />

          <div className="cronograma-rodape-acoes">
            <Link to="/anais" className="btn btn-outline">VER OS ANAIS</Link>
            <Link to="/cadastro" className="btn btn-primary">CADASTRAR-SE</Link>
          </div>
        </div>
      </section>

      <RodapePublico />
    </div>
  );
};

export default Pitches;
