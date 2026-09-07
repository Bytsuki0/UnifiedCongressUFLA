import type { PublicacaoAnais } from "@/services/anaisService";

/**
 * Os anais publicados, só de leitura.
 *
 * Componente único da seção da landing e da página /anais — mesma
 * informação, mesmo desenho, e duas cópias divergiriam no primeiro
 * ajuste. É o mesmo papel que `<ListaCronograma>` faz para as datas; a
 * tela de co-chairs não o usa, porque lá cada linha tem editar e
 * excluir.
 *
 * O cartão é um bloco inteiro, e não um título com um link no fim: a
 * referência ("Revista X, v. 12, dezembro de 2025") é o que a pessoa lê
 * para decidir se é o volume que procura, e ela precisa estar junto do
 * botão que leva lá.
 */

type Props = {
  anais: PublicacaoAnais[];
  /** Diferencia "ainda buscando" de "nada publicado". */
  carregando?: boolean;
};

export const ListaAnais = ({ anais, carregando = false }: Props) => {
  if (carregando) {
    return <p className="cronograma-aviso">Carregando anais...</p>;
  }

  if (anais.length === 0) {
    return (
      <p className="cronograma-aviso">
        Os anais ainda não foram publicados. Assim que a organização divulgar as publicações, elas
        aparecem aqui.
      </p>
    );
  }

  return (
    <ul className="anais-lista">
      {anais.map((item) => (
        <li className="anais-item" key={item.id}>
          <div className="anais-item-texto">
            <h3 className="anais-item-titulo">{item.titulo}</h3>
            {/* Vazia esconde a linha, em vez de reservar espaço: a
                referência é opcional e um espaço em branco sob o título
                pareceria falha de carregamento. */}
            {item.descricao && <p className="anais-item-ref">{item.descricao}</p>}
          </div>
          {/* Aba nova + noopener: o destino é externo (revista,
              repositório, Drive) e não deve poder mexer na janela que o
              abriu. Mesma regra de `BotaoBaixar`. */}
          <a
            className="btn btn-primary btn-sm"
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            ACESSAR
          </a>
        </li>
      ))}
    </ul>
  );
};

export default ListaAnais;
