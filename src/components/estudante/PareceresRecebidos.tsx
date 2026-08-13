import { RESULTADO_OPTIONS, type ResultadoParecer } from "@/lib/types";
import type { ParecerAnonimo } from "@/services/correcaoService";

const RESULTADO_LABEL = Object.fromEntries(
  RESULTADO_OPTIONS.map((o) => [o.value, o.label]),
) as Record<ResultadoParecer, string>;

const RESULTADO_BADGE: Record<ResultadoParecer, string> = {
  aprovado: "badge badge-green",
  aprovado_correcoes: "badge badge-amber",
  nao_aprovado: "badge badge-red",
};

/**
 * As notas e os comentários que o trabalho recebeu, como o AUTOR os vê.
 *
 * A fonte é a RPC `pareceres_do_meu_trabalho`, que aplica duas regras do
 * servidor: nada de nome ou e-mail do revisor (avaliação às cegas) e
 * nada antes de a decisão consolidar. Este componente não decide nada —
 * se a lista chegou, é porque o banco liberou.
 *
 * Vale para QUALQUER desfecho: aprovado, aprovado com correções e
 * reprovado. Quem foi reprovado é justamente quem mais precisa ler o
 * porquê, e quem vai corrigir precisa saber o quê.
 *
 * Usado pela tela de correção e pela de detalhe do trabalho — as duas
 * mostram exatamente o mesmo, e é para continuar assim.
 */
export function PareceresRecebidos({ pareceres }: { pareceres: ParecerAnonimo[] }) {
  if (pareceres.length === 0) return null;

  const comNota = pareceres.flatMap((p) => p.itens.map((i) => Number(i.nota)));
  const media = comNota.length
    ? (comNota.reduce((s, n) => s + n, 0) / comNota.length).toFixed(2)
    : null;

  return (
    <>
      {media && (
        <div className="alert alert-warning" style={{ marginBottom: "var(--space-4)" }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18, flexShrink: 0, marginTop: 1 }}>
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
          <div>
            <strong>Média das notas: {media} de 5.</strong>{" "}
            {pareceres.length === 1
              ? "1 parecer recebido."
              : `${pareceres.length} pareceres recebidos.`}{" "}
            A identificação dos avaliadores é omitida, a avaliação é às cegas.
          </div>
        </div>
      )}

      {pareceres.map((p) => (
        <div
          key={p.ordem}
          style={{
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-md)",
            padding: "var(--space-4)",
            marginBottom: "var(--space-3)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <strong style={{ fontSize: "var(--fs-sm)" }}>Parecer {p.ordem}</strong>
            <span className={RESULTADO_BADGE[p.resultado] ?? "badge badge-gray"}>
              {RESULTADO_LABEL[p.resultado] ?? p.resultado}
            </span>
          </div>

          {p.comentario_geral && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: "var(--fs-xs)", fontWeight: "var(--fw-semibold)", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
                Comentário geral
              </div>
              <div style={{ fontSize: "var(--fs-sm)", background: "var(--gray-50)", padding: 8, borderRadius: 4, lineHeight: "var(--lh-normal)", whiteSpace: "pre-wrap" }}>
                {p.comentario_geral}
              </div>
            </div>
          )}

          {p.itens.length > 0 && (
            <>
              <div style={{ fontSize: "var(--fs-xs)", fontWeight: "var(--fw-semibold)", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
                Notas por critério
              </div>
              <div className="table-container">
                <table className="table" style={{ width: "100%" }}>
                  <thead>
                    <tr>
                      <th>CRITÉRIO</th>
                      <th style={{ width: 80, textAlign: "center" }}>NOTA</th>
                      <th>COMENTÁRIO</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.itens.map((it) => (
                      <tr key={it.criterio_id}>
                        <td style={{ fontWeight: "var(--fw-semibold)" }}>{it.titulo}</td>
                        <td style={{ textAlign: "center" }}>{it.nota} / 5</td>
                        <td style={{ color: it.comentario ? undefined : "var(--color-text-muted)", whiteSpace: "pre-wrap" }}>
                          {it.comentario || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      ))}
    </>
  );
}
