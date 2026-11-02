import { useCallback } from "react";
import { useAvisos } from "@/contexts/AvisosContext";
import { CorpoDoAviso } from "@/components/CorpoDoAviso";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * O pop-up de avisos da organização, exibido logo depois do login.
 *
 * Fica montado uma vez, na raiz da aplicação, e não dentro de cada
 * Layout: os cinco portais mostrariam o mesmo diálogo, e um usuário que
 * navegasse de /estudante para /estudante/cronograma o veria de novo a
 * cada troca de tela.
 *
 * A lista, o "já vi este" e o gate de sessão moram todos no
 * `AvisosContext` que é o mesmo que alimenta a aba **Notificações** da
 * barra superior. Sem esse compartilhamento, fechar este diálogo não
 * mexeria no contador do sino.
 *
 * QUEM recebe o quê é decisão do servidor (`meus_avisos()` compara os
 * papéis do aviso com os papéis REAIS da conta). Este componente não
 * filtra nada nem por papel, nem por rota.
 */
export const AvisosLogin = () => {
  const { pendentes, marcarVisto } = useAvisos();

  const atual = pendentes[0] ?? null;

  const fechar = useCallback(() => {
    if (atual) marcarVisto(atual.id);
  }, [atual, marcarVisto]);

  if (!atual) return null;

  // Banner: só a imagem, sem cartão branco nem botão "Entendi". 80% da
  // largura no desktop, a largura inteira no celular; fecha pelo X azul.
  // O X padrão do DialogContent (último filho) é escondido para não haver dois.
  if (atual.tipo === "banner") {
    return (
      <Dialog open onOpenChange={(aberto) => !aberto && fechar()}>
        {/* z-[110]: acima da barra lateral (z-index 100 no index.css). */}
        <DialogContent
          overlayClassName="z-[110]"
          className="z-[110] w-screen max-w-none gap-0 border-0 bg-transparent p-0 shadow-none sm:w-[80vw] sm:rounded-none [&>button:last-child]:hidden"
        >
          <DialogTitle className="sr-only">{atual.titulo}</DialogTitle>
          <CorpoDoAviso aviso={atual} imgClassName="block h-auto w-full max-h-[90dvh] object-contain" />
          <DialogClose
            className="absolute right-2 top-2 rounded-full bg-primary p-1.5 text-primary-foreground shadow-md hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring"
            title="Fechar"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </DialogClose>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={(aberto) => !aberto && fechar()}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{atual.titulo}</DialogTitle>
        </DialogHeader>

        <CorpoDoAviso aviso={atual} />

        <DialogFooter>
          <Button onClick={fechar}>
            {/* "Entendi" e não "Fechar": a fila pode ter mais de um, e o
                contador diz que ainda vem coisa sem ele, o segundo
                diálogo parece o primeiro reabrindo por defeito. */}
            {pendentes.length > 1 ? `Entendi (faltam ${pendentes.length - 1})` : "Entendi"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AvisosLogin;
