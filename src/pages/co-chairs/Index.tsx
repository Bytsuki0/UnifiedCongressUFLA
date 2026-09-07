import { Link } from "react-router-dom";
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  ClipboardList,
  FileText,
  Gavel,
  Tags,
  Users,
  Video,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * Painel de Controle dos co-chairs — a porta de entrada do portal.
 *
 * Os cartões são uma LISTA, e não oito blocos de JSX repetidos: eram
 * quatro escritos à mão e o painel já estava mentindo — Trabalhos e
 * Cronograma existiam no menu lateral e não aqui, e quem entrava pelo
 * painel não sabia que as telas existiam. Com a lista, acrescentar uma
 * seção é uma linha, e é mais difícil esquecer.
 *
 * ⚠ Esta lista tem de acompanhar o menu lateral de
 * `components/co-chairs/Layout.tsx`: são as duas rotas de acesso às
 * mesmas telas, e a divergência entre elas é justamente o defeito que
 * este arquivo passou a existir para não repetir.
 */

type Secao = {
  para: string;
  titulo: string;
  descricao: string;
  Icone: LucideIcon;
};

const SECOES: Secao[] = [
  {
    para: "/co-chairs/trabalhos",
    titulo: "Trabalhos",
    descricao: "Consulte, cadastre e acompanhe os trabalhos submetidos ao congresso.",
    Icone: FileText,
  },
  {
    para: "/co-chairs/avaliadores",
    titulo: "Co-Chairs",
    descricao: "Cadastre e gerencie os co-chairs do congresso.",
    Icone: Users,
  },
  {
    para: "/co-chairs/categorias",
    titulo: "Categorias",
    descricao:
      "Categorias, critérios de análise e quais anexos cada uma exige na submissão.",
    Icone: Tags,
  },
  {
    para: "/co-chairs/atribuicoes",
    titulo: "Atribuições",
    descricao: "Distribua trabalhos aos revisores com a recomendação do sistema.",
    Icone: ClipboardList,
  },
  {
    para: "/co-chairs/parecer-editorial",
    titulo: "Parecer Editorial",
    descricao: "Leia os pareceres e registre a decisão final de cada trabalho.",
    Icone: Gavel,
  },
  {
    para: "/co-chairs/cronograma",
    titulo: "Cronograma",
    descricao: "As datas do congresso, publicadas na página inicial e em /cronograma.",
    Icone: CalendarDays,
  },
  {
    para: "/co-chairs/anais",
    titulo: "Anais do Congresso",
    descricao: "Publique onde os trabalhos do congresso saíram e o link de cada volume.",
    Icone: BookOpen,
  },
  {
    para: "/co-chairs/pitches",
    titulo: "Pitches",
    descricao:
      "A vitrine de vídeos. Os trabalhos aprovados entram sozinhos; aqui vai o acervo antigo.",
    Icone: Video,
  },
];

const Index = () => {
  return (
    <div className="space-y-10">
      <section className="rounded-2xl bg-[image:var(--gradient-hero)] p-10 text-primary-foreground shadow-[var(--shadow-card)]">
        <h1 className="text-3xl font-bold sm:text-4xl">Aba de gerenciamento de co-chairs</h1>
        <p className="mt-3 max-w-2xl text-primary-foreground/90">
          Gerencie co-chairs e trabalhos submetidos ao congresso acadêmico de forma simples e
          organizada.
        </p>
      </section>

      <section className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {SECOES.map(({ para, titulo, descricao, Icone }) => (
          <Card key={para} className="flex flex-col shadow-[var(--shadow-card)]">
            <CardHeader>
              <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
                <Icone className="h-5 w-5" />
              </div>
              <CardTitle>{titulo}</CardTitle>
              <CardDescription>{descricao}</CardDescription>
            </CardHeader>
            {/* `mt-auto` prende o botão no rodapé do cartão: as descrições
                têm alturas diferentes e, sem isso, os botões da mesma
                linha ficam em alturas diferentes. */}
            <CardContent className="mt-auto">
              <Button asChild>
                <Link to={para}>
                  Acessar <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </section>
    </div>
  );
};

export default Index;
