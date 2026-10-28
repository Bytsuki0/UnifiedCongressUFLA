import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Presentation } from "lucide-react";
import { listarPosteres, type PosterEntregue } from "@/services/anexosService";
import { mapaCategorias } from "@/services/categoriasService";
import { openPdf } from "@/lib/pdfStorage";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Os pôsteres entregues (migration 20261027180000), para a organização
 * conferir e imprimir.
 *
 * Só leitura, e de propósito: quem manda e troca o pôster é o autor, pela
 * lista de trabalhos dele, e uma segunda porta de escrita aqui seria uma
 * segunda regra a manter. A lista sai de `trabalho_anexos` (`poster =
 * true`) — inclusive o pôster cuja exigência já foi apagada, que a entrega
 * guarda como cópia.
 */
const Posteres = () => {
  const [posteres, setPosteres] = useState<PosterEntregue[] | null>(null);
  const [categorias, setCategorias] = useState<Record<string, string>>({});
  const [erro, setErro] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [lista, nomes] = await Promise.all([listarPosteres(), mapaCategorias()]);
        setPosteres(lista);
        setCategorias(nomes);
      } catch {
        // Nunca "nenhum pôster": com a falha à vista, ninguém conclui que
        // os autores não mandaram.
        setErro(true);
      }
    })();
  }, []);

  const abrir = async (valor: string) => {
    if (!(await openPdf(valor))) toast.error("Não foi possível abrir o PDF.");
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Presentation className="h-6 w-6" /> Pôsteres
        </h1>
        <p className="text-muted-foreground">
          Os pôsteres enviados pelos autores dos trabalhos aprovados. O envio abre no momento da
          divulgação dos resultados (definido em Configurações, no Portal Admin) e só existe nas
          categorias com um anexo marcado como pôster. Quando o autor troca o arquivo, a data
          muda.
        </p>
      </div>

      {erro ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          Não foi possível carregar os pôsteres. Recarregue a página.
        </div>
      ) : posteres === null ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : posteres.length === 0 ? (
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="py-12 text-center text-muted-foreground">
            Nenhum pôster enviado ainda.
          </CardContent>
        </Card>
      ) : (
        <div className="table-container">
          <table className="table" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th>TRABALHO</th>
                <th>AUTORES</th>
                <th>CATEGORIA</th>
                <th>PÔSTER</th>
                <th>ENVIADO EM</th>
                <th>AÇÕES</th>
              </tr>
            </thead>
            <tbody>
              {posteres.map((p) => (
                <tr key={p.id}>
                  <td data-rotulo="TRABALHO" className="celula-titulo">
                    {p.trabalho?.titulo ?? "—"}
                  </td>
                  <td data-rotulo="AUTORES" className="celula-truncada">
                    {p.trabalho?.autores ?? "—"}
                  </td>
                  <td data-rotulo="CATEGORIA">
                    {(p.trabalho?.categoria_id && categorias[p.trabalho.categoria_id]) || "—"}
                  </td>
                  <td data-rotulo="PÔSTER">{p.titulo}</td>
                  <td data-rotulo="ENVIADO EM">{new Date(p.criado_em).toLocaleString("pt-BR")}</td>
                  <td data-rotulo="AÇÕES" className="celula-acoes">
                    <Button size="sm" variant="outline" onClick={() => abrir(p.valor)}>
                      Abrir
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default Posteres;
