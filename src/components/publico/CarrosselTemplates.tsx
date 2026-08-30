import { useCallback, useEffect, useRef, useState } from "react";
import { BotaoBaixar } from "@/components/BotaoBaixar";
import type { ArquivoDownload } from "@/services/configuracoesService";

/** Cores dos ícones, cicladas — a lista de arquivos não tem mais tamanho fixo. */
const CORES = ["blue-800", "blue-700", "blue-600", "blue-500"];

/**
 * Os arquivos publicados, na landing, dentro de um carrossel.
 *
 * A grade antiga era `repeat(4, 1fr)` e a lista tinha exatamente quatro
 * itens, fixos no código. Agora a organização acrescenta e remove
 * arquivos em /admin/configuracoes: com cinco, a grade quebrava a
 * seção em duas fileiras desalinhadas; com um, deixava três buracos.
 * O carrossel mostra quantos couberem e guarda o resto, seja qual for o
 * número.
 *
 * A rolagem é do próprio navegador (`overflow-x` + `scroll-snap`), não
 * uma posição calculada em estado: assim o gesto de arrastar no celular
 * e a roda horizontal do trackpad continuam funcionando de graça, e as
 * setas são só um atalho. Elas somem quando tudo já cabe na tela — o
 * caso comum de quem publicou três ou quatro arquivos.
 */
export function CarrosselTemplates({ arquivos }: { arquivos: ArquivoDownload[] }) {
  const trilho = useRef<HTMLDivElement>(null);
  const [posicao, setPosicao] = useState({ transbordou: false, inicio: true, fim: false });

  const medir = useCallback(() => {
    const el = trilho.current;
    if (!el) return;
    // 1px de folga: `scrollWidth`/`clientWidth` são arredondados e um
    // trilho que cabe justo se declararia transbordado sem isso.
    const transbordou = el.scrollWidth > el.clientWidth + 1;
    setPosicao({
      transbordou,
      inicio: el.scrollLeft <= 1,
      fim: el.scrollLeft >= el.scrollWidth - el.clientWidth - 1,
    });
  }, []);

  useEffect(() => {
    const el = trilho.current;
    if (!el) return;
    medir();
    el.addEventListener("scroll", medir, { passive: true });
    // Quantos cartões cabem muda com a largura da janela (a CSS troca de
    // 4 para 2 e para 1), e com ela muda se as setas fazem sentido.
    const observer = new ResizeObserver(medir);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", medir);
      observer.disconnect();
    };
  }, [medir, arquivos]);

  const paginar = (direcao: 1 | -1) => {
    const el = trilho.current;
    if (!el) return;
    el.scrollBy({ left: direcao * el.clientWidth, behavior: "smooth" });
  };

  if (arquivos.length === 0) return null;

  return (
    <div className="carrossel">
      {posicao.transbordou && (
        <div className="carrossel-controles">
          <button
            type="button"
            className="carrossel-seta"
            onClick={() => paginar(-1)}
            disabled={posicao.inicio}
            aria-label="Ver arquivos anteriores"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6"/>
            </svg>
          </button>
          <button
            type="button"
            className="carrossel-seta"
            onClick={() => paginar(1)}
            disabled={posicao.fim}
            aria-label="Ver mais arquivos"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m9 18 6-6-6-6"/>
            </svg>
          </button>
        </div>
      )}

      <div className="carrossel-trilho" ref={trilho}>
        {arquivos.map((a, i) => (
          <div className="template-card" key={a.id}>
            <div className={`template-icon ${CORES[i % CORES.length]}`}>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
            </div>
            {/* O selo do formato é opcional: sem ele o espaço não fica
                reservado, senão todo cartão sem formato ganharia uma
                faixa vazia acima do nome. */}
            {a.formato && (
              <div className="template-type" style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                <span className="template-ext">{a.formato}</span>
              </div>
            )}
            <div className="template-name">{a.titulo}</div>
            <BotaoBaixar url={a.url} className="btn btn-primary btn-sm">BAIXAR</BotaoBaixar>
          </div>
        ))}
      </div>
    </div>
  );
}
