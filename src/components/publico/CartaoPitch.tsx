import { useState } from "react";
import { urlDaMiniatura, urlDeEmbed } from "@/lib/youtube";
import type { Pitch } from "@/services/pitchesService";

/**
 * Um vídeo da vitrine de pitches.
 *
 * ⚠ O cartão nasce como MINIATURA e só vira `<iframe>` quando alguém
 * clica ("lite embed"). É a diferença entre uma página com doze imagens
 * e uma página com doze players do YouTube carregando scripts e cookies
 * de terceiro antes de o visitante ter pedido vídeo nenhum. O `play`
 * dado fica no estado do cartão: quem já abriu um vídeo continua com ele
 * aberto enquanto navega pela mesma página.
 *
 * O cartão serve às duas origens da vitrine, e é por isso que ele mostra
 * linhas condicionais em vez de campos fixos: o trabalho aprovado traz
 * autores e categoria, o vídeo de acervo traz descrição e edição, e
 * nenhum dos dois traz os quatro. Campo vazio SOME — reservar espaço
 * para o que não existe faz metade dos cartões parecer meio carregada.
 */
export function CartaoPitch({ pitch }: { pitch: Pitch }) {
  const [tocando, setTocando] = useState(false);

  const embed = urlDeEmbed(pitch.video_url);
  const miniatura = urlDaMiniatura(pitch.video_url);

  // Link que o banco aceitou (é do domínio do YouTube) mas de que não sai
  // um id de vídeo — um link de canal ou de playlist, por exemplo. O
  // cartão não some: quem cadastrou precisa ver que está no ar e errado,
  // e o visitante ainda pode abrir o endereço.
  if (!embed || !miniatura) {
    return (
      <article className="pitch-card">
        <div className="pitch-thumb pitch-thumb-vazia">
          <span>Link de vídeo não reconhecido</span>
          <a className="btn btn-outline btn-sm" href={pitch.video_url} target="_blank" rel="noopener noreferrer">
            ABRIR EM NOVA ABA
          </a>
        </div>
        <CorpoDoCartao pitch={pitch} />
      </article>
    );
  }

  return (
    <article className="pitch-card">
      <div className="pitch-thumb">
        {tocando ? (
          // `autoplay` porque o clique JÁ foi o pedido de reprodução —
          // sem ele a pessoa clica duas vezes, uma para trocar a
          // miniatura pelo player e outra no play do próprio YouTube.
          <iframe
            src={`${embed}&autoplay=1`}
            title={pitch.titulo}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
            className="pitch-iframe"
          />
        ) : (
          <button
            type="button"
            className="pitch-play"
            onClick={() => setTocando(true)}
            aria-label={`Assistir: ${pitch.titulo}`}
          >
            {/* `loading="lazy"`: numa página de doze cartões, as últimas
                linhas só baixam a imagem quando chegam perto da tela. */}
            <img src={miniatura} alt="" loading="lazy" className="pitch-img" />
            <span className="pitch-play-icone" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            </span>
          </button>
        )}
      </div>
      <CorpoDoCartao pitch={pitch} />
    </article>
  );
}

/** Título e as linhas de apoio que existirem para esta origem. */
function CorpoDoCartao({ pitch }: { pitch: Pitch }) {
  return (
    <div className="pitch-corpo">
      <div className="pitch-selos">
        {/* A categoria (BIC Jr., Extensão...) só existe no trabalho
            aprovado; a edição, só no acervo. Um cartão nunca tem os dois. */}
        {pitch.categoria && <span className="pitch-selo">{pitch.categoria}</span>}
        {pitch.edicao && <span className="pitch-selo pitch-selo-arquivo">{pitch.edicao}</span>}
      </div>
      <h3 className="pitch-titulo">{pitch.titulo}</h3>
      {pitch.autores && <p className="pitch-autores">{pitch.autores}</p>}
      {pitch.descricao && <p className="pitch-desc">{pitch.descricao}</p>}
    </div>
  );
}

export default CartaoPitch;
