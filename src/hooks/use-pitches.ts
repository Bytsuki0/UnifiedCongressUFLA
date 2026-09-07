import { useEffect, useState } from "react";
import { carregarPitchesPublicos, type Pitch } from "@/services/pitchesService";

/**
 * A vitrine de pitches inteira, numa requisição só.
 *
 * Vem tudo de uma vez porque a paginação é do cliente — ver
 * `src/lib/pitches.ts`: a troca de página não vai à rede, e por isso não
 * há como a ordem mudar no meio da navegação e um vídeo pular de página.
 *
 * `carregando` separa "ainda buscando" de "nada publicado": sem ele a
 * landing pisca uma seção de vitrine vazia no primeiro quadro de toda
 * visita.
 */
export function usePitches(): { pitches: Pitch[]; carregando: boolean } {
  const [pitches, setPitches] = useState<Pitch[]>([]);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let vivo = true;
    carregarPitchesPublicos().then((lista) => {
      if (!vivo) return;
      setPitches(lista);
      setCarregando(false);
    });
    return () => {
      vivo = false;
    };
  }, []);

  return { pitches, carregando };
}
