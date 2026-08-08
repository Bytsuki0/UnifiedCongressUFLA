import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

/**
 * Perfil do participante (`profiles`) e a foto no bucket `avatars`.
 *
 * A policy `profiles select` restringe a leitura ao próprio usuário e à
 * organização; o upsert exige `id = auth.uid()`. Por isso nenhuma função
 * aqui aceita "o perfil de outra pessoa" como parâmetro casual — o id
 * vem sempre da sessão de quem chama.
 */

export type Perfil = Tables<"profiles">;

const BUCKET_AVATARES = "avatars";
const TTL_AVATAR_SEGUNDOS = 3600;

export async function obterPerfil(userId: string): Promise<Perfil | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Dados do cadastro real da conta, sejam eles de qual tabela forem. */
export type DadosDaConta = {
  nome: string;
  curso: string;
  instituicao: string;
  tipo: string;
};

/**
 * Procura a conta em estudantes -> professores -> avaliadores, nesta
 * ordem, e devolve a primeira que casar pelo e-mail.
 *
 * São três tabelas separadas por herança do cadastro antigo; a ordem
 * importa porque uma mesma pessoa pode constar em mais de uma (um
 * professor promovido a avaliador, por exemplo) e o cadastro de origem é
 * o que descreve melhor o vínculo.
 */
export async function obterDadosDaConta(email: string): Promise<DadosDaConta | null> {
  const estudante = await supabase
    .from("estudantes")
    .select("nome, email, curso")
    .eq("email", email)
    .maybeSingle();
  if (estudante.data) {
    return {
      nome: estudante.data.nome,
      curso: estudante.data.curso ?? "",
      instituicao: "UFLA",
      tipo: "Estudante",
    };
  }

  const professor = await supabase
    .from("professores")
    .select("nome, email, departamento")
    .eq("email", email)
    .maybeSingle();
  if (professor.data) {
    return {
      nome: professor.data.nome,
      curso: professor.data.departamento ?? "",
      instituicao: "UFLA",
      tipo: "Professor",
    };
  }

  const avaliador = await supabase
    .from("avaliadores")
    .select("nome, email, instituicao")
    .eq("email", email)
    .maybeSingle();
  if (avaliador.data) {
    return {
      nome: avaliador.data.nome,
      curso: "",
      instituicao: avaliador.data.instituicao ?? "",
      tipo: "Avaliador",
    };
  }

  return null;
}

export type SalvarPerfilInput = {
  userId: string;
  email: string | null;
  nome: string;
  curso: string;
  telefone: string;
  instituicao: string;
};

/**
 * Grava o perfil. É upsert porque a linha pode não existir ainda: o
 * cadastro cria a conta no Auth, e `profiles` só ganha linha quando a
 * pessoa abre esta tela pela primeira vez.
 */
export async function salvarPerfil(input: SalvarPerfilInput): Promise<void> {
  const { error } = await supabase.from("profiles").upsert(
    {
      id: input.userId,
      email: input.email,
      nome: input.nome,
      curso: input.curso,
      telefone: input.telefone,
      instituicao: input.instituicao,
    },
    { onConflict: "id" },
  );
  if (error) throw error;
}

/** URL temporária da foto de perfil — o bucket de avatares é privado. */
export async function urlAssinadaDoAvatar(caminho: string): Promise<string | null> {
  const { data } = await supabase.storage
    .from(BUCKET_AVATARES)
    .createSignedUrl(caminho, TTL_AVATAR_SEGUNDOS);
  return data?.signedUrl ?? null;
}

/**
 * Sobe a foto na pasta do próprio usuário e aponta o perfil para ela.
 * O caminho carrega timestamp para o navegador não servir a foto antiga
 * do cache depois da troca.
 */
export async function enviarAvatar(
  userId: string,
  email: string | null,
  nome: string,
  arquivo: File,
): Promise<void> {
  const extensao = arquivo.name.split(".").pop();
  const caminho = `${userId}/avatar-${Date.now()}.${extensao}`;

  const { error: erroUpload } = await supabase.storage
    .from(BUCKET_AVATARES)
    .upload(caminho, arquivo, { upsert: true });
  if (erroUpload) throw erroUpload;

  const { error } = await supabase.from("profiles").upsert(
    { id: userId, email, nome: nome || (email ?? ""), foto_perfil: caminho },
    { onConflict: "id" },
  );
  if (error) throw error;
}
