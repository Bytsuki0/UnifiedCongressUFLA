import { useEffect, useMemo, useState } from "react";
import type { MarcacaoCronograma, MesCronograma } from "@/services/cronogramaService";
import {
  chaveDia,
  chaveMes,
  corDoTexto,
  DIAS_SEMANA,
  gradeDoMes,
  hojeLocal,
  marcacoesDoMes,
  marcacoesPorDia,
  rotuloDiaCurto,
  rotuloMes,
} from "@/lib/cronograma";

/**
 * O calendário do cronograma, só de leitura.
 *
 * Componente ÚNICO das três telas que exibem o cronograma: a seção da
 * landing (sem sessão), a página pública /cronograma e
 * /estudante/cronograma. É de propósito: são a mesma informação com o
 * mesmo desenho, e três cópias divergiriam no primeiro ajuste de cor.
 * A tela de co-chairs NÃO usa este componente — lá o calendário é
 * editável, com seleção múltipla, e misturar as duas coisas encheria
 * este arquivo de props que só uma delas usa.
 *
 * Quando há mais de um mês publicado, as abas trocam de mês. Com um mês
 * só, as abas não aparecem — uma aba solitária não é navegação, é
 * ruído.
 */

type Props = {
  meses: MesCronograma[];
  marcacoes: MarcacaoCronograma[];
  /** Diferencia "ainda buscando" de "nada publicado". */
  carregando?: boolean;
};

export const CalendarioCronograma = ({ meses, marcacoes, carregando = false }: Props) => {
  const [ativo, setAtivo] = useState(0);
  const [diaAberto, setDiaAberto] = useState<string | null>(null);

  // A lista de meses chega depois da primeira renderização (busca
  // assíncrona) e pode encolher entre uma carga e outra na tela de
  // gestão. Sem isto, o índice guardado apontaria para fora do array e
  // o mês ativo sairia `undefined`.
  useEffect(() => {
    if (ativo > meses.length - 1) setAtivo(0);
  }, [meses.length, ativo]);

  const mes = meses[ativo];
  const porDia = useMemo(() => marcacoesPorDia(marcacoes), [marcacoes]);
  const legenda = useMemo(
    () => (mes ? marcacoesDoMes(marcacoes, mes) : []),
    [marcacoes, mes],
  );
  const hoje = hojeLocal();

  if (carregando) {
    return <p className="cronograma-aviso">Carregando cronograma...</p>;
  }

  if (!mes) {
    return (
      <p className="cronograma-aviso">
        O cronograma ainda não foi publicado. Assim que a organização definir as datas, elas
        aparecem aqui.
      </p>
    );
  }

  const marcacoesDoDiaAberto = diaAberto ? porDia[diaAberto] ?? [] : [];

  return (
    <div className="cronograma">
      {meses.length > 1 && (
        <div className="cronograma-abas" role="tablist" aria-label="Meses do cronograma">
          {meses.map((m, i) => (
            <button
              key={chaveMes(m)}
              type="button"
              role="tab"
              aria-selected={i === ativo}
              className={`cronograma-aba${i === ativo ? " ativa" : ""}`}
              onClick={() => {
                setAtivo(i);
                setDiaAberto(null);
              }}
            >
              {rotuloMes(m)}
            </button>
          ))}
        </div>
      )}

      <div className="cronograma-mes">
        <h3 className="cronograma-titulo-mes">{rotuloMes(mes)}</h3>

        <div className="cronograma-grade">
          {DIAS_SEMANA.map((d) => (
            <div key={d} className="cronograma-cabecalho-dia" aria-hidden="true">
              {d}
            </div>
          ))}

          {gradeDoMes(mes.ano, mes.mes).map((dia, i) => {
            if (dia === null) return <div key={`vazio-${i}`} className="cronograma-celula vazia" />;

            const chave = chaveDia(mes.ano, mes.mes, dia);
            const doDia = porDia[chave] ?? [];
            const principal = doDia[0];
            const ehHoje = chave === hoje;

            // Sem marcação a casa é um <div>: não há detalhe para abrir,
            // e um botão inerte quebraria a navegação por teclado.
            if (!principal) {
              return (
                <div
                  key={chave}
                  className={`cronograma-celula${ehHoje ? " hoje" : ""}`}
                >
                  <span className="cronograma-numero">{dia}</span>
                </div>
              );
            }

            const aberta = chave === diaAberto;
            return (
              <button
                key={chave}
                type="button"
                className={`cronograma-celula marcada${ehHoje ? " hoje" : ""}${aberta ? " aberta" : ""}`}
                style={{ background: principal.cor, color: corDoTexto(principal.cor) }}
                onClick={() => setDiaAberto(aberta ? null : chave)}
                aria-expanded={aberta}
                title={doDia.map((m) => m.titulo).join(" · ")}
              >
                <span className="cronograma-numero">{dia}</span>
                <span className="cronograma-rotulo">{principal.titulo}</span>
                {doDia.length > 1 && (
                  <span className="cronograma-mais">+{doDia.length - 1}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {diaAberto && (
        <div className="cronograma-detalhe" role="status">
          <div className="cronograma-detalhe-dia">{rotuloDiaCurto(diaAberto)}</div>
          {marcacoesDoDiaAberto.map((m) => (
            <div key={m.id} className="cronograma-detalhe-item">
              <span className="cronograma-bolinha" style={{ background: m.cor }} />
              <div>
                <div className="cronograma-detalhe-titulo">{m.titulo}</div>
                {m.descricao && <p className="cronograma-detalhe-desc">{m.descricao}</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      {legenda.length > 0 && (
        <div className="cronograma-legenda">
          {legenda.map((m) => (
            <div key={m.id} className="cronograma-legenda-item">
              <span className="cronograma-bolinha" style={{ background: m.cor }} />
              <div>
                <div className="cronograma-legenda-titulo">{m.titulo}</div>
                {m.descricao && <p className="cronograma-legenda-desc">{m.descricao}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default CalendarioCronograma;
