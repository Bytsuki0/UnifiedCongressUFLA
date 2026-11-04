import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Eraser, Save, Undo2 } from "lucide-react";
import { toast } from "sonner";
import {
  AGENDA_VAZIA,
  avisoPendente,
  calcularMudancas,
  estadoLinha,
  hora,
  ultimoEnvioPorTrabalho,
  type Agenda,
  type EnvioApresentacao,
  type EstadoLinha,
} from "@/lib/apresentacoes";
import { filtrarTrabalhos } from "@/lib/avaliacaoEvento";
import {
  carregarAdminCA,
  salvarCronogramaApresentacoes,
  type DadosAdminCA,
  type TrabalhoAgendavel,
} from "@/services/apresentacoesService";
import { situacaoEnvio, type SituacaoEnvio } from "@/services/revisorService";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * Editar Cronograma de Apresentação — a gestão do Cronograma de
 * Apresentações (migration 20261104120000): dia, início, fim e sala de cada
 * trabalho APROVADO, e o tipo de apresentação de cada categoria, que todo
 * trabalho dela herda. No código a tela se chama "AdminCA", o nome que ela
 * teve primeiro (e que a URL, /co-chairs/admin-ca, guarda).
 *
 * Tudo se edita na tela e sai num clique só, o SALVAR: a RPC grava o lote
 * numa transação e põe na fila do e-mail cada trabalho com informação nova
 * (agendado agora, ou com dia, horário, sala ou tipo alterado). O e-mail sai
 * para fora do sistema e não tem volta, por isso o Salvar confirma antes,
 * dizendo quantos autores vão ser avisados — número que sai de
 * `calcularMudancas`, espelho da régua do servidor.
 *
 * Linha recusada aborta o lote inteiro com a frase do banco dizendo qual
 * trabalho; as edições continuam na tela para a pessoa consertar só ela.
 */

/** Grupo dos trabalhos sem categoria no filtro (o id de categoria nunca é vazio). */
const SEM_CATEGORIA = "";

/**
 * A cor da linha diz o que o Salvar vai fazer com ela. Reaproveita a faixa
 * de desfecho da lista do autor (azul, amarelo, vermelho, laranja), que já
 * vira borda do cartão no celular.
 */
const LINHA: Partial<Record<EstadoLinha, { classe: string; rotulo: string; variant: "default" | "secondary" | "destructive" }>> = {
  nova: { classe: "linha-desfecho linha-ativa", rotulo: "novo", variant: "default" },
  alterada: { classe: "linha-desfecho linha-correcoes", rotulo: "alterado", variant: "secondary" },
  removida: { classe: "linha-desfecho linha-reprovada", rotulo: "sai do cronograma", variant: "destructive" },
  incompleta: { classe: "linha-desfecho linha-reenvio", rotulo: "incompleto", variant: "destructive" },
  horario_invertido: { classe: "linha-desfecho linha-reenvio", rotulo: "fim antes do início", variant: "destructive" },
};

/** O vocabulário do selo de e-mail de Atribuições, para as duas telas dizerem o mesmo. */
const SITUACAO: Record<SituacaoEnvio, { rotulo: string; variant: "outline" | "secondary" | "destructive" }> = {
  enviado: { rotulo: "enviado", variant: "outline" },
  falha: { rotulo: "falhou", variant: "destructive" },
  enviando: { rotulo: "enviando", variant: "secondary" },
  sem_confirmacao: { rotulo: "sem confirmação", variant: "secondary" },
};

/** As agendas gravadas dos trabalhos listados, com as horas já em 'HH:MM'. */
function gravadasDe(dados: DadosAdminCA): Record<string, Agenda> {
  const listados = new Set(dados.trabalhos.map((t) => t.id));
  return Object.fromEntries(
    dados.apresentacoes
      .filter((a) => listados.has(a.trabalho_id))
      .map((a) => [
        a.trabalho_id,
        { data: a.data, hora_inicio: hora(a.hora_inicio), hora_fim: hora(a.hora_fim), sala: a.sala },
      ]),
  );
}

/** O formulário como está no banco: uma agenda por trabalho listado e o tipo de cada categoria. */
function formularioDe(dados: DadosAdminCA) {
  const gravadas = gravadasDe(dados);
  return {
    editadas: Object.fromEntries(dados.trabalhos.map((t) => [t.id, gravadas[t.id] ?? AGENDA_VAZIA])),
    tipos: Object.fromEntries(dados.categorias.map((c) => [c.id, c.tipo_apresentacao])),
  };
}

const plural = (n: number, um: string, varios: string) => (n === 1 ? um : varios);

const AdminCA = () => {
  const [dados, setDados] = useState<DadosAdminCA | null>(null);
  const [erro, setErro] = useState(false);
  const [editadas, setEditadas] = useState<Record<string, Agenda>>({});
  const [tipos, setTipos] = useState<Record<string, string>>({});
  const [categoriaId, setCategoriaId] = useState<string | null>(null);
  const [termo, setTermo] = useState("");
  const [confirmando, setConfirmando] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const carregar = async () => {
    try {
      const d = await carregarAdminCA();
      const formulario = formularioDe(d);
      setDados(d);
      setEditadas(formulario.editadas);
      setTipos(formulario.tipos);
      setErro(false);
    } catch {
      // Nunca uma tela vazia: editar em cima de um estado que não é o do
      // banco agendaria por cima do que já está lá.
      setErro(true);
    }
  };

  useEffect(() => {
    carregar();
  }, []);

  const gravadas = useMemo(() => (dados ? gravadasDe(dados) : {}), [dados]);

  const mudancas = useMemo(
    () =>
      calcularMudancas({
        gravadas,
        editadas,
        categoriaDe: Object.fromEntries((dados?.trabalhos ?? []).map((t) => [t.id, t.categoria_id])),
        tiposGravados: Object.fromEntries((dados?.categorias ?? []).map((c) => [c.id, c.tipo_apresentacao])),
        tiposEditados: tipos,
      }),
    [dados, gravadas, editadas, tipos],
  );

  // Linha pela metade também é edição por salvar: sem contá-la, o Salvar
  // ficaria desabilitado sem dizer por quê — é o clique nele que explica.
  const temMudanca =
    mudancas.itens.length > 0 || mudancas.tipos.length > 0 || mudancas.invalidos.length > 0;

  const agendamentos = mudancas.itens.length - mudancas.removidos.length;
  const resumo = [
    agendamentos > 0 &&
      `${agendamentos} ${plural(agendamentos, "agendamento novo ou alterado", "agendamentos novos ou alterados")}`,
    mudancas.removidos.length > 0 &&
      `${mudancas.removidos.length} ${plural(mudancas.removidos.length, "trabalho saindo", "trabalhos saindo")} do cronograma`,
    mudancas.tipos.length > 0 &&
      `${mudancas.tipos.length} ${plural(mudancas.tipos.length, "tipo de apresentação alterado", "tipos de apresentação alterados")}`,
  ].filter(Boolean);

  // Fechar a aba com o lote por salvar perderia tudo o que foi digitado.
  useEffect(() => {
    if (!temMudanca) return;
    const aoSair = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", aoSair);
    return () => window.removeEventListener("beforeunload", aoSair);
  }, [temMudanca]);

  const trabalhoPorId = useMemo(
    () => new Map((dados?.trabalhos ?? []).map((t) => [t.id, t])),
    [dados],
  );

  const ultimoEnvio = useMemo(() => ultimoEnvioPorTrabalho(dados?.envios ?? []), [dados]);

  const enviosPorTrabalho = useMemo(() => {
    const m = new Map<string, EnvioApresentacao[]>();
    for (const e of dados?.envios ?? []) {
      for (const id of e.trabalhos_ids) m.set(id, [...(m.get(id) ?? []), e]);
    }
    return m;
  }, [dados]);

  const apresentacaoPorTrabalho = useMemo(
    () => new Map((dados?.apresentacoes ?? []).map((a) => [a.trabalho_id, a])),
    [dados],
  );

  // Sugestões dos campos: o que já foi digitado em outras linhas.
  const tiposUsados = [...new Set(Object.values(tipos).map((t) => t.trim()).filter(Boolean))].sort();
  const salasUsadas = [...new Set(Object.values(editadas).map((a) => a.sala.trim()).filter(Boolean))].sort();

  const mudar = (trabalhoId: string, campos: Partial<Agenda>) =>
    setEditadas((prev) => ({ ...prev, [trabalhoId]: { ...(prev[trabalhoId] ?? AGENDA_VAZIA), ...campos } }));

  /** O formulário volta a ser o que está no banco. */
  const descartar = () => {
    if (!dados) return;
    const formulario = formularioDe(dados);
    setEditadas(formulario.editadas);
    setTipos(formulario.tipos);
  };

  const pedirConfirmacao = () => {
    const n = mudancas.invalidos.length;
    if (n > 0) {
      const exemplo = trabalhoPorId.get(mudancas.invalidos[0])?.titulo;
      toast.error(
        `${plural(n, "Uma linha está", `${n} linhas estão`)} pela metade ou com o fim antes do início` +
          `${exemplo ? ` (por exemplo, "${exemplo}")` : ""}. Complete ou limpe antes de salvar.`,
      );
      return;
    }
    setConfirmando(true);
  };

  const salvar = async () => {
    setSalvando(true);
    try {
      const n = await salvarCronogramaApresentacoes(mudancas.tipos, mudancas.itens);
      toast.success(
        n === 0
          ? "Cronograma salvo. Nenhum trabalho com informação nova: nenhum e-mail vai sair."
          : `Cronograma salvo. ${n} ${plural(n, "trabalho com informação nova", "trabalhos com informação nova")}: ` +
              "os autores recebem o e-mail de congressoparaiso@ufla.br em até 1 minuto.",
      );
      await carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar o cronograma de apresentações.");
    } finally {
      setSalvando(false);
    }
  };

  /** O selo de e-mail de um trabalho já agendado. Sem agenda gravada, não há e-mail a acompanhar. */
  const SeloEmail = ({ trabalho }: { trabalho: TrabalhoAgendavel }) => {
    const gravada = apresentacaoPorTrabalho.get(trabalho.id);
    if (!gravada) return <span className="text-muted-foreground">—</span>;

    if (!trabalho.owner_id) {
      return (
        <Badge variant="outline" title="Trabalho cadastrado pela organização, sem conta de autor: não há a quem mandar o e-mail.">
          sem autor
        </Badge>
      );
    }

    const ultimo = ultimoEnvio.get(trabalho.id);
    const pendente = avisoPendente(gravada, enviosPorTrabalho.get(trabalho.id) ?? []);
    if (pendente === "na_fila") {
      return (
        <Badge variant="secondary" title="Sai da conta congressoparaiso@ufla.br em até 1 minuto.">
          na fila
        </Badge>
      );
    }
    if (pendente === "desistiu") {
      return (
        <Badge
          variant="destructive"
          title={`O e-mail falhou 3 vezes${ultimo?.erro ? `: ${ultimo.erro}` : ""}. Salve uma mudança neste trabalho para tentar de novo.`}
        >
          falhou
        </Badge>
      );
    }
    if (!ultimo) return <span className="text-muted-foreground">—</span>;

    const situacao = situacaoEnvio(ultimo);
    const title =
      situacao === "enviado"
        ? `E-mail enviado em ${new Date(ultimo.concluido_em ?? ultimo.criado_em).toLocaleString("pt-BR")}`
        : situacao === "falha"
          ? `O envio falhou: ${ultimo.erro}. A fila tenta de novo sozinha.`
          : situacao === "enviando"
            ? "Saindo agora da conta congressoparaiso@ufla.br"
            : "O Apps Script pegou este e-mail e não confirmou o envio: pode ter saído ou não.";
    return (
      <Badge variant={SITUACAO[situacao].variant} title={title}>
        {SITUACAO[situacao].rotulo}
      </Badge>
    );
  };

  // Os grupos: uma por categoria, na ordem do nome, e os sem categoria no fim.
  const grupos = useMemo(() => {
    if (!dados) return [];
    const porCategoria = new Map<string, TrabalhoAgendavel[]>();
    for (const t of dados.trabalhos) {
      const chave = t.categoria_id ?? SEM_CATEGORIA;
      porCategoria.set(chave, [...(porCategoria.get(chave) ?? []), t]);
    }
    const lista = dados.categorias.map((c) => ({
      id: c.id,
      nome: c.nome,
      trabalhos: porCategoria.get(c.id) ?? [],
    }));
    if (porCategoria.has(SEM_CATEGORIA)) {
      lista.push({ id: SEM_CATEGORIA, nome: "Sem categoria", trabalhos: porCategoria.get(SEM_CATEGORIA) ?? [] });
    }
    return lista;
  }, [dados]);

  const gruposVisiveis = grupos
    .filter((g) => categoriaId === null || g.id === categoriaId)
    .map((g) => ({ ...g, linhas: filtrarTrabalhos(g.trabalhos, { categoriaId: "", termo }) }))
    // Buscando, categoria sem resultado só atrapalha; sem busca, toda
    // categoria aparece — o tipo pode ser definido antes dos trabalhos.
    .filter((g) => !termo.trim() || g.linhas.length > 0);

  const semDonoAvisados = mudancas.avisados.filter((id) => !trabalhoPorId.get(id)?.owner_id).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
            <CalendarClock className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Editar Cronograma de Apresentação</h1>
            <p className="text-sm text-muted-foreground">
              Cronograma de apresentações: dia, horário e sala de cada trabalho aprovado, e o tipo de
              apresentação de cada categoria. Aparece na página inicial, em{" "}
              <strong>/apresentacoes</strong> e no portal do autor.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={descartar} disabled={!temMudanca || salvando}>
            <Undo2 className="mr-2 h-4 w-4" /> Descartar alterações
          </Button>
          <Button onClick={pedirConfirmacao} disabled={!temMudanca || salvando}>
            <Save className="mr-2 h-4 w-4" /> {salvando ? "Salvando..." : "Salvar"}
          </Button>
        </div>
      </div>

      <div className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
        Ao salvar, quem submeteu cada trabalho com informação nova — agendado agora, ou com dia,
        horário, sala ou tipo de apresentação alterado — recebe um e-mail de congressoparaiso@ufla.br.
        Coautores não recebem. Tirar um trabalho do cronograma (limpar a linha) não manda e-mail.
      </div>

      {erro ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          Não foi possível carregar o cronograma de apresentações. Recarregue a página.
        </div>
      ) : dados === null ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : (
        <>
          <div className="toolbar" style={{ marginBottom: 0 }}>
            <div className="search-wrapper">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="search"
                className="search-input"
                placeholder="Buscar por título ou autor..."
                aria-label="Buscar por título ou autor"
                value={termo}
                onChange={(e) => setTermo(e.target.value)}
              />
            </div>
            <select
              className="form-select"
              style={{ width: "auto" }}
              aria-label="Filtrar por categoria"
              value={categoriaId ?? "*"}
              onChange={(e) => setCategoriaId(e.target.value === "*" ? null : e.target.value)}
            >
              <option value="*">Todas as categorias</option>
              {grupos.map((g) => (
                <option key={g.id || "sem"} value={g.id}>
                  {g.nome}
                </option>
              ))}
            </select>
          </div>

          {temMudanca && (
            <p className="text-sm">
              <strong>Alterações não salvas:</strong> {resumo.join(" · ")}
              {mudancas.invalidos.length > 0 && (
                <span className="text-destructive">
                  {resumo.length > 0 && " · "}
                  {mudancas.invalidos.length}{" "}
                  {plural(mudancas.invalidos.length, "linha incompleta", "linhas incompletas")}
                </span>
              )}
            </p>
          )}

          {dados.trabalhos.length === 0 && (
            <Card className="shadow-[var(--shadow-card)]">
              <CardContent className="py-12 text-center text-muted-foreground">
                Nenhum trabalho aprovado ainda. Só trabalhos aprovados (inclusive os aprovados com
                correções) entram no cronograma de apresentações.
              </CardContent>
            </Card>
          )}

          {gruposVisiveis.map((g) => {
            const agendados = g.trabalhos.filter((t) =>
              ["igual", "nova", "alterada"].includes(estadoLinha(gravadas[t.id], editadas[t.id] ?? AGENDA_VAZIA)),
            ).length;
            const tipo = tipos[g.id] ?? "";
            const tipoGravado = dados.categorias.find((c) => c.id === g.id)?.tipo_apresentacao ?? "";
            const tipoMudou = g.id !== SEM_CATEGORIA && tipo.trim() !== tipoGravado.trim();

            return (
              <Card key={g.id || "sem"} className="shadow-[var(--shadow-card)]">
                <CardHeader className="space-y-3 pb-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="text-lg font-semibold">{g.nome}</h2>
                    <span className="text-xs text-muted-foreground">
                      {agendados} de {g.trabalhos.length} {plural(g.trabalhos.length, "trabalho agendado", "trabalhos agendados")}
                    </span>
                  </div>
                  {g.id === SEM_CATEGORIA ? (
                    <p className="text-xs text-muted-foreground">
                      Trabalhos sem categoria não têm tipo de apresentação: aparecem com "—".
                    </p>
                  ) : (
                    <div className="max-w-md space-y-1">
                      <div className="flex items-center gap-2">
                        <Label htmlFor={`tipo-${g.id}`}>Tipo de apresentação</Label>
                        {tipoMudou && <Badge variant="secondary">alterado</Badge>}
                      </div>
                      <Input
                        id={`tipo-${g.id}`}
                        list="adminca-tipos"
                        maxLength={80}
                        value={tipo}
                        placeholder="Ex.: Pôster, Apresentação oral"
                        onChange={(e) => setTipos((prev) => ({ ...prev, [g.id]: e.target.value }))}
                      />
                      <p className="text-xs text-muted-foreground">
                        Vale para todos os trabalhos desta categoria.
                      </p>
                    </div>
                  )}
                </CardHeader>
                <CardContent>
                  {g.linhas.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {g.trabalhos.length === 0
                        ? "Nenhum trabalho aprovado nesta categoria."
                        : "Nenhum trabalho encontrado."}
                    </p>
                  ) : (
                    // `overflow-x: auto` no lugar do `hidden` da classe: oito
                    // colunas com campos podem passar da largura, e cortado
                    // ninguém edita. No celular a tabela vira cartões.
                    <div className="table-container" style={{ overflowX: "auto" }}>
                      <table className="table" style={{ width: "100%" }}>
                        <thead>
                          <tr>
                            <th>TRABALHO</th>
                            <th>DIA</th>
                            <th>INÍCIO</th>
                            <th>FIM</th>
                            <th>SALA</th>
                            <th>E-MAIL</th>
                            <th>AÇÕES</th>
                          </tr>
                        </thead>
                        <tbody>
                          {g.linhas.map((t) => {
                            const agenda = editadas[t.id] ?? AGENDA_VAZIA;
                            const estado = estadoLinha(gravadas[t.id], agenda);
                            const linha = LINHA[estado];
                            const vazia = estado === "vazia";
                            return (
                              <tr key={t.id} className={linha?.classe}>
                                {/* Autores sob o título, e não numa coluna: com
                                    os campos de dia e hora, uma oitava coluna
                                    empurrava o selo do e-mail para fora da tela. */}
                                <td data-rotulo="TRABALHO" className="celula-titulo" style={{ minWidth: 200 }}>
                                  <span style={{ fontWeight: "var(--fw-semibold)" }}>{t.titulo}</span>
                                  {linha && (
                                    <Badge variant={linha.variant} className="ml-2 align-middle">
                                      {linha.rotulo}
                                    </Badge>
                                  )}
                                  <div className="mt-1 text-xs font-normal text-muted-foreground">{t.autores}</div>
                                </td>
                                <td data-rotulo="DIA">
                                  <Input
                                    type="date"
                                    className="h-9 min-w-[9.5rem]"
                                    aria-label={`Dia da apresentação de ${t.titulo}`}
                                    value={agenda.data}
                                    onChange={(e) => mudar(t.id, { data: e.target.value })}
                                  />
                                </td>
                                <td data-rotulo="INÍCIO">
                                  <Input
                                    type="time"
                                    className="h-9 min-w-[6.5rem]"
                                    aria-label={`Início da apresentação de ${t.titulo}`}
                                    value={agenda.hora_inicio}
                                    onChange={(e) => mudar(t.id, { hora_inicio: e.target.value })}
                                  />
                                </td>
                                <td data-rotulo="FIM">
                                  {/* `min` é cortesia: quem recusa é o CHECK da coluna. */}
                                  <Input
                                    type="time"
                                    className="h-9 min-w-[6.5rem]"
                                    aria-label={`Fim da apresentação de ${t.titulo}`}
                                    min={agenda.hora_inicio || undefined}
                                    value={agenda.hora_fim}
                                    onChange={(e) => mudar(t.id, { hora_fim: e.target.value })}
                                  />
                                </td>
                                <td data-rotulo="SALA">
                                  <Input
                                    className="h-9 min-w-[10rem]"
                                    list="adminca-salas"
                                    maxLength={120}
                                    placeholder="Ex.: Sala 101"
                                    aria-label={`Sala da apresentação de ${t.titulo}`}
                                    value={agenda.sala}
                                    onChange={(e) => mudar(t.id, { sala: e.target.value })}
                                  />
                                </td>
                                <td data-rotulo="E-MAIL">
                                  {/* O <span> é quem estica na célula-grade do
                                      cartão (celular); o selo fica do tamanho dele. */}
                                  <span>
                                    <SeloEmail trabalho={t} />
                                  </span>
                                </td>
                                <td data-rotulo="AÇÕES" className="celula-acoes">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    disabled={vazia}
                                    onClick={() => mudar(t.id, AGENDA_VAZIA)}
                                    aria-label={`Limpar a agenda de ${t.titulo}`}
                                    title="Limpa a linha. Se o trabalho já estava agendado, ele sai do cronograma ao salvar."
                                  >
                                    <Eraser className="h-4 w-4" />
                                  </Button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}

          <datalist id="adminca-tipos">
            {tiposUsados.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
          <datalist id="adminca-salas">
            {salasUsadas.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </>
      )}

      <AlertDialog open={confirmando} onOpenChange={setConfirmando}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Salvar o cronograma de apresentações?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                {mudancas.avisados.length > 0 ? (
                  <p>
                    <strong>
                      {mudancas.avisados.length}{" "}
                      {plural(mudancas.avisados.length, "trabalho com informação nova", "trabalhos com informação nova")}
                    </strong>
                    : quem submeteu cada um recebe um e-mail de congressoparaiso@ufla.br com dia, horário,
                    sala e tipo de apresentação.
                    {semDonoAvisados > 0 &&
                      ` ${semDonoAvisados} ${plural(semDonoAvisados, "não tem", "não têm")} conta de autor e ${plural(semDonoAvisados, "fica", "ficam")} sem e-mail.`}
                  </p>
                ) : (
                  <p>Nenhum trabalho com informação nova: nenhum e-mail vai sair.</p>
                )}
                {mudancas.tipos.length > 0 && (
                  <p>
                    {mudancas.tipos.length}{" "}
                    {plural(mudancas.tipos.length, "categoria muda", "categorias mudam")} de tipo de
                    apresentação — os trabalhos já agendados nelas entram na contagem acima.
                  </p>
                )}
                {mudancas.removidos.length > 0 && (
                  <p>
                    {mudancas.removidos.length}{" "}
                    {plural(mudancas.removidos.length, "trabalho sai", "trabalhos saem")} do cronograma
                    público, sem e-mail.
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={salvar}>Salvar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default AdminCA;
