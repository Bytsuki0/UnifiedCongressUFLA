import { useEffect, useState } from "react";
import { carregarApresentacoesPublicas } from "@/services/apresentacoesService";
import type { ApresentacaoPublica } from "@/lib/apresentacoes";

export type ApresentacoesCarregadas = { itens: ApresentacaoPublica[]; carregando: boolean };

/**
 * O cronograma de apresentações publicado, para as três telas que só o
 * EXIBEM (landing, /apresentacoes e /estudante/apresentacoes). O AdminCA
 * não usa este hook: ele lê as tabelas e precisa dos erros.
 *
 * `carregando` separa "ainda buscando" de "nada publicado" — sem isso a
 * landing piscaria a seção antes de decidir escondê-la.
 */
export function useApresentacoes(): ApresentacoesCarregadas {
  const [itens, setItens] = useState<ApresentacaoPublica[]>([]);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let vivo = true;
    carregarApresentacoesPublicas().then((lista) => {
      if (!vivo) return;
      setItens(lista);
      setCarregando(false);
    });
    return () => {
      vivo = false;
    };
  }, []);

  return { itens, carregando };
}
