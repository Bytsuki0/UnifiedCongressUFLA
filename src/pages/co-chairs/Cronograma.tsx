import { useEffect, useState } from "react";
import { CalendarDays, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  atualizarItemCronograma,
  carregarCronogramaGestao,
  criarItemCronograma,
  removerItemCronograma,
  type ItemCronograma,
} from "@/services/cronogramaService";
import {
  corDoTexto,
  CORES_SUGERIDAS,
  diasNoPeriodo,
  estadoDoPeriodo,
  hojeLocal,
  rotuloPeriodo,
} from "@/lib/cronograma";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

/**
 * Gestão do cronograma — a lista de datas que a landing, /cronograma e
 * /estudante/cronograma exibem.
 *
 * Era um calendário: a organização publicava meses e pintava dia por dia.
 * Agora é uma lista, e cada item carrega o período inteiro. Some com isso
 * a distinção entre "cadastrado" e "publicado" que os meses davam — aqui
 * o que existe está no ar, e tirar do ar é EXCLUIR. Por isso a exclusão
 * pede confirmação e diz o que vai sumir da vista do visitante.
 *
 * O editor é um <Dialog>, e não mais um painel inline: o painel existia
 * para não cobrir o calendário de onde saíam os dias clicados. Sem
 * calendário, o formulário não tem nada atrás de si para preservar.
 */

/** Formulário do diálogo. `id` nulo = item novo. */
type Editor = {
  id: string | null;
  titulo: string;
  descricao: string;
  cor: string;
  data_inicio: string;
  data_fim: string;
};

const editorNovo = (): Editor => ({
  id: null,
  titulo: "",
  descricao: "",
  cor: CORES_SUGERIDAS[0].hex,
  // Hoje como ponto de partida: um campo de data em branco obriga a
  // digitar a data inteira mesmo quando o item começa hoje.
  data_inicio: hojeLocal(),
  data_fim: "",
});

const editorDe = (item: ItemCronograma): Editor => ({
  id: item.id,
  titulo: item.titulo,
  descricao: item.descricao,
  cor: item.cor,
  data_inicio: item.data_inicio,
  // Item de um dia só volta com o campo de término VAZIO, do mesmo jeito
  // que foi cadastrado — repetir a data de início ali sugeriria que ela
  // foi digitada duas vezes.
  data_fim: item.data_fim === item.data_inicio ? "" : item.data_fim,
});

const Cronograma = () => {
  const [itens, setItens] = useState<ItemCronograma[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [aExcluir, setAExcluir] = useState<ItemCronograma | null>(null);

  const hoje = hojeLocal();

  const carregar = async () => {
    setCarregando(true);
    try {
      setItens(await carregarCronogramaGestao());
    } catch {
      toast.error("Erro ao carregar o cronograma.");
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    carregar();
  }, []);

  const salvar = async () => {
    if (!editor) return;

    if (!editor.titulo.trim()) {
      toast.error("Informe o nome do item.");
      return;
    }
    if (!editor.data_inicio) {
      toast.error("Informe a data de início.");
      return;
    }
    // Término em branco = item de um dia só. O banco guarda as duas datas
    // sempre preenchidas (o CHECK exige fim >= início); quem traduz "um
    // dia" para "começa e termina no mesmo dia" é esta linha.
    const fim = editor.data_fim || editor.data_inicio;
    if (fim < editor.data_inicio) {
      toast.error("A data de término não pode ser anterior à de início.");
      return;
    }

    const campos = {
      titulo: editor.titulo.trim(),
      descricao: editor.descricao.trim(),
      cor: editor.cor,
      data_inicio: editor.data_inicio,
      data_fim: fim,
    };

    setSalvando(true);
    try {
      if (editor.id) {
        await atualizarItemCronograma(editor.id, campos);
        toast.success("Item atualizado.");
      } else {
        await criarItemCronograma(campos);
        toast.success("Item adicionado ao cronograma.");
      }
      setEditor(null);
      carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar o item.");
    } finally {
      setSalvando(false);
    }
  };

  const confirmarExclusao = async () => {
    if (!aExcluir) return;
    try {
      await removerItemCronograma(aExcluir.id);
      toast.success("Item excluído.");
      carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao excluir o item.");
    }
    setAExcluir(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
            <CalendarDays className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Cronograma</h1>
            <p className="text-sm text-muted-foreground">
              Cada item tem um nome, uma cor e um período. A lista aparece na página inicial, em{" "}
              <strong>/cronograma</strong> e no portal do autor, sempre em ordem cronológica.
            </p>
          </div>
        </div>
        <Button onClick={() => setEditor(editorNovo())}>
          <Plus className="mr-2 h-4 w-4" /> Novo item
        </Button>
      </div>

      {carregando ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : itens.length === 0 ? (
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="py-12 text-center text-muted-foreground">
            Nenhuma data no cronograma — a seção não aparece na página inicial. Crie a primeira com
            “Novo item”.
          </CardContent>
        </Card>
      ) : (
        <Card className="shadow-[var(--shadow-card)]">
          <CardHeader className="space-y-0 pb-3">
            <h2 className="text-lg font-semibold">Datas publicadas</h2>
            <p className="text-xs text-muted-foreground">
              Tudo que está aqui está no ar. Para tirar uma data da vista do visitante, exclua o
              item.
            </p>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {itens.map((item) => (
                <li key={item.id} className="flex flex-wrap items-start gap-3 py-3">
                  <span
                    className="mt-1 h-4 w-4 shrink-0 rounded-full"
                    style={{ background: item.cor }}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{item.titulo}</span>
                      {estadoDoPeriodo(item.data_inicio, item.data_fim, hoje) === "andamento" && (
                        <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold text-secondary-foreground">
                          Em andamento
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {rotuloPeriodo(item.data_inicio, item.data_fim)}
                      {item.data_fim !== item.data_inicio &&
                        ` · ${diasNoPeriodo(item.data_inicio, item.data_fim)} dias`}
                    </p>
                    {item.descricao && <p className="text-sm">{item.descricao}</p>}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button variant="outline" size="sm" onClick={() => setEditor(editorDe(item))}>
                      <Pencil className="mr-2 h-4 w-4" /> Editar
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setAExcluir(item)}
                      aria-label={`Excluir ${item.titulo}`}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Diálogo: novo item / edição */}
      <Dialog open={!!editor} onOpenChange={(aberto) => !aberto && setEditor(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editor?.id ? "Editar item" : "Novo item"}</DialogTitle>
            <DialogDescription>
              Deixe o término em branco para uma data única.
            </DialogDescription>
          </DialogHeader>

          {editor && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="cron-titulo">Nome *</Label>
                <Input
                  id="cron-titulo"
                  value={editor.titulo}
                  placeholder="Ex.: Prazo final de submissão"
                  onChange={(e) => setEditor({ ...editor, titulo: e.target.value })}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="cron-inicio">Início *</Label>
                  <Input
                    id="cron-inicio"
                    type="date"
                    value={editor.data_inicio}
                    onChange={(e) => setEditor({ ...editor, data_inicio: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cron-fim">Término</Label>
                  {/* `min` impede o intervalo invertido no próprio seletor.
                      É cortesia: quem manda é o CHECK da coluna. */}
                  <Input
                    id="cron-fim"
                    type="date"
                    min={editor.data_inicio || undefined}
                    value={editor.data_fim}
                    onChange={(e) => setEditor({ ...editor, data_fim: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="cron-cor">Cor</Label>
                <div className="flex flex-wrap items-center gap-2">
                  {CORES_SUGERIDAS.map((c) => (
                    <button
                      key={c.hex}
                      type="button"
                      title={c.nome}
                      aria-label={c.nome}
                      aria-pressed={editor.cor.toLowerCase() === c.hex.toLowerCase()}
                      onClick={() => setEditor({ ...editor, cor: c.hex })}
                      className={`h-7 w-7 rounded-full border-2 ${
                        editor.cor.toLowerCase() === c.hex.toLowerCase()
                          ? "border-foreground"
                          : "border-transparent"
                      }`}
                      style={{ background: c.hex }}
                    />
                  ))}
                  {/* Cor livre. O CHECK da coluna só aceita hex de 6
                      dígitos — que é exatamente o que <input type="color">
                      devolve. */}
                  <Input
                    id="cron-cor"
                    type="color"
                    value={editor.cor}
                    onChange={(e) => setEditor({ ...editor, cor: e.target.value })}
                    className="h-8 w-12 cursor-pointer p-1"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="cron-desc">Descrição</Label>
                <Textarea
                  id="cron-desc"
                  rows={3}
                  value={editor.descricao}
                  placeholder="O que acontece nesse período. Aparece abaixo do nome, na lista."
                  onChange={(e) => setEditor({ ...editor, descricao: e.target.value })}
                />
              </div>

              {/* Prévia: a etiqueta é exatamente a que o visitante vê, com
                  a mesma cor de texto calculada. É onde se percebe que uma
                  cor clara demais deixa a data ilegível. */}
              <div className="space-y-1">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                  Como vai aparecer
                </Label>
                <div>
                  <span
                    className="inline-block rounded-full px-3 py-1 text-sm font-semibold"
                    style={{ background: editor.cor, color: corDoTexto(editor.cor) }}
                  >
                    {editor.data_inicio
                      ? rotuloPeriodo(editor.data_inicio, editor.data_fim || editor.data_inicio)
                      : "Escolha a data de início"}
                  </span>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditor(null)}>
              Cancelar
            </Button>
            <Button onClick={salvar} disabled={salvando}>
              {salvando ? "Salvando..." : editor?.id ? "Salvar item" : "Adicionar item"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmação de exclusão */}
      <AlertDialog open={!!aExcluir} onOpenChange={(o) => !o && setAExcluir(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir item do cronograma?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{aExcluir?.titulo}</strong>
              {aExcluir && ` (${rotuloPeriodo(aExcluir.data_inicio, aExcluir.data_fim)})`} sai do
              cronograma público. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmarExclusao}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Cronograma;
