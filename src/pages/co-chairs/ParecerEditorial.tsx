import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Gavel, Hourglass } from "lucide-react";
import {
  carregarPainelParecerEditorial,
  DECISAO_BADGE,
  DECISAO_LABEL,
  LinhaParecerEditorial,
  PARECERES_PARA_DECIDIR,
} from "@/services/parecerEditorialService";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * A fila do parecer editorial.
 *
 * Todo trabalho aparece, mas só sai do cinza quando os 3 pareceres da
 * rodada corrente entraram — é a leitura direta da regra do servidor
 * (`registrar_parecer_editorial` recusa abaixo de 3). Decidir antes de
 * ler os três seria decidir no escuro, e é por isso que o botão não fica
 * apenas feio: fica desabilitado.
 */
const ParecerEditorial = () => {
  const [linhas, setLinhas] = useState<LinhaParecerEditorial[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        setLinhas(await carregarPainelParecerEditorial());
      } catch {
        toast.error("Erro ao carregar os trabalhos");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const aguardando = useMemo(
    () => linhas.filter((l) => l.pronto && !l.decisao).length,
    [linhas],
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Gavel className="h-6 w-6" /> Parecer Editorial
        </h1>
        <p className="text-muted-foreground">
          A decisão final de cada trabalho. Ela deixou de sair sozinha da média dos pareceres: os{" "}
          {PARECERES_PARA_DECIDIR} revisores emitem, e um co-chair lê tudo e decide, com justificativa.
        </p>
      </div>

      {!loading && aguardando > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm">
          <Hourglass className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <span>
            <strong>{aguardando} trabalho(s) aguardando parecer editorial</strong> — os pareceres
            chegaram e a decisão está com a organização. Enquanto ninguém decidir, o autor não vê
            nota nenhuma.
          </span>
        </div>
      )}

      <Card className="shadow-[var(--shadow-card)]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Título</TableHead>
              <TableHead>Categoria</TableHead>
              <TableHead className="w-28 text-center">Pareceres</TableHead>
              <TableHead className="w-52">Decisão</TableHead>
              <TableHead className="w-32 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  Carregando...
                </TableCell>
              </TableRow>
            ) : linhas.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  Nenhum trabalho submetido.
                </TableCell>
              </TableRow>
            ) : (
              linhas.map((l) => (
                // Sem os 3 pareceres a linha inteira apaga. `pointer-events-none`
                // fica fora de propósito: o co-chair ainda precisa poder
                // selecionar o título para procurá-lo em Atribuições.
                <TableRow key={l.trabalho.id} className={l.pronto ? undefined : "opacity-45"}>
                  <TableCell className="font-medium">
                    {l.trabalho.titulo}
                    {l.trabalho.rodada > 1 && (
                      <Badge variant="outline" className="ml-2 font-normal">
                        {l.trabalho.rodada}ª rodada
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{l.categoriaNome}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant={l.pronto ? "secondary" : "outline"}>
                      {l.pareceres}/{PARECERES_PARA_DECIDIR}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {l.decisao ? (
                      <span className={DECISAO_BADGE[l.decisao.decisao]}>
                        {DECISAO_LABEL[l.decisao.decisao]}
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        {l.pronto ? "Aguardando decisão" : "Em avaliação"}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {l.pronto ? (
                      <Button size="sm" variant={l.decisao ? "outline" : "default"} asChild>
                        <Link to={`/co-chairs/parecer-editorial/${l.trabalho.id}`}>
                          {l.decisao ? "Rever" : "Analisar"}
                        </Link>
                      </Button>
                    ) : (
                      <Button size="sm" disabled title="Faltam pareceres para analisar">
                        Analisar
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
};

export default ParecerEditorial;
