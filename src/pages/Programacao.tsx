import { CabecalhoPublico } from "@/components/publico/CabecalhoPublico";
import { RodapePublico } from "@/components/publico/RodapePublico";
import { ImagemProgramacao } from "@/components/cronograma/ImagemProgramacao";
import { useProgramacao } from "@/hooks/use-programacao";

/**
 * Programação — página pública, aberta ANTES do login (aba PROGRAMAÇÃO).
 * O arquivo é o que a organização sobe em /co-chairs/cronograma. Como em
 * /cronograma, aqui o vazio AVISA: quem clicou na aba pediu a informação.
 */
const Programacao = () => {
  const { programacao, carregando } = useProgramacao();

  return (
    <div style={{ fontFamily: "var(--font-family)", background: "#fff", minHeight: "100vh" }}>
      <CabecalhoPublico />

      <section className="cronograma-pagina">
        <div className="cronograma-inner">
          <div className="section-overline">PROGRAMAÇÃO</div>
          <h1 className="section-title">Programação do evento.</h1>

          {carregando ? (
            <p className="cronograma-aviso">Carregando programação...</p>
          ) : programacao ? (
            <ImagemProgramacao programacao={programacao} />
          ) : (
            <p className="cronograma-aviso">
              A programação ainda não foi publicada. Assim que a organização a divulgar, ela aparece
              aqui.
            </p>
          )}
        </div>
      </section>

      <RodapePublico />
    </div>
  );
};

export default Programacao;
