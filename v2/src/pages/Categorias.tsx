import { useEffect, useState } from "react";
import { Tags } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import type { Categoria, Trabalho } from "@/lib/types";

// Página de listagem de categorias do congresso (somente leitura — categorias são fixas)
const Categorias = () => {
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [trabalhos, setTrabalhos] = useState<Trabalho[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [{ data: c, error: e1 }, { data: t, error: e2 }] = await Promise.all([
        supabase.from("categorias").select("*").order("nome"),
        supabase.from("trabalhos").select("*"),
      ]);
      if (e1 || e2) toast.error("Erro ao carregar categorias");
      setCategorias(c ?? []);
      setTrabalhos((t ?? []) as Trabalho[]);
      setLoading(false);
    })();
  }, []);

  const countByCat = (id: string) => trabalhos.filter((t) => t.categoria_id === id).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
          <Tags className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Categorias</h1>
          <p className="text-sm text-muted-foreground">
            Categorias fixas do congresso. Trabalhos são organizados por uma destas categorias.
          </p>
        </div>
      </div>

      <Card className="shadow-[var(--shadow-card)]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead className="w-40 text-right">Trabalhos</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={2} className="text-center text-muted-foreground">
                  Carregando...
                </TableCell>
              </TableRow>
            ) : (
              categorias.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.nome}</TableCell>
                  <TableCell className="text-right">
                    <Badge variant="secondary">{countByCat(c.id)}</Badge>
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

export default Categorias;
