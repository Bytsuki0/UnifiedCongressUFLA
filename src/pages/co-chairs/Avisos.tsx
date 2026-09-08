import { useEffect, useState } from "react";
import { Image as ImageIcon, Megaphone, Pencil, Trash2, Type } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import {
  atualizarAviso,
  criarAviso,
  descartarBanner,
  enviarBanner,
  listarAvisos,
  removerAviso,
  resolverBanner,
  type AvisoAdmin,
  type TipoAviso,
} from "@/services/avisosService";
import {
  PAPEIS_AVISO,
  ROTULO_PAPEL,
  temConteudo,
  type PapelAviso,
} from "@/lib/avisos";
import { EditorTextoRico } from "@/components/EditorTextoRico";
import { TextoRico } from "@/components/TextoRico";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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

/**
 * Gestão dos avisos de login (migration 20260908120000).
 *
 * Mesmo desenho das telas do cronograma e dos anais: uma lista curta que
 * a organização edita de vez em quando, editor em <Dialog>, exclusão com
 * confirmação. E a mesma regra: **não existe "desligar"** o que está
 * cadastrado está no ar, e excluir é o que faz o pop-up parar.
 *
 * ⚠ DOIS botões de adicionar, um por forma de conteúdo, e nunca um
 * seletor "texto ou banner" dentro do diálogo. É a convenção que os
 * anexos por categoria e o painel de downloads já fixaram: num seletor,
 * escolher errado é o padrão. E, como lá, o TIPO não é editável depois
 * trocar um banner para texto deixaria a imagem pendurada no bucket sem
 * nada apontando para ela.
 */

/** Formulário do diálogo. `id` nulo = aviso novo. */
type Editor = {
  id: string | null;
  tipo: TipoAviso;
  titulo: string;
  corpo: string;
  /** Caminho já gravado no bucket. Vazio num banner ainda sem imagem. */
  imagem: string;
  /** Imagem escolhida agora, ainda não enviada. */
  arquivo: File | null;
  papeis: PapelAviso[];
};

const editorNovo = (tipo: TipoAviso): Editor => ({
  id: null,
  tipo,
  titulo: "",
  corpo: "",
  imagem: "",
  arquivo: null,
  papeis: [],
});

const editorDe = (aviso: AvisoAdmin): Editor => ({
  id: aviso.id,
  tipo: aviso.tipo,
  titulo: aviso.titulo,
  corpo: aviso.corpo,
  imagem: aviso.imagem,
  arquivo: null,
  papeis: aviso.papeis,
});

/** Resumo de uma linha de um aviso de texto, para a lista. */
const primeiraLinha = (corpo: string) => {
  const linha = corpo.split("\n").find((l) => l.trim() !== "") ?? "";
  return linha.length > 120 ? `${linha.slice(0, 120)}…` : linha;
};

const Avisos = () => {
  const { user } = useAuth();
  const [avisos, setAvisos] = useState<AvisoAdmin[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [aExcluir, setAExcluir] = useState<AvisoAdmin | null>(null);
  /** URL assinada da imagem já gravada, só para a pré-visualização. */
  const [previaGravada, setPreviaGravada] = useState<string | null>(null);
  /** URL local da imagem recém-escolhida, ainda não enviada. */
  const [previaArquivo, setPreviaArquivo] = useState<string | null>(null);

  const carregar = async () => {
    setCarregando(true);
    try {
      setAvisos(await listarAvisos());
    } catch {
      toast.error("Erro ao carregar os avisos.");
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    carregar();
  }, []);

  // A imagem já gravada mora num bucket privado: para vê-la é preciso
  // assinar. Só quando o diálogo abre num banner que já tem imagem.
  //
  // ⚠ A dependência é o CAMINHO, e não o `editor` inteiro: o editor é um
  // objeto novo a cada tecla do título, e assinar de novo a cada tecla
  // seria uma requisição por caractere digitado.
  const imagemGravada = editor?.tipo === "banner" ? editor.imagem : "";
  useEffect(() => {
    setPreviaGravada(null);
    if (!imagemGravada) return;

    let vivo = true;
    resolverBanner(imagemGravada).then((url) => {
      if (vivo) setPreviaGravada(url);
    });
    return () => {
      vivo = false;
    };
  }, [imagemGravada]);

  // A pré-visualização do arquivo escolhido é um object URL, e ele
  // precisa ser devolvido: criá-lo no meio do JSX vazaria um blob por
  // render e esta tela re-renderiza a cada tecla do título.
  useEffect(() => {
    const arquivo = editor?.arquivo ?? null;
    if (!arquivo) {
      setPreviaArquivo(null);
      return;
    }
    const url = URL.createObjectURL(arquivo);
    setPreviaArquivo(url);
    return () => URL.revokeObjectURL(url);
  }, [editor?.arquivo]);

  const alternarPapel = (papel: PapelAviso) => {
    if (!editor) return;
    setEditor({
      ...editor,
      papeis: editor.papeis.includes(papel)
        ? editor.papeis.filter((p) => p !== papel)
        : [...editor.papeis, papel],
    });
  };

  const salvar = async () => {
    if (!editor || !user) return;

    if (!editor.titulo.trim()) {
      toast.error("Informe o título do aviso.");
      return;
    }
    if (editor.papeis.length === 0) {
      toast.error("Escolha ao menos um papel que deve receber o aviso.");
      return;
    }
    if (editor.tipo === "texto" && !temConteudo(editor.corpo)) {
      toast.error("Escreva a mensagem do aviso.");
      return;
    }
    if (editor.tipo === "banner" && !editor.arquivo && !editor.imagem) {
      toast.error("Escolha a imagem do banner.");
      return;
    }

    setSalvando(true);
    // Caminho do arquivo enviado NESTA tentativa. Enquanto a gravação
    // não passa, ele é um órfão em potencial e é limpo no `catch`,
    // como em `prepararAnexos`: uma recusa da RLS não pode deixar
    // arquivo pago no bucket a cada tentativa.
    let enviado = "";
    // Caminho que a gravação bem-sucedida aposenta (imagem trocada). Só
    // sai do Storage DEPOIS de o UPDATE passar: apagar antes e ver a
    // gravação falhar deixaria o aviso apontando para um arquivo que já
    // não existe.
    let substituido = "";
    try {
      let imagem = editor.imagem;
      if (editor.tipo === "banner" && editor.arquivo) {
        enviado = await enviarBanner(editor.arquivo, user.id);
        imagem = enviado;
        substituido = editor.imagem;
      }

      if (editor.id) {
        await atualizarAviso(editor.id, {
          titulo: editor.titulo.trim(),
          corpo: editor.tipo === "texto" ? editor.corpo.trim() : "",
          imagem: editor.tipo === "banner" ? imagem : "",
          papeis: editor.papeis,
        });
        toast.success("Aviso atualizado.");
      } else {
        // No fim da fila: o máximo atual + 1. Sem isto todo aviso novo
        // nasceria com ordem 0 e a ordem entre eles ficaria por conta do
        // desempate de `criado_em`.
        await criarAviso({
          tipo: editor.tipo,
          titulo: editor.titulo.trim(),
          corpo: editor.tipo === "texto" ? editor.corpo.trim() : "",
          imagem: editor.tipo === "banner" ? imagem : "",
          papeis: editor.papeis,
          ordem: avisos.reduce((maior, a) => Math.max(maior, a.ordem), 0) + 1,
        });
        toast.success("Aviso publicado.");
      }

      // Gravou: o arquivo novo passou a ser o oficial e não é mais
      // órfão; quem sobra agora é o que ele substituiu.
      enviado = "";
      if (substituido) await descartarBanner(substituido);
      setEditor(null);
      carregar();
    } catch (e) {
      // Upload aceito e gravação recusada: o arquivo novo sai na hora.
      // Nada aponta para ele, e a tentativa seguinte subiria outro.
      if (enviado) await descartarBanner(enviado);
      toast.error(e instanceof Error ? e.message : "Erro ao salvar o aviso.");
    } finally {
      setSalvando(false);
    }
  };

  const confirmarExclusao = async () => {
    if (!aExcluir) return;
    try {
      // Devolve o caminho da imagem lido ANTES do DELETE depois a linha
      // não existe mais e não haveria como saber o que apagar do bucket.
      const imagem = await removerAviso(aExcluir.id);
      await descartarBanner(imagem);
      toast.success("Aviso excluído. Ele não aparece mais no login.");
      carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao excluir o aviso.");
    }
    setAExcluir(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
            <Megaphone className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Avisos de Login</h1>
            <p className="text-sm text-muted-foreground">
              Recados que aparecem em uma janela logo depois do login, para os papéis que você
              escolher. Enquanto o aviso estiver cadastrado, ele reaparece a cada nova entrada.
            </p>
          </div>
        </div>
        {/* Um botão por forma de conteúdo: num seletor "texto ou banner",
            escolher errado é o padrão. */}
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setEditor(editorNovo("texto"))}>
            <Type className="mr-2 h-4 w-4" /> Aviso de texto
          </Button>
          <Button onClick={() => setEditor(editorNovo("banner"))}>
            <ImageIcon className="mr-2 h-4 w-4" /> Aviso com banner
          </Button>
        </div>
      </div>

      {carregando ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : avisos.length === 0 ? (
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="py-12 text-center text-muted-foreground">
            Nenhum aviso cadastrado ninguém vê janela nenhuma ao entrar. Crie o primeiro com um
            dos botões acima.
          </CardContent>
        </Card>
      ) : (
        <Card className="shadow-[var(--shadow-card)]">
          <CardHeader className="space-y-0 pb-3">
            <h2 className="text-lg font-semibold">Avisos no ar</h2>
            <p className="text-xs text-muted-foreground">
              Tudo que está aqui aparece no login de quem tem um dos papéis marcados. Para parar de
              exibir um aviso, exclua a linha não existe “desligar”.
            </p>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {avisos.map((aviso) => (
                <li key={aviso.id} className="flex flex-wrap items-start gap-3 py-3">
                  <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    {aviso.tipo === "banner" ? (
                      <ImageIcon className="h-4 w-4" />
                    ) : (
                      <Type className="h-4 w-4" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="font-medium">{aviso.titulo}</span>
                    <p className="text-sm text-muted-foreground">
                      {aviso.tipo === "banner"
                        ? "Banner (imagem)"
                        : primeiraLinha(aviso.corpo) || "—"}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {aviso.papeis.map((papel) => (
                        <Badge key={papel} variant="secondary">
                          {ROTULO_PAPEL[papel] ?? papel}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button variant="outline" size="sm" onClick={() => setEditor(editorDe(aviso))}>
                      <Pencil className="mr-2 h-4 w-4" /> Editar
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setAExcluir(aviso)}
                      aria-label={`Excluir ${aviso.titulo}`}
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

      {/* Diálogo: novo aviso / edição */}
      <Dialog open={!!editor} onOpenChange={(aberto) => !aberto && setEditor(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editor?.id ? "Editar aviso" : "Novo aviso"}
              {editor?.tipo === "banner" ? " (banner)" : " (texto)"}
            </DialogTitle>
            <DialogDescription>
              O aviso aparece assim que a pessoa entra. A forma do conteúdo texto ou banner é
              escolhida na criação e não muda depois.
            </DialogDescription>
          </DialogHeader>

          {editor && (
            <div className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="aviso-titulo">Título *</Label>
                <Input
                  id="aviso-titulo"
                  value={editor.titulo}
                  placeholder="Ex.: Prazo de submissão prorrogado"
                  onChange={(e) => setEditor({ ...editor, titulo: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  É o cabeçalho da janela vale para os dois tipos de aviso.
                </p>
              </div>

              <div className="space-y-2">
                <Label>Quem recebe *</Label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {PAPEIS_AVISO.map((papel) => (
                    <label
                      key={papel}
                      className="flex cursor-pointer items-center gap-2 rounded-md border border-input px-3 py-2 text-sm"
                    >
                      <Checkbox
                        checked={editor.papeis.includes(papel)}
                        onCheckedChange={() => alternarPapel(papel)}
                      />
                      {ROTULO_PAPEL[papel]}
                    </label>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Estudantes e participantes externos são papéis diferentes, mesmo usando o mesmo
                  portal: marque os dois para falar com todos os autores.
                </p>
              </div>

              {editor.tipo === "texto" ? (
                <div className="space-y-2">
                  <Label htmlFor="aviso-corpo">Mensagem *</Label>
                  <EditorTextoRico
                    id="aviso-corpo"
                    valor={editor.corpo}
                    onChange={(corpo) => setEditor({ ...editor, corpo })}
                    placeholder={"Ex.: O prazo foi prorrogado até **20 de outubro**.\n\n- Envie o PDF final\n- Confira os dados dos coautores"}
                  />
                  {temConteudo(editor.corpo) && (
                    <div className="rounded-md border border-dashed border-input p-3">
                      <p className="mb-1 text-xs font-medium text-muted-foreground">
                        Como o destinatário vai ver
                      </p>
                      <TextoRico texto={editor.corpo} className="text-sm leading-relaxed" />
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="aviso-imagem">Imagem do banner *</Label>
                  <Input
                    id="aviso-imagem"
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    onChange={(e) =>
                      setEditor({ ...editor, arquivo: e.target.files?.[0] ?? null })
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    PNG, JPEG, WEBP ou GIF, até 5 MB. A imagem aparece na largura da janela um
                    cartaz muito alto obriga a rolar.
                  </p>
                  {(previaArquivo || previaGravada) && (
                    <div className="rounded-md border border-dashed border-input p-3">
                      <p className="mb-2 text-xs font-medium text-muted-foreground">
                        {previaArquivo ? "Imagem escolhida" : "Imagem publicada hoje"}
                      </p>
                      <img
                        src={previaArquivo ?? previaGravada ?? ""}
                        alt="Pré-visualização do banner"
                        className="w-full rounded"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditor(null)}>
              Cancelar
            </Button>
            <Button onClick={salvar} disabled={salvando}>
              {salvando ? "Salvando..." : editor?.id ? "Salvar aviso" : "Publicar aviso"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmação de exclusão */}
      <AlertDialog open={!!aExcluir} onOpenChange={(o) => !o && setAExcluir(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir este aviso?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{aExcluir?.titulo}</strong> deixa de aparecer no login de{" "}
              {aExcluir?.papeis.map((p) => ROTULO_PAPEL[p] ?? p).join(", ")}. É assim que se para
              de exibir um aviso não há como apenas desligá-lo. Esta ação não pode ser desfeita.
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

export default Avisos;
