import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { tituloDaRota } from "@/lib/pageTitles";

/**
 * Ajusta o <title> a cada navegação.
 *
 * A aplicação é client-side, então o <title> do index.html seria o
 * mesmo para todas as URLs — quem abre várias abas (um revisor
 * comparando trabalhos, por exemplo) veria só "Congresso Unificado
 * ICTIN" repetido, e o histórico e os favoritos ficariam inúteis.
 * Resolvido em um lugar só, sem precisar tocar em cada página.
 *
 * A tabela de títulos vive em @/lib/pageTitles (testada à parte).
 */
export function DocumentTitle() {
  const { pathname } = useLocation();

  useEffect(() => {
    document.title = tituloDaRota(pathname);
  }, [pathname]);

  return null;
}
