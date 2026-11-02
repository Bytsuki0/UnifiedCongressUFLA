import { useEffect, useState } from "react";
import { Trophy } from "lucide-react";
import type { LinhaRanking } from "@/lib/avaliacaoEvento";
import type { Categoria, Trabalho } from "@/lib/types";
import { carregarResultadosEvento } from "@/services/avaliacaoEventoService";
import { Card, CardContent } from "@/components/ui/card";

/**
 * O ranking da avaliação ao vivo, por categoria: a média das médias de
 * cada avaliador. Só leitura — quem escreve é o portal Avaliação.
 */
const ResultadosEvento = () => {
  const [dados, setDados] = useState<{
    ranking: Record<string, LinhaRanking<Trabalho>[]>;
    categorias: Categoria[];
  } | null>(null);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    carregarResultadosEvento().then(setDados).catch(() => setErro(true));
  }, []);

  // Na ordem das categorias; "sem categoria" (chave "") por último, se houver.
  const grupos = dados
    ? [...dados.categorias.map((c) => ({ id: c.id, nome: c.nome })), { id: "", nome: "Sem categoria" }]
        .filter((g) => dados.ranking[g.id]?.length)
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Trophy className="h-6 w-6" /> Resultados da Avaliação
        </h1>
        <p className="text-muted-foreground">
          As notas dadas no portal Avaliação durante o congresso, por categoria. A média de cada
          trabalho é a média das médias de quem o avaliou.
        </p>
      </div>

      {erro ? (
        // Nunca "nenhuma avaliação": com a falha à vista, ninguém conclui que não houve nota.
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          Não foi possível carregar os resultados. Recarregue a página.
        </div>
      ) : dados === null ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : grupos.length === 0 ? (
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="py-12 text-center text-muted-foreground">
            Nenhum trabalho avaliado ainda.
          </CardContent>
        </Card>
      ) : (
        grupos.map((g) => (
          <div key={g.id} className="space-y-2">
            <h2 className="text-lg font-semibold">{g.nome}</h2>
            <div className="table-container">
              <table className="table" style={{ width: "100%" }}>
                <thead>
                  <tr>
                    <th>POSIÇÃO</th>
                    <th>TRABALHO</th>
                    <th>AUTORES</th>
                    <th>MÉDIA</th>
                    <th>AVALIAÇÕES</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.ranking[g.id].map((l, i) => (
                    <tr key={l.trabalho.id}>
                      <td data-rotulo="POSIÇÃO">{i + 1}º</td>
                      <td data-rotulo="TRABALHO" className="celula-titulo">{l.trabalho.titulo}</td>
                      <td data-rotulo="AUTORES" className="celula-truncada">{l.trabalho.autores}</td>
                      <td data-rotulo="MÉDIA">{l.media.toFixed(2)}</td>
                      <td data-rotulo="AVALIAÇÕES">{l.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </div>
  );
};

export default ResultadosEvento;
