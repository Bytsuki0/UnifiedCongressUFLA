import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ClipboardList, Sparkles, Trash2, UserCheck, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  Avaliador,
  LIMITE_TRABALHOS_POR_AVALIADOR,
  MAX_REVISORES_POR_TRABALHO,
  Professor,
  ResultadoParecer,
  Trabalho,
  TrabalhoRevisor,
} from "@/lib/types";
import {
  associarRevisor,
  distribuirRevisoresAutomaticamente,
  removerRevisor,
  RevisorOption,
} from "@/services/revisorService";
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

type ParecerLite = { trabalho_id: string; revisor_email: string; resultado: ResultadoParecer };

const Atribuicoes = () => {
  const [avaliadores, setAvaliadores] = useState<Avaliador[]>([]);
  const [professores, setProfessores] = useState<Professor[]>([]);
  const [trabalhos, setTrabalhos] = useState<Trabalho[]>([]);
  const [revisores, setRevisores] = useState<TrabalhoRevisor[]>([]);
  const [pareceres, setPareceres] = useState<ParecerLite[]>([]);
  const [trabalhoId, setTrabalhoId] = useState<string>("");
  const [revisorEmail, setRevisorEmail] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const carregar = async () => {
    setLoading(true);
    try {
      const [{ data: av }, { data: pr }, { data: tr }, { data: rv }, { data: pa }] =
        await Promise.all([
          supabase.from("avaliadores").select("*").order("nome"),
          supabase.from("professores").select("*").order("nome"),
          supabase.from("trabalhos").select("*").order("titulo"),
          supabase.from("trabalho_revisores").select("*").order("created_at"),
          supabase.from("pareceres").select("trabalho_id, revisor_email, resultado"),
        ]);
      setAvaliadores((av ?? []) as Avaliador[]);
      setProfessores((pr ?? []) as Professor[]);
      setTrabalhos((tr ?? []) as Trabalho[]);
      setRevisores((rv ?? []) as TrabalhoRevisor[]);
      setPareceres((pa ?? []) as ParecerLite[]);
    } catch (e) {
      toast.error("Erro ao carregar dados");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregar();
  }, []);

  // Pool unificado de revisores: avaliadores + professores, únicos por e-mail.
  const revisorOptions = useMemo<RevisorOption[]>(() => {
    const map = new Map<string, RevisorOption>();
    avaliadores.forEach((a) => {
      if (a.email) map.set(a.email, { email: a.email, nome: a.nome, tipo: "avaliador" });
    });
    professores.forEach((p) => {
      if (p.email && !map.has(p.email)) map.set(p.email, { email: p.email, nome: p.nome, tipo: "professor" });
    });
    return Array.from(map.values()).sort((a, b) => a.nome.localeCompare(b.nome));
  }, [avaliadores, professores]);

  const trabalhosPorId = useMemo(() => new Map(trabalhos.map((t) => [t.id, t])), [trabalhos]);

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

  const revCount = trabalhoId ? (revisoresPorTrabalho.get(trabalhoId)?.length ?? 0) : 0;
  const revLimiteAtingido = revCount >= MAX_REVISORES_POR_TRABALHO;

  const handleAssociar = async () => {
    if (!trabalhoId || !revisorEmail) {
      toast.error("Selecione um trabalho e um revisor");
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

  const handleAuto = async () => {
    setSubmitting(true);
    try {
      const criados = await distribuirRevisoresAutomaticamente(
        revisorOptions,
        trabalhos.map((t) => t.id),
      );
      if (criados === 0) {
        toast.info("Nenhum trabalho disponível para distribuição automática");
      } else {
        toast.success(`${criados} associação(ões) criada(s) automaticamente`);
      }
      await carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro na distribuição");
    } finally {
      setSubmitting(false);
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

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <ClipboardList className="h-6 w-6" /> Atribuições
          </h1>
          <p className="text-muted-foreground">
            Associe revisores (avaliadores e professores, tratados igualmente) aos trabalhos. Até{" "}
            {MAX_REVISORES_POR_TRABALHO} revisores por trabalho · limite de {LIMITE_TRABALHOS_POR_AVALIADOR}{" "}
            trabalhos por revisor.
          </p>
        </div>
        <Button onClick={handleAuto} disabled={submitting || loading} variant="secondary">
          <Sparkles className="mr-2 h-4 w-4" />
          Distribuição automática
        </Button>
      </div>

      {/* Associação manual unificada */}
      <Card>
        <CardHeader>
          <CardTitle>Associar revisor</CardTitle>
          <CardDescription>
            Selecione um trabalho e um revisor — avaliadores e professores aparecem na mesma lista e são tratados da
            mesma forma. O revisor verá o trabalho no portal do revisor pelo e-mail associado.
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
                      {t.titulo} — {n}/{MAX_REVISORES_POR_TRABALHO}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            {trabalhoId && (
              <p className={`mt-1 text-xs ${revLimiteAtingido ? "text-destructive" : "text-muted-foreground"}`}>
                {revCount}/{MAX_REVISORES_POR_TRABALHO} revisores{revLimiteAtingido && " — limite atingido"}
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
                    Nenhum avaliador/professor cadastrado
                  </div>
                ) : (
                  revisorOptions.map((o) => {
                    const carga = cargaPorRevisor.get(o.email) ?? 0;
                    return (
                      <SelectItem key={o.email} value={o.email}>
                        {o.nome} · {TIPO_LABEL[o.tipo]} — {carga}/{LIMITE_TRABALHOS_POR_AVALIADOR}
                      </SelectItem>
                    );
                  })
                )}
              </SelectContent>
            </Select>
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
                    <Badge variant={lista.length >= MAX_REVISORES_POR_TRABALHO ? "destructive" : "secondary"}>
                      {lista.length}/{MAX_REVISORES_POR_TRABALHO}
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
            <p className="text-sm text-muted-foreground">Nenhum avaliador/professor cadastrado.</p>
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
                    <Badge variant={lista.length >= LIMITE_TRABALHOS_POR_AVALIADOR ? "destructive" : "secondary"}>
                      {lista.length}/{LIMITE_TRABALHOS_POR_AVALIADOR}
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
