import { describe, expect, it } from "vitest";
import { idDoVideo, urlDeEmbed } from "@/lib/youtube";

/**
 * O link do vídeo é campo obrigatório da submissão, e a mesma função
 * decide se o formulário aceita e se o player do revisor consegue tocar.
 * Se as duas coisas divergissem, o autor conseguiria enviar um endereço
 * que a tela de avaliação não abre.
 */
describe("idDoVideo", () => {
  const ID = "dQw4w9WgXcQ";

  it("aceita os formatos que as pessoas colam", () => {
    expect(idDoVideo(`https://www.youtube.com/watch?v=${ID}`)).toBe(ID);
    expect(idDoVideo(`https://youtube.com/watch?v=${ID}`)).toBe(ID);
    expect(idDoVideo(`https://m.youtube.com/watch?v=${ID}`)).toBe(ID);
    expect(idDoVideo(`https://youtu.be/${ID}`)).toBe(ID);
    expect(idDoVideo(`https://www.youtube.com/embed/${ID}`)).toBe(ID);
    expect(idDoVideo(`https://www.youtube.com/shorts/${ID}`)).toBe(ID);
    expect(idDoVideo(`https://www.youtube.com/live/${ID}`)).toBe(ID);
  });

  it("ignora os parâmetros extras que vêm do botão Compartilhar", () => {
    expect(idDoVideo(`https://youtu.be/${ID}?si=AbCdEfGhIjKl`)).toBe(ID);
    expect(idDoVideo(`https://www.youtube.com/watch?v=${ID}&t=42s`)).toBe(ID);
    // O v= nem sempre é o primeiro parâmetro (playlists, por exemplo).
    expect(idDoVideo(`https://www.youtube.com/watch?list=PL123&v=${ID}`)).toBe(ID);
  });

  it("tolera espaços em volta", () => {
    expect(idDoVideo(`  https://youtu.be/${ID}  `)).toBe(ID);
  });

  it("recusa o que não é vídeo do YouTube", () => {
    expect(idDoVideo("https://vimeo.com/123456789")).toBeNull();
    expect(idDoVideo("https://www.youtube.com/@algumcanal")).toBeNull();
    expect(idDoVideo("nem é uma url")).toBeNull();
    expect(idDoVideo("")).toBeNull();
    expect(idDoVideo(null)).toBeNull();
    expect(idDoVideo(undefined)).toBeNull();
  });

  it("recusa id de tamanho errado", () => {
    expect(idDoVideo("https://youtu.be/curto")).toBeNull();
  });
});

describe("urlDeEmbed", () => {
  it("monta o endereço sem cookies a partir de qualquer formato aceito", () => {
    expect(urlDeEmbed("https://youtu.be/dQw4w9WgXcQ")).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0",
    );
  });

  it("devolve null quando o link não vale", () => {
    expect(urlDeEmbed("https://exemplo.com/video.mp4")).toBeNull();
  });
});
