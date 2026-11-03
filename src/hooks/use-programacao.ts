import { useEffect, useState } from "react";
import { carregarProgramacao, type Programacao } from "@/services/programacaoService";

/**
 * A programação publicada, para as telas que só a EXIBEM (landing,
 * /cronograma, /estudante/cronograma). `null` enquanto carrega e quando
 * não há — nos dois casos a seção não aparece.
 */
export function useProgramacao(): Programacao | null {
  const [programacao, setProgramacao] = useState<Programacao | null>(null);

  useEffect(() => {
    let vivo = true;
    carregarProgramacao().then((p) => vivo && setProgramacao(p));
    return () => {
      vivo = false;
    };
  }, []);

  return programacao;
}
