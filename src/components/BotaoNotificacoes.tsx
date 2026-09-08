import { useState } from "react";
import { useAvisos } from "@/contexts/AvisosContext";
import { CorpoDoAviso } from "@/components/CorpoDoAviso";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Aba "Notificações" da barra superior, ao lado do nome do usuário.
 *
 * Existe porque o pop-up do login é **efêmero**: quem fecha o aviso (ou
 * o fecha sem querer, no Esc) não tinha como voltar a ele até o login
 * seguinte e um recado que diz "o prazo agora é dia 20" precisa ser
 * relido. Aqui a lista fica parada, e mostra **todos** os avisos
 * endereçados à pessoa, inclusive os já fechados.
 *
 * ⚠ Isto NÃO é o mesmo que a seção "Notificações" de `/admin`, que lista
 * submissões recentes para a organização, nem a tabela `notifications`
 * do `/congresso` (área congelada). O que aparece aqui são os **avisos**
 * (`meus_avisos()`, migration 20260908120000) os mesmos do pop-up.
 *
 * QUEM vê o quê continua sendo decisão do servidor: a RPC compara os
 * papéis do aviso com os papéis reais da conta. Este componente não
 * filtra nada.
 *
 * Segue o desenho do `<BotaoSuporte />` mesmo lugar, mesma pílula, e é
 * por isso que os dois dividem as regras `.link-suporte` no `index.css`.
 * O contador só aparece quando há aviso ainda não fechado NESTA aba: é o
 * mesmo estado que alimenta o pop-up, então fechar o diálogo o zera na
 * hora. Um contador do total ficaria permanentemente aceso, e um número
 * que nunca muda deixa de ser lido.
 */
export function BotaoNotificacoes() {
  const [aberto, setAberto] = useState(false);
  const { avisos, pendentes, carregando } = useAvisos();

  // Sem sessão (ou sem aviso nenhum endereçado a este papel) a aba não
  // aparece: um sino que nunca tem nada é ruído permanente na barra.
  if (carregando || avisos.length === 0) return null;

  return (
    <>
      <button
        type="button"
        className="link-suporte link-notificacoes"
        onClick={() => setAberto(true)}
        title="Ver os avisos da organização"
      >
        <span className="link-suporte-icone" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        </span>
        <span className="link-suporte-label">Notificações</span>
        {pendentes.length > 0 && (
          <span className="link-notificacoes-contador" aria-label={`${pendentes.length} não lido(s)`}>
            {pendentes.length}
          </span>
        )}
      </button>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Notificações</DialogTitle>
            <DialogDescription>
              Avisos da organização do congresso para o seu perfil. Ficam disponíveis aqui
              enquanto estiverem publicados.
            </DialogDescription>
          </DialogHeader>

          <ul className="divide-y divide-border">
            {avisos.map((aviso) => (
              <li key={aviso.id} className="py-4 first:pt-0 last:pb-0">
                <h3 className="mb-2 font-semibold">{aviso.titulo}</h3>
                <CorpoDoAviso aviso={aviso} />
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default BotaoNotificacoes;
