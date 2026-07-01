import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

// Worker do pdf.js resolvido a partir do próprio pacote instalado (versão casada
// com o react-pdf). O Vite empacota o worker como asset automaticamente.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

/**
 * Visualizador de PDF renderizado em canvas (pdf.js), portanto abre o arquivo
 * DENTRO do sistema — nunca dispara download do navegador, independentemente da
 * configuração do usuário ou do Content-Disposition do arquivo no bucket.
 */
export function PdfViewer({ url }: { url: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [numPages, setNumPages] = useState(0);
  const [width, setWidth] = useState(0);
  const [error, setError] = useState(false);

  useEffect(() => {
    setNumPages(0);
    setError(false);
  }, [url]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pageWidth = width ? Math.min(width - 24, 900) : undefined;

  return (
    <div
      ref={containerRef}
      style={{ position: "absolute", inset: 0, overflow: "auto", background: "var(--gray-100, #f3f4f6)", zIndex: 5 }}
    >
      {error ? (
        <div style={{ display: "flex", height: "100%", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center", color: "var(--color-text-muted)", fontSize: "var(--fs-sm)" }}>
          Não foi possível carregar o PDF para leitura embutida. Use “Baixar PDF” ou “Abrir em nova aba”.
        </div>
      ) : (
        <Document
          file={url}
          onLoadSuccess={({ numPages }) => setNumPages(numPages)}
          onLoadError={() => setError(true)}
          onSourceError={() => setError(true)}
          loading={<div style={{ padding: 24, textAlign: "center", color: "var(--color-text-muted)", fontSize: "var(--fs-sm)" }}>Carregando PDF...</div>}
          error={<div style={{ padding: 24, textAlign: "center", color: "var(--color-text-muted)", fontSize: "var(--fs-sm)" }}>Falha ao carregar o PDF.</div>}
        >
          {Array.from({ length: numPages }, (_, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "center", padding: "8px 0" }}>
              <Page
                pageNumber={i + 1}
                width={pageWidth}
                renderTextLayer
                renderAnnotationLayer
              />
            </div>
          ))}
        </Document>
      )}
    </div>
  );
}
