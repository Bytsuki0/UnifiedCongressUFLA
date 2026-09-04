import type { ItemCronograma } from "@/services/cronogramaService";
import { corDoTexto, estadoDoPeriodo, hojeLocal, rotuloPeriodo } from "@/lib/cronograma";

/**
 * O cronograma, só de leitura: uma lista de períodos em ordem
 * cronológica.
 *
 * Componente ÚNICO das três telas que o exibem — a seção da landing (sem
 * sessão), a página pública /cronograma e /estudante/cronograma. É de
 * propósito: são a mesma informação com o mesmo desenho, e três cópias
 * divergiriam no primeiro ajuste de cor. A tela de co-chairs NÃO usa este
 * componente: lá cada linha tem botões de editar e excluir, e misturar as
 * duas coisas encheria este arquivo de props que só uma delas usa.
 *
 * A cor do item aparece DUAS vezes — no filete da esquerda e no fundo da
 * etiqueta de data. É o que torna a lista escaneável: numa lista, o filete
 * sozinho é fino demais para associar dois itens da mesma cor.
 */

type Props = {
  itens: ItemCronograma[];
  /** Diferencia "ainda buscando" de "nada publicado". */
  carregando?: boolean;
};

export const ListaCronograma = ({ itens, carregando = false }: Props) => {
  // "Hoje" vem do relógio do navegador. Ver `hojeLocal`: o pior caso de um
  // relógio errado aqui é o selo aparecer um dia antes ou depois.
  const hoje = hojeLocal();

  if (carregando) {
    return <p className="cronograma-aviso">Carregando cronograma...</p>;
  }

  if (itens.length === 0) {
    return (
      <p className="cronograma-aviso">
        O cronograma ainda não foi publicado. Assim que a organização definir as datas, elas
        aparecem aqui.
      </p>
    );
  }

  return (
    <ol className="cronograma-lista">
      {itens.map((item) => {
        const estado = estadoDoPeriodo(item.data_inicio, item.data_fim, hoje);

        return (
          <li
            key={item.id}
            className={`cronograma-item ${estado}`}
            style={{ borderLeftColor: item.cor }}
          >
            <div className="cronograma-item-topo">
              <span
                className="cronograma-periodo"
                style={{ background: item.cor, color: corDoTexto(item.cor) }}
              >
                {rotuloPeriodo(item.data_inicio, item.data_fim)}
              </span>
              {estado === "andamento" && <span className="cronograma-selo">Em andamento</span>}
            </div>

            <h3 className="cronograma-item-titulo">{item.titulo}</h3>
            {item.descricao && <p className="cronograma-item-desc">{item.descricao}</p>}
          </li>
        );
      })}
    </ol>
  );
};

export default ListaCronograma;
