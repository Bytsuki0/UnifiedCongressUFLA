import { PdfComoImagem } from "@/components/PdfViewer";
import type { Programacao } from "@/services/programacaoService";

/**
 * A programação do evento como imagem, e só ela: sem moldura, sem caixa
 * de altura fixa — a altura é a do arquivo. No celular amplia pela pinça
 * nativa do navegador (o viewport não trava o zoom); no desktop é estática.
 * A imagem nunca passa do tamanho natural, para não borrar ampliada.
 */
export function ImagemProgramacao({ programacao }: { programacao: Programacao }) {
  const alt = "Programação do evento";
  return programacao.pdf ? (
    <PdfComoImagem url={programacao.url} alt={alt} />
  ) : (
    <img src={programacao.url} alt={alt} loading="lazy" className="mx-auto block h-auto max-w-full" />
  );
}
