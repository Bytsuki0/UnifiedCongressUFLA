import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Gavel, Lightbulb, Lock } from "lucide-react";
import {
  AnaliseEditorial,
  carregarAnaliseEditorial,
  DECISAO_BADGE,
  DECISAO_LABEL,
  DECISAO_OPTIONS,
  DecisaoEditorial,
  registrarParecerEditorial,
} from "@/services/parecerEditorialService";
import { ParecerCompleto } from "@/components/co-chairs/ParecerCompleto";
import { PdfViewer } from "@/components/PdfViewer";
import { VideoViewer } from "@/components/VideoViewer";
import { resolvePdfUrl } from "@/lib/pdfStorage";
import { rotuloTipoResumo } from "@/lib/submissao";
import { RESULTADO_OPTIONS } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const SUGESTAO_LABEL = Object.fromEntries(
  RESULTADO_OPTIONS.map((o) => [o.value, o.label]),
) as Record<string, string>;

type Coautor = { nome?: string; email?: string };

/**
 * A tela onde a decisão do trabalho é tomada.
 *
 * É o contraponto deliberado da tela do revisor: lá `COLUNAS_VISIVEIS`
 * corta autoria, orientador e coautores para que a avaliação seja às
 * cegas; aqui tudo aparece, inclusive o nome de quem assinou cada
 * parecer. Quem decide o desfecho precisa ver o conjunto — e é
 * justamente por isso que quem decide não é quem avalia.
 *
 * A moda dos pareceres continua sendo calculada e mostrada, mas como
 * SUGESTÃO. Ela era a decisão até 20260820140000.
 */
const ParecerEditorialDetalhe = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [analise, setAnalise] = useState<AnaliseEditorial | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [visor, setVisor] = useState<"pdf" | "video">("pdf");
  const [decisao, setDecisao] = useState<DecisaoEditorial | "">("");
  const [comentario, setComentario] = useState("");
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const dados = await carregarAnaliseEditorial(id);
      if (!dados) {
        toast.error("Trabalho não encontrado.");
        navigate("/co-chairs/parecer-editorial");
        return;
      }
      setAnalise(dados);
      setPdfUrl(await resolvePdfUrl(dados.trabalho.pdf_url));
      // Rever uma decisão abre o formulário com o que já está registrado:
      // o co-chair corrige o que quer, não redigita tudo.
      if (dados.decisao) {
        setDecisao(dados.decisao.decisao);
        setComentario(dados.decisao.comentario);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao carregar a análise.");
    } finally {
      setLoading(false);
    }
  }, [id, navigate]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const registrar = async () => {
    if (!analise || !decisao) {
      toast.error("Escolha a decisão final.");
      return;
    }
    setSalvando(true);
    try {
      await registrarParecerEditorial({
        trabalhoId: analise.trabalho.id,
        decisao,
        comentario,
      });
      toast.success("Parecer editorial registrado.");
      navigate("/co-chairs/parecer-editorial");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao registrar a decisão.");
      setSalvando(false);
    }
  };

  if (loading || !analise) {
    return <p className="text-muted-foreground">Carregando...</p>;
  }

  const { trabalho, categoria, pareceres, anteriores, revisores, sugestao, historico, travada } =
    analise;
  const coautores = (Array.isArray(trabalho.coautores) ? trabalho.coautores : []) as Coautor[];
  const semParecer = revisores.filter(
    (r) => !pareceres.some((p) => p.revisor_email.toLowerCase() === r.revisor_email.toLowerCase()),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/co-chairs/parecer-editorial">
            <ArrowLeft className="mr-2 h-4 w-4" /> Voltar
          </Link>
        </Button>
        {trabalho.rodada > 1 && (
          <Badge variant="outline">{trabalho.rodada}ª rodada de avaliação</Badge>
        )}
      </div>

      {/* ---- Identificação: tudo que o revisor NÃO vê ---- */}
      <Card className="shadow-[var(--shadow-card)]">
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            {categoria && <Badge variant="secondary">{categoria.nome}</Badge>}
            <Badge variant="outline">{rotuloTipoResumo(trabalho.tipo_resumo)}</Badge>
            <span className="text-xs text-muted-foreground">
              Submetido em {new Date(trabalho.data_submissao).toLocaleDateString("pt-BR")}
            </span>
          </div>
          <CardTitle className="text-2xl">{trabalho.titulo}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div>
            <h3 className="mb-1 text-sm font-semibold text-muted-foreground">Autores</h3>
            <p className="text-sm">{trabalho.autores}</p>
          </div>
          <div>
            <h3 className="mb-1 text-sm font-semibold text-muted-foreground">Orientador</h3>
            <p className="text-sm">{trabalho.orientador_email || "—"}</p>
          </div>
          <div>
            <h3 className="mb-1 text-sm font-semibold text-muted-foreground">Coautores</h3>
            {coautores.length === 0 ? (
              <p className="text-sm text-muted-foreground">—</p>
            ) : (
              <ul className="space-y-0.5 text-sm">
                {coautores.map((c, i) => (
                  <li key={i}>
                    {c.nome || "(sem nome)"}
                    {c.email && <span className="text-muted-foreground"> — {c.email}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="mb-1 text-sm font-semibold text-muted-foreground">Palavras-chave</h3>
            <div className="flex flex-wrap gap-1.5">
              {(trabalho.palavras_chave ?? []).length === 0 ? (
                <span className="text-sm text-muted-foreground">—</span>
              ) : (
                trabalho.palavras_chave.map((p) => (
                  <Badge key={p} variant="outline" className="font-normal">
                    {p}
                  </Badge>
                ))
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ---- Conteúdo submetido: PDF e vídeo ---- */}
      <Card className="shadow-[var(--shadow-card)]">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Conteúdo submetido</CardTitle>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={visor === "pdf" ? "default" : "outline"}
              onClick={() => setVisor("pdf")}
            >
              PDF
            </Button>
            <Button
              size="sm"
              variant={visor === "video" ? "default" : "outline"}
              onClick={() => setVisor("video")}
            >
              Vídeo
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* `.pdf-viewer` é `position: relative` — PdfViewer e VideoViewer
              se posicionam por `inset: 0` dentro dele. Ver o contrato em
              components/PdfViewer.tsx. */}
          <div className="pdf-viewer" style={{ position: "relative", minHeight: 520 }}>
            {visor === "video" ? (
              trabalho.video_url ? (
                <VideoViewer url={trabalho.video_url} />
              ) : (
                <span className="text-sm text-muted-foreground">
                  Este trabalho não possui vídeo de apresentação.
                </span>
              )
            ) : pdfUrl ? (
              <PdfViewer url={pdfUrl} />
            ) : (
              <span className="text-sm text-muted-foreground">
                Este trabalho não possui arquivo PDF anexado.
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ---- Os pareceres, identificados ---- */}
      <Card className="shadow-[var(--shadow-card)]">
        <CardHeader>
          <CardTitle className="text-base">
            Pareceres recebidos ({pareceres.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {pareceres.map((p, i) => (
            <ParecerCompleto key={p.id} parecer={p} ordem={i + 1} />
          ))}

          {semParecer.length > 0 && (
            <p className="text-sm text-muted-foreground">
              Sem parecer até agora:{" "}
              {semParecer.map((r) => r.revisor_nome ?? r.revisor_email).join(", ")}.
            </p>
          )}

          {sugestao && (
            <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm">
              <Lightbulb className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                <strong>Sugestão pela moda dos pareceres: {SUGESTAO_LABEL[sugestao] ?? sugestao}.</strong>{" "}
                É só uma sugestão — era ela que decidia sozinha até esta tela existir. A decisão é sua.
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---- Rodadas anteriores ---- */}
      {anteriores.length > 0 && (
        <Accordion type="single" collapsible>
          <AccordionItem value="anteriores">
            <AccordionTrigger className="text-sm">
              Rodadas anteriores ({anteriores.length} parecer(es) arquivado(s))
            </AccordionTrigger>
            <AccordionContent className="space-y-3">
              {historico
                .filter((d) => d.rodada < trabalho.rodada)
                .map((d) => (
                  <div key={d.id} className="rounded-md border border-border p-3 text-sm">
                    <div className="mb-1 flex items-center gap-2">
                      <Badge variant="outline">{d.rodada}ª rodada</Badge>
                      <span className={DECISAO_BADGE[d.decisao]}>{DECISAO_LABEL[d.decisao]}</span>
                      {d.decidido_nome && (
                        <span className="text-xs text-muted-foreground">por {d.decidido_nome}</span>
                      )}
                    </div>
                    <p className="whitespace-pre-wrap text-muted-foreground">{d.comentario}</p>
                  </div>
                ))}
              {anteriores.map((p, i) => (
                <ParecerCompleto key={p.id} parecer={p} ordem={i + 1} />
              ))}
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}

      {/* ---- A decisão ---- */}
      <Card className="shadow-[var(--shadow-card)]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Gavel className="h-4 w-4" /> Decisão final
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {travada ? (
            <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm">
              <Lock className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                O autor já cumpriu esta decisão
                {analise.decisao && (
                  <>
                    {" "}
                    (<strong>{DECISAO_LABEL[analise.decisao.decisao]}</strong>)
                  </>
                )}
                . Ela não pode mais ser alterada — mudá-la agora deixaria o trabalho num estado que
                ninguém pediu.
              </span>
            </div>
          ) : (
            <>
              {analise.decisao && (
                <p className="text-sm text-muted-foreground">
                  Já existe uma decisão registrada nesta rodada (
                  <span className={DECISAO_BADGE[analise.decisao.decisao]}>
                    {DECISAO_LABEL[analise.decisao.decisao]}
                  </span>
                  ). Registrar outra a substitui; a anterior fica no histórico.
                </p>
              )}

              <div>
                <label className="mb-1 block text-sm font-medium">Decisão</label>
                <Select value={decisao} onValueChange={(v) => setDecisao(v as DecisaoEditorial)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Escolha a decisão final" />
                  </SelectTrigger>
                  <SelectContent>
                    {DECISAO_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {decisao && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {DECISAO_OPTIONS.find((o) => o.value === decisao)?.ajuda}
                  </p>
                )}
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium" htmlFor="comentario-editorial">
                  Comentário para o autor
                </label>
                <Textarea
                  id="comentario-editorial"
                  rows={6}
                  value={comentario}
                  onChange={(e) => setComentario(e.target.value)}
                  placeholder="Justifique a decisão. É este texto que o autor lê junto com os pareceres."
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Obrigatório. O autor vê a decisão e este comentário, sem a identificação de quem
                  decidiu.
                </p>
              </div>

              <Button
                onClick={registrar}
                disabled={salvando || !decisao || !comentario.trim()}
              >
                {salvando
                  ? "Registrando..."
                  : analise.decisao
                    ? "Atualizar decisão"
                    : "Registrar parecer editorial"}
              </Button>
            </>
          )}

          {historico.filter((d) => d.rodada === trabalho.rodada).length > 1 && (
            <Accordion type="single" collapsible>
              <AccordionItem value="hist">
                <AccordionTrigger className="text-sm">
                  Histórico desta rodada (
                  {historico.filter((d) => d.rodada === trabalho.rodada).length} registros)
                </AccordionTrigger>
                <AccordionContent className="space-y-2">
                  {historico
                    .filter((d) => d.rodada === trabalho.rodada)
                    .map((d, i) => (
                      <div key={d.id} className="rounded-md border border-border p-3 text-sm">
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                          {i === 0 && <Badge variant="secondary">vigente</Badge>}
                          <span className={DECISAO_BADGE[d.decisao]}>
                            {DECISAO_LABEL[d.decisao]}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {new Date(d.created_at).toLocaleString("pt-BR")}
                            {d.decidido_nome && ` · ${d.decidido_nome}`}
                          </span>
                        </div>
                        <p className="whitespace-pre-wrap text-muted-foreground">{d.comentario}</p>
                      </div>
                    ))}
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ParecerEditorialDetalhe;
