import { useState } from "react";
import { normalizar } from "@/lib/avaliacaoEvento";
import { rotuloData, rotuloHorario, type ApresentacaoPublica } from "@/lib/apresentacoes";

/**
 * O cronograma de apresentações, só de leitura: busca por título e a tabela
 * com título, autores, dia, horário, sala e tipo.
 *
 * Componente ÚNICO das telas que o exibem — /apresentacoes (sem sessão, e
 * para onde a chamada da landing leva) e /estudante/apresentacoes —, como a
 * <ListaCronograma> do cronograma do evento: duas cópias divergiriam no
 * primeiro ajuste. O AdminCA não usa este componente: lá cada linha é um
 * formulário.
 *
 * A busca ignora acento e caixa (`normalizar`): "cafe" acha "Café".
 */

/**
 * Só a tabela. Exportada à parte para o quadro "Sua apresentação" do portal
 * do autor mostrar o trabalho dele com exatamente as mesmas colunas.
 */
export const TabelaApresentacoes = ({
  itens,
  vazio = "Nenhum trabalho encontrado.",
}: {
  itens: ApresentacaoPublica[];
  vazio?: string;
}) => (
  <div className="table-container">
    <table className="table" style={{ width: "100%" }}>
      <thead>
        <tr>
          <th>TÍTULO</th>
          <th>AUTORES</th>
          <th>DIA</th>
          <th>HORÁRIO</th>
          <th>SALA</th>
          <th>TIPO</th>
        </tr>
      </thead>
      <tbody>
        {itens.length === 0 ? (
          <tr>
            <td
              colSpan={6}
              className="celula-plena"
              style={{ textAlign: "center", color: "var(--color-text-muted)" }}
            >
              {vazio}
            </td>
          </tr>
        ) : (
          itens.map((a) => (
            <tr key={a.id}>
              <td data-rotulo="TÍTULO" className="celula-titulo" style={{ fontWeight: "var(--fw-semibold)" }}>
                {a.titulo}
              </td>
              <td data-rotulo="AUTORES">{a.autores}</td>
              <td data-rotulo="DIA" style={{ whiteSpace: "nowrap" }}>
                {rotuloData(a.data)}
              </td>
              <td data-rotulo="HORÁRIO" style={{ whiteSpace: "nowrap" }}>
                {rotuloHorario(a.hora_inicio, a.hora_fim)}
              </td>
              <td data-rotulo="SALA">{a.sala}</td>
              <td data-rotulo="TIPO">{a.tipo || "—"}</td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  </div>
);

type Props = {
  itens: ApresentacaoPublica[];
  /** Diferencia "ainda buscando" de "nada publicado". */
  carregando?: boolean;
};

export const ListaApresentacoes = ({ itens, carregando = false }: Props) => {
  const [termo, setTermo] = useState("");

  if (carregando) {
    return <p className="cronograma-aviso">Carregando o cronograma de apresentações...</p>;
  }

  if (itens.length === 0) {
    return (
      <p className="cronograma-aviso">
        O cronograma de apresentações ainda não foi publicado. Assim que a organização definir dia,
        horário e sala dos trabalhos, eles aparecem aqui.
      </p>
    );
  }

  const busca = normalizar(termo.trim());
  const linhas = busca ? itens.filter((a) => normalizar(a.titulo).includes(busca)) : itens;

  return (
    <>
      <div className="toolbar">
        <div className="search-wrapper">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="search"
            className="search-input"
            placeholder="Buscar por título..."
            aria-label="Buscar por título"
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
          />
        </div>
      </div>

      <TabelaApresentacoes itens={linhas} />
    </>
  );
};

export default ListaApresentacoes;
