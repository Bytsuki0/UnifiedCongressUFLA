import { useEffect, useRef, useState } from "react";
import type { Modelo, Variaveis } from "@/lib/certificados";
import { desenharEm } from "@/services/certificadosService";

/**
 * Um certificado desenhado num canvas reduzido. É o MESMO desenho do
 * download (`desenharEm`), só que menor: o que aparece aqui é o que sai.
 */
export function PreviaCertificado({
  modelo,
  imagem,
  variaveis,
  largura = 480,
}: {
  modelo: Modelo;
  imagem: string;
  variaveis: Variaveis;
  largura?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    let vivo = true;
    const canvas = ref.current;
    if (!canvas) return;
    setErro(false);
    desenharEm(canvas, modelo, imagem, variaveis, largura).catch(() => vivo && setErro(true));
    return () => {
      vivo = false;
    };
  }, [modelo, imagem, variaveis, largura]);

  return (
    <>
      <canvas
        ref={ref}
        style={{ width: "100%", height: "auto", display: "block", borderRadius: 6, border: "1px solid var(--color-border, #e5e7eb)" }}
      />
      {erro && (
        <p style={{ fontSize: "var(--fs-sm)", color: "var(--color-danger, #b91c1c)", marginTop: 8 }}>
          Não foi possível carregar o modelo. Recarregue a página.
        </p>
      )}
    </>
  );
}
