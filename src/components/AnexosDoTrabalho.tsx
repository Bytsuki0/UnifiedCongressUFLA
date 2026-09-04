import { PdfViewer } from "@/components/PdfViewer";
import { VideoViewer } from "@/components/VideoViewer";
import type { AnexoDoTrabalho } from "@/lib/anexos";

/**
 * Leitura dos anexos de um trabalho: as abas, os botões e o visor.
 *
 * Antes eram dois anexos fixos — um PDF e um vídeo — e cada tela do lado
 * de quem lê (`/revisor/analise/:id` e `/co-chairs/parecer-editorial/:id`)
 * tinha a sua própria cópia do alternador, da URL assinada e do botão de
 * baixar. Agora a quantidade e o tipo vêm da categoria, e as abas se
 * montam a partir do que o trabalho ENTREGOU.
 *
 * O estado (qual aba está aberta, a URL assinada) mora em
 * `useAnexoAtivo`, em src/hooks — um .tsx só pode exportar componentes,
 * senão o lint acusa `react-refresh/only-export-components`.
 *
 * ⚠ São TRÊS peças e não um componente só de propósito: as duas telas têm
 * layouts incompatíveis. Na do revisor o visor ocupa uma coluna inteira do
 * grid e `PdfViewer` se posiciona por `inset: 0` dentro de `.pdf-viewer`,
 * então qualquer barra de abas colocada ali dentro ficaria COBERTA pelo
 * canvas (z-index 5). As abas têm de morar fora do visor, e cada tela as
 * põe onde cabe. O que é compartilhado — estado, URL assinada, escolha do
 * visualizador, estados vazios — está todo aqui.
 */

/**
 * A barra de abas. Some quando há um anexo só — uma aba sozinha não é
 * escolha, é ruído — e quando não há nenhum.
 */
export function AbasDeAnexos({
  anexos,
  indice,
  onEscolher,
}: {
  anexos: AnexoDoTrabalho[];
  indice: number;
  onEscolher: (i: number) => void;
}) {
  if (anexos.length < 2) return null;

  return (
    <div className="anexo-tabs" role="tablist" aria-label="Anexos do trabalho">
      {anexos.map((anexo, i) => (
        <label className="anexo-tab" key={anexo.id}>
          <input
            type="radio"
            name="anexo-ativo"
            checked={i === indice}
            onChange={() => onEscolher(i)}
          />
          <span className="anexo-tab-text">{anexo.titulo}</span>
        </label>
      ))}
    </div>
  );
}

/** Baixa o PDF de fato, em vez de deixar o navegador decidir se abre. */
async function baixarPdf(url: string, nome: string) {
  try {
    const resp = await fetch(url);
    const blob = await resp.blob();
    const obj = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = obj;
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(obj);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

/** Baixar / abrir em nova aba — o que faz sentido para o anexo aberto. */
export function AcoesDoAnexo({
  anexo,
  url,
  nomeBase,
}: {
  anexo: AnexoDoTrabalho | null;
  url: string | null;
  /** Título do trabalho, para nomear o arquivo baixado. */
  nomeBase?: string;
}) {
  if (!anexo) return null;

  if (anexo.tipo === "video") {
    return (
      <a className="btn btn-outline btn-sm" href={anexo.valor} target="_blank" rel="noopener noreferrer">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        ABRIR NO YOUTUBE
      </a>
    );
  }

  if (!url) return null;

  const nome = `${(nomeBase || anexo.titulo || "trabalho").replace(/[^a-zA-Z0-9._-]+/g, "_")}.pdf`;
  return (
    <span style={{ display: "inline-flex", gap: "var(--space-2)" }}>
      <button type="button" className="btn btn-primary btn-sm" onClick={() => baixarPdf(url, nome)}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        BAIXAR PDF
      </button>
      <a className="btn btn-outline btn-sm" href={url} target="_blank" rel="noopener noreferrer">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        ABRIR EM NOVA ABA
      </a>
    </span>
  );
}

function Aviso({ titulo, descricao, icone }: { titulo: string; descricao: string; icone: JSX.Element }) {
  return (
    <>
      {icone}
      <div className="pdf-viewer-filename">{titulo}</div>
      <div className="pdf-viewer-description">{descricao}</div>
    </>
  );
}

const ICONE_PDF = (
  <svg className="pdf-viewer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 64, height: 64, color: "var(--gray-400)" }}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
  </svg>
);

/**
 * O conteúdo de dentro de `.pdf-viewer`.
 *
 * Quem desenha o contêiner é a página — na do revisor ele é uma coluna do
 * grid, na do co-chair um bloco dentro de um Card —, mas o contrato de
 * layout é o mesmo nas duas: `position: relative`, com `PdfViewer` e
 * `VideoViewer` se posicionando por `inset: 0`.
 */
export function CorpoDoAnexo({
  anexo,
  url,
  vazio,
}: {
  anexo: AnexoDoTrabalho | null;
  url: string | null;
  /** Frase para quando o trabalho não entregou anexo nenhum. */
  vazio?: string;
}) {
  if (!anexo) {
    return (
      <Aviso
        icone={ICONE_PDF}
        titulo="NENHUM ANEXO"
        descricao={vazio ?? "A categoria deste trabalho não exigia arquivo nem vídeo."}
      />
    );
  }

  if (anexo.tipo === "video") {
    return <VideoViewer url={anexo.valor} />;
  }

  if (!url) {
    return (
      <Aviso
        icone={ICONE_PDF}
        titulo="PDF NÃO DISPONÍVEL"
        descricao="Não foi possível abrir este arquivo. Ele pode ter sido removido do armazenamento."
      />
    );
  }

  return <PdfViewer url={url} />;
}
