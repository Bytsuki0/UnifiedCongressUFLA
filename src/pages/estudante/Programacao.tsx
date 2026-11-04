import { ImagemProgramacao } from "@/components/cronograma/ImagemProgramacao";
import { useProgramacao } from "@/hooks/use-programacao";

/**
 * Programação dentro do Portal do Estudante — o mesmo arquivo de
 * /programacao, para quem já entrou não precisar sair do portal.
 */
const Programacao = () => {
  const { programacao, carregando } = useProgramacao();

  return (
    <div className="section active">
      <div className="content-area">
        <div className="page-header">
          <div className="page-overline">Evento</div>
          <h1 className="page-title">Programação</h1>
        </div>

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
    </div>
  );
};

export default Programacao;
