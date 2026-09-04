import { useEffect, useState } from "react";
import { Tags, Plus, Trash2, Save, X, FileText, Video } from "lucide-react";
import {
  atualizarAnexoCategoria,
  carregarCategorias,
  criarAnexoCategoria,
  criarCategoria,
  excluirAnexoCategoria,
  excluirCategoria,
  excluirCriterio,
  salvarCriterios,
  type CategoriaComCriterios,
  type Criterio,
} from "@/services/categoriasService";
import type { AnexoDaCategoria, TipoAnexo } from "@/lib/anexos";
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

const emptyCriterios = (): Criterio[] =>
  Array.from({ length: 5 }, (_, i) => ({ ordem: i + 1, titulo: "" }));

/**
 * O rótulo padrão de cada tipo de anexo.
 *
 * ⚠ São DOIS botões de adicionar, um por tipo, e não um botão com um
 * seletor de tipo — mesmo raciocínio de `ArquivosDownloadPanel`: num
 * seletor, escolher errado é o padrão, e uma exigência de PDF criada
 * como vídeo pede ao autor um link do YouTube no lugar do arquivo.
 * `tipo` também não é editável depois (ver `atualizarAnexoCategoria`):
 * trocá-lo numa exigência já cumprida deixaria PDFs pendurados numa
 * exigência de vídeo.
 */
const PADRAO_DO_TIPO: Record<TipoAnexo, { titulo: string; descricao: string }> = {
  pdf: {
    titulo: "Trabalho completo",
    descricao: "O arquivo do trabalho em PDF, até 10 MB.",
  },
  video: {
    titulo: "Vídeo de apresentação",
    descricao: "Link do vídeo no YouTube. Os avaliadores o assistem dentro do sistema.",
  },
};

const Categorias = () => {
  const [categorias, setCategorias] = useState<CategoriaComCriterios[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<CategoriaComCriterios | null>(null);
  const [anexoOcupado, setAnexoOcupado] = useState<string | null>(null);

  // Diálogo de nova categoria
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newNome, setNewNome] = useState("");
  const [newCriterios, setNewCriterios] = useState<Criterio[]>(emptyCriterios());
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { categorias: cats, contagens } = await carregarCategorias();
      setCategorias(cats);
      setCounts(contagens);
    } catch {
      toast.error("Erro ao carregar categorias");
    } finally {
      setLoading(false);
    }
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
      try {
        await excluirCriterio(cr.id);
      } catch {
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
    try {
      await salvarCriterios(cat.id, cat.criterios);
      toast.success("Critérios salvos");
      load();
    } catch {
      toast.error("Erro ao salvar critérios");
    } finally {
      setSavingId(null);
    }
  };

  // ----- anexos exigidos por uma categoria -----
  // Gravam NA HORA, fora do botão "Salvar critérios" (que grava outra
  // tabela). Um botão só para as duas coisas deixaria o co-chair sem
  // saber o que foi gravado quando uma das duas falhasse.
  const addAnexo = async (cat: CategoriaComCriterios, tipo: TipoAnexo) => {
    setAnexoOcupado(cat.id);
    try {
      const criado = await criarAnexoCategoria({
        categoriaId: cat.id,
        tipo,
        ...PADRAO_DO_TIPO[tipo],
        ordem: cat.anexos.reduce((maior, a) => Math.max(maior, a.ordem), 0) + 1,
      });
      setCategorias((prev) =>
        prev.map((c) => (c.id === cat.id ? { ...c, anexos: [...c.anexos, criado] } : c)),
      );
      toast.success("Anexo exigido adicionado.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao adicionar o anexo.");
    } finally {
      setAnexoOcupado(null);
    }
  };

  const setAnexoCampo = (catId: string, anexoId: string, campos: Partial<AnexoDaCategoria>) =>
    setCategorias((prev) =>
      prev.map((c) =>
        c.id === catId
          ? { ...c, anexos: c.anexos.map((a) => (a.id === anexoId ? { ...a, ...campos } : a)) }
          : c,
      ),
    );

  const salvarAnexo = async (catId: string, anexo: AnexoDaCategoria) => {
    if (!anexo.titulo.trim()) {
      toast.error("O anexo precisa de um nome — é ele que vira a aba na tela do revisor.");
      return;
    }
    setAnexoOcupado(anexo.id);
    try {
      await atualizarAnexoCategoria(anexo.id, {
        titulo: anexo.titulo.trim(),
        descricao: anexo.descricao.trim(),
      });
      toast.success("Anexo salvo.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar o anexo.");
    } finally {
      setAnexoOcupado(null);
    }
  };

  const removerAnexo = async (cat: CategoriaComCriterios, anexo: AnexoDaCategoria) => {
    const quantos = counts[cat.id] ?? 0;
    const aviso =
      `Remover "${anexo.titulo}" das exigências de ${cat.nome}?\n\n` +
      "Os trabalhos já submetidos NÃO perdem o que enviaram — o arquivo continua " +
      "visível para os revisores. Ele só é descartado se o autor salvar o trabalho " +
      "de novo." +
      (quantos > 0 ? `\n\n${quantos} trabalho(s) usam esta categoria.` : "");
    if (!confirm(aviso)) return;

    setAnexoOcupado(anexo.id);
    try {
      await excluirAnexoCategoria(anexo.id);
      setCategorias((prev) =>
        prev.map((c) =>
          c.id === cat.id ? { ...c, anexos: c.anexos.filter((a) => a.id !== anexo.id) } : c,
        ),
      );
      toast.success("Exigência removida.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao remover o anexo.");
    } finally {
      setAnexoOcupado(null);
    }
  };

  // ----- nova categoria -----
  const createCategoria = async () => {
    if (!newNome.trim()) {
      toast.error("Informe o nome da categoria.");
      return;
    }
    setCreating(true);
    try {
      const { criteriosComErro, anexosComErro } = await criarCategoria(
        newNome,
        newCriterios,
        // Toda categoria nasce pedindo um PDF e um vídeo — o que o
        // formulário exigia de todo mundo até 20260904. O co-chair ajusta
        // no cartão da categoria (Extensão vira dois PDFs, e assim por
        // diante).
        [
          { tipo: "pdf", ...PADRAO_DO_TIPO.pdf },
          { tipo: "video", ...PADRAO_DO_TIPO.video },
        ],
      );
      if (criteriosComErro) {
        toast.error("Categoria criada, mas houve erro ao salvar os critérios.");
      }
      if (anexosComErro) {
        toast.error("Categoria criada, mas houve erro ao salvar os anexos exigidos.");
      }
      toast.success("Categoria criada");
      setDialogOpen(false);
      setNewNome("");
      setNewCriterios(emptyCriterios());
      load();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao criar categoria (o nome já existe?).",
      );
    } finally {
      setCreating(false);
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    try {
      await excluirCategoria(toDelete.id);
      toast.success("Categoria excluída");
      load();
    } catch {
      toast.error("Erro ao excluir categoria");
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
                    {counts[cat.id] ?? 0} trabalho(s) · {cat.criterios.length} critério(s) ·{" "}
                    {cat.anexos.filter((a) => a.tipo === "pdf").length} PDF(s) ·{" "}
                    {cat.anexos.filter((a) => a.tipo === "video").length} vídeo(s)
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

                {/* ---- O que esta categoria exige da submissão ---- */}
                <div className="space-y-3 border-t border-border pt-4">
                  <div>
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                      Anexos exigidos na submissão
                    </Label>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Cada linha vira um campo no formulário do autor e uma aba na tela do
                      revisor. Sem nenhuma linha, a categoria não pede arquivo nem vídeo.
                    </p>
                  </div>

                  {cat.anexos.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Nenhum anexo exigido — quem submeter nesta categoria envia só os dados do
                      trabalho.
                    </p>
                  ) : (
                    cat.anexos.map((anexo) => (
                      <div key={anexo.id} className="space-y-2 rounded-md border border-border p-3">
                        <div className="flex items-center gap-2">
                          <span
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-secondary text-secondary-foreground"
                            title={anexo.tipo === "pdf" ? "Arquivo PDF" : "Link de vídeo"}
                          >
                            {anexo.tipo === "pdf" ? (
                              <FileText className="h-4 w-4" />
                            ) : (
                              <Video className="h-4 w-4" />
                            )}
                          </span>
                          <Input
                            value={anexo.titulo}
                            placeholder={anexo.tipo === "pdf" ? "Nome do arquivo" : "Nome do vídeo"}
                            onChange={(e) =>
                              setAnexoCampo(cat.id, anexo.id, { titulo: e.target.value })
                            }
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="shrink-0"
                            disabled={anexoOcupado === anexo.id}
                            onClick={() => removerAnexo(cat, anexo)}
                            aria-label={`Remover ${anexo.titulo}`}
                          >
                            <X className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        </div>
                        <Input
                          value={anexo.descricao}
                          placeholder="Explique o que enviar aqui (opcional)"
                          onChange={(e) =>
                            setAnexoCampo(cat.id, anexo.id, { descricao: e.target.value })
                          }
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={anexoOcupado === anexo.id}
                          onClick={() => salvarAnexo(cat.id, anexo)}
                        >
                          <Save className="mr-2 h-4 w-4" />
                          {anexoOcupado === anexo.id ? "Salvando..." : "Salvar anexo"}
                        </Button>
                      </div>
                    ))
                  )}

                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={anexoOcupado === cat.id}
                      onClick={() => addAnexo(cat, "pdf")}
                    >
                      <Plus className="mr-2 h-4 w-4" /> Exigir um PDF
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={anexoOcupado === cat.id}
                      onClick={() => addAnexo(cat, "video")}
                    >
                      <Plus className="mr-2 h-4 w-4" /> Exigir um vídeo
                    </Button>
                  </div>
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
              Defina o nome e os 5 critérios de análise iniciais (editáveis depois). A categoria
              nasce pedindo um PDF e um vídeo na submissão — ajuste isso no cartão dela.
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
