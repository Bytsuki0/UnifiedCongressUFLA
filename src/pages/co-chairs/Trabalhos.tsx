import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Pencil, Trash2, Eye } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import type { Trabalho, Categoria } from "@/lib/types";

const Trabalhos = () => {
  const [trabalhos, setTrabalhos] = useState<Trabalho[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [loading, setLoading] = useState(true);
  const [toDelete, setToDelete] = useState<Trabalho | null>(null);

  const load = async () => {
    setLoading(true);
    const [{ data: t, error: e1 }, { data: c, error: e2 }] = await Promise.all([
      supabase.from("trabalhos").select("*").order("created_at", { ascending: false }),
      supabase.from("categorias").select("*").order("nome"),
    ]);
    if (e1 || e2) toast.error("Erro ao carregar dados");
    setTrabalhos(t ?? []);
    setCategorias(c ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const catNome = (id: string | null) =>
    id ? categorias.find((c) => c.id === id)?.nome ?? "—" : "—";

  const confirmDelete = async () => {
    if (!toDelete) return;
    const { error } = await supabase.from("trabalhos").delete().eq("id", toDelete.id);
    if (error) toast.error("Erro ao excluir");
    else {
      toast.success("Trabalho excluído");
      load();
    }
    setToDelete(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Trabalhos</h1>
          <p className="text-sm text-muted-foreground">Trabalhos submetidos ao congresso.</p>
        </div>
        <Button asChild>
          <Link to="/trabalhos/novo">
            <Plus className="mr-2 h-4 w-4" /> Novo trabalho
          </Link>
        </Button>
      </div>

      <Card className="shadow-[var(--shadow-card)]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Título</TableHead>
              <TableHead>Autores</TableHead>
              <TableHead>Categoria</TableHead>
              <TableHead>Submissão</TableHead>
              <TableHead className="w-40 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  Carregando...
                </TableCell>
              </TableRow>
            ) : trabalhos.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  Nenhum trabalho submetido.
                </TableCell>
              </TableRow>
            ) : (
              trabalhos.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.titulo}</TableCell>
                  <TableCell className="max-w-xs truncate">{t.autores}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{catNome(t.categoria_id)}</Badge>
                  </TableCell>
                  <TableCell>{new Date(t.data_submissao).toLocaleDateString("pt-BR")}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" asChild>
                      <Link to={`/trabalhos/${t.id}`}>
                        <Eye className="h-4 w-4" />
                      </Link>
                    </Button>
                    <Button variant="ghost" size="icon" asChild>
                      <Link to={`/trabalhos/${t.id}/editar`}>
                        <Pencil className="h-4 w-4" />
                      </Link>
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => setToDelete(t)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir trabalho?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. O trabalho{" "}
              <strong>{toDelete?.titulo}</strong> será removido permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Trabalhos;