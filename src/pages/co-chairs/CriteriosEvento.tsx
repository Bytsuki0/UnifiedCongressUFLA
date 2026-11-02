import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ListChecks, Plus, Save, X } from "lucide-react";
import { toast } from "sonner";
import {
  excluirCriterio,
  listarCategorias,
  salvarCriterios,
  type Criterio,
} from "@/services/categoriasService";
import { listarCriteriosEvento } from "@/services/avaliacaoEventoService";
import type { Categoria } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Os critérios da AVALIAÇÃO AO VIVO (/avaliacao), por categoria. As
 * categorias vêm de /co-chairs/categorias e aqui não se cria nem se apaga
 * nenhuma; os critérios do parecer de /revisor também ficam lá, e não têm
 * nada a ver com estes.
 *
 * O editor é o mesmo de Categorias: remover grava na hora, acrescentar e
 * renomear esperam o "Salvar critérios" daquela categoria.
 */
const CriteriosEvento = () => {
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [criterios, setCriterios] = useState<Record<string, Criterio[]>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [cats, crits] = await Promise.all([listarCategorias(), listarCriteriosEvento()]);
      setCategorias(cats);
      setCriterios(crits);
    } catch {
      toast.error("Erro ao carregar os critérios do evento");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const mudar = (catId: string, fn: (lista: Criterio[]) => Criterio[]) =>
    setCriterios((prev) => ({ ...prev, [catId]: fn(prev[catId] ?? []) }));

  const remover = async (catId: string, idx: number) => {
    const cr = criterios[catId]?.[idx];
    if (cr?.id) {
      try {
        await excluirCriterio(cr.id, "criterios_evento");
      } catch {
        toast.error("Erro ao remover critério");
        return;
      }
    }
    mudar(catId, (l) => l.filter((_, i) => i !== idx));
  };

  const salvar = async (catId: string) => {
    const lista = criterios[catId] ?? [];
    if (lista.some((cr) => !cr.titulo.trim())) {
      toast.error("Preencha todos os critérios antes de salvar.");
      return;
    }
    setSavingId(catId);
    try {
      await salvarCriterios(catId, lista, "criterios_evento");
      toast.success("Critérios salvos");
      load();
    } catch {
      toast.error("Erro ao salvar critérios");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
          <ListChecks className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Critérios do Evento</h1>
          <p className="text-sm text-muted-foreground">
            Os critérios usados na avaliação ao vivo (portal Avaliação), por categoria. Os critérios
            do parecer dos revisores continuam em Categorias.
          </p>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : categorias.length === 0 ? (
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="py-12 text-center text-muted-foreground">
            Nenhuma categoria cadastrada. Crie as categorias em{" "}
            <Link className="underline" to="/co-chairs/categorias">Categorias</Link>.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {categorias.map((cat) => {
            const lista = criterios[cat.id] ?? [];
            return (
              <Card key={cat.id} className="shadow-[var(--shadow-card)]">
                <CardHeader className="space-y-0">
                  <h2 className="text-lg font-semibold">{cat.nome}</h2>
                  <p className="text-xs text-muted-foreground">{lista.length} critério(s)</p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                    Critérios da avaliação ao vivo
                  </Label>
                  {lista.map((cr, idx) => (
                    <div key={cr.id ?? `new-${idx}`} className="flex items-center gap-2">
                      <span className="w-5 shrink-0 text-sm font-medium text-muted-foreground">
                        {idx + 1}.
                      </span>
                      <Input
                        value={cr.titulo}
                        placeholder={`Critério ${idx + 1}`}
                        onChange={(e) =>
                          mudar(cat.id, (l) =>
                            l.map((c, i) => (i === idx ? { ...c, titulo: e.target.value } : c)),
                          )
                        }
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="shrink-0"
                        onClick={() => remover(cat.id, idx)}
                        aria-label="Remover critério"
                      >
                        <X className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </div>
                  ))}
                  <div className="flex items-center justify-between pt-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => mudar(cat.id, (l) => [...l, { ordem: l.length + 1, titulo: "" }])}
                    >
                      <Plus className="mr-2 h-4 w-4" /> Adicionar critério
                    </Button>
                    <Button size="sm" onClick={() => salvar(cat.id)} disabled={savingId === cat.id}>
                      <Save className="mr-2 h-4 w-4" />
                      {savingId === cat.id ? "Salvando..." : "Salvar critérios"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default CriteriosEvento;
