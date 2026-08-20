import { useCallback, useLayoutEffect, useState } from "react";

/**
 * Menu lateral recolhido: preferência do usuário, guardada entre sessões.
 *
 * O estado não vive no React e sim em `<body data-sidebar="recolhida">`: os
 * cinco layouts (estudante, revisor, co-chairs, admin e congresso) desenham a
 * mesma barra `.sidebar`, e um atributo no body deixa o CSS resolver todos de
 * uma vez — em vez de cada layout passar classe para baixo.
 */

/** Segue as chaves `nexus_*` já gravadas no navegador (ver CLAUDE.md). */
const CHAVE = "nexus_sidebar_recolhida";

function lerPreferencia(): boolean {
  try {
    return localStorage.getItem(CHAVE) === "1";
  } catch {
    // Storage bloqueado (aba anônima com restrição): barra aberta, como antes.
    return false;
  }
}

function aplicarNoBody(recolhida: boolean) {
  if (recolhida) document.body.dataset.sidebar = "recolhida";
  else delete document.body.dataset.sidebar;
}

/** Devolve o estado atual e a função que o alterna. */
export function useSidebarRecolhida(): [boolean, () => void] {
  const [recolhida, setRecolhida] = useState(lerPreferencia);

  // `useLayoutEffect` e não `useEffect`: o atributo precisa estar no body
  // antes da primeira pintura, senão a barra aparece aberta e salta.
  useLayoutEffect(() => {
    aplicarNoBody(recolhida);
  }, [recolhida]);

  const alternar = useCallback(() => {
    setRecolhida(atual => {
      const proximo = !atual;
      try {
        localStorage.setItem(CHAVE, proximo ? "1" : "0");
      } catch {
        // Sem storage a escolha vale só para esta sessão.
      }
      return proximo;
    });
  }, []);

  return [recolhida, alternar];
}
