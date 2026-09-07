import { useEffect, useState } from "react";
import { ExternalLink, Pencil, Plus, Trash2, Video } from "lucide-react";
import { toast } from "sonner";
import {
  atualizarPitchHistorico,
  carregarPitchesPublicos,
  criarPitchHistorico,
  listarPitchesHistoricos,
  removerPitchHistorico,
  type Pitch,
  type PitchHistorico,
} from "@/services/pitchesService";
import { idDoVideo } from "@/lib/youtube";
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
 * Gestão dos Pitches a vitrine de vídeos de /pitches.
 *
 * A tela tem DOIS blocos, e a diferença entre eles é o assunto da
 * feature inteira:
 *
 *   · O ACERVO, editável. Vídeos de edições anteriores, que a
 *     organização cadastra à mão porque daquela época o sistema não tem
 *     submissão nenhuma.
 *   · Os DESTA EDIÇÃO, só leitura. Vêm sozinhos dos trabalhos aprovados
 *     que entregaram vídeo, e não têm linha em tabela nenhuma são
 *     derivados de `trabalho_anexos`. Aparecem aqui para que quem
 *     administra veja o que está no ar sem precisar abrir a página
 *     pública e contar.
 *
 * O segundo bloco não tem botão de excluir de propósito: o que o põe no
 * ar é a APROVAÇÃO do trabalho, e um botão de esconder aqui criaria um
 * segundo estado de "aprovado mas invisível" que nenhuma outra tela
 * conhece. Tirar um vídeo dali é assunto do parecer editorial.
 */

/** Formulário do diálogo. `id` nulo = vídeo novo. */
type Editor = {
  id: string | null;
  titulo: string;
  descricao: string;
  edicao: string;
  video_url: string;
};

const editorNovo = (): Editor => ({
  id: null,
  titulo: "",
  descricao: "",
  edicao: "",
  video_url: "",
});

const editorDe = (item: PitchHistorico): Editor => ({
  id: item.id,
  titulo: item.titulo,
  descricao: item.descricao,
  edicao: item.edicao,
  video_url: item.video_url,
});

const Pitches = () => {
  const [acervo, setAcervo] = useState<PitchHistorico[]>([]);
  const [doCongresso, setDoCongresso] = useState<Pitch[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [aExcluir, setAExcluir] = useState<PitchHistorico | null>(null);

  const carregar = async () => {
    setCarregando(true);
    try {
      // As duas listas juntas: a tabela (que propaga erro) e a vitrine
      // pública, de onde saem só os de origem 'trabalho' o outro ramo
      // dela é o próprio acervo que já veio pela tabela.
      const [linhas, vitrine] = await Promise.all([
        listarPitchesHistoricos(),
        carregarPitchesPublicos(),
      ]);
      setAcervo(linhas);
      setDoCongresso(vitrine.filter((p) => p.origem === "trabalho"));
    } catch {
      toast.error("Erro ao carregar os pitches.");
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
      toast.error("Informe o título do vídeo.");
      return;
    }
    // Conferência de CORTESIA: quem recusa de verdade é o CHECK da
    // coluna. Vale a pena mesmo assim porque a mensagem do banco não
    // diria qual campo está errado e um link de canal ou de playlist
    // passaria pelo CHECK (é do domínio do YouTube) e viraria um cartão
    // sem vídeo na vitrine.
    if (!idDoVideo(editor.video_url)) {
      toast.error("O link precisa ser de um vídeo do YouTube.");
      return;
    }

    const campos = {
      titulo: editor.titulo.trim(),
      descricao: editor.descricao.trim(),
      edicao: editor.edicao.trim(),
      video_url: editor.video_url.trim(),
    };

    setSalvando(true);
    try {
      if (editor.id) {
        await atualizarPitchHistorico(editor.id, campos);
        toast.success("Vídeo atualizado.");
      } else {
        await criarPitchHistorico({
          ...campos,
          // No fim do acervo, como em `arquivos_download` e nos anais.
          ordem: acervo.reduce((maior, p) => Math.max(maior, p.ordem), 0) + 1,
        });
        toast.success("Vídeo adicionado ao acervo.");
      }
      setEditor(null);
      carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar o vídeo.");
    } finally {
      setSalvando(false);
    }
  };

  const confirmarExclusao = async () => {
    if (!aExcluir) return;
    try {
      await removerPitchHistorico(aExcluir.id);
      toast.success("Vídeo excluído do acervo.");
      carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao excluir o vídeo.");
    }
    setAExcluir(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
            <Video className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Pitches</h1>
            <p className="text-sm text-muted-foreground">
              A vitrine de <strong>/pitches</strong>. Os vídeos dos trabalhos aprovados desta edição
              entram sozinhos; aqui você cadastra os das edições anteriores.
            </p>
          </div>
        </div>
        <Button onClick={() => setEditor(editorNovo())}>
          <Plus className="mr-2 h-4 w-4" /> Novo vídeo do acervo
        </Button>
      </div>

      {carregando ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : (
        <>
          {/* Bloco 1 o acervo, editável */}
          <Card className="shadow-[var(--shadow-card)]">
            <CardHeader className="space-y-0 pb-3">
              <h2 className="text-lg font-semibold">Acervo de edições anteriores</h2>
              <p className="text-xs text-muted-foreground">
                Cadastrados à mão. Tudo que está aqui está no ar para tirar um vídeo da vitrine,
                exclua a linha.
              </p>
            </CardHeader>
            <CardContent>
              {acervo.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Nenhum vídeo de edição anterior cadastrado. Use “Novo vídeo do acervo”.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {acervo.map((item) => (
                    <li key={item.id} className="flex flex-wrap items-start gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{item.titulo}</span>
                          {item.edicao && (
                            <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold text-secondary-foreground">
                              {item.edicao}
                            </span>
                          )}
                        </div>
                        {item.descricao && (
                          <p className="text-sm text-muted-foreground">{item.descricao}</p>
                        )}
                        <a
                          className="mt-1 inline-flex items-center gap-1 break-all text-xs text-primary underline"
                          href={item.video_url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {item.video_url}
                          <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setEditor(editorDe(item))}
                        >
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
              )}
            </CardContent>
          </Card>

          {/* Bloco 2 os desta edição, só leitura */}
          <Card className="shadow-[var(--shadow-card)]">
            <CardHeader className="space-y-0 pb-3">
              <h2 className="text-lg font-semibold">
                Desta edição ({doCongresso.length})
              </h2>
              <p className="text-xs text-muted-foreground">
                Entram sozinhos: são os vídeos dos trabalhos <strong>aprovados</strong> cuja
                categoria exigia vídeo. Não há o que cadastrar nem o que excluir aqui um trabalho
                sai da vitrine mudando a decisão editorial.
              </p>
            </CardHeader>
            <CardContent>
              {doCongresso.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Nenhum trabalho aprovado com vídeo até agora. Categorias que não exigem vídeo
                  (Extensão, por exemplo) nunca aparecem aqui.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {doCongresso.map((item) => (
                    <li key={item.id} className="flex flex-wrap items-start gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{item.titulo}</span>
                          {item.categoria && (
                            <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold text-secondary-foreground">
                              {item.categoria}
                            </span>
                          )}
                        </div>
                        {item.autores && (
                          <p className="text-sm text-muted-foreground">{item.autores}</p>
                        )}
                        <a
                          className="mt-1 inline-flex items-center gap-1 break-all text-xs text-primary underline"
                          href={item.video_url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {item.video_url}
                          <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Diálogo: novo vídeo do acervo / edição */}
      <Dialog open={!!editor} onOpenChange={(aberto) => !aberto && setEditor(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editor?.id ? "Editar vídeo" : "Novo vídeo do acervo"}</DialogTitle>
            <DialogDescription>
              Para vídeos de edições anteriores. Os desta edição entram sozinhos quando o trabalho
              é aprovado.
            </DialogDescription>
          </DialogHeader>

          {editor && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="pitch-titulo">Título *</Label>
                <Input
                  id="pitch-titulo"
                  value={editor.titulo}
                  placeholder="Ex.: Monitoramento de qualidade da água com sensores de baixo custo"
                  onChange={(e) => setEditor({ ...editor, titulo: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="pitch-url">Link do vídeo *</Label>
                <Input
                  id="pitch-url"
                  value={editor.video_url}
                  placeholder="https://www.youtube.com/watch?v=..."
                  onChange={(e) => setEditor({ ...editor, video_url: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Precisa ser um vídeo do YouTube a vitrine mostra a miniatura e abre o player no
                  clique.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="pitch-edicao">Edição</Label>
                <Input
                  id="pitch-edicao"
                  value={editor.edicao}
                  placeholder="Ex.: 2024"
                  onChange={(e) => setEditor({ ...editor, edicao: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Vira um selo no cartão. Em branco, o cartão não mostra selo nenhum.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="pitch-desc">Descrição</Label>
                <Textarea
                  id="pitch-desc"
                  rows={3}
                  value={editor.descricao}
                  placeholder="Autores, ou uma frase sobre o trabalho. Aparece abaixo do título."
                  onChange={(e) => setEditor({ ...editor, descricao: e.target.value })}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditor(null)}>
              Cancelar
            </Button>
            <Button onClick={salvar} disabled={salvando}>
              {salvando ? "Salvando..." : editor?.id ? "Salvar vídeo" : "Adicionar vídeo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmação de exclusão */}
      <AlertDialog open={!!aExcluir} onOpenChange={(o) => !o && setAExcluir(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir vídeo do acervo?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{aExcluir?.titulo}</strong> sai da vitrine de /pitches. O vídeo no YouTube não
              é tocado. Esta ação não pode ser desfeita.
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

export default Pitches;
