/**
 * Link do YouTube: extração do id e montagem da URL de incorporação.
 *
 * Funções puras, sem dependência de rede — o mesmo par serve para
 * validar o campo no formulário de submissão e para alimentar o player
 * na tela do revisor, sem que as duas divirjam sobre o que é um link
 * aceitável.
 *
 * Os formatos cobertos são os que as pessoas de fato colam da barra de
 * endereços ou do botão "Compartilhar": watch, youtu.be, embed, shorts
 * e live. Parâmetros extras (`&t=`, `?si=`, `?feature=`) são ignorados.
 */

// O id de um vídeo do YouTube tem exatamente 11 caracteres de
// [A-Za-z0-9_-]. Ancorar no tamanho é o que impede que um pedaço de
// caminho qualquer passe por id.
const ID = "([A-Za-z0-9_-]{11})";

const PADROES: RegExp[] = [
  // https://www.youtube.com/watch?v=ID  (o v= pode não ser o 1º parâmetro)
  new RegExp(`(?:youtube\\.com|youtube-nocookie\\.com)/watch\\?(?:[^#]*&)?v=${ID}`, "i"),
  // https://youtu.be/ID
  new RegExp(`youtu\\.be/${ID}`, "i"),
  // https://www.youtube.com/{embed,shorts,live,v}/ID
  new RegExp(`(?:youtube\\.com|youtube-nocookie\\.com)/(?:embed|shorts|live|v)/${ID}`, "i"),
];

/** Id do vídeo, ou null quando a URL não é um link de vídeo do YouTube. */
export function idDoVideo(url: string | null | undefined): string | null {
  const bruto = (url ?? "").trim();
  if (!bruto) return null;
  for (const padrao of PADROES) {
    const m = bruto.match(padrao);
    if (m) return m[1];
  }
  return null;
}

/**
 * URL de incorporação para o `<iframe>`, ou null quando o link não vale.
 *
 * Usa o domínio `youtube-nocookie.com`: mesmo player, sem os cookies de
 * rastreamento antes de o revisor dar play. `rel=0` limita as sugestões
 * do fim do vídeo ao próprio canal.
 */
export function urlDeEmbed(url: string | null | undefined): string | null {
  const id = idDoVideo(url);
  return id ? `https://www.youtube-nocookie.com/embed/${id}?rel=0` : null;
}
