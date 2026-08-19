import { urlDeEmbed } from "@/lib/youtube";

/**
 * Player do vídeo de apresentação anexado ao trabalho.
 *
 * Irmão de `PdfViewer` e com o MESMO contrato de layout: raiz
 * `position: absolute; inset: 0`, porque o pai (`.pdf-viewer`) é
 * `position: relative` e centraliza por flex — um filho no fluxo normal
 * brigaria com essa centralização em vez de preencher o painel.
 */
export function VideoViewer({ url }: { url: string }) {
  const embed = urlDeEmbed(url);

  if (!embed) {
    return (
      <div style={{ position: "absolute", inset: 0, zIndex: 5, display: "flex", flexDirection: "column", gap: 12, alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center", background: "var(--gray-100, #f3f4f6)", color: "var(--color-text-muted)", fontSize: "var(--fs-sm)" }}>
        <span>O link de vídeo informado não é um vídeo do YouTube reconhecível.</span>
        <a className="btn btn-outline btn-sm" href={url} target="_blank" rel="noopener noreferrer">
          ABRIR O LINK EM NOVA ABA
        </a>
      </div>
    );
  }

  return (
    <iframe
      src={embed}
      title="Vídeo de apresentação do trabalho"
      allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
      allowFullScreen
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none", zIndex: 5, background: "#000" }}
    />
  );
}
