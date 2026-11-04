import { ListaApresentacoes, TabelaApresentacoes } from "@/components/apresentacoes/ListaApresentacoes";
import { useApresentacoes } from "@/hooks/use-apresentacoes";

/**
 * Cronograma de apresentações dentro do Portal do Estudante.
 *
 * A MESMA lista de /apresentacoes, pela mesma RPC — com uma diferença: a
 * sessão faz a RPC marcar em `meu` os trabalhos que esta conta SUBMETEU, e
 * eles aparecem num quadro de destaque antes da lista completa, com as
 * mesmas colunas. Só o dono: coautor não vê o trabalho destacado, como não
 * recebe o e-mail. O trabalho continua na lista completa — o quadro
 * destaca, não tira de lá —, e a busca não alcança o quadro.
 */
const Apresentacoes = () => {
  const { itens, carregando } = useApresentacoes();
  const minhas = itens.filter((a) => a.meu);

  return (
    <div className="section active">
      <div className="content-area">
        <div className="page-header">
          <div className="page-overline">Apresentações do congresso</div>
          <h1 className="page-title">Cronograma de Apresentações</h1>
          <p style={{ fontSize: "var(--fs-sm)", color: "var(--color-text-secondary)" }}>
            Dia, horário, sala e formato de apresentação de cada trabalho aprovado. Busque pelo
            título ou pelo nome de um autor.
          </p>
        </div>

        {minhas.length > 0 && (
          <section className="apresentacoes-destaque" aria-labelledby="apresentacoes-destaque-titulo">
            <h2 id="apresentacoes-destaque-titulo" className="apresentacoes-destaque-titulo">
              {minhas.length === 1 ? "Sua apresentação" : "Suas apresentações"}
            </h2>
            <p className="apresentacoes-destaque-texto">
              {minhas.length === 1
                ? "O trabalho que você submeteu. Ele também está na lista completa, abaixo."
                : "Os trabalhos que você submeteu. Eles também estão na lista completa, abaixo."}
            </p>
            <TabelaApresentacoes itens={minhas} />
          </section>
        )}

        <ListaApresentacoes itens={itens} carregando={carregando} />
      </div>
    </div>
  );
};

export default Apresentacoes;
