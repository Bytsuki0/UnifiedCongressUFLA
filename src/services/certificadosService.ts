import { supabase } from "@/integrations/supabase/client";
import {
  desenharCertificado,
  familiaDaFonte,
  type Caixa,
  type Modelo,
  type Uso,
  type Variaveis,
} from "@/lib/certificados";

/**
 * Certificados (migration 20261111120000).
 *
 * O modelo (PNG + caixas) fica no banco e no bucket privado `certificados`;
 * o certificado de cada pessoa é desenhado AQUI, no navegador, na hora do
 * download — nada gerado é guardado. A prévia da organização e o arquivo
 * final passam pelo mesmo `desenharCertificado`.
 *
 * Quem recebe o quê, e se já está liberado, é do servidor
 * (`meus_certificados`, `previa_certificados`). `publicado_em` e
 * `liberado_em` não são graváveis pela API: só pelas RPCs.
 *
 * Mesma dupla de políticas de erro das outras telas: a leitura do portal
 * (`carregarMeusCertificados`) falha VAZIA; as da tela de gestão PROPAGAM.
 */

const BUCKET = "certificados";
const URL_ASSINADA_SEGUNDOS = 60 * 60;

/** O `file_size_limit` do bucket. */
export const MAX_ARQUIVO_BYTES = 20 * 1024 * 1024;

/** Extensões de fonte aceitas, com o tipo que o bucket exige. */
const TIPOS_FONTE: Record<string, string> = {
  ttf: "font/ttf",
  otf: "font/otf",
  woff2: "font/woff2",
};

export type ModeloGravado = Modelo & {
  uso: Uso;
  imagem: string;
  publicado_em: string | null;
  liberado_em: string | null;
};

export type Destinatario = { chave: string; variaveis: Variaveis };
export type MeuCertificado = Destinatario & { uso: Uso; imagem: string; modelo: Modelo };

// ------------------------------------------------------------
// Modelos (tela de gestão — erro PROPAGA)
// ------------------------------------------------------------

export async function listarModelos(): Promise<Partial<Record<Uso, ModeloGravado>>> {
  const { data, error } = await supabase.from("certificado_modelos").select("*");
  if (error) throw new Error(error.message);
  const porUso: Partial<Record<Uso, ModeloGravado>> = {};
  for (const m of data ?? []) {
    porUso[m.uso as Uso] = { ...m, uso: m.uso as Uso, caixas: (m.caixas ?? []) as Caixa[] };
  }
  return porUso;
}

/**
 * Grava a arte e as caixas de um uso.
 *
 * ⚠ INSERT ou UPDATE, nunca `upsert`: o upsert do PostgREST põe a chave
 * (`uso`) no SET, e o grant de UPDATE da tabela é por coluna — de propósito,
 * para `publicado_em`/`liberado_em` só mudarem pelas RPCs.
 */
export async function salvarModelo(
  uso: Uso,
  valores: { imagem: string; largura: number; altura: number; caixas: Caixa[] },
  existe: boolean,
): Promise<void> {
  const { error } = existe
    ? await supabase
        .from("certificado_modelos")
        .update({ ...valores, atualizado_em: new Date().toISOString() })
        .eq("uso", uso)
    : await supabase.from("certificado_modelos").insert({ uso, ...valores });
  if (error) throw new Error(error.message);
}

/** Sobe o PNG do modelo e devolve o caminho. Nome novo a cada envio. */
export async function enviarImagemModelo(uso: Uso, arquivo: File): Promise<string> {
  if (arquivo.type !== "image/png") throw new Error("O modelo precisa ser um arquivo PNG.");
  if (arquivo.size > MAX_ARQUIVO_BYTES) throw new Error("O arquivo passa de 20 MB.");
  const caminho = `modelos/${uso}-${Date.now()}.png`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(caminho, arquivo, { contentType: "image/png", upsert: false });
  if (error) throw new Error("Não foi possível enviar o modelo.");
  return caminho;
}

/** Best-effort: o registro já está certo, falhar só deixa um arquivo órfão. */
export async function descartarArquivo(caminho: string): Promise<void> {
  if (!caminho) return;
  await supabase.storage.from(BUCKET).remove([caminho]).catch(() => {});
}

export async function publicarCertificado(uso: Uso): Promise<void> {
  const { error } = await supabase.rpc("publicar_certificado", { _uso: uso });
  if (error) throw new Error(error.message);
}

export async function despublicarCertificado(uso: Uso): Promise<void> {
  const { error } = await supabase.rpc("despublicar_certificado", { _uso: uso });
  if (error) throw new Error(error.message);
}

/** Substitui o pódio pelo top 3 atual de cada categoria. Devolve quantos entraram. */
export async function congelarPodio(): Promise<number> {
  const { data, error } = await supabase.rpc("congelar_podio");
  if (error) throw new Error(error.message);
  return data ?? 0;
}

/** Quando o pódio foi congelado pela última vez; `null` = nunca. */
export async function podioCongeladoEm(): Promise<string | null> {
  const { data, error } = await supabase
    .from("certificado_podio")
    .select("congelado_em")
    .order("congelado_em", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return data?.[0]?.congelado_em ?? null;
}

/** A data de liberação já passou? Do SERVIDOR — relógio de navegador não decide. */
export async function dataDosCertificadosChegou(): Promise<boolean> {
  const { data, error } = await supabase.rpc("certificados_data_chegou");
  if (error) throw new Error(error.message);
  return data === true;
}

/** Todos os destinatários de um uso, publicado ou não — a prévia. */
export async function previaCertificados(uso: Uso): Promise<Destinatario[]> {
  const { data, error } = await supabase.rpc("previa_certificados", { _uso: uso });
  if (error) throw new Error(error.message);
  return (data ?? []) as Destinatario[];
}

// ------------------------------------------------------------
// Fontes — sem tabela: a lista é a pasta `fontes/` do bucket
// ------------------------------------------------------------

export async function listarFontes(): Promise<string[]> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .list("fontes", { limit: 200, sortBy: { column: "name", order: "asc" } });
  if (error) throw new Error(error.message);
  return (data ?? []).filter((o) => o.id).map((o) => `fontes/${o.name}`);
}

export async function enviarFonte(arquivo: File): Promise<string> {
  const ext = arquivo.name.split(".").pop()?.toLowerCase() ?? "";
  const tipo = TIPOS_FONTE[ext];
  if (!tipo) throw new Error("Envie uma fonte .ttf, .otf ou .woff2.");
  // O nome do arquivo vira o nome da família; só caracteres que o Storage aceita.
  const base = arquivo.name.slice(0, -(ext.length + 1)).replace(/[^a-zA-Z0-9_-]+/g, "-");
  const caminho = `fontes/${base || "fonte"}.${ext}`;
  // ⚠ O tipo vai no próprio Blob: para File/Blob o storage-js IGNORA a opção
  // `contentType` e manda o `type` do arquivo — que o Windows entrega vazio
  // para .ttf/.otf, e o `allowed_mime_types` do bucket recusa.
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(caminho, new Blob([arquivo], { type: tipo }), { contentType: tipo, upsert: false });
  if (error) {
    throw new Error(
      /exists|duplicate/i.test(error.message)
        ? "Já existe uma fonte com esse nome."
        : `Não foi possível enviar a fonte (${error.message}).`,
    );
  }
  return caminho;
}

// ------------------------------------------------------------
// Desenho
// ------------------------------------------------------------

async function assinar(caminho: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(caminho, URL_ASSINADA_SEGUNDOS);
  if (error || !data?.signedUrl) throw new Error("Não foi possível carregar o arquivo do certificado.");
  return data.signedUrl;
}

const imagens = new Map<string, Promise<HTMLImageElement>>();

/** A imagem do modelo, pronta para o canvas. Uma carga por caminho. */
export function carregarImagem(caminho: string): Promise<HTMLImageElement> {
  let p = imagens.get(caminho);
  if (!p) {
    p = assinar(caminho).then(
      (url) =>
        new Promise<HTMLImageElement>((ok, falha) => {
          const img = new Image();
          // Sem isto o canvas fica "sujo" e o toBlob do download é recusado.
          img.crossOrigin = "anonymous";
          img.onload = () => ok(img);
          img.onerror = () => falha(new Error("Não foi possível carregar a imagem do modelo."));
          img.src = url;
        }),
    );
    p.catch(() => imagens.delete(caminho));
    imagens.set(caminho, p);
  }
  return p;
}

const fontes = new Map<string, Promise<void>>();

/**
 * Carrega as fontes ENVIADAS que as caixas usam. Canvas não espera fonte:
 * desenhar antes disso sairia com a de reserva. Falha de uma fonte não
 * impede o desenho — o texto sai na de reserva, e a prévia mostra.
 */
export async function carregarFontes(caixas: Caixa[]): Promise<void> {
  const enviadas = [...new Set(caixas.map((c) => c.fonte).filter((f) => f.startsWith("fontes/")))];
  await Promise.all(
    enviadas.map((caminho) => {
      let p = fontes.get(caminho);
      if (!p) {
        p = assinar(caminho)
          .then((url) => new FontFace(familiaDaFonte(caminho), `url(${JSON.stringify(url)})`).load())
          .then((face) => {
            document.fonts.add(face);
          });
        p.catch(() => fontes.delete(caminho));
        fontes.set(caminho, p);
      }
      return p.catch(() => {});
    }),
  );
}

/**
 * Desenha um certificado num canvas. `largura` reduz proporcionalmente (a
 * prévia); sem ela sai no tamanho do modelo (o download).
 */
export async function desenharEm(
  canvas: HTMLCanvasElement,
  modelo: Modelo,
  imagem: string,
  variaveis: Variaveis,
  largura = modelo.largura,
): Promise<void> {
  const [img] = await Promise.all([carregarImagem(imagem), carregarFontes(modelo.caixas)]);
  canvas.width = largura;
  canvas.height = Math.round((largura * modelo.altura) / modelo.largura);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("O navegador não permitiu desenhar o certificado.");
  desenharCertificado(ctx, modelo, img, variaveis, canvas.width, canvas.height);
}

/** Gera o PNG no tamanho do modelo e o entrega como download. */
export async function baixarCertificado(
  modelo: Modelo,
  imagem: string,
  variaveis: Variaveis,
  nome: string,
): Promise<void> {
  const canvas = document.createElement("canvas");
  await desenharEm(canvas, modelo, imagem, variaveis);
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/png"));
  if (!blob) throw new Error("Não foi possível gerar o certificado.");
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}

// ------------------------------------------------------------
// Portal — falha VAZIA
// ------------------------------------------------------------

/** Os certificados liberados de quem chama. Falha devolve lista vazia. */
export async function carregarMeusCertificados(): Promise<MeuCertificado[]> {
  const { data, error } = await supabase.rpc("meus_certificados");
  if (error) return [];
  return (data ?? []).map((c) => ({
    uso: c.uso as Uso,
    chave: c.chave,
    variaveis: (c.variaveis ?? {}) as Variaveis,
    imagem: c.imagem,
    modelo: { largura: c.largura, altura: c.altura, caixas: (c.caixas ?? []) as Caixa[] },
  }));
}
