import { useEffect, useState } from "react";
import { Trophy } from "lucide-react";
import type { LinhaRanking } from "@/lib/avaliacaoEvento";
import type { Categoria, Trabalho } from "@/lib/types";
import { carregarResultadosEvento } from "@/services/avaliacaoEventoService";
import { Card, CardContent } from "@/components/ui/card";

/**
 * O ranking do congresso, por categoria: metade da nota da revisão, metade
 * da avaliação ao vivo. Só leitura — quem escreve são os portais Revisão e
 * Avaliação.
 */

const nota = (n: number | null) => (n === null ? "—" : n.toFixed(2));
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
          Os trabalhos aprovados, por categoria, do maior para o menor número de pontos. Os pontos
          são metade a nota da revisão (média dos pareceres) e metade a da avaliação ao vivo (média
          de quem avaliou no congresso), as duas de 1 a 5. Enquanto uma das metades não existe, ela
          vale zero.
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
            Nenhum trabalho aprovado ainda.
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
                    <th>REVISÃO</th>
                    <th>AO VIVO</th>
                    <th>AVALIAÇÕES</th>
                    <th>PONTOS</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.ranking[g.id].map((l, i) => (
                    <tr key={l.trabalho.id}>
                      <td data-rotulo="POSIÇÃO">{i + 1}º</td>
                      <td data-rotulo="TRABALHO" className="celula-titulo">{l.trabalho.titulo}</td>
                      <td data-rotulo="AUTORES" className="celula-truncada">{l.trabalho.autores}</td>
                      <td data-rotulo="REVISÃO">{nota(l.revisao)}</td>
                      <td data-rotulo="AO VIVO">{nota(l.evento)}</td>
                      <td data-rotulo="AVALIAÇÕES">{l.avaliacoes}</td>
                      <td data-rotulo="PONTOS"><strong>{l.pontos.toFixed(2)}</strong></td>
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
