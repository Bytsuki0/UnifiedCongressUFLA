import { useCallback } from "react";
import { useAvisos } from "@/contexts/AvisosContext";
import { CorpoDoAviso } from "@/components/CorpoDoAviso";
import { Button } from "@/components/ui/button";
import {
  Dialog,
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

  return (
    <Dialog open onOpenChange={(aberto) => !aberto && fechar()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
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
