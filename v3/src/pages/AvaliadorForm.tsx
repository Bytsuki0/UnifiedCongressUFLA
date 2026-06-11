import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { ArrowLeft, UserCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";

type Professor = {
  id: string;
  nome: string;
  email: string;
  departamento: string;
};

const AvaliadorForm = () => {
  const navigate = useNavigate();
  const [professors, setProfessors] = useState<Professor[]>([]);
  const [loading, setLoading] = useState(true);
  const [promoting, setPromoting] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);

    const [profRes, avalRes] = await Promise.all([
      (supabase.from("professores" as never) as any).select("id, nome, email, departamento").order("nome"),
      supabase.from("avaliadores").select("email"),
    ]);

    if (profRes.error) {
      toast.error("Erro ao carregar professores");
      setLoading(false);
      return;
    }

    const avalEmails = new Set<string>((avalRes.data ?? []).map((a: any) => a.email));
    const eligible = (profRes.data ?? []).filter((p: Professor) => !avalEmails.has(p.email));
    setProfessors(eligible);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const promover = async (prof: Professor) => {
    setPromoting(prof.id);
    const { error } = await supabase.from("avaliadores").insert({
      nome: prof.nome,
      email: prof.email,
      instituicao: prof.departamento || "UFLA",
    });

    if (error) {
      if (error.code === "23505") toast.error("Este professor já é avaliador");
      else toast.error("Erro ao promover professor");
    } else {
      toast.success(`${prof.nome} agora é avaliador!`);
      navigate("/avaliadores");
    }
    setPromoting(null);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Button variant="ghost" size="sm" asChild>
        <Link to="/avaliadores">
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
