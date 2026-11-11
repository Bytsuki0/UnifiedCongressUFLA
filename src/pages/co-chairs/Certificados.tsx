import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Award, Bold, Italic, Plus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { envolverSelecao } from "@/lib/avisos";
import {
  caixaNova,
  estadoDoModelo,
  familiaDaFonte,
  FONTES_EMBUTIDAS,
  precisaEncolher,
  ROTULO_USO,
  USOS,
  USOS_DO_PODIO,
  VARIAVEIS_DO_USO,
  type Alinhamento,
  type Caixa,
  type Uso,
} from "@/lib/certificados";
import { fatiaDaPagina, paginaValida, totalDePaginas } from "@/lib/pitches";
import {
  carregarFontes,
  congelarPodio,
  dataDosCertificadosChegou,
  descartarArquivo,
  despublicarCertificado,
  enviarFonte,
  enviarImagemModelo,
  listarFontes,
  listarModelos,
  podioCongeladoEm,
  previaCertificados,
  publicarCertificado,
  salvarModelo,
  type Destinatario,
  type ModeloGravado,
} from "@/services/certificadosService";
import { carregarConfiguracoes } from "@/services/configuracoesService";
import { PreviaCertificado } from "@/components/PreviaCertificado";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Certificados (migration 20261111120000).
 *
 * Um modelo por USO: o PNG, mais caixas de texto arrastadas sobre ele. O
 * texto aceita variáveis (`{titulo}`) e a marcação leve dos avisos
 * (`**negrito**`, `*itálico*`). Embaixo, a prévia de TODOS os destinatários
 * — o mesmo desenho que cada um vai baixar.
 *
 * Duas gravações diferentes, e os botões dizem qual é qual: SALVAR grava a
 * arte e as caixas (vale na hora para quem já baixa); PUBLICAR é o que
 * põe o certificado na fila da liberação. `publicado_em`/`liberado_em` só
 * mudam pelas RPCs — a tela nem tem como gravá-los.
 */

type Rascunho = { imagem: string; largura: number; altura: number; caixas: Caixa[] };

const POR_PAGINA = 6;
const LARGURA_EDITOR = 1000;

/** 'AAAA-MM-DDTHH:MM…' → 'DD/MM/AAAA às HH:MM', sem passar por `Date` (o valor não tem fuso). */
const momentoBr = (m: string) => `${m.slice(8, 10)}/${m.slice(5, 7)}/${m.slice(0, 4)} às ${m.slice(11, 16)}`;

const prender = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max);

const Certificados = () => {
  const [modelos, setModelos] = useState<Partial<Record<Uso, ModeloGravado>> | null>(null);
  const [erro, setErro] = useState(false);
  const [fontes, setFontes] = useState<string[]>([]);
  const [dataChegou, setDataChegou] = useState(false);
  const [dataLiberacao, setDataLiberacao] = useState<string | null>(null);
  const [podioEm, setPodioEm] = useState<string | null>(null);

  const [uso, setUso] = useState<Uso>("base");
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [sujo, setSujo] = useState(false);
  const [selecionada, setSelecionada] = useState(0);
  const [ocupado, setOcupado] = useState(false);

  const [destinatarios, setDestinatarios] = useState<Destinatario[]>([]);
  const [encolhidos, setEncolhidos] = useState<Set<string>>(new Set());
  const [soEncolhidos, setSoEncolhidos] = useState(false);
  const [pagina, setPagina] = useState(1);

  const palco = useRef<HTMLDivElement>(null);
  const campoTexto = useRef<HTMLTextAreaElement>(null);

  const recarregar = useCallback(async () => {
    try {
      const [m, f, chegou, podio, config] = await Promise.all([
        listarModelos(),
        listarFontes(),
        dataDosCertificadosChegou(),
        podioCongeladoEm(),
        carregarConfiguracoes(),
      ]);
      setModelos(m);
      setFontes(f);
      setDataChegou(chegou);
      setPodioEm(podio);
      setDataLiberacao(config?.certificados_liberacao ?? null);
    } catch {
      setErro(true);
    }
  }, []);

  useEffect(() => {
    recarregar();
  }, [recarregar]);

  const gravado = modelos?.[uso];

  // Trocar de uso (ou recarregar do banco) repõe o rascunho a partir do gravado.
  useEffect(() => {
    setRascunho(
      gravado
        ? { imagem: gravado.imagem, largura: gravado.largura, altura: gravado.altura, caixas: gravado.caixas }
        : null,
    );
    setSujo(false);
    setSelecionada(0);
  }, [gravado]);

  const carregarPrevia = useCallback(async () => {
    try {
      setDestinatarios(await previaCertificados(uso));
    } catch {
      setDestinatarios([]);
      toast.error("Não foi possível carregar os destinatários deste certificado.");
    }
  }, [uso]);

  useEffect(() => {
    setPagina(1);
    setSoEncolhidos(false);
    carregarPrevia();
  }, [carregarPrevia]);

  // Confere TODOS os destinatários (só medindo): quem precisou reduzir a fonte.
  useEffect(() => {
    let vivo = true;
    if (!rascunho) {
      setEncolhidos(new Set());
      return;
    }
    carregarFontes(rascunho.caixas).then(() => {
      const ctx = document.createElement("canvas").getContext("2d");
      if (!vivo || !ctx) return;
      setEncolhidos(
        new Set(destinatarios.filter((d) => precisaEncolher(ctx, rascunho, d.variaveis)).map((d) => d.chave)),
      );
    });
    return () => {
      vivo = false;
    };
  }, [rascunho, destinatarios]);

  const caixa = rascunho?.caixas[selecionada];
  const estado = estadoDoModelo(gravado, dataChegou);
  const ehPodio = USOS_DO_PODIO.includes(uso);

  const mudarCaixas = (caixas: Caixa[]) => {
    setRascunho((r) => (r ? { ...r, caixas } : r));
    setSujo(true);
  };
  const mudarCaixa = (parcial: Partial<Caixa>) => {
    if (!rascunho) return;
    mudarCaixas(rascunho.caixas.map((c, i) => (i === selecionada ? { ...c, ...parcial } : c)));
  };

  // Arrastar (mover) e puxar o canto (redimensionar), em fração do palco.
  const arrastar = (e: React.PointerEvent, indice: number, modo: "mover" | "medir") => {
    const area = palco.current?.getBoundingClientRect();
    const inicial = rascunho?.caixas[indice];
    if (!area || !inicial) return;
    e.preventDefault();
    e.stopPropagation();
    setSelecionada(indice);
    const x0 = e.clientX;
    const y0 = e.clientY;

    const mover = (ev: PointerEvent) => {
      const dx = (ev.clientX - x0) / area.width;
      const dy = (ev.clientY - y0) / area.height;
      const nova =
        modo === "mover"
          ? { x: prender(inicial.x + dx, 0, 1 - inicial.l), y: prender(inicial.y + dy, 0, 1 - inicial.a) }
          : { l: prender(inicial.l + dx, 0.03, 1 - inicial.x), a: prender(inicial.a + dy, 0.02, 1 - inicial.y) };
      setRascunho((r) =>
        r ? { ...r, caixas: r.caixas.map((c, i) => (i === indice ? { ...c, ...nova } : c)) } : r,
      );
      setSujo(true);
    };
    const soltar = () => {
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", soltar);
    };
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
  };

  // Escreve no texto da caixa preservando a seleção (mesma técnica do EditorTextoRico).
  const editarTexto = (edicao: (texto: string, inicio: number, fim: number) => { texto: string; inicio: number; fim: number }) => {
    const el = campoTexto.current;
    if (!el || !caixa) return;
    const r = edicao(caixa.texto, el.selectionStart, el.selectionEnd);
    mudarCaixa({ texto: r.texto });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(r.inicio, r.fim);
    });
  };
  const inserirVariavel = (nome: string) =>
    editarTexto((t, i, f) => {
      const marca = `{${nome}}`;
      return { texto: t.slice(0, i) + marca + t.slice(f), inicio: i + marca.length, fim: i + marca.length };
    });

  const comOcupado = async (acao: () => Promise<void>) => {
    setOcupado(true);
    try {
      await acao();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível concluir.");
    } finally {
      setOcupado(false);
    }
  };

  const enviarPng = (arquivo: File | undefined) =>
    arquivo &&
    comOcupado(async () => {
      // As medidas saem do próprio arquivo: são elas que fixam a proporção das caixas.
      const bitmap = await createImageBitmap(arquivo).catch(() => {
        throw new Error("O arquivo não é uma imagem PNG válida.");
      });
      const caminho = await enviarImagemModelo(uso, arquivo);
      try {
        // Trocar a arte grava na hora (as caixas atuais vão junto): imagem
        // no bucket sem linha apontando para ela seria um órfão.
        await salvarModelo(
          uso,
          { imagem: caminho, largura: bitmap.width, altura: bitmap.height, caixas: rascunho?.caixas ?? [] },
          !!gravado,
        );
      } catch (e) {
        await descartarArquivo(caminho);
        throw e;
      }
      if (gravado) await descartarArquivo(gravado.imagem);
      await recarregar();
      toast.success("Modelo enviado.");
    });

  const salvar = () =>
    rascunho &&
    comOcupado(async () => {
      await salvarModelo(uso, rascunho, true);
      await recarregar();
      toast.success("Modelo salvo.");
    });

  const publicar = () =>
    comOcupado(async () => {
      await publicarCertificado(uso);
      await Promise.all([recarregar(), carregarPrevia()]);
      toast.success("Certificado publicado.");
    });

  const despublicar = () =>
    comOcupado(async () => {
      await despublicarCertificado(uso);
      await recarregar();
      toast.success("Publicação desfeita.");
    });

  const congelar = () => {
    if (
      podioEm &&
      !window.confirm(
        "Recalcular o pódio substitui os três primeiros de cada categoria pelo ranking de agora. Quem saiu do pódio perde o certificado de colocação. Continuar?",
      )
    )
      return;
    comOcupado(async () => {
      const n = await congelarPodio();
      await Promise.all([recarregar(), carregarPrevia()]);
      toast.success(`Pódio congelado: ${n} colocação(ões).`);
    });
  };

  const enviarFonteNova = (arquivo: File | undefined) =>
    arquivo &&
    comOcupado(async () => {
      const caminho = await enviarFonte(arquivo);
      setFontes(await listarFontes());
      if (caixa) mudarCaixa({ fonte: caminho });
      toast.success("Fonte enviada.");
    });

  const visiveis = useMemo(
    () => (soEncolhidos ? destinatarios.filter((d) => encolhidos.has(d.chave)) : destinatarios),
    [soEncolhidos, destinatarios, encolhidos],
  );
  const paginas = totalDePaginas(visiveis.length, POR_PAGINA);
  const paginaAtual = paginaValida(pagina, paginas);
  // Sem destinatário ainda, a edição mostra as variáveis por extenso.
  const amostra = destinatarios[0]?.variaveis ?? {};

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Award className="h-6 w-6" /> Certificados
        </h1>
        <p className="text-muted-foreground">
          Envie o PNG de cada certificado, posicione as caixas de texto e confira a prévia de todos.
          Só o que for publicado é liberado
          {dataLiberacao ? ` — a liberação está marcada para ${momentoBr(dataLiberacao)}` : " — a data de liberação ainda não foi definida no Portal Admin"}
          . Publicado depois dessa data, o certificado sai na hora.
        </p>
      </div>

      {erro ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          Não foi possível carregar os certificados. Recarregue a página.
        </div>
      ) : modelos === null ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : (
        <>
          {/* Um botão por uso, nunca um seletor: escolher o uso errado
              publicaria o certificado de 1º lugar para todo mundo. */}
          <div className="flex flex-wrap gap-2">
            {USOS.map((u) => {
              const e = estadoDoModelo(modelos[u], dataChegou);
              return (
                <Button
                  key={u}
                  variant={u === uso ? "default" : "outline"}
                  size="sm"
                  disabled={ocupado}
                  onClick={() => {
                    if (sujo && !window.confirm("Há alterações não salvas neste modelo. Descartar?")) return;
                    setUso(u);
                  }}
                >
                  {ROTULO_USO[u]}
                  <span className="ml-2 text-[11px] opacity-70">
                    {!modelos[u] ? "sem modelo" : e === "liberado" ? "liberado" : e === "aguardando" ? "publicado" : "rascunho"}
                  </span>
                </Button>
              );
            })}
          </div>

          <Card className="shadow-[var(--shadow-card)]">
            <CardContent className="space-y-4 pt-6">
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex">
                  <input
                    type="file"
                    accept="image/png"
                    className="hidden"
                    disabled={ocupado}
                    onChange={(e) => {
                      enviarPng(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                  <Button asChild variant="outline" size="sm" disabled={ocupado}>
                    <span className="cursor-pointer">
                      <Upload className="mr-2 h-4 w-4" /> {gravado ? "Trocar o PNG" : "Enviar o PNG do modelo"}
                    </span>
                  </Button>
                </label>

                {rascunho && (
                  <>
                    <Button size="sm" onClick={salvar} disabled={ocupado || !sujo}>
                      Salvar modelo
                    </Button>
                    {estado === "rascunho" ? (
                      <Button size="sm" variant="secondary" onClick={publicar} disabled={ocupado || sujo}
                        title={sujo ? "Salve o modelo antes de publicar" : undefined}>
                        Publicar
                      </Button>
                    ) : estado === "aguardando" ? (
                      <Button size="sm" variant="outline" onClick={despublicar} disabled={ocupado}>
                        Desfazer publicação
                      </Button>
                    ) : null}
                    {ehPodio && (
                      <Button size="sm" variant="outline" onClick={congelar} disabled={ocupado}>
                        {podioEm ? "Recalcular o pódio" : "Congelar o pódio"}
                      </Button>
                    )}
                  </>
                )}

                <span className="ml-auto text-sm text-muted-foreground">
                  {estado === "liberado"
                    ? "Liberado — quem recebe já pode baixar. Alterações salvas valem na hora."
                    : estado === "aguardando"
                      ? dataLiberacao
                        ? `Publicado — sai em ${momentoBr(dataLiberacao)}.`
                        : "Publicado — aguardando a data de liberação ser definida."
                      : gravado
                        ? "Rascunho — ninguém recebe até publicar."
                        : ""}
                </span>
              </div>

              {ehPodio && (
                <p className="text-sm text-muted-foreground">
                  {podioEm
                    ? `Pódio congelado em ${new Date(podioEm).toLocaleString("pt-BR")}: os três primeiros de cada categoria ficaram fixos, e notas novas não mudam quem recebe.`
                    : "O pódio ainda não foi congelado. Publicar um certificado de colocação congela o ranking daquele momento."}
                </p>
              )}

              {!rascunho ? (
                <p className="py-10 text-center text-muted-foreground">
                  Este uso ainda não tem modelo. Envie o PNG para começar.
                </p>
              ) : (
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
                  {/* O palco: o certificado desenhado de verdade, com as caixas por cima. */}
                  <div ref={palco} className="relative select-none self-start" style={{ touchAction: "none" }}>
                    <PreviaCertificado modelo={rascunho} imagem={rascunho.imagem} variaveis={amostra} largura={LARGURA_EDITOR} />
                    {rascunho.caixas.map((c, i) => (
                      <div
                        key={i}
                        onPointerDown={(e) => arrastar(e, i, "mover")}
                        title="Arraste para mover"
                        style={{
                          position: "absolute",
                          left: `${c.x * 100}%`,
                          top: `${c.y * 100}%`,
                          width: `${c.l * 100}%`,
                          height: `${c.a * 100}%`,
                          border: `1.5px ${i === selecionada ? "solid #2563eb" : "dashed rgba(37,99,235,.55)"}`,
                          background: i === selecionada ? "rgba(37,99,235,.06)" : "transparent",
                          cursor: "move",
                        }}
                      >
                        <div
                          onPointerDown={(e) => arrastar(e, i, "medir")}
                          title="Arraste para redimensionar"
                          style={{
                            position: "absolute",
                            right: -6,
                            bottom: -6,
                            width: 12,
                            height: 12,
                            background: "#2563eb",
                            borderRadius: 2,
                            cursor: "nwse-resize",
                          }}
                        />
                      </div>
                    ))}
                  </div>

                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      {rascunho.caixas.map((_, i) => (
                        <Button key={i} size="sm" variant={i === selecionada ? "default" : "outline"} onClick={() => setSelecionada(i)}>
                          Caixa {i + 1}
                        </Button>
                      ))}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          mudarCaixas([...rascunho.caixas, caixaNova()]);
                          setSelecionada(rascunho.caixas.length);
                        }}
                      >
                        <Plus className="mr-1 h-4 w-4" /> Caixa de texto
                      </Button>
                    </div>

                    {!caixa ? (
                      <p className="text-sm text-muted-foreground">
                        Adicione uma caixa de texto e arraste-a sobre o certificado.
                      </p>
                    ) : (
                      <>
                        <div className="rounded-md border border-input">
                          <div className="flex flex-wrap items-center gap-1 border-b border-input px-1 py-1">
                            <Button type="button" variant="ghost" size="sm" className="h-8 px-2" title="Negrito" aria-label="Negrito"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => editarTexto((t, i, f) => envolverSelecao(t, i, f, "**"))}>
                              <Bold className="h-4 w-4" />
                            </Button>
                            <Button type="button" variant="ghost" size="sm" className="h-8 px-2" title="Itálico" aria-label="Itálico"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => editarTexto((t, i, f) => envolverSelecao(t, i, f, "*"))}>
                              <Italic className="h-4 w-4" />
                            </Button>
                            {VARIAVEIS_DO_USO[uso].map((v) => (
                              <Button key={v} type="button" variant="ghost" size="sm" className="h-8 px-2 font-mono text-xs"
                                title={`Inserir a variável {${v}}`}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => inserirVariavel(v)}>
                                {`{${v}}`}
                              </Button>
                            ))}
                          </div>
                          <textarea
                            ref={campoTexto}
                            className="block w-full resize-y rounded-b-md bg-transparent p-2 text-sm outline-none"
                            rows={5}
                            aria-label="Texto da caixa"
                            value={caixa.texto}
                            onChange={(e) => mudarCaixa({ texto: e.target.value })}
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <label className="col-span-2 text-sm">
                            <span className="form-label">Fonte</span>
                            <select className="form-input" value={caixa.fonte} onChange={(e) => mudarCaixa({ fonte: e.target.value })}>
                              {[...FONTES_EMBUTIDAS, ...fontes].map((f) => (
                                <option key={f} value={f}>
                                  {familiaDaFonte(f)}
                                  {f.startsWith("fontes/") ? " (enviada)" : ""}
                                </option>
                              ))}
                              {/* Fonte apagada do bucket: a caixa não pode perder o valor em silêncio. */}
                              {![...FONTES_EMBUTIDAS, ...fontes].includes(caixa.fonte) && (
                                <option value={caixa.fonte}>{familiaDaFonte(caixa.fonte)} (não encontrada)</option>
                              )}
                            </select>
                          </label>
                          <label className="text-sm">
                            <span className="form-label">Tamanho (% da altura)</span>
                            <input
                              type="number"
                              className="form-input"
                              min={0.5}
                              max={30}
                              step={0.1}
                              value={Number((caixa.tamanho * 100).toFixed(2))}
                              onChange={(e) => mudarCaixa({ tamanho: prender(Number(e.target.value) || 0.5, 0.5, 30) / 100 })}
                            />
                          </label>
                          <label className="text-sm">
                            <span className="form-label">Cor</span>
                            <input type="color" className="form-input" style={{ padding: 2, height: 40 }} value={caixa.cor}
                              onChange={(e) => mudarCaixa({ cor: e.target.value })} />
                          </label>
                          <label className="col-span-2 text-sm">
                            <span className="form-label">Alinhamento</span>
                            <select className="form-input" value={caixa.alinhamento}
                              onChange={(e) => mudarCaixa({ alinhamento: e.target.value as Alinhamento })}>
                              <option value="left">À esquerda</option>
                              <option value="center">Centralizado</option>
                              <option value="right">À direita</option>
                            </select>
                          </label>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <label className="inline-flex">
                            <input
                              type="file"
                              accept=".ttf,.otf,.woff2"
                              className="hidden"
                              disabled={ocupado}
                              onChange={(e) => {
                                enviarFonteNova(e.target.files?.[0]);
                                e.target.value = "";
                              }}
                            />
                            <Button asChild variant="outline" size="sm" disabled={ocupado}>
                              <span className="cursor-pointer">
                                <Upload className="mr-2 h-4 w-4" /> Enviar fonte
                              </span>
                            </Button>
                          </label>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              mudarCaixas(rascunho.caixas.filter((_, i) => i !== selecionada));
                              setSelecionada(0);
                            }}
                          >
                            <Trash2 className="mr-2 h-4 w-4" /> Remover caixa
                          </Button>
                        </div>

                        <p className="text-xs text-muted-foreground">
                          O texto quebra para baixo dentro da caixa. Se não couber na altura, a fonte
                          diminui até caber. Negrito e itálico de uma fonte enviada usam o arquivo que
                          você subiu: para um negrito desenhado, envie a versão Bold como outra fonte.
                        </p>
                      </>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {rascunho && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-lg font-semibold">
                  Prévia de todos ({destinatarios.length})
                </h2>
                {encolhidos.size > 0 && (
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={soEncolhidos}
                      onChange={(e) => {
                        setSoEncolhidos(e.target.checked);
                        setPagina(1);
                      }} />
                    Mostrar só os {encolhidos.size} em que a fonte precisou diminuir
                  </label>
                )}
              </div>

              {destinatarios.length === 0 ? (
                <Card className="shadow-[var(--shadow-card)]">
                  <CardContent className="py-10 text-center text-muted-foreground">
                    {ehPodio && !podioEm
                      ? "Sem destinatários: o pódio ainda não foi congelado."
                      : "Ninguém recebe este certificado ainda."}
                  </CardContent>
                </Card>
              ) : (
                <>
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {fatiaDaPagina(visiveis, paginaAtual, POR_PAGINA).map((d) => (
                      <div key={d.chave} className="space-y-1">
                        <PreviaCertificado modelo={rascunho} imagem={rascunho.imagem} variaveis={d.variaveis} />
                        <p className="truncate text-sm" title={d.variaveis.titulo ?? d.variaveis.nome}>
                          {d.variaveis.titulo ?? d.variaveis.nome}
                          {encolhidos.has(d.chave) && (
                            <span className="badge badge-amber ml-2">fonte reduzida</span>
                          )}
                        </p>
                      </div>
                    ))}
                  </div>
                  {paginas > 1 && (
                    <div className="flex items-center justify-center gap-3 text-sm">
                      <Button size="sm" variant="outline" disabled={paginaAtual <= 1} onClick={() => setPagina(paginaAtual - 1)}>
                        Anterior
                      </Button>
                      Página {paginaAtual} de {paginas}
                      <Button size="sm" variant="outline" disabled={paginaAtual >= paginas} onClick={() => setPagina(paginaAtual + 1)}>
                        Próxima
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default Certificados;
