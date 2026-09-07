import { useEffect, useState } from "react";
import { BookOpen, ExternalLink, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  atualizarPublicacaoAnais,
  criarPublicacaoAnais,
  listarAnais,
  removerPublicacaoAnais,
  type PublicacaoAnaisAdmin,
} from "@/services/anaisService";
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
 * Gestão dos Anais as publicações que a landing e /anais exibem.
 *
 * Mesmo desenho da tela do cronograma, e pelo mesmo motivo: é uma lista
 * curta que a organização edita de vez em quando. O editor é um
 * <Dialog>, a exclusão pede confirmação e diz o que vai sumir da vista
 * do visitante aqui também não existe "despublicar": o que está
 * cadastrado está no ar, e tirar do ar é EXCLUIR.
 *
 * A referência ("onde e quando saiu") é um campo de texto livre, não um
 * par veículo + data: a forma de citar varia demais entre revista, anais
 * em PDF e repositório institucional, e dois campos fixos obrigariam
 * quem publica a torcer a referência para caber.
 */

/** Formulário do diálogo. `id` nulo = publicação nova. */
type Editor = {
  id: string | null;
  titulo: string;
  descricao: string;
  url: string;
};

const editorNovo = (): Editor => ({ id: null, titulo: "", descricao: "", url: "" });

const editorDe = (item: PublicacaoAnaisAdmin): Editor => ({
  id: item.id,
  titulo: item.titulo,
  descricao: item.descricao,
  url: item.url,
});

const Anais = () => {
  const [anais, setAnais] = useState<PublicacaoAnaisAdmin[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [aExcluir, setAExcluir] = useState<PublicacaoAnaisAdmin | null>(null);

  const carregar = async () => {
    setCarregando(true);
    try {
      setAnais(await listarAnais());
    } catch {
      toast.error("Erro ao carregar os anais.");
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
      toast.error("Informe o título da publicação.");
      return;
    }
    if (!editor.url.trim()) {
      toast.error("Informe o link da publicação.");
      return;
    }

    const campos = {
      titulo: editor.titulo.trim(),
      descricao: editor.descricao.trim(),
      url: editor.url.trim(),
    };

    setSalvando(true);
    try {
      if (editor.id) {
        await atualizarPublicacaoAnais(editor.id, campos);
        toast.success("Publicação atualizada.");
      } else {
        // No fim da lista: o máximo atual + 1. Sem isto toda linha nova
        // nasceria com ordem 0 e a ordem entre elas ficaria por conta do
        // desempate de `criado_em`.
        await criarPublicacaoAnais({
          ...campos,
          ordem: anais.reduce((maior, a) => Math.max(maior, a.ordem), 0) + 1,
        });
        toast.success("Publicação adicionada aos anais.");
      }
      setEditor(null);
      carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar a publicação.");
    } finally {
      setSalvando(false);
    }
  };

  const confirmarExclusao = async () => {
    if (!aExcluir) return;
    try {
      await removerPublicacaoAnais(aExcluir.id);
      toast.success("Publicação excluída.");
      carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao excluir a publicação.");
    }
    setAExcluir(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
            <BookOpen className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Anais do Congresso</h1>
            <p className="text-sm text-muted-foreground">
              Os trabalhos que já foram publicados. A lista aparece na página inicial e em{" "}
              <strong>/anais</strong>, na ordem em que estiver aqui.
            </p>
          </div>
        </div>
        <Button onClick={() => setEditor(editorNovo())}>
          <Plus className="mr-2 h-4 w-4" /> Nova publicação
        </Button>
      </div>

      {carregando ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : anais.length === 0 ? (
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="py-12 text-center text-muted-foreground">
            Nenhuma publicação cadastrada a seção não aparece na página inicial. Cadastre a
            primeira com “Nova publicação”.
          </CardContent>
        </Card>
      ) : (
        <Card className="shadow-[var(--shadow-card)]">
          <CardHeader className="space-y-0 pb-3">
            <h2 className="text-lg font-semibold">Publicações no ar</h2>
            <p className="text-xs text-muted-foreground">
              Tudo que está aqui está no ar. Para tirar uma publicação da vista do visitante,
              exclua a linha.
            </p>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {anais.map((item) => (
                <li key={item.id} className="flex flex-wrap items-start gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <span className="font-medium">{item.titulo}</span>
                    {item.descricao && (
                      <p className="text-sm text-muted-foreground">{item.descricao}</p>
                    )}
                    {/* O link vai como link, e não como texto: o erro mais
                        comum aqui é um endereço colado errado, e clicar é
                        a única conferência que vale. */}
                    <a
                      className="mt-1 inline-flex items-center gap-1 break-all text-xs text-primary underline"
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {item.url}
                      <ExternalLink className="h-3 w-3 shrink-0" />
                    </a>
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

      {/* Diálogo: nova publicação / edição */}
      <Dialog open={!!editor} onOpenChange={(aberto) => !aberto && setEditor(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editor?.id ? "Editar publicação" : "Nova publicação"}</DialogTitle>
            <DialogDescription>
              O título e o link são obrigatórios. A referência é livre escreva onde e quando a
              publicação saiu.
            </DialogDescription>
          </DialogHeader>

          {editor && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="anais-titulo">Título *</Label>
                <Input
                  id="anais-titulo"
                  value={editor.titulo}
                  placeholder="Ex.: Anais do XII Congresso Unificado ICTIN"
                  onChange={(e) => setEditor({ ...editor, titulo: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="anais-desc">Onde e quando foi publicado</Label>
                <Textarea
                  id="anais-desc"
                  rows={4}
                  value={editor.descricao}
                  placeholder="Ex.: Revista de Ciência e Tecnologia da UFLA, v. 12, n. 3, dezembro de 2025."
                  onChange={(e) => setEditor({ ...editor, descricao: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Aparece abaixo do título, na lista pública. Deixe em branco para esconder a linha.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="anais-url">Link *</Label>
                <Input
                  id="anais-url"
                  value={editor.url}
                  placeholder="https://..."
                  onChange={(e) => setEditor({ ...editor, url: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Endereço dos anais publicados revista, repositório ou Drive. Abre em nova aba.
                </p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditor(null)}>
              Cancelar
            </Button>
            <Button onClick={salvar} disabled={salvando}>
              {salvando ? "Salvando..." : editor?.id ? "Salvar publicação" : "Adicionar publicação"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmação de exclusão */}
      <AlertDialog open={!!aExcluir} onOpenChange={(o) => !o && setAExcluir(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir publicação dos anais?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{aExcluir?.titulo}</strong> sai da página inicial e de /anais. O arquivo no
              destino não é tocado. Esta ação não pode ser desfeita.
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

export default Anais;
