import { useEffect, useMemo, useState } from "react";
import { Award, Medal } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type RankingAvaliacao = {
  nota_geral: number | null;
  trabalhos: {
    id: string;
    titulo: string;
    autores: string;
    categorias: { id: string; nome: string } | null;
  } | null;
};

type RankingItem = {
  trabalhoId: string;
  titulo: string;
  autores: string;
  categoria: string;
  notaGeral: number;
  totalAvaliacoes: number;
};

const Rankings = () => {
  const [avaliacoes, setAvaliacoes] = useState<RankingAvaliacao[]>([]);
  const [loading, setLoading] = useState(true);

  const carregar = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("avaliacoes")
      .select("nota_geral, trabalhos(id, titulo, autores, categorias(id, nome))")
      .not("nota_geral", "is", null);

    if (error) {
      toast.error("Erro ao carregar rankings");
      setLoading(false);
      return;
    }

    setAvaliacoes((data ?? []) as unknown as RankingAvaliacao[]);
    setLoading(false);
  };

  useEffect(() => {
    carregar();
  }, []);

  const rankings = useMemo(() => {
    const porTrabalho = new Map<string, RankingItem & { soma: number }>();

    avaliacoes.forEach((avaliacao) => {
      if (avaliacao.nota_geral === null || !avaliacao.trabalhos) return;
      const trabalho = avaliacao.trabalhos;
      const categoria = trabalho.categorias?.nome ?? "Sem categoria";
      const current = porTrabalho.get(trabalho.id);

      if (current) {
        current.soma += Number(avaliacao.nota_geral);
        current.totalAvaliacoes += 1;
        current.notaGeral = current.soma / current.totalAvaliacoes;
      } else {
        porTrabalho.set(trabalho.id, {
          trabalhoId: trabalho.id,
          titulo: trabalho.titulo,
          autores: trabalho.autores,
          categoria,
          notaGeral: Number(avaliacao.nota_geral),
          totalAvaliacoes: 1,
          soma: Number(avaliacao.nota_geral),
        });
      }
    });

    const grouped = new Map<string, RankingItem[]>();
    Array.from(porTrabalho.values()).forEach(({ soma: _soma, ...item }) => {
      const list = grouped.get(item.categoria) ?? [];
      list.push({ ...item, notaGeral: Number(item.notaGeral.toFixed(2)) });
      grouped.set(item.categoria, list);
    });

    return Array.from(grouped.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([categoria, items]) => ({
        categoria,
        items: items.sort((a, b) => b.notaGeral - a.notaGeral || a.titulo.localeCompare(b.titulo)),
      }));
  }, [avaliacoes]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
          <Award className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Rankings</h1>
          <p className="text-sm text-muted-foreground">
            Trabalhos agrupados por categoria e ordenados pela média das avaliações salvas.
          </p>
        </div>
      </div>

      {loading ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">Carregando rankings...</CardContent>
        </Card>
      ) : rankings.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Nenhuma avaliação concluída com nota geral até o momento.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {rankings.map(({ categoria, items }) => (
            <Card key={categoria} className="shadow-[var(--shadow-card)]">
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Medal className="h-5 w-5 text-secondary" />
                  {categoria}
                </CardTitle>
                <Badge variant="secondary">{items.length} trabalho(s)</Badge>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-24">Posição</TableHead>
                      <TableHead>Título</TableHead>
                      <TableHead>Autor(es)</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead className="text-right">Nota geral</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item, index) => (
                      <TableRow key={item.trabalhoId}>
                        <TableCell className="font-semibold">{index + 1}º</TableCell>
                        <TableCell className="font-medium">{item.titulo}</TableCell>
                        <TableCell className="max-w-xs truncate">{item.autores}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{item.categoria}</Badge>
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          {item.notaGeral.toFixed(2)}
                          <span className="ml-1 text-xs font-normal text-muted-foreground">
                            ({item.totalAvaliacoes})
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default Rankings;
