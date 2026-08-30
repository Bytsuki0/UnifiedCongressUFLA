import { CalendarioCronograma } from "@/components/cronograma/CalendarioCronograma";
import { useCronograma } from "@/hooks/use-cronograma";

/**
 * Cronograma dentro do Portal do Estudante.
 *
 * É o MESMO calendário de /cronograma e da landing, pelo mesmo hook e
 * pela mesma RPC pública — o autor não vê nada a mais por estar logado.
 * A página existe para que quem já entrou não precise sair do portal
 * (nem deslogar) para conferir um prazo.
 */
const Cronograma = () => {
  const { cronograma, carregando } = useCronograma();

  return (
    <div className="section active">
      <div className="content-area">
        <div className="page-header">
          <div className="page-overline">Datas do congresso</div>
          <h1 className="page-title">Cronograma</h1>
          <p style={{ fontSize: "var(--fs-sm)", color: "var(--color-text-secondary)" }}>
            Prazos de submissão, avaliação e realização do evento. Clique em um dia marcado para
            ver o que acontece nele.
          </p>
        </div>

        <div className="card">
          <CalendarioCronograma
            meses={cronograma.meses}
            marcacoes={cronograma.marcacoes}
            carregando={carregando}
          />
        </div>
      </div>
    </div>
  );
};

export default Cronograma;
