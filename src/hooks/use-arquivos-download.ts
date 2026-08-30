import { useEffect, useState } from "react";
import {
  carregarArquivosDownload,
  type ArquivoDownload,
  type GrupoDownload,
} from "@/services/configuracoesService";

/**
 * Os arquivos que a organização publicou para um grupo de telas.
 *
 * Uma requisição só traz os dois grupos (a RPC devolve tudo); o filtro é
 * aqui porque nenhuma tela mostra os dois ao mesmo tempo e partir a
 * função em duas só para isso dobraria a superfície pública.
 *
 * `carregando` existe para a landing: sem ele o carrossel pisca "nenhum
 * arquivo publicado" no primeiro quadro de toda visita. Lista vazia
 * depois de carregar é estado legítimo — a organização ainda não
 * publicou nada — e cada tela decide se esconde a seção ou avisa.
 */
export function useArquivosDownload(grupo: GrupoDownload): {
  arquivos: ArquivoDownload[];
  carregando: boolean;
} {
  const [arquivos, setArquivos] = useState<ArquivoDownload[]>([]);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let vivo = true;
    carregarArquivosDownload().then((lista) => {
      if (!vivo) return;
      setArquivos(lista.filter((a) => a.grupo === grupo));
      setCarregando(false);
    });
    return () => {
      vivo = false;
    };
  }, [grupo]);

  return { arquivos, carregando };
}
