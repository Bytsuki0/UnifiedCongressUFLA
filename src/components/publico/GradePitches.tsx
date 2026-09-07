import { useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { CartaoPitch } from "@/components/publico/CartaoPitch";
import { Paginacao } from "@/components/publico/Paginacao";
import { fatiaDaPagina, paginaValida, totalDePaginas } from "@/lib/pitches";
import type { Pitch } from "@/services/pitchesService";

/**
 * A vitrine de pitches: dois vídeos por linha, seis linhas por página, e
 * o rodapé de páginas embaixo.
 *
 * A página vive na QUERY STRING (`?pagina=3`), não no estado do
 * componente. É o que faz o botão VOLTAR do navegador desfazer a
 * navegação de página, e o que torna a página 3 um endereço que dá para
 * mandar para alguém. Como qualquer um pode digitar `?pagina=99` ali,
 * quem lê o número o prende ao intervalo existente (`paginaValida`) — e
 * é a mesma trava que salva a tela quando um vídeo é despublicado e a
 * última página deixa de existir com o visitante em cima dela.
 *
 * A troca de página NÃO vai à rede: a lista inteira já está em memória
 * (ver `usePitches`). Por isso não há estado de carregamento entre uma
 * página e outra — e, mais importante, não há como a ordem mudar no meio
 * da navegação e um vídeo pular da página 2 para a 1.
 */

type Props = {
  pitches: Pitch[];
  /** Diferencia "ainda buscando" de "nada publicado". */
  carregando?: boolean;
};

export const GradePitches = ({ pitches, carregando = false }: Props) => {
  const [params, setParams] = useSearchParams();
  const topo = useRef<HTMLDivElement>(null);

  const paginas = totalDePaginas(pitches.length);
  const atual = paginaValida(Number(params.get("pagina") ?? 1), paginas);
  const daPagina = fatiaDaPagina(pitches, atual);

  const trocarPagina = (destino: number) => {
    const proxima = paginaValida(destino, paginas);
    const novos = new URLSearchParams(params);
    // A página 1 não vira parâmetro: /pitches e /pitches?pagina=1 são o
    // mesmo lugar, e deixar o parâmetro grudado dá dois endereços para a
    // mesma tela (e dois resultados de busca).
    if (proxima === 1) novos.delete("pagina");
    else novos.set("pagina", String(proxima));

    // `replace: false` de propósito: cada página é um passo do histórico,
    // que é o que o VOLTAR do navegador desfaz.
    setParams(novos);

    // Sem isto a página 2 abre já rolada até o rodapé — o clique foi lá
    // embaixo, e a grade nova começa lá em cima.
    topo.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (carregando) {
    return <p className="cronograma-aviso">Carregando pitches...</p>;
  }

  if (pitches.length === 0) {
    return (
      <p className="cronograma-aviso">
        Nenhum pitch publicado ainda. Os vídeos aparecem aqui quando os trabalhos que os enviaram
        são aprovados, ou quando a organização publica o acervo das edições anteriores.
      </p>
    );
  }

  return (
    <div ref={topo}>
      <div className="pitches-grade">
        {daPagina.map((pitch) => (
          <CartaoPitch key={pitch.id} pitch={pitch} />
        ))}
      </div>

      <p className="pitches-contagem">
        {pitches.length === 1
          ? "1 pitch publicado"
          : `${pitches.length} pitches publicados`}
        {paginas > 1 && ` · página ${atual} de ${paginas}`}
      </p>

      <Paginacao
        paginaAtual={atual}
        totalPaginas={paginas}
        aoTrocar={trocarPagina}
        rotulo="pitches"
      />
    </div>
  );
};

export default GradePitches;
