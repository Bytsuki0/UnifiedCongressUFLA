import type { LinksDownloads } from "@/services/configuracoesService";

/**
 * Os arquivos que a organização disponibiliza para download.
 *
 * A lista mora aqui, e não em cada página, porque os mesmos modelos do
 * estudante aparecem em três telas (landing, /login e
 * /estudante/templates) e antes divergiam: a landing oferecia um modelo
 * de Keynote, o /login um "resumo expandido" que ninguém mais citava, e
 * os três discordavam do tamanho do mesmo arquivo (245 KB contra 412 KB).
 * Eram números inventados — nenhum arquivo existia. Por isso o item aqui
 * não tem tamanho: quem hospeda é o Drive, e o peso só apareceria certo
 * se viesse de lá.
 *
 * `chave` é o campo de `configuracoes` onde o admin cola o link; é o que
 * amarra o item ao que a RPC `links_downloads()` devolve.
 */
export type ItemDownload = {
  chave: keyof LinksDownloads;
  nome: string;
  /** Selo do formato, para o usuário saber o que vem antes de clicar. */
  ext: string;
  /** Só o painel do revisor mostra descrição. */
  desc?: string;
};

/** Modelos e normas para quem vai submeter (landing, /login, /estudante/templates). */
export const DOWNLOADS_ESTUDANTE: ItemDownload[] = [
  { chave: "link_template_word", nome: "Modelo de artigo · Word", ext: ".DOCX" },
  { chave: "link_template_latex", nome: "Modelo de artigo · LaTeX", ext: ".TEX" },
  { chave: "link_template_slides", nome: "Modelo dos slides", ext: ".PPTX" },
  { chave: "link_normas_formatacao", nome: "Normas de formatação", ext: ".PDF" },
];

/** Documentos do /revisor/arquivo — outro acervo, mantido como estava. */
export const DOWNLOADS_REVISOR: ItemDownload[] = [
  {
    chave: "link_edital_congresso",
    nome: "Edital do Congresso 2026",
    ext: "PDF",
    desc: "Regulamento completo e normas",
  },
  {
    chave: "link_manual_revisor",
    nome: "Manual do Revisor",
    ext: "PDF",
    desc: "Orientações para avaliação duplo-cega",
  },
  {
    chave: "link_diretrizes_avaliacao",
    nome: "Diretrizes de Avaliação",
    ext: "PDF",
    desc: "Critérios e pontuações por categoria",
  },
  {
    chave: "link_codigo_etica",
    nome: "Código de Ética",
    ext: "PDF",
    desc: "Normas de conduta e conflitos de interesse",
  },
];
