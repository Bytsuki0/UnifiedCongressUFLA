import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ClipboardList, Sparkles, Trash2, UserCheck, FileText, ShieldAlert, Users, Mail } from "lucide-react";
import {
  MAX_REVISORES_POR_TRABALHO,
  META_TRABALHOS_POR_REVISOR,
  ResultadoParecer,
  Trabalho,
  TrabalhoRevisor,
} from "@/lib/types";
import {
  associarRevisor,
  carregarPainelAtribuicoes,
  confirmarDistribuicao,
  indexarConflitos,
  MotivoConflito,
  ParDistribuicao,
  ParecerLite,
  recomendarDistribuicao,
  removerRevisor,
  RevisorOption,
  solicitarAvisosAtribuicao,
} from "@/services/revisorService";
import { definirRevisoresPorTrabalho } from "@/services/configuracoesService";
import DialogoDistribuicao from "@/components/co-chairs/DialogoDistribuicao";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const RESULTADO_LABEL: Record<ResultadoParecer, string> = {
  aprovado: "Aprovado",
  aprovado_correcoes: "Aprovado c/ correções",
  nao_aprovado: "Não aprovado",
};
const RESULTADO_VARIANT: Record<ResultadoParecer, "default" | "secondary" | "destructive"> = {
  aprovado: "default",
  aprovado_correcoes: "secondary",
  nao_aprovado: "destructive",
};
const TIPO_LABEL: Record<"avaliador" | "professor", string> = {
  avaliador: "Avaliador",
  professor: "Professor",
};


const MOTIVO_TEXTO: Record<MotivoConflito, string> = {
  autor: "é autor deste trabalho",
  orientador: "é orientador deste trabalho",
  coautor: "é coautor deste trabalho",
};

/** Na fila há mais que isto = o Apps Script, que busca a cada minuto, parou. */
const FILA_PARADA_MS = 5 * 60 * 1000;

const Atribuicoes = () => {
  const [revisorOptions, setRevisorOptions] = useState<RevisorOption[]>([]);
  const [trabalhos, setTrabalhos] = useState<Trabalho[]>([]);
  const [revisores, setRevisores] = useState<TrabalhoRevisor[]>([]);
  const [pareceres, setPareceres] = useState<ParecerLite[]>([]);
  const [conflitos, setConflitos] = useState<Map<string, Map<string, MotivoConflito>>>(new Map());
  const [trabalhoId, setTrabalhoId] = useState<string>("");
  const [revisorEmail, setRevisorEmail] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  // Distribuição em revisão: a proposta e a janela onde ela é editada.
  // `plano` só existe entre o clique em "Recomendar" e o Confirmar/Cancelar.
  const [plano, setPlano] = useState<ParDistribuicao[]>([]);
  const [dialogoAberto, setDialogoAberto] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  // Revisores por trabalho: o que está GRAVADO (é o que o servidor cobra)
  // e a posição do controle, que pode estar à frente dele por um instante.
  const [numeroRevisores, setNumeroRevisores] = useState<number | null>(null);
  const [posicaoControle, setPosicaoControle] = useState<number | null>(null);
  const [gravandoNumero, setGravandoNumero] = useState(false);
  const [enviandoAvisos, setEnviandoAvisos] = useState(false);

  const carregar = async () => {
    setLoading(true);
    try {
      const dados = await carregarPainelAtribuicoes();
      setRevisorOptions(dados.pool);
      setTrabalhos(dados.trabalhos);
      setRevisores(dados.revisores);
      setPareceres(dados.pareceres);
      setConflitos(indexarConflitos(dados.conflitos));
      setNumeroRevisores(dados.revisoresPorTrabalho);
      setPosicaoControle(dados.revisoresPorTrabalho);
    } catch (e) {
      toast.error("Erro ao carregar dados");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregar();
  }, []);

  /*
   * O controle grava sozinho, meio segundo depois de parar de mexer: é um
   * número só, e um botão de salvar ao lado dele deixaria a recomendação
   * rodando sobre um valor diferente do que aparece na tela. O meio
   * segundo é o que impede que arrastar de 3 para 1 grave o 2 no caminho
   * — cada gravação recalcula a fila do parecer editorial inteira.
   * Enquanto grava, o controle trava, para não haver duas no ar.
   */
  useEffect(() => {
    if (posicaoControle === null || posicaoControle === numeroRevisores || gravandoNumero) return;
    const timer = setTimeout(async () => {
      setGravandoNumero(true);
      try {
        const n = await definirRevisoresPorTrabalho(posicaoControle);
        setNumeroRevisores(n);
        toast.success(
          `Agora são ${n} revisor(es) por trabalho. A fila do Parecer Editorial já segue o novo número.`,
        );
      } catch (e) {
        // O controle volta para o que está gravado: deixá-lo na posição
        // recusada mostraria um número que o servidor não está cobrando.
        setPosicaoControle(numeroRevisores);
        toast.error(e instanceof Error ? e.message : "Não foi possível alterar o número de revisores");
      } finally {
        setGravandoNumero(false);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [posicaoControle, numeroRevisores, gravandoNumero]);

  // Sem número carregado conta como pendente: a recomendação não roda às
  // cegas quando a leitura falhou.
  const numeroPendente =
    numeroRevisores === null || posicaoControle !== numeroRevisores || gravandoNumero;

  const trabalhosPorId = useMemo(() => new Map(trabalhos.map((t) => [t.id, t])), [trabalhos]);

  /** Motivo do impedimento deste e-mail neste trabalho, se houver. */
  const motivoConflito = (tid: string, email: string): MotivoConflito | undefined =>
    conflitos.get(tid)?.get(email.toLowerCase());

  const revisoresPorTrabalho = useMemo(() => {
    const m = new Map<string, TrabalhoRevisor[]>();
    revisores.forEach((r) => {
      const list = m.get(r.trabalho_id) ?? [];
      list.push(r);
      m.set(r.trabalho_id, list);
    });
    return m;
  }, [revisores]);

  const revisoresPorEmail = useMemo(() => {
    const m = new Map<string, TrabalhoRevisor[]>();
    revisores.forEach((r) => {
      const list = m.get(r.revisor_email) ?? [];
      list.push(r);
      m.set(r.revisor_email, list);
    });
    return m;
  }, [revisores]);

  const cargaPorRevisor = useMemo(() => {
    const m = new Map<string, number>();
    revisores.forEach((r) => m.set(r.revisor_email, (m.get(r.revisor_email) ?? 0) + 1));
    return m;
  }, [revisores]);

  // Resultado do parecer por (trabalho, revisor), quando já emitido.
  const parecerPorChave = useMemo(() => {
    const m = new Map<string, ResultadoParecer>();
    pareceres.forEach((p) => m.set(`${p.trabalho_id}:${p.revisor_email}`, p.resultado));
    return m;
  }, [pareceres]);

  /*
   * O e-mail de designação desta associação foi liberado e ainda não saiu?
   *
   * O "ainda deve parecer" aqui é ESPELHO de `_parecer_pendente` (SQL) — só
   * para a tela. Sem ele, uma associação que deixou de precisar do e-mail
   * (o parecer chegou antes, o trabalho foi decidido) ficaria "na fila" para
   * sempre, e o aviso de fila parada nunca mais apagaria. Quem decide o que
   * sai continua sendo o banco.
   */
  const naFila = (r: TrabalhoRevisor): boolean =>
    !!r.aviso_solicitado_em &&
    !r.aviso_enviado_em &&
    !parecerPorChave.has(`${r.trabalho_id}:${r.revisor_email}`) &&
    ["pendente", "em_avaliacao"].includes(trabalhosPorId.get(r.trabalho_id)?.status ?? "");

  // Relógio do navegador, e pode: nada é autorizado por isto, é só um aviso
  // (mesma exceção do "hoje" do cronograma).
  const filaParada = revisores.some(
    (r) => naFila(r) && Date.now() - Date.parse(r.aviso_solicitado_em as string) > FILA_PARADA_MS,
  );

  const revCount = trabalhoId ? (revisoresPorTrabalho.get(trabalhoId)?.length ?? 0) : 0;
  const revLimiteAtingido = numeroRevisores !== null && revCount >= numeroRevisores;

  // Trabalhos que ninguém revisa ainda — ver o aviso no topo.
  const semRevisor = trabalhos.filter((t) => !revisoresPorTrabalho.has(t.id)).length;

  // Revisores impedidos no trabalho selecionado (autor/orientador/coautor).
  const impedidos = trabalhoId
    ? revisorOptions.filter((o) => motivoConflito(trabalhoId, o.email))
    : [];

  const handleAssociar = async () => {
    if (!trabalhoId || !revisorEmail) {
      toast.error("Selecione um trabalho e um revisor");
      return;
    }
    const motivo = motivoConflito(trabalhoId, revisorEmail);
    if (motivo) {
      toast.error(`Conflito de interesse: esta pessoa ${MOTIVO_TEXTO[motivo]}.`);
      return;
    }
    const opt = revisorOptions.find((o) => o.email === revisorEmail);
    setSubmitting(true);
    try {
      await associarRevisor(trabalhoId, revisorEmail, opt?.nome ?? null, opt?.tipo ?? "professor");
      toast.success("Revisor associado ao trabalho");
      setRevisorEmail("");
      await carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao associar revisor");
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * Pede a proposta ao servidor e abre a janela de revisão.
   * **Não grava nada** — é o ponto do fluxo novo.
   */
  const handleRecomendar = async () => {
    setSubmitting(true);
    try {
      const proposta = await recomendarDistribuicao();
      if (proposta.length === 0) {
        toast.info("Nada a recomendar: todos os trabalhos já estão completos ou não há revisor livre");
        return;
      }
      setPlano(proposta);
      setDialogoAberto(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao montar a recomendação");
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * Grava o que o co-chair confirmou. Em caso de recusa a janela FICA
   * ABERTA com as escolhas intactas: o banco recusa o lote inteiro, e a
   * pessoa precisa poder consertar a linha apontada em vez de recomeçar.
   */
  const handleConfirmarDistribuicao = async (
    pares: { trabalho_id: string; revisor_email: string }[],
  ) => {
    setConfirmando(true);
    try {
      const criados = await confirmarDistribuicao(pares);
      toast.success(`${criados} associação(ões) criada(s)`);
      setDialogoAberto(false);
      setPlano([]);
      await carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao confirmar a distribuição");
    } finally {
      setConfirmando(false);
    }
  };

  /**
   * Libera os e-mails de designação. Só põe na fila: quem envia é o Apps
   * Script da conta congressoparaiso@ufla.br, que busca a fila a cada minuto.
   */
  const handleEnviarAvisos = async () => {
    setEnviandoAvisos(true);
    try {
      const n = await solicitarAvisosAtribuicao();
      if (n === 0) {
        toast.info("Nenhum revisor a avisar: quem ainda tem parecer pendente já foi avisado.");
      } else {
        toast.success(
          `${n} revisor(es) na fila. Os e-mails saem de congressoparaiso@ufla.br em até 1 minuto.`,
        );
      }
      await carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível liberar os e-mails");
    } finally {
      setEnviandoAvisos(false);
    }
  };

  const handleRemover = async (id: string) => {
    try {
      await removerRevisor(id);
      toast.success("Associação removida");
      await carregar();
    } catch {
      toast.error("Erro ao remover associação");
    }
  };

  const ParecerBadge = ({ resultado }: { resultado?: ResultadoParecer }) =>
    resultado ? (
      <Badge variant={RESULTADO_VARIANT[resultado]}>{RESULTADO_LABEL[resultado]}</Badge>
    ) : (
      <Badge variant="outline">Pendente</Badge>
    );

  /** O e-mail de designação desta associação: saiu, está na fila, ou nada. */
  const AvisoBadge = ({ r }: { r: TrabalhoRevisor }) =>
    r.aviso_enviado_em ? (
      <Badge
        variant="outline"
        title={`E-mail de designação enviado em ${new Date(r.aviso_enviado_em).toLocaleString("pt-BR")}`}
      >
        <Mail className="mr-1 h-3 w-3" /> avisado
      </Badge>
    ) : naFila(r) ? (
      <Badge variant="secondary" title="Sai da conta congressoparaiso@ufla.br em até 1 minuto">
        na fila
      </Badge>
    ) : null;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <ClipboardList className="h-6 w-6" /> Atribuições
          </h1>
          <p className="text-muted-foreground">
            Associe revisores (avaliadores e professores, tratados igualmente) aos trabalhos. Quantos
            revisores cada trabalho recebe é definido logo abaixo · a recomendação evita passar de{" "}
            {META_TRABALHOS_POR_REVISOR} trabalhos por revisor, mas passa se for isso ou deixar trabalho a
            descoberto · autor, orientador e coautores não podem revisar o próprio trabalho.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* E-mail sai para fora do sistema e não tem volta: confirma antes.
              Associar nunca dispara e-mail sozinho — é este clique que
              anuncia a distribuição, quando o co-chair a dá por pronta. */}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" disabled={enviandoAvisos || loading}>
                <Mail className="mr-2 h-4 w-4" />
                {enviandoAvisos ? "Liberando..." : "Enviar e-mails aos revisores"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Enviar e-mails aos revisores?</AlertDialogTitle>
                <AlertDialogDescription>
                  Cada revisor com parecer pendente que ainda não foi avisado recebe um e-mail de
                  congressoparaiso@ufla.br com os títulos dos trabalhos dele (sem autores, a avaliação é às
                  cegas) e o link do Portal de Revisão. Quem já foi avisado não recebe de novo; associações
                  feitas depois deste clique esperam o próximo.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={handleEnviarAvisos}>Enviar</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          {/* Travado enquanto o número não termina de gravar: a recomendação
              lê o número do SERVIDOR, e rodá-la nesse meio-tempo proporia
              para o valor antigo. */}
          <Button
            onClick={handleRecomendar}
            disabled={submitting || loading || numeroPendente}
            variant="secondary"
          >
            <Sparkles className="mr-2 h-4 w-4" />
            Recomendar distribuição
          </Button>
        </div>
      </div>

      {/*
        Sinal precoce de envio quebrado: o Apps Script busca a fila a cada
        minuto, então nada deveria ficar nela por 5. Sem este aviso, um
        gatilho desinstalado ou um segredo trocado deixaria os revisores sem
        e-mail em silêncio — foi o que aconteceu com a chave errada do Brevo.
      */}
      {!loading && filaParada && (
        <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <span>
            <strong>Há e-mails na fila há mais de 5 minutos</strong>: o envio pela conta
            congressoparaiso@ufla.br parece parado. Confira as Execuções do Apps Script (gatilho
            instalado? o SEGREDO é o mesmo gravado no Supabase?).
          </span>
        </div>
      )}

      {/*
        Nenhum trabalho recebe revisor sozinho desde 20260820: se ninguém
        clicar em "Recomendar distribuição", eles ficam parados. O aviso
        existe para que isso não passe despercebido.
      */}
      {!loading && semRevisor > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <span>
            <strong>
              {semRevisor} trabalho(s) aguardando distribuição
            </strong>{" "}
            — nenhum revisor é associado automaticamente. Use "Recomendar distribuição" para revisar uma
            proposta e confirmá-la.
          </span>
        </div>
      )}

      {/*
        Revisores por trabalho. Não é só o alvo da recomendação: o servidor
        usa o MESMO número como teto da associação e como a quantidade de
        pareceres que encerra a revisão. Com o controle em 2, dois
        pareceres já levam o trabalho ao Parecer Editorial.
      */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" /> Revisores por trabalho
          </CardTitle>
          <CardDescription>
            Vale para todos os trabalhos: é quantos revisores a recomendação propõe, o limite de revisores
            de cada trabalho e quantos pareceres encerram a avaliação e levam o trabalho ao Parecer
            Editorial. Trabalhos que já têm mais revisores do que o número escolhido não perdem nenhum, e
            os que já receberam uma decisão editorial não mudam.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {posicaoControle === null ? (
            <p className="text-sm text-muted-foreground">Carregando...</p>
          ) : (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <div className="w-full max-w-xs">
                <label htmlFor="revisores-por-trabalho" className="sr-only">
                  Revisores por trabalho
                </label>
                <input
                  id="revisores-por-trabalho"
                  type="range"
                  min={1}
                  max={MAX_REVISORES_POR_TRABALHO}
                  step={1}
                  value={posicaoControle}
                  onChange={(e) => setPosicaoControle(Number(e.target.value))}
                  disabled={gravandoNumero}
                  className="w-full cursor-pointer accent-primary disabled:cursor-wait"
                />
                <div className="flex justify-between px-1 text-xs text-muted-foreground" aria-hidden="true">
                  {Array.from({ length: MAX_REVISORES_POR_TRABALHO }, (_, i) => (
                    <span key={i}>{i + 1}</span>
                  ))}
                </div>
              </div>
              <p className="text-sm" aria-live="polite">
                <strong className="text-2xl">{posicaoControle}</strong> revisor(es) por trabalho
                {numeroPendente && <span className="ml-2 text-muted-foreground">· salvando...</span>}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Associação manual unificada */}
      <Card>
        <CardHeader>
          <CardTitle>Associar revisor</CardTitle>
          <CardDescription>
            Para um trabalho de cada vez. Para vários de uma vez, use "Recomendar distribuição". A lista traz
            toda conta com papel de avaliador ou professor (concedido em Papéis, no Portal Admin), tratadas da
            mesma forma. O revisor verá o trabalho no portal do revisor pelo e-mail associado. Quem consta como
            autor, orientador ou coautor do trabalho aparece impedido.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-[1fr_1fr_auto]">
          <div>
            <label className="mb-1 block text-sm font-medium">Trabalho</label>
            <Select value={trabalhoId} onValueChange={(v) => { setTrabalhoId(v); setRevisorEmail(""); }}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione um trabalho" />
              </SelectTrigger>
              <SelectContent>
                {trabalhos.map((t) => {
                  const n = revisoresPorTrabalho.get(t.id)?.length ?? 0;
                  return (
                    <SelectItem key={t.id} value={t.id}>
                      {t.titulo}, {n}/{numeroRevisores}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            {trabalhoId && (
              <p className={`mt-1 text-xs ${revLimiteAtingido ? "text-destructive" : "text-muted-foreground"}`}>
                {revCount}/{numeroRevisores} revisores{revLimiteAtingido && ", limite atingido"}
              </p>
            )}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Revisor</label>
            <Select value={revisorEmail} onValueChange={setRevisorEmail}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione um revisor" />
              </SelectTrigger>
              <SelectContent>
                {revisorOptions.length === 0 ? (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">
                    Nenhum revisor no pool, conceda o papel de professor ou avaliador em Papéis
                  </div>
                ) : (
                  revisorOptions.map((o) => {
                    const carga = cargaPorRevisor.get(o.email) ?? 0;
                    const motivo = trabalhoId ? motivoConflito(trabalhoId, o.email) : undefined;
                    return (
                      <SelectItem key={o.email} value={o.email} disabled={!!motivo}>
                        {o.nome} · {TIPO_LABEL[o.tipo]}, {carga}/{META_TRABALHOS_POR_REVISOR}
                        {motivo && ` · impedido (${motivo})`}
                      </SelectItem>
                    );
                  })
                )}
              </SelectContent>
            </Select>
            {impedidos.length > 0 && (
              <p className="mt-1 flex items-start gap-1.5 text-xs text-muted-foreground">
                <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                <span>
                  {impedidos.length} revisor(es) impedido(s) neste trabalho por conflito de interesse:{" "}
                  {impedidos.map((o) => o.email).join(", ")}
                </span>
              </p>
            )}
          </div>
          <div className="flex items-end">
            <Button
              onClick={handleAssociar}
              disabled={submitting || revLimiteAtingido || !trabalhoId || !revisorEmail}
              className="w-full md:w-auto"
            >
              Associar
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Visualização */}
      <Tabs defaultValue="por-trabalho">
        <TabsList>
          <TabsTrigger value="por-trabalho">
            <FileText className="mr-2 h-4 w-4" /> Por trabalho
          </TabsTrigger>
          <TabsTrigger value="por-revisor">
            <UserCheck className="mr-2 h-4 w-4" /> Por revisor
          </TabsTrigger>
        </TabsList>

        {/* Por trabalho */}
        <TabsContent value="por-trabalho" className="space-y-4">
          {trabalhos.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhum trabalho cadastrado.</p>
          )}
          {trabalhos.map((t) => {
            const lista = revisoresPorTrabalho.get(t.id) ?? [];
            return (
              <Card key={t.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{t.titulo}</CardTitle>
                    <Badge variant={lista.length >= numeroRevisores ? "destructive" : "secondary"}>
                      {lista.length}/{numeroRevisores}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  {lista.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nenhum revisor associado.</p>
                  ) : (
                    <ul className="space-y-2">
                      {lista.map((r) => (
                        <li
                          key={r.id}
                          className="flex items-center justify-between gap-3 rounded-md border border-border p-3"
                        >
                          <span className="flex flex-1 flex-wrap items-center gap-2 text-sm">
                            <span className="font-medium">{r.revisor_nome ?? r.revisor_email}</span>
                            <span className="text-muted-foreground">— {r.revisor_email}</span>
                            <Badge variant="outline">{TIPO_LABEL[r.tipo]}</Badge>
                          </span>
                          <AvisoBadge r={r} />
                          <ParecerBadge resultado={parecerPorChave.get(`${t.id}:${r.revisor_email}`)} />
                          <RemoverBotao onConfirm={() => handleRemover(r.id)} />
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        {/* Por revisor */}
        <TabsContent value="por-revisor" className="space-y-4">
          {revisorOptions.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhum revisor no pool, conceda o papel de professor ou avaliador em Papéis (Portal Admin).
            </p>
          )}
          {revisorOptions.map((o) => {
            const lista = revisoresPorEmail.get(o.email) ?? [];
            return (
              <Card key={o.email}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-base">
                        {o.nome}
                        <Badge variant="outline">{TIPO_LABEL[o.tipo]}</Badge>
                      </CardTitle>
                      <CardDescription>{o.email}</CardDescription>
                    </div>
                    {/* Acima da meta é aviso, não erro — daí `outline` e não `destructive`. */}
                    <Badge variant={lista.length > META_TRABALHOS_POR_REVISOR ? "outline" : "secondary"}>
                      {lista.length}/{META_TRABALHOS_POR_REVISOR}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  {lista.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Sem trabalhos associados.</p>
                  ) : (
                    <ul className="space-y-2">
                      {lista.map((r) => {
                        const t = trabalhosPorId.get(r.trabalho_id);
                        return (
                          <li
                            key={r.id}
                            className="flex items-center justify-between gap-3 rounded-md border border-border p-3"
                          >
                            <span className="flex-1 text-sm font-medium">
                              {t?.titulo ?? "Trabalho removido"}
                            </span>
                            <AvisoBadge r={r} />
                            <ParecerBadge resultado={parecerPorChave.get(`${r.trabalho_id}:${o.email}`)} />
                            <RemoverBotao onConfirm={() => handleRemover(r.id)} />
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>
      </Tabs>

      <DialogoDistribuicao
        aberto={dialogoAberto}
        onOpenChange={setDialogoAberto}
        plano={plano}
        trabalhos={trabalhos}
        pool={revisorOptions}
        conflitos={conflitos}
        revisoresAtuais={revisores}
        numeroRevisores={numeroRevisores}
        confirmando={confirmando}
        onConfirmar={handleConfirmarDistribuicao}
      />
    </div>
  );
};

const RemoverBotao = ({ onConfirm }: { onConfirm: () => void }) => (
  <AlertDialog>
    <AlertDialogTrigger asChild>
      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive">
        <Trash2 className="h-4 w-4" />
      </Button>
    </AlertDialogTrigger>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Remover associação?</AlertDialogTitle>
        <AlertDialogDescription>
          Esta ação não pode ser desfeita. O revisor deixará de avaliar este trabalho.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancelar</AlertDialogCancel>
        <AlertDialogAction onClick={onConfirm}>Remover</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);

export default Atribuicoes;
