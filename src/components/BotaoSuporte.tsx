import { useState } from "react";
import { toast } from "sonner";
import { SUPPORT_EMAIL } from "@/lib/brand";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Copia para a área de transferência.
 *
 * `navigator.clipboard` só existe em contexto seguro (https ou
 * localhost) e pode ser recusado pela permissão do navegador. Quando
 * falha, cai no textarea + execCommand — obsoleto, mas é o que ainda
 * funciona nesses casos. Se os dois falharem, quem chama avisa o
 * usuário: o endereço está na tela para ser copiado à mão.
 */
async function copiar(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    try {
      const campo = document.createElement("textarea");
      campo.value = texto;
      campo.setAttribute("readonly", "");
      campo.style.position = "fixed";
      campo.style.opacity = "0";
      document.body.appendChild(campo);
      campo.select();
      const copiou = document.execCommand("copy");
      document.body.removeChild(campo);
      return copiou;
    } catch {
      return false;
    }
  }
}

/**
 * Contato do suporte, no canto superior direito de todo portal.
 *
 * Abre uma janela com o endereço em vez de disparar `mailto:` direto:
 * quem não tem cliente de e-mail configurado (a maioria, no navegador)
 * clicava e não acontecia nada visível. Aqui o endereço aparece na tela,
 * dá para copiar num clique, e o `mailto:` continua disponível para
 * quem tem o cliente configurado.
 */
export function BotaoSuporte() {
  const [aberto, setAberto] = useState(false);

  async function handleCopiar() {
    if (await copiar(SUPPORT_EMAIL)) toast.success("E-mail copiado.");
    else toast.error("Não foi possível copiar. Selecione o endereço e copie à mão.");
  }

  return (
    <>
      <button
        type="button"
        className="link-suporte"
        onClick={() => setAberto(true)}
        title="Falar com o suporte"
      >
        <span className="link-suporte-icone" aria-hidden="true">?</span>
        <span className="link-suporte-label">Suporte</span>
      </button>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Suporte</DialogTitle>
            <DialogDescription>
              Dúvidas sobre submissão, avaliação ou acesso à sua conta? Fale com a
              organização do congresso pelo e-mail abaixo.
            </DialogDescription>
          </DialogHeader>

          <div className="suporte-endereco">{SUPPORT_EMAIL}</div>

          <div className="suporte-acoes">
            <button type="button" className="btn btn-outline btn-sm" onClick={handleCopiar}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
              COPIAR E-MAIL
            </button>
            <a className="btn btn-primary btn-sm" href={`mailto:${SUPPORT_EMAIL}`}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>
              </svg>
              ABRIR NO E-MAIL
            </a>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
