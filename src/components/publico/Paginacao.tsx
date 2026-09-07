import { janelaDePaginas } from "@/lib/pitches";

/**
 * Rodapé de páginas no estilo da busca do Google: anterior, uma janela
 * de números em volta da página atual, próxima.
 *
 * A regra da janela mora em `src/lib/pitches.ts` (e tem teste): aqui só
 * fica o desenho. Com uma página só o rodapé não aparece — um "1"
 * sozinho não é navegação, é ruído.
 *
 * Os números são `<button>` e não links: a página vive na query string e
 * quem a troca é o componente de cima, que também precisa rolar a
 * vitrine de volta ao topo. Um `<a href>` daria o menu de contexto
 * "abrir em nova aba" de graça, mas duplicaria o estado — o href teria
 * de reconstruir a URL inteira, com os outros parâmetros que ela venha a
 * ter.
 */

type Props = {
  paginaAtual: number;
  totalPaginas: number;
  aoTrocar: (pagina: number) => void;
  /** Para o leitor de tela saber o que está sendo paginado. */
  rotulo?: string;
};

export const Paginacao = ({ paginaAtual, totalPaginas, aoTrocar, rotulo = "páginas" }: Props) => {
  if (totalPaginas <= 1) return null;

  const paginas = janelaDePaginas(paginaAtual, totalPaginas);
  const primeira = paginaAtual <= 1;
  const ultima = paginaAtual >= totalPaginas;

  return (
    <nav className="paginacao" aria-label={`Navegação de ${rotulo}`}>
      <button
        type="button"
        className="paginacao-seta"
        onClick={() => aoTrocar(paginaAtual - 1)}
        disabled={primeira}
        aria-label="Página anterior"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="m15 18-6-6 6-6" />
        </svg>
        ANTERIOR
      </button>

      <ol className="paginacao-numeros">
        {/* A janela pode começar depois do 1: as reticências dizem que há
            páginas atrás dela, senão o "4 5 6" do começo do rodapé parece
            a lista inteira. */}
        {paginas[0] > 1 && <li className="paginacao-elipse" aria-hidden="true">…</li>}

        {paginas.map((n) => (
          <li key={n}>
            <button
              type="button"
              className={`paginacao-numero${n === paginaAtual ? " ativo" : ""}`}
              onClick={() => aoTrocar(n)}
              aria-label={`Página ${n}`}
              aria-current={n === paginaAtual ? "page" : undefined}
            >
              {n}
            </button>
          </li>
        ))}

        {paginas[paginas.length - 1] < totalPaginas && (
          <li className="paginacao-elipse" aria-hidden="true">…</li>
        )}
      </ol>

      <button
        type="button"
        className="paginacao-seta"
        onClick={() => aoTrocar(paginaAtual + 1)}
        disabled={ultima}
        aria-label="Próxima página"
      >
        PRÓXIMA
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="m9 18 6-6-6-6" />
        </svg>
      </button>
    </nav>
  );
};

export default Paginacao;
