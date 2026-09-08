import { useEffect, useState } from "react";
import { resolverBanner, type Aviso } from "@/services/avisosService";
import { TextoRico } from "@/components/TextoRico";

/**
 * O conteúdo de um aviso texto com marcação ou banner, do jeito que
 * ele deve aparecer em qualquer tela.
 *
 * Componente único entre o pop-up do login (`<AvisosLogin />`) e a aba
 * Notificações (`<BotaoNotificacoes />`) pelo mesmo motivo de
 * `PareceresRecebidos`: são duas telas mostrando a MESMA coisa, e duas
 * cópias divergiriam a mais provável sendo uma delas esquecer de
 * assinar a URL do banner e mostrar um retângulo quebrado.
 *
 * A assinatura é feita aqui dentro, quando o aviso entra na tela: o
 * bucket é privado e a URL expira, então não há o que pré-carregar nem
 * o que guardar.
 */
export const CorpoDoAviso = ({ aviso }: { aviso: Aviso }) => {
  const [banner, setBanner] = useState<string | null>(null);
  const [tentou, setTentou] = useState(false);

  useEffect(() => {
    setBanner(null);
    setTentou(false);
    if (aviso.tipo !== "banner") return;

    let vivo = true;
    resolverBanner(aviso.imagem).then((url) => {
      if (!vivo) return;
      setBanner(url);
      setTentou(true);
    });
    return () => {
      vivo = false;
    };
  }, [aviso.tipo, aviso.imagem]);

  if (aviso.tipo !== "banner") {
    return <TextoRico texto={aviso.corpo} className="text-sm leading-relaxed" />;
  }

  if (banner) {
    return (
      <img
        src={banner}
        alt={aviso.titulo}
        className="w-full rounded-md"
        /* O banner chega em tamanho de cartaz. `height: auto` com a
           largura do contêiner evita que uma imagem alta empurre os
           botões para fora da área rolável. */
        style={{ height: "auto" }}
      />
    );
  }

  // Enquanto a assinatura está em voo não se diz que falhou: o "não
  // carregou" só aparece depois da tentativa, senão toda abertura pisca
  // uma mensagem de erro antes da imagem.
  return (
    <p className="py-6 text-center text-sm text-muted-foreground">
      {tentou ? "A imagem deste aviso não pôde ser carregada." : "Carregando a imagem..."}
    </p>
  );
};

export default CorpoDoAviso;
