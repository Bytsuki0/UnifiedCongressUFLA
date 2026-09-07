import { useEffect, useState } from "react";
import { carregarAnaisPublicos, type PublicacaoAnais } from "@/services/anaisService";

/**
 * Os anais publicados, para as telas que só os EXIBEM (a seção da
 * landing e /anais). A tela de gestão não usa este hook: ela lê a tabela
 * e precisa dos erros.
 *
 * `carregando` existe para separar "ainda buscando" de "nada publicado" —
 * sem isso a landing pisca uma seção vazia antes de decidir escondê-la.
 * Mesmo desenho de `useCronograma` e `useArquivosDownload`.
 */
export function useAnais(): { anais: PublicacaoAnais[]; carregando: boolean } {
  const [anais, setAnais] = useState<PublicacaoAnais[]>([]);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let vivo = true;
    carregarAnaisPublicos().then((lista) => {
      if (!vivo) return;
      setAnais(lista);
      setCarregando(false);
    });
    return () => {
      vivo = false;
    };
  }, []);

  return { anais, carregando };
}
