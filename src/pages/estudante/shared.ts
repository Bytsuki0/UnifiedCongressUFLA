import { useCallback, useEffect, useState } from "react";
import { listarTrabalhosDoAutorComCategorias } from "@/services/trabalhosService";
import { listarAnexosPorCategoria } from "@/services/categoriasService";
import { carregarPrazoSubmissoes, type PrazoSubmissoes } from "@/services/configuracoesService";
import { useAuth } from "@/contexts/AuthContext";
import type { AnexoDaCategoria } from "@/lib/anexos";

// Tipos e helpers compartilhados pelas páginas do Portal do Estudante.

export type Coautor = { nome?: string; email?: string };

export type Submission = {
  id: string;
  owner_id?: string | null;
  titulo: string;
  /**
   * Texto do resumo. Opcional desde 20260819120000: o formulário não o
   * pede mais (o resumo vive no PDF), mas as submissões antigas ainda
   * têm o conteúdo gravado.
   */
  resumo?: string | null;
  palavras_chave?: string[] | null;
  autores: string;
  categoria_id: string | null;
  status: string;
  data_submissao: string;
  created_at: string;
  orientador_email?: string | null;
  coautores?: Coautor[] | null;
  correcoes_enviadas_em?: string | null;
  /** Rodada corrente de avaliação. Sobe a cada reenvio ("resubmeter"). */
  rodada?: number;
  /** Marca do reenvio. Uma vez gravada, o trabalho não é mais editável. */
  reenviado_em?: string | null;
};

export type Categoria = { id: string; nome: string };

// O bucket de PDFs (privado) e o helper de URL assinada vivem em
// "@/lib/pdfStorage"; o limite de tamanho, em "@/lib/anexos" (é lá que a
// validação dos anexos o aplica).
export { MAX_PDF_BYTES } from "@/lib/anexos";

export const statusLabel: Record<string, string> = {
  pendente: "Recebido",
  em_avaliacao: "Em Avaliação",
  aguardando_parecer_editorial: "Em análise final",
  aprovado_correcoes: "Aprovado c/ correções",
  aprovado: "Aprovado",
  reprovado: "Reprovado",
  resubmeter: "Reenvio solicitado",
};

/** Status em que o autor deve reenviar o trabalho corrigido. */
export const AGUARDANDO_CORRECAO = "aprovado_correcoes";

/** Status em que o trabalho ainda não entrou em avaliação. */
export const PENDENTE = "pendente";

/** Status em que o trabalho está com os revisores. */
export const EM_AVALIACAO = "em_avaliacao";

/**
 * Os 3 pareceres entraram e a decisão está com a organização.
 *
 * ⚠ Para o AUTOR isto é indistinguível de "em avaliação", e tem de
 * continuar sendo: revelar que os pareceres já saíram convida a perguntar
 * o resultado antes de haver resultado. Quem decide é o co-chair, em
 * /co-chairs/parecer-editorial.
 */
export const AGUARDANDO_EDITORIAL = "aguardando_parecer_editorial";

/** Status em que o autor deve reenviar o trabalho INTEIRO, uma única vez. */
export const AGUARDANDO_REENVIO = "resubmeter";

/**
 * Desfecho de uma submissão na leitura do AUTOR — é o que decide a cor da
 * etiqueta e da faixa da linha, no mesmo código de cores dos sistemas de
 * submissão (JEMS e afins): azul em andamento, amarelo devolvido para
 * correção, verde aprovado, vermelho reprovado.
 *
 * "ativa" é tudo que ainda NÃO recebeu decisão — `pendente`, `em_avaliacao` e
 * `aguardando_parecer_editorial` juntos, porque para quem submeteu a
 * diferença entre "recebido", "com os revisores" e "com a organização" não
 * muda o que há para fazer (nada, além de esperar).
 * `aprovado_correcoes` fica DE FORA de "ativa" de propósito: já foi julgado,
 * e é justamente o caso que precisa saltar aos olhos com cor própria.
 *
 * `reenvio` é o desfecho mais pesado depois de reprovado: o trabalho volta
 * ao começo. Cor própria, distinta do amarelo da correção — as duas pedem
 * ação do autor, mas uma pede ajuste e a outra pede refazer.
 */
export type Desfecho =
  | "ativa"
  | "correcoes"
  | "reenvio"
  | "aprovada"
  | "reprovada"
  | "outro";

export const desfechoDo = (status: string): Desfecho => {
  if (status === PENDENTE || status === EM_AVALIACAO || status === AGUARDANDO_EDITORIAL) {
    return "ativa";
  }
  if (status === AGUARDANDO_CORRECAO) return "correcoes";
  if (status === AGUARDANDO_REENVIO) return "reenvio";
  if (status === "aprovado") return "aprovada";
  if (status === "reprovado") return "reprovada";
  return "outro";
};

const BADGE_DO_DESFECHO: Record<Desfecho, string> = {
  ativa: "badge badge-blue",
  correcoes: "badge badge-amber",
  reenvio: "badge badge-orange",
  aprovada: "badge badge-green",
  reprovada: "badge badge-red",
  outro: "badge badge-gray",
};

export const statusBadge = (s: string) => BADGE_DO_DESFECHO[desfechoDo(s)];

/** Classe da linha da tabela — a faixa colorida na borda esquerda. */
export const linhaDesfecho = (s: string) => `linha-desfecho linha-${desfechoDo(s)}`;

/** As submissões sem decisão: o único número que a tela ainda mostra. */
export const estaAtiva = (status: string) => desfechoDo(status) === "ativa";

/**
 * Status em que a decisão já está fechada — é quando os pareceres ficam
 * visíveis para o autor. Bate com a regra do servidor
 * (`pareceres_do_meu_trabalho` só revela depois do PARECER EDITORIAL);
 * aqui serve só para decidir se vale a pena oferecer o botão.
 *
 * ⚠ `aguardando_parecer_editorial` NÃO entra, e nunca pode entrar: nesse
 * estado os 3 pareceres existem mas ninguém decidiu ainda. Oferecer o
 * botão mostraria ao autor três vereditos que a organização ainda pode
 * contrariar — o servidor recusa, mas a tela não deve nem convidar.
 */
export const STATUS_COM_PARECER = [
  "aprovado",
  AGUARDANDO_CORRECAO,
  "reprovado",
  AGUARDANDO_REENVIO,
];

/** dd/mm/aaaa a partir do 'aaaa-mm-dd' que o Postgres devolve. */
export const formatarData = (iso: string | null): string =>
  iso ? iso.split("-").reverse().join("/") : "—";

/**
 * Onde estamos na janela de submissão — e o motivo de a janela estar
 * fechada, que é o que a tela precisa dizer.
 *
 * `aberto: false` sozinho não distingue "ainda não abriu" de "já
 * encerrou", e as duas frases são opostas para quem lê: uma manda
 * esperar, a outra diz que acabou. Sem isto as telas mostravam
 * "prazo encerrado" para quem chegou cedo demais.
 *
 * ⚠ A distinção compara `hoje` com `abertura`, DUAS DATAS DO SERVIDOR
 * (a mesma RPC `prazo_submissoes` devolve as duas). O relógio do
 * navegador continua fora da decisão — e nada aqui recalcula `aberto`,
 * que segue vindo pronto de `submissoes_abertas()`.
 *
 * "indefinido" é o "não sei" — prazo ainda carregando ou falha de rede.
 * Nenhuma tela bloqueia por causa dele: quem recusa é o banco.
 */
export type FasePrazo = "indefinido" | "antes" | "aberto" | "encerrado";

export const fasePrazo = (prazo: PrazoSubmissoes | null): FasePrazo => {
  if (!prazo) return "indefinido";
  if (prazo.aberto) return "aberto";
  if (prazo.abertura && prazo.hoje && prazo.hoje < prazo.abertura) return "antes";
  // Fechado sem ser por antecedência: ou passou do encerramento, ou a
  // configuração mudou entre a leitura e agora. Nos dois casos o que o
  // autor pode fazer é o mesmo — não há mais envio.
  return "encerrado";
};

/**
 * Prazo de submissão vigente, do servidor.
 *
 * `aberto` NUNCA é recalculado aqui a partir das datas: o relógio do
 * navegador não decide prazo, e um computador adiantado reabriria a
 * janela na tela. Enquanto carrega, `aberto` fica `null` = "não sei" —
 * as telas tratam isso como "ainda não bloquear", porque quem recusa de
 * verdade é o banco (trigger `protect_trabalhos_fields` e a RPC
 * `editar_submissao`). Esta camada é conveniência, não segurança.
 */
export function usePrazo() {
  const [prazo, setPrazo] = useState<PrazoSubmissoes | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let vivo = true;
    carregarPrazoSubmissoes()
      .then((p) => { if (vivo) setPrazo(p); })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, []);

  return { prazo, carregando, aberto: prazo?.aberto ?? null, fase: fasePrazo(prazo) };
}

/**
 * O que cada categoria EXIGE da submissão, indexado por categoria.
 *
 * As quatro telas do autor precisam disso para montar os campos de
 * anexo. Carrega tudo de uma vez — a tabela tem dezenas de linhas — para
 * que trocar a categoria no formulário não pisque um "carregando" no
 * meio do preenchimento.
 *
 * Falha de rede devolve mapa vazio, e a consequência é benigna: o passo
 * de anexos não aparece e o servidor recusa a submissão incompleta com a
 * frase certa. O contrário — travar o formulário inteiro — seria pior.
 */
export function useExigencias() {
  const [porCategoria, setPorCategoria] = useState<Record<string, AnexoDaCategoria[]>>({});
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let vivo = true;
    listarAnexosPorCategoria()
      .then((mapa) => { if (vivo) setPorCategoria(mapa); })
      .catch(() => { if (vivo) setPorCategoria({}); })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, []);

  const exigenciasDe = useCallback(
    (categoriaId: string | null | undefined): AnexoDaCategoria[] =>
      categoriaId ? (porCategoria[categoriaId] ?? []) : [],
    [porCategoria],
  );

  return { porCategoria, carregando, exigenciasDe };
}

/**
 * Carrega as submissões DO USUÁRIO LOGADO + as categorias.
 *
 * O recorte por dono é explícito de propósito. A RLS de `trabalhos`
 * deixa a organização (admin/avaliador) ler tudo e o revisor ler o que
 * lhe foi atribuído — necessário para /admin, /trabalhos e /revisor.
 * O Portal do Estudante, porém, é sempre "as MINHAS submissões",
 * qualquer que seja o papel de quem entra; sem este filtro um professor
 * enxergava aqui os trabalhos de todo mundo.
 */
export function useTrabalhos() {
  const { user, loading: authLoading } = useAuth();
  const ownerId = user?.id ?? null;
  const [trabalhos, setTrabalhos] = useState<Submission[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const dados = await listarTrabalhosDoAutorComCategorias(ownerId);
      setTrabalhos(
        dados.trabalhos.map((r) => ({
          ...r,
          coautores: Array.isArray(r.coautores) ? (r.coautores as Coautor[]) : [],
        })) as Submission[],
      );
      setCategorias(dados.categorias);
    } finally {
      setLoading(false);
    }
  }, [ownerId]);

  useEffect(() => {
    // Espera a sessão resolver: sem isso a primeira carga rodaria sem
    // dono e a tela piscaria "nenhuma submissão".
    if (authLoading) return;
    reload();
  }, [authLoading, reload]);

  const catNome = (id: string | null) =>
    id ? (categorias.find((c) => c.id === id)?.nome ?? "—") : "—";

  return { trabalhos, categorias, loading, reload, catNome };
}
