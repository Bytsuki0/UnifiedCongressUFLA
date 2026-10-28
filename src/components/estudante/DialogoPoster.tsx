import { useState } from "react";
import { toast } from "sonner";
import { CamposAnexos } from "@/components/estudante/CamposAnexos";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { enviarPosteres } from "@/services/anexosService";
import {
  validarAnexos,
  type AnexoDaCategoria,
  type AnexoDoTrabalho,
  type RascunhoAnexos,
} from "@/lib/anexos";

/**
 * O envio do pôster (migration 20261027180000), aberto pela linha do
 * trabalho em /estudante/papeis-submetidos.
 *
 * Um diálogo, e não uma rota: é um arquivo só, e o autor não perde a lista
 * de vista. Os campos são os MESMOS das quatro telas de submissão
 * (`CamposAnexos`) — "Versão atual" com o pôster já enviado, e arquivo novo
 * substitui.
 *
 * Quem decide se pode é `enviar_posteres`: a tela só oferece o botão quando
 * a regra parece cumprida (`podeEnviarPoster`), e a frase do banco chega no
 * toast quando não estiver.
 */
export function DialogoPoster({
  trabalho,
  posteres,
  atuais,
  ownerId,
  onFechar,
  onEnviado,
}: {
  trabalho: { id: string; titulo: string };
  /** As exigências de pôster da categoria do trabalho. */
  posteres: AnexoDaCategoria[];
  /** Os pôsteres que o trabalho já entregou. */
  atuais: AnexoDoTrabalho[];
  ownerId: string;
  onFechar: () => void;
  onEnviado: () => void;
}) {
  const [rascunho, setRascunho] = useState<RascunhoAnexos>({});
  const [enviando, setEnviando] = useState(false);

  const enviar = async () => {
    // Sem arquivo novo a RPC não faria nada, e "Pôster enviado" seria mentira.
    if (!posteres.some((p) => rascunho[p.id]?.arquivo)) {
      toast.error("Escolha o PDF do pôster.");
      return;
    }
    const erro = validarAnexos({ exigencias: posteres, rascunho, atuais });
    if (erro) {
      toast.error(erro);
      return;
    }
    setEnviando(true);
    try {
      await enviarPosteres({ trabalhoId: trabalho.id, posteres, rascunho, ownerId });
      toast.success(atuais.length > 0 ? "Pôster substituído." : "Pôster enviado.");
      onEnviado();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível enviar o pôster.");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Dialog open onOpenChange={(aberto) => !aberto && !enviando && onFechar()}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Pôster</DialogTitle>
          <DialogDescription>{trabalho.titulo}</DialogDescription>
        </DialogHeader>

        <CamposAnexos
          exigencias={posteres}
          rascunho={rascunho}
          onMudar={setRascunho}
          atuais={atuais}
        />

        <DialogFooter>
          <button type="button" className="btn btn-outline btn-sm" onClick={onFechar} disabled={enviando}>
            CANCELAR
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={enviar} disabled={enviando}>
            {enviando ? "ENVIANDO..." : atuais.length > 0 ? "SUBSTITUIR PÔSTER" : "ENVIAR PÔSTER"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
