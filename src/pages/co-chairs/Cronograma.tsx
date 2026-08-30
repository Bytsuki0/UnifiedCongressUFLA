import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import {
  adicionarMes,
  carregarCronogramaGestao,
  excluirMarcacao,
  removerMes,
  salvarMarcacao,
  type MarcacaoCronograma,
  type MesCronograma,
} from "@/services/cronogramaService";
import {
  chaveDia,
  chaveMes,
  corDoTexto,
  CORES_SUGERIDAS,
  DIAS_SEMANA,
  gradeDoMes,
  hojeLocal,
  marcacoesPorDia,
  NOMES_MESES,
  rotuloDiaCurto,
  rotuloMes,
} from "@/lib/cronograma";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
 * Gestão do cronograma — a tela onde a organização monta o calendário
 * que a landing, /cronograma e /estudante/cronograma exibem.
 *
 * O editor é um painel INLINE, não um diálogo modal, e isso é a decisão
 * central desta tela: os dias de uma marcação são escolhidos clicando no
 * calendário, então o formulário não pode cobrir o calendário. Abrir um
 * <Dialog> obrigaria a fechá-lo para trocar um dia e reabri-lo para
 * salvar.
 *
 * A seleção atravessa as abas de propósito — uma marcação pode cobrir o
 * fim de agosto e o começo de setembro. Por isso o contador diz quantos
 * dias há no total E quantos estão no mês visível: sem isso, quem
 * trocasse de aba acharia que perdeu a seleção.
 */

/** Formulário do painel inline. `id` nulo = marcação nova. */
type Editor = { id: string | null; titulo: string; descricao: string; cor: string };

const editorVazio = (): Editor => ({
  id: null,
  titulo: "",
  descricao: "",
  cor: CORES_SUGERIDAS[0].hex,
});

/** Anos oferecidos: do atual em diante. Cronograma é sempre para frente. */
const ANO_ATUAL = new Date().getFullYear();
const ANOS = [ANO_ATUAL, ANO_ATUAL + 1, ANO_ATUAL + 2];

const Cronograma = () => {
  const [meses, setMeses] = useState<MesCronograma[]>([]);
  const [marcacoes, setMarcacoes] = useState<MarcacaoCronograma[]>([]);
  const [carregando, setCarregando] = useState(true);

  const [aba, setAba] = useState(0);
  const [selecao, setSelecao] = useState<Set<string>>(new Set());
  // Âncora do shift+clique: o último dia clicado sem shift.
  const [ancora, setAncora] = useState<number | null>(null);

  const [editor, setEditor] = useState<Editor | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [aExcluir, setAExcluir] = useState<MarcacaoCronograma | null>(null);

  const [novoAno, setNovoAno] = useState(ANO_ATUAL);
  const [novoMes, setNovoMes] = useState(new Date().getMonth() + 1);

  const carregar = async () => {
    setCarregando(true);
    try {
      const dados = await carregarCronogramaGestao();
      setMeses(dados.meses);
      setMarcacoes(dados.marcacoes);
    } catch {
      toast.error("Erro ao carregar o cronograma.");
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    carregar();
  }, []);

  // Remover o último mês deixaria a aba ativa fora do array.
  useEffect(() => {
    if (aba > meses.length - 1) setAba(0);
  }, [meses.length, aba]);

  const mes = meses[aba];
  const porDia = useMemo(() => marcacoesPorDia(marcacoes), [marcacoes]);
  const hoje = hojeLocal();

  const prefixoMes = mes ? `${mes.ano}-${String(mes.mes).padStart(2, "0")}-` : "";
  const selecionadosNoMes = [...selecao].filter((d) => d.startsWith(prefixoMes)).length;

  // ---------- meses publicados ----------

  const publicarMes = async () => {
    if (meses.some((m) => m.ano === novoAno && m.mes === novoMes)) {
      toast.info("Esse mês já está no cronograma.");
      return;
    }
    try {
      await adicionarMes(novoAno, novoMes);
      toast.success(`${NOMES_MESES[novoMes - 1]} de ${novoAno} adicionado.`);
      carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao adicionar o mês.");
    }
  };

  const despublicarMes = async (m: MesCronograma) => {
    try {
      await removerMes(m.ano, m.mes);
      toast.success(`${rotuloMes(m)} saiu do cronograma.`);
      carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao remover o mês.");
    }
  };

  // ---------- seleção de dias ----------

  const clicarDia = (dia: number, comShift: boolean) => {
    if (!mes) return;

    setSelecao((antes) => {
      const nova = new Set(antes);

      // Shift+clique preenche o intervalo entre a âncora e este dia,
      // sempre ADICIONANDO: é o gesto de "marcar de 12 a 16", e um
      // intervalo que alternasse cada dia individualmente devolveria um
      // resultado imprevisível quando parte dele já estivesse marcada.
      if (comShift && ancora !== null) {
        const [de, ate] = ancora <= dia ? [ancora, dia] : [dia, ancora];
        for (let d = de; d <= ate; d++) nova.add(chaveDia(mes.ano, mes.mes, d));
        return nova;
      }

      const chave = chaveDia(mes.ano, mes.mes, dia);
      if (nova.has(chave)) nova.delete(chave);
      else nova.add(chave);
      return nova;
    });

    if (!comShift) setAncora(dia);
  };

  const limparSelecao = () => {
    setSelecao(new Set());
    setAncora(null);
  };

  // ---------- marcações ----------

  const abrirNova = () => {
    if (selecao.size === 0) {
      toast.info("Selecione ao menos um dia no calendário.");
      return;
    }
    setEditor(editorVazio());
  };

  const abrirEdicao = (m: MarcacaoCronograma) => {
    // Editar carrega os dias da marcação NA SELEÇÃO: é a única forma de
    // acrescentar ou tirar um dia sem uma segunda tela.
    setSelecao(new Set(m.dias));
    setAncora(null);
    setEditor({ id: m.id, titulo: m.titulo, descricao: m.descricao, cor: m.cor });
  };

  const fecharEditor = () => {
    setEditor(null);
    limparSelecao();
  };

  const salvar = async () => {
    if (!editor) return;
    if (!editor.titulo.trim()) {
      toast.error("Informe o nome do evento.");
      return;
    }
    if (selecao.size === 0) {
      toast.error("Selecione ao menos um dia no calendário.");
      return;
    }

    setSalvando(true);
    try {
      await salvarMarcacao({
        id: editor.id,
        titulo: editor.titulo,
        descricao: editor.descricao,
        cor: editor.cor,
        dias: [...selecao].sort(),
      });
      toast.success(editor.id ? "Marcação atualizada." : "Marcação criada.");
      fecharEditor();
      carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar a marcação.");
    } finally {
      setSalvando(false);
    }
  };

  const confirmarExclusao = async () => {
    if (!aExcluir) return;
    try {
      await excluirMarcacao(aExcluir.id);
      toast.success("Marcação excluída.");
      // A marcação aberta no editor pode ser justamente esta.
      if (editor?.id === aExcluir.id) fecharEditor();
      carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao excluir a marcação.");
    }
    setAExcluir(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
          <CalendarDays className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Cronograma</h1>
          <p className="text-sm text-muted-foreground">
            Escolha os meses exibidos, pinte os dias e descreva o que acontece em cada um. O que
            for salvo aqui aparece na página inicial, em <strong>/cronograma</strong> e no portal
            do autor.
          </p>
        </div>
      </div>

      {/* ---------- meses publicados ---------- */}
      <Card className="shadow-[var(--shadow-card)]">
        <CardHeader className="space-y-0 pb-3">
          <h2 className="text-lg font-semibold">Meses exibidos</h2>
          <p className="text-xs text-muted-foreground">
            Só estes meses viram abas no cronograma público. Tirar um mês daqui esconde as
            marcações dele, mas não as apaga.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="cron-mes" className="text-xs uppercase tracking-wide text-muted-foreground">
                Mês
              </Label>
              <select
                id="cron-mes"
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={novoMes}
                onChange={(e) => setNovoMes(Number(e.target.value))}
              >
                {NOMES_MESES.map((nome, i) => (
                  <option key={nome} value={i + 1}>{nome}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="cron-ano" className="text-xs uppercase tracking-wide text-muted-foreground">
                Ano
              </Label>
              <select
                id="cron-ano"
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={novoAno}
                onChange={(e) => setNovoAno(Number(e.target.value))}
              >
                {ANOS.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>
            <Button onClick={publicarMes}>
              <Plus className="mr-2 h-4 w-4" /> Adicionar mês
            </Button>
          </div>

          {meses.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum mês no cronograma — a seção não aparece na página inicial.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {meses.map((m) => (
                <span
                  key={chaveMes(m)}
                  className="inline-flex items-center gap-2 rounded-full border border-border bg-muted px-3 py-1 text-sm"
                >
                  {rotuloMes(m)}
                  <button
                    type="button"
                    onClick={() => despublicarMes(m)}
                    aria-label={`Remover ${rotuloMes(m)}`}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---------- calendário editável ---------- */}
      {carregando ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : mes ? (
        <Card className="shadow-[var(--shadow-card)]">
          <CardHeader className="space-y-0 pb-3">
            <h2 className="text-lg font-semibold">Dias</h2>
            <p className="text-xs text-muted-foreground">
              Clique para marcar ou desmarcar um dia. <strong>Shift + clique</strong> marca todo o
              intervalo desde o último dia clicado.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {meses.length > 1 && (
              <div className="cronograma-abas">
                {meses.map((m, i) => (
                  <button
                    key={chaveMes(m)}
                    type="button"
                    className={`cronograma-aba${i === aba ? " ativa" : ""}`}
                    onClick={() => setAba(i)}
                  >
                    {rotuloMes(m)}
                  </button>
                ))}
              </div>
            )}

            <div className="cronograma cronograma-editavel">
              <div className="cronograma-grade">
                {DIAS_SEMANA.map((d) => (
                  <div key={d} className="cronograma-cabecalho-dia" aria-hidden="true">{d}</div>
                ))}

                {gradeDoMes(mes.ano, mes.mes).map((dia, i) => {
                  if (dia === null) {
                    return <div key={`vazio-${i}`} className="cronograma-celula vazia" />;
                  }

                  const chave = chaveDia(mes.ano, mes.mes, dia);
                  const doDia = porDia[chave] ?? [];
                  const principal = doDia[0];
                  const marcado = selecao.has(chave);

                  return (
                    <button
                      key={chave}
                      type="button"
                      aria-pressed={marcado}
                      className={`cronograma-celula${principal ? " marcada" : ""}${chave === hoje ? " hoje" : ""}${marcado ? " selecionada" : ""}`}
                      style={
                        principal
                          ? { background: principal.cor, color: corDoTexto(principal.cor) }
                          : undefined
                      }
                      onClick={(e) => clicarDia(dia, e.shiftKey)}
                      title={doDia.map((m) => m.titulo).join(" · ")}
                    >
                      <span className="cronograma-numero">{dia}</span>
                      {principal && <span className="cronograma-rotulo">{principal.titulo}</span>}
                      {doDia.length > 1 && (
                        <span className="cronograma-mais">+{doDia.length - 1}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              <p className="text-sm text-muted-foreground">
                {selecao.size === 0
                  ? "Nenhum dia selecionado."
                  : `${selecao.size} dia(s) selecionado(s)${
                      selecionadosNoMes !== selecao.size ? ` · ${selecionadosNoMes} neste mês` : ""
                    }`}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={limparSelecao} disabled={selecao.size === 0}>
                  Limpar seleção
                </Button>
                {!editor && (
                  <Button size="sm" onClick={abrirNova}>
                    <Plus className="mr-2 h-4 w-4" /> Marcar dias selecionados
                  </Button>
                )}
              </div>
            </div>

            {/* Painel inline: fica ABAIXO do calendário para que os dias
                continuem clicáveis enquanto o formulário está aberto. */}
            {editor && (
              <div className="space-y-4 rounded-lg border border-border bg-muted/40 p-4">
                <h3 className="text-sm font-semibold">
                  {editor.id ? "Editar marcação" : "Nova marcação"}
                </h3>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="marc-titulo">Nome do evento *</Label>
                    <Input
                      id="marc-titulo"
                      value={editor.titulo}
                      placeholder="Ex.: Prazo final de submissão"
                      onChange={(e) => setEditor({ ...editor, titulo: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="marc-cor">Cor</Label>
                    <div className="flex items-center gap-2">
                      {CORES_SUGERIDAS.map((c) => (
                        <button
                          key={c.hex}
                          type="button"
                          title={c.nome}
                          aria-label={c.nome}
                          aria-pressed={editor.cor.toLowerCase() === c.hex.toLowerCase()}
                          onClick={() => setEditor({ ...editor, cor: c.hex })}
                          className={`h-7 w-7 rounded-full border-2 ${
                            editor.cor.toLowerCase() === c.hex.toLowerCase()
                              ? "border-foreground"
                              : "border-transparent"
                          }`}
                          style={{ background: c.hex }}
                        />
                      ))}
                      {/* Cor livre. O CHECK da coluna só aceita hex de 6
                          dígitos — que é exatamente o que <input
                          type="color"> devolve. */}
                      <Input
                        id="marc-cor"
                        type="color"
                        value={editor.cor}
                        onChange={(e) => setEditor({ ...editor, cor: e.target.value })}
                        className="h-8 w-12 cursor-pointer p-1"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="marc-desc">Descrição</Label>
                  <Textarea
                    id="marc-desc"
                    rows={3}
                    value={editor.descricao}
                    placeholder="O que acontece nesses dias. Aparece para quem clicar no dia."
                    onChange={(e) => setEditor({ ...editor, descricao: e.target.value })}
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                    Dias desta marcação
                  </Label>
                  <p className="text-sm">
                    {selecao.size === 0
                      ? "Nenhum — clique no calendário acima."
                      : [...selecao].sort().map(rotuloDiaCurto).join(", ")}
                  </p>
                </div>

                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={fecharEditor}>Cancelar</Button>
                  <Button onClick={salvar} disabled={salvando}>
                    {salvando ? "Salvando..." : "Salvar marcação"}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* ---------- marcações existentes ---------- */}
      <Card className="shadow-[var(--shadow-card)]">
        <CardHeader className="space-y-0 pb-3">
          <h2 className="text-lg font-semibold">Marcações</h2>
          <p className="text-xs text-muted-foreground">
            Cada marcação tem uma cor, um nome e uma descrição, compartilhados por todos os dias
            dela.
          </p>
        </CardHeader>
        <CardContent>
          {marcacoes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma marcação ainda. Selecione dias no calendário e clique em “Marcar dias
              selecionados”.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {marcacoes.map((m) => (
                <li key={m.id} className="flex items-start gap-3 py-3">
                  <span
                    className="mt-1 h-4 w-4 shrink-0 rounded-full"
                    style={{ background: m.cor }}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{m.titulo}</div>
                    {m.descricao && (
                      <p className="text-sm text-muted-foreground">{m.descricao}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {m.dias.length} dia(s): {m.dias.map(rotuloDiaCurto).join(", ")}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button variant="outline" size="sm" onClick={() => abrirEdicao(m)}>
                      Editar
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setAExcluir(m)}
                      aria-label={`Excluir ${m.titulo}`}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!aExcluir} onOpenChange={(o) => !o && setAExcluir(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir marcação?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{aExcluir?.titulo}</strong> e os {aExcluir?.dias.length} dia(s) dela saem do
              cronograma público. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmarExclusao}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Cronograma;
