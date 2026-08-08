import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { ArrowLeft, UserCheck } from "lucide-react";
import {
  AvaliadorDuplicadoError,
  listarProfessoresElegiveis,
  promoverProfessor,
  type ProfessorElegivel as Professor,
} from "@/services/avaliadoresService";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";

const AvaliadorForm = () => {
  const navigate = useNavigate();
  const [professors, setProfessors] = useState<Professor[]>([]);
  const [loading, setLoading] = useState(true);
  const [promoting, setPromoting] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setProfessors(await listarProfessoresElegiveis());
    } catch {
      toast.error("Erro ao carregar professores");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const promover = async (prof: Professor) => {
    setPromoting(prof.id);
    try {
      await promoverProfessor(prof);
      toast.success(`${prof.nome} agora é avaliador!`);
      navigate("/co-chairs/avaliadores");
    } catch (err) {
      toast.error(
        err instanceof AvaliadorDuplicadoError ? err.message : "Erro ao promover professor",
      );
    } finally {
      setPromoting(null);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Button variant="ghost" size="sm" asChild>
        <Link to="/co-chairs/avaliadores">
          <ArrowLeft className="mr-2 h-4 w-4" /> Voltar
        </Link>
      </Button>

      <Card className="shadow-[var(--shadow-card)]">
        <CardHeader>
          <CardTitle>Promover Professor a Avaliador</CardTitle>
          <p className="text-sm text-muted-foreground">
            Selecione um professor cadastrado no sistema para conceder o papel de avaliador.
          </p>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">Carregando professores...</div>
          ) : professors.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              Todos os professores cadastrados já são avaliadores, ou não há professores registrados no sistema.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Departamento</TableHead>
                  <TableHead className="w-36 text-right">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {professors.map(prof => (
                  <TableRow key={prof.id}>
                    <TableCell className="font-medium">{prof.nome}</TableCell>
                    <TableCell>{prof.email}</TableCell>
                    <TableCell>{prof.departamento || "—"}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        disabled={promoting === prof.id}
                        onClick={() => promover(prof)}
                      >
                        <UserCheck className="mr-2 h-4 w-4" />
                        {promoting === prof.id ? "Promovendo..." : "Promover"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default AvaliadorForm;
