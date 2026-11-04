import { useEffect, useState } from "react";
import { carregarProgramacao, type Programacao } from "@/services/programacaoService";

/**
 * A programação publicada, para as telas que só a EXIBEM (landing,
 * /programacao, /estudante/programacao). `programacao` nula = não há (ou
 * falhou); `carregando` separa isso de "ainda buscando".
 */
export function useProgramacao(): { programacao: Programacao | null; carregando: boolean } {
  const [programacao, setProgramacao] = useState<Programacao | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let vivo = true;
    carregarProgramacao().then((p) => {
      if (!vivo) return;
      setProgramacao(p);
      setCarregando(false);
    });
    return () => {
      vivo = false;
    };
  }, []);

  return { programacao, carregando };
}
