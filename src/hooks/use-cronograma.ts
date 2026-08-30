import { useEffect, useState } from "react";
import {
  carregarCronogramaPublico,
  CRONOGRAMA_VAZIO,
  type Cronograma,
} from "@/services/cronogramaService";

export type CronogramaCarregado = { cronograma: Cronograma; carregando: boolean };

/**
 * O cronograma publicado, para as três telas que só o EXIBEM (landing,
 * /cronograma e /estudante/cronograma). A tela de gestão não usa este
 * hook: ela lê as tabelas e precisa dos erros.
 *
 * `carregando` existe para separar "ainda buscando" de "não há nada
 * publicado" — sem isso a landing pisca uma seção de calendário vazia
 * antes de decidir escondê-la.
 */
export function useCronograma(): CronogramaCarregado {
  const [cronograma, setCronograma] = useState<Cronograma>(CRONOGRAMA_VAZIO);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let vivo = true;
    carregarCronogramaPublico().then((c) => {
      if (!vivo) return;
      setCronograma(c);
      setCarregando(false);
    });
    return () => {
      vivo = false;
    };
  }, []);

  return { cronograma, carregando };
}
