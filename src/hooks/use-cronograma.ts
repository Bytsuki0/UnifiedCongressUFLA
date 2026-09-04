import { useEffect, useState } from "react";
import { carregarCronogramaPublico, type ItemCronograma } from "@/services/cronogramaService";

export type CronogramaCarregado = { itens: ItemCronograma[]; carregando: boolean };

/**
 * O cronograma publicado, para as três telas que só o EXIBEM (landing,
 * /cronograma e /estudante/cronograma). A tela de gestão não usa este
 * hook: ela lê a tabela e precisa dos erros.
 *
 * `carregando` existe para separar "ainda buscando" de "não há nada
 * publicado" — sem isso a landing pisca uma seção de cronograma vazia
 * antes de decidir escondê-la.
 */
export function useCronograma(): CronogramaCarregado {
  const [itens, setItens] = useState<ItemCronograma[]>([]);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let vivo = true;
    carregarCronogramaPublico().then((lista) => {
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
