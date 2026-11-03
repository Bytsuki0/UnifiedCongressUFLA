import { ListaCronograma } from "@/components/cronograma/ListaCronograma";
import { useCronograma } from "@/hooks/use-cronograma";
import { ImagemProgramacao } from "@/components/cronograma/ImagemProgramacao";
import { useProgramacao } from "@/hooks/use-programacao";

/**
 * Cronograma dentro do Portal do Estudante.
 *
 * É a MESMA lista de /cronograma e da landing, pelo mesmo hook e pela
 * mesma RPC pública — o autor não vê nada a mais por estar logado.
 * A página existe para que quem já entrou não precise sair do portal
 * (nem deslogar) para conferir um prazo.
 */
const Cronograma = () => {
  const { itens, carregando } = useCronograma();
  const programacao = useProgramacao();

  return (
    <div className="section active">
      <div className="content-area">
        <div className="page-header">
          <div className="page-overline">Datas do congresso</div>
          <h1 className="page-title">Cronograma</h1>
          <p style={{ fontSize: "var(--fs-sm)", color: "var(--color-text-secondary)" }}>
            Prazos de submissão, avaliação e realização do evento, em ordem cronológica.
          </p>
        </div>

        <div className="card">
          <ListaCronograma itens={itens} carregando={carregando} />
        </div>

        {programacao && (
          <div className="card" style={{ marginTop: "var(--space-6)" }}>
            <h2 style={{ fontSize: "var(--fs-h4)", fontWeight: "var(--fw-semibold)", marginBottom: "var(--space-4)" }}>
              Programação do evento
            </h2>
            <ImagemProgramacao programacao={programacao} />
          </div>
        )}
      </div>
    </div>
  );
};

export default Cronograma;
