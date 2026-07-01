import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import type { Trabalho, Categoria } from "@/lib/types";

const TrabalhoDetalhe = () => {
  const { id } = useParams();
  const [trabalho, setTrabalho] = useState<Trabalho | null>(null);
  const [categoria, setCategoria] = useState<Categoria | null>(null);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const { data, error } = await supabase.from("trabalhos").select("*").eq("id", id).maybeSingle();
      if (error || !data) {
        toast.error("Trabalho não encontrado");
        return;
      }
      setTrabalho(data);
      if (data.categoria_id) {
        const { data: c } = await supabase.from("categorias").select("*").eq("id", data.categoria_id).maybeSingle();
        setCategoria(c);
      }
    })();
  }, [id]);

  if (!trabalho) {
    return <p className="text-muted-foreground">Carregando...</p>;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/trabalhos">
            <ArrowLeft className="mr-2 h-4 w-4" /> Voltar
          </Link>
        </Button>
        <Button asChild>
          <Link to={`/trabalhos/${trabalho.id}/editar`}>
            <Pencil className="mr-2 h-4 w-4" /> Editar
          </Link>
        </Button>
      </div>

      <Card className="shadow-[var(--shadow-card)]">
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            {categoria && <Badge variant="secondary">{categoria.nome}</Badge>}
            <span className="text-xs text-muted-foreground">
              Submetido em {new Date(trabalho.data_submissao).toLocaleDateString("pt-BR")}
            </span>
          </div>
          <CardTitle className="text-2xl">{trabalho.titulo}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <h3 className="mb-1 text-sm font-semibold text-muted-foreground">Autores</h3>
            <p>{trabalho.autores}</p>
          </div>
          <div>
            <h3 className="mb-1 text-sm font-semibold text-muted-foreground">Resumo</h3>
            <p className="whitespace-pre-wrap leading-relaxed">{trabalho.resumo}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default TrabalhoDetalhe;