import { useEffect, useState } from "react";
import { resolvePdfUrl } from "@/lib/pdfStorage";
import type { AnexoDoTrabalho } from "@/lib/anexos";

/**
 * Qual anexo do trabalho está aberto, e a URL assinada dele.
 *
 * Vive num arquivo próprio (e não junto de `AnexosDoTrabalho.tsx`) porque
 * a regra `react-refresh/only-export-components` só deixa um .tsx
 * exportar componentes — o baseline de lint do projeto é 0 erros e 9
 * warnings, e um hook exportado dali somava mais um.
 */
export function useAnexoAtivo(anexos: AnexoDoTrabalho[]) {
  const [indice, setIndice] = useState(0);
  const [url, setUrl] = useState<string | null>(null);

  // A lista pode encurtar entre dois carregamentos (a organização removeu
  // uma exigência): sem isto o índice apontaria para fora e a tela ficaria
  // em branco sem dizer por quê.
  const seguro = indice < anexos.length ? indice : 0;
  const ativo = anexos[seguro] ?? null;

  useEffect(() => {
    let vivo = true;
    if (!ativo || ativo.tipo !== "pdf") {
      setUrl(null);
      return;
    }
    // O bucket é privado (SEC-05): o que está gravado é o caminho, e o
    // que o visualizador consome é uma URL assinada e temporária.
    resolvePdfUrl(ativo.valor).then((assinada) => {
      if (vivo) setUrl(assinada);
    });
    return () => {
      vivo = false;
    };
  }, [ativo]);

  return { indice: seguro, setIndice, ativo, url };
}
