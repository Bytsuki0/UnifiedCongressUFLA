import { Link } from "react-router-dom";
import { Users, FileText, ArrowRight, ClipboardList, Award } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const Index = () => {
  return (
    <div className="space-y-10">
      <section className="rounded-2xl bg-[image:var(--gradient-hero)] p-10 text-primary-foreground shadow-[var(--shadow-card)]">
        <h1 className="text-3xl font-bold sm:text-4xl">Aba de gerenciamento de co-chairs</h1>
        <p className="mt-3 max-w-2xl text-primary-foreground/90">
          Gerencie co-chairs e trabalhos submetidos ao congresso acadêmico de forma simples e organizada.
        </p>
      </section>

      <section className="grid gap-6 md:grid-cols-4">
        <Card className="shadow-[var(--shadow-card)]">
          <CardHeader>
            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
              <Users className="h-5 w-5" />
            </div>
            <CardTitle>Co-Chairs</CardTitle>
            <CardDescription>Cadastre e gerencie os co-chairs do congresso.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link to="/avaliadores">
                Acessar <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="shadow-[var(--shadow-card)]">
          <CardHeader>
            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
              <ClipboardList className="h-5 w-5" />
            </div>
            <CardTitle>Atribuições</CardTitle>
            <CardDescription>Distribua trabalhos aos revisores manual ou automaticamente.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link to="/atribuicoes">
                Acessar <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="shadow-[var(--shadow-card)]">
          <CardHeader>
            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
              <Award className="h-5 w-5" />
            </div>
            <CardTitle>Rankings</CardTitle>
            <CardDescription>Visualize trabalhos por categoria ordenados pela nota geral.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link to="/rankings">
                Acessar <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </section>
    </div>
  );
};

export default Index;
