import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { carregarMeusAvisos, type Aviso } from "@/services/avisosService";

/**
 * Os avisos endereçados a quem está logado, num lugar só.
 *
 * Duas telas mostram a mesma lista e precisam concordar:
 *
 *   · `<AvisosLogin />`  o diálogo que abre depois do login, com o que
 *     ainda não foi fechado NESTA aba;
 *   · `<BotaoNotificacoes />` a aba "Notificações" da barra superior,
 *     que mostra TODOS os avisos, sempre, para quem quiser reler o que
 *     já fechou.
 *
 * Elas moram em pontos distantes da árvore (o diálogo na raiz do App, o
 * botão dentro de cada Layout), e é isso que torna o contexto necessário
 * e não um exagero:
 *
 *   1. **Uma requisição só.** Cada componente com seu `useEffect` faria
 *      duas chamadas idênticas a `meus_avisos()` em todo carregamento de
 *      página.
 *   2. **Um estado só.** É o que importa de verdade: com dois estados em
 *      memória, fechar o pop-up não mexeria no contador do sino até a
 *      próxima renderização do outro componente. Os dois leriam o mesmo
 *      `sessionStorage`, mas em momentos diferentes e o contador
 *      ficaria mentindo.
 *
 * ⚠ "Já vi este" continua sendo do NAVEGADOR, e o banco continua sem
 * tabela de leitura. O aviso deve reaparecer a cada login é recado, não
 * caixa de entrada, mas não pode reabrir a cada F5. `sessionStorage`
 * resolve os dois: vale enquanto a aba viver e morre com ela. A chave leva
 * o id do usuário porque duas contas podem entrar na mesma aba; sem isso,
 * quem entrasse depois herdaria os avisos "já vistos" de quem saiu.
 */

type AvisosContextType = {
  /** Todos os avisos endereçados a mim. É o que a aba Notificações lista. */
  avisos: Aviso[];
  /** Os que ainda não foram fechados nesta aba. É o que o pop-up mostra. */
  pendentes: Aviso[];
  carregando: boolean;
  /** Marca um aviso como visto nesta aba (memória + sessionStorage). */
  marcarVisto: (id: string) => void;
};

const AvisosContext = createContext<AvisosContextType>({
  avisos: [],
  pendentes: [],
  carregando: true,
  marcarVisto: () => {},
});

/** Segue as chaves `nexus_*` já gravadas no navegador (ver CLAUDE.md). */
const chaveVistos = (userId: string) => `nexus_avisos_vistos_${userId}`;

function lerVistos(userId: string): string[] {
  try {
    const cru = sessionStorage.getItem(chaveVistos(userId));
    const lista = cru ? JSON.parse(cru) : [];
    return Array.isArray(lista) ? (lista as string[]) : [];
  } catch {
    // Aba anônima, storage desligado, JSON corrompido: nada disso pode
    // derrubar a tela. Sem registro, o aviso aparece que é o padrão
    // seguro aqui.
    return [];
  }
}

function gravarVistos(userId: string, ids: string[]): void {
  try {
    sessionStorage.setItem(chaveVistos(userId), JSON.stringify(ids));
  } catch {
    /* ver lerVistos */
  }
}

export function AvisosProvider({ children }: { children: ReactNode }) {
  const { user, role, emailConfirmado, loading } = useAuth();
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const [vistos, setVistos] = useState<string[]>([]);
  const [carregando, setCarregando] = useState(true);

  const userId = user?.id ?? null;

  // Quem ainda não confirmou o e-mail está preso em /verifique-email e não
  // tem portal onde receber recado. `null` (não sabemos) NÃO bloqueia, como
  // em toda parte: só o `false` explícito.
  const podeReceber = !loading && !!userId && !!role && emailConfirmado !== false;

  useEffect(() => {
    if (!podeReceber || !userId) {
      setAvisos([]);
      setVistos([]);
      setCarregando(false);
      return;
    }

    // O conjunto de vistos é relido junto com a lista: trocar de conta na
    // mesma aba tem de trocar as duas coisas ao mesmo tempo.
    setVistos(lerVistos(userId));

    let vivo = true;
    setCarregando(true);
    carregarMeusAvisos().then((lista) => {
      if (!vivo) return;
      setAvisos(lista);
      setCarregando(false);
    });

    return () => {
      vivo = false;
    };
  }, [podeReceber, userId]);

  const marcarVisto = useCallback(
    (id: string) => {
      if (!userId) return;
      setVistos((antes) => {
        if (antes.includes(id)) return antes;
        const agora = [...antes, id];
        gravarVistos(userId, agora);
        return agora;
      });
    },
    [userId],
  );

  const pendentes = avisos.filter((a) => !vistos.includes(a.id));

  return (
    <AvisosContext.Provider value={{ avisos, pendentes, carregando, marcarVisto }}>
      {children}
    </AvisosContext.Provider>
  );
}

export function useAvisos() {
  return useContext(AvisosContext);
}
