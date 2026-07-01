import { useEffect, useState } from "react";
import { Tags, Plus, Trash2, Save, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

type Criterio = { id?: string; ordem: number; titulo: string };
type CategoriaComCriterios = { id: string; nome: string; criterios: Criterio[] };

const emptyCriterios = (): Criterio[] =>
  Array.from({ length: 5 }, (_, i) => ({ ordem: i + 1, titulo: "" }));

const Categorias = () => {
  const [categorias, setCategorias] = useState<CategoriaComCriterios[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<CategoriaComCriterios | null>(null);

  // Diálogo de nova categoria
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newNome, setNewNome] = useState("");
  const [newCriterios, setNewCriterios] = useState<Criterio[]>(emptyCriterios());
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setLoading(true);
    const [{ data: cats, error: e1 }, { data: crits, error: e2 }, { data: tr, error: e3 }] =
      await Promise.all([
        supabase.from("categorias").select("id, nome").order("nome"),
        supabase.from("criterios").select("id, categoria_id, ordem, titulo"),
        supabase.from("trabalhos").select("id, categoria_id"),
      ]);
    if (e1 || e2 || e3) toast.error("Erro ao carregar categorias");

    const byCat: Record<string, Criterio[]> = {};
    (crits ?? []).forEach((cr) => {
      (byCat[cr.categoria_id] ??= []).push({ id: cr.id, ordem: cr.ordem, titulo: cr.titulo });
    });
    Object.values(byCat).forEach((list) => list.sort((a, b) => a.ordem - b.ordem));

    const cnt: Record<string, number> = {};
    (tr ?? []).forEach((t) => {
      if (t.categoria_id) cnt[t.categoria_id] = (cnt[t.categoria_id] ?? 0) + 1;
    });

    setCategorias((cats ?? []).map((c) => ({ id: c.id, nome: c.nome, criterios: byCat[c.id] ?? [] })));
    setCounts(cnt);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  // ----- edição de critérios de uma categoria existente -----
  const setCriterioTitulo = (catId: string, idx: number, value: string) =>
    setCategorias((prev) =>
      prev.map((c) =>
        c.id === catId
          ? { ...c, criterios: c.criterios.map((cr, i) => (i === idx ? { ...cr, titulo: value } : cr)) }
          : c,
      ),
    );

  const addCriterio = (catId: string) =>
    setCategorias((prev) =>
      prev.map((c) =>
        c.id === catId
          ? { ...c, criterios: [...c.criterios, { ordem: c.criterios.length + 1, titulo: "" }] }
          : c,
      ),
    );

  const removeCriterio = async (catId: string, idx: number) => {
    const cat = categorias.find((c) => c.id === catId);
    const cr = cat?.criterios[idx];
    if (cr?.id) {
      const { error } = await supabase.from("criterios").delete().eq("id", cr.id);
      if (error) {
        toast.error("Erro ao remover critério");
        return;
      }
    }
    setCategorias((prev) =>
      prev.map((c) =>
        c.id === catId ? { ...c, criterios: c.criterios.filter((_, i) => i !== idx) } : c,
      ),
    );
  };

  const saveCriterios = async (cat: CategoriaComCriterios) => {
    if (cat.criterios.some((cr) => !cr.titulo.trim())) {
      toast.error("Preencha todos os critérios antes de salvar.");
      return;
    }
    setSavingId(cat.id);
    const results = await Promise.all(
      cat.criterios.map((cr, i) => {
        const payload = { ordem: i + 1, titulo: cr.titulo.trim() };
        return cr.id
          ? supabase.from("criterios").update(payload).eq("id", cr.id)
          : supabase.from("criterios").insert({ ...payload, categoria_id: cat.id });
      }),
    );
    setSavingId(null);
    if (results.some((r) => r.error)) toast.error("Erro ao salvar critérios");
    else {
      toast.success("Critérios salvos");
      load();
    }
  };

  // ----- nova categoria -----
  const createCategoria = async () => {
    if (!newNome.trim()) {
      toast.error("Informe o nome da categoria.");
      return;
    }
    setCreating(true);
    const { data: cat, error } = await supabase
      .from("categorias")
      .insert({ nome: newNome.trim() })
      .select()
      .single();
    if (error || !cat) {
      setCreating(false);
      toast.error("Erro ao criar categoria (o nome já existe?).");
      return;
    }
    const rows = newCriterios
      .map((c, i) => ({ categoria_id: cat.id, ordem: i + 1, titulo: c.titulo.trim() }))
      .filter((c) => c.titulo);
    if (rows.length) {
      const { error: e2 } = await supabase.from("criterios").insert(rows);
      if (e2) toast.error("Categoria criada, mas houve erro ao salvar os critérios.");
    }
    setCreating(false);
    toast.success("Categoria criada");
    setDialogOpen(false);
    setNewNome("");
    setNewCriterios(emptyCriterios());
    load();
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    const { error } = await supabase.from("categorias").delete().eq("id", toDelete.id);
    if (error) toast.error("Erro ao excluir categoria");
    else {
      toast.success("Categoria excluída");
      load();
    }
    setToDelete(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
            <Tags className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Categorias</h1>
            <p className="text-sm text-muted-foreground">
              Gerencie as categorias e os critérios de análise usados na avaliação dos trabalhos.
            </p>
          </div>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> Nova categoria
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : categorias.length === 0 ? (
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="py-12 text-center text-muted-foreground">
            Nenhuma categoria cadastrada. Crie a primeira com “Nova categoria”.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {categorias.map((cat) => (
            <Card key={cat.id} className="shadow-[var(--shadow-card)]">
              <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
                <div>
                  <h2 className="text-lg font-semibold">{cat.nome}</h2>
                  <p className="text-xs text-muted-foreground">
                    {counts[cat.id] ?? 0} trabalho(s) · {cat.criterios.length} critério(s)
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setToDelete(cat)}
                  aria-label={`Excluir ${cat.nome}`}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </CardHeader>
              <CardContent className="space-y-3">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                  Principais critérios
                </Label>
                {cat.criterios.map((cr, idx) => (
                  <div key={cr.id ?? `new-${idx}`} className="flex items-center gap-2">
                    <span className="w-5 shrink-0 text-sm font-medium text-muted-foreground">
                      {idx + 1}.
                    </span>
                    <Input
                      value={cr.titulo}
                      placeholder={`Critério ${idx + 1}`}
                      onChange={(e) => setCriterioTitulo(cat.id, idx, e.target.value)}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0"
                      onClick={() => removeCriterio(cat.id, idx)}
                      aria-label="Remover critério"
                    >
                      <X className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </div>
                ))}
                <div className="flex items-center justify-between pt-1">
                  <Button variant="outline" size="sm" onClick={() => addCriterio(cat.id)}>
                    <Plus className="mr-2 h-4 w-4" /> Adicionar critério
                  </Button>
                  <Button size="sm" onClick={() => saveCriterios(cat)} disabled={savingId === cat.id}>
                    <Save className="mr-2 h-4 w-4" />
                    {savingId === cat.id ? "Salvando..." : "Salvar critérios"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Diálogo: nova categoria */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Nova categoria</DialogTitle>
            <DialogDescription>
              Defina o nome e os 5 critérios de análise iniciais (editáveis depois).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="nova-nome">Nome da categoria *</Label>
              <Input
                id="nova-nome"
                value={newNome}
                placeholder="Ex.: Inovação"
                onChange={(e) => setNewNome(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Critérios de análise
              </Label>
              {newCriterios.map((cr, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="w-5 shrink-0 text-sm font-medium text-muted-foreground">
                    {idx + 1}.
                  </span>
                  <Input
                    value={cr.titulo}
                    placeholder={`Critério ${idx + 1}`}
                    onChange={(e) =>
                      setNewCriterios((prev) =>
                        prev.map((c, i) => (i === idx ? { ...c, titulo: e.target.value } : c)),
                      )
                    }
                  />
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={createCategoria} disabled={creating}>
              {creating ? "Criando..." : "Criar categoria"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmação de exclusão */}
      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir categoria?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. A categoria <strong>{toDelete?.nome}</strong> e seus
              critérios serão removidos permanentemente. Trabalhos vinculados ficarão sem categoria.
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

export default Categorias;
