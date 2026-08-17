import { useEffect, useState } from "react";
import {
  carregarLinksDownloads,
  LINKS_VAZIOS,
  type LinksDownloads,
} from "@/services/configuracoesService";

/**
 * Links de download da organização, para as telas que mostram botões de
 * baixar. Começa vazio e assim permanece se a busca falhar — botão
 * desabilitado é o estado seguro (ver `carregarLinksDownloads`).
 */
export function useLinksDownloads(): LinksDownloads {
  const [links, setLinks] = useState<LinksDownloads>(LINKS_VAZIOS);

  useEffect(() => {
    let vivo = true;
    carregarLinksDownloads().then((l) => {
      if (vivo) setLinks(l);
    });
    return () => {
      vivo = false;
    };
  }, []);

  return links;
}
