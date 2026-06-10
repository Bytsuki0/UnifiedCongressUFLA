import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import type { Avaliador } from "@/lib/types";

const Avaliadores = () => {
  const [avaliadores, setAvaliadores] = useState<Avaliador[]>([]);
  const [loading, setLoading] = useState(true);
  const [toDelete, setToDelete] = useState<Avaliador | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("avaliadores")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) toast.error("Erro ao carregar avaliadores");
    else setAvaliadores(data ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const confirmDelete = async () => {
    if (!toDelete) return;
    const { error } = await supabase.from("avaliadores").delete().eq("id", toDelete.id);
    if (error) toast.error("Erro ao excluir");
    else {
      toast.success("Avaliador excluído");
      load();
    }
    setToDelete(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Avaliadores</h1>
          <p className="text-sm text-muted-foreground">Gerencie os avaliadores cadastrados.</p>
        </div>
        <Button asChild>
          <Link to="/avaliadores/novo">
            <Plus className="mr-2 h-4 w-4" /> Novo avaliador
          </Link>
        </Button>
      </div>

      <Card className="shadow-[var(--shadow-card)]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Instituição</TableHead>
              <TableHead className="w-32 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  Carregando...
                </TableCell>
              </TableRow>
            ) : avaliadores.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  Nenhum avaliador cadastrado.
                </TableCell>
              </TableRow>
            ) : (
              avaliadores.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.nome}</TableCell>
                  <TableCell>{a.email}</TableCell>
                  <TableCell>{a.instituicao}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" asChild>
                      <Link to={`/avaliadores/${a.id}/editar`}>
                        <Pencil className="h-4 w-4" />
                      </Link>
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => setToDelete(a)}>
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
            <AlertDialogTitle>Excluir avaliador?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. O avaliador{" "}
              <strong>{toDelete?.nome}</strong> será removido permanentemente.
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

export default Avaliadores;
