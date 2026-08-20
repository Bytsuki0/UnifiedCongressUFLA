import { RESULTADO_OPTIONS, type ResultadoParecer } from "@/lib/types";
import type { ParecerIdentificado } from "@/services/parecerEditorialService";
import { Badge } from "@/components/ui/badge";

const RESULTADO_LABEL = Object.fromEntries(
  RESULTADO_OPTIONS.map((o) => [o.value, o.label]),
) as Record<ResultadoParecer, string>;

const RESULTADO_VARIANT: Record<ResultadoParecer, "default" | "secondary" | "destructive"> = {
  aprovado: "default",
  aprovado_correcoes: "secondary",
  nao_aprovado: "destructive",
};

/**
 * Um parecer como a ORGANIZAÇÃO o vê: com o nome e o e-mail de quem o
 * emitiu.
 *
 * É o gêmeo identificado de `components/estudante/PareceresRecebidos`, e
 * são dois componentes de propósito: aquele recebe `ParecerAnonimo`, um
 * tipo que simplesmente não tem campo de identidade, e é bom que não
 * tenha — a avaliação às cegas fica garantida pelo formato do dado, não
 * por lembrar de esconder uma coluna no JSX.
 *
 * Aqui vale o contrário: quem decide o desfecho precisa saber quem
 * assinou cada nota.
 */
export function ParecerCompleto({
  parecer,
  ordem,
}: {
  parecer: ParecerIdentificado;
  ordem: number;
}) {
  const media = parecer.itens.length
    ? (
        parecer.itens.reduce((s, i) => s + Number(i.nota), 0) / parecer.itens.length
      ).toFixed(2)
    : null;

  return (
    <div className="rounded-md border border-border p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">
            Parecer {ordem} · {parecer.revisor_nome ?? parecer.revisor_email}
          </div>
          <div className="text-xs text-muted-foreground">{parecer.revisor_email}</div>
        </div>
        <div className="flex items-center gap-2">
          {media && (
            <span className="text-xs text-muted-foreground">média {media}/5</span>
          )}
          <Badge variant={RESULTADO_VARIANT[parecer.resultado] ?? "outline"}>
            {RESULTADO_LABEL[parecer.resultado] ?? parecer.resultado}
          </Badge>
        </div>
      </div>

      {parecer.comentario_geral && (
        <div className="mb-3">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Comentário geral
          </div>
          <p className="whitespace-pre-wrap rounded bg-muted/50 p-2 text-sm leading-relaxed">
            {parecer.comentario_geral}
          </p>
        </div>
      )}

      {parecer.itens.length > 0 && (
        <>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Notas por critério
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="py-1 pr-2 font-medium">CRITÉRIO</th>
                  <th className="w-16 py-1 text-center font-medium">NOTA</th>
                  <th className="py-1 font-medium">COMENTÁRIO</th>
                </tr>
              </thead>
              <tbody>
                {parecer.itens.map((it) => (
                  <tr key={it.criterio_id} className="border-b border-border/60 last:border-0">
                    <td className="py-1.5 pr-2 font-medium">{it.titulo}</td>
                    <td className="py-1.5 text-center">{it.nota} / 5</td>
                    <td
                      className={`py-1.5 whitespace-pre-wrap ${
                        it.comentario ? "" : "text-muted-foreground"
                      }`}
                    >
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
  );
}
