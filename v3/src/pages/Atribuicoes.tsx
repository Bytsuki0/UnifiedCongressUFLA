import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ClipboardList, Sparkles, Trash2, UserCheck, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  Avaliacao,
  AvaliacaoStatus,
  Avaliador,
  LIMITE_TRABALHOS_POR_AVALIADOR,
  Trabalho,
} from "@/lib/types";
import {
  atribuirTrabalho,
  distribuirAutomaticamente,
  listarAvaliacoes,
  removerAvaliacao,
  atualizarStatus,
} from "@/services/avaliacaoService";
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

const STATUS_LABEL: Record<AvaliacaoStatus, string> = {
  pendente: "Pendente",
  em_avaliacao: "Em avaliação",
  concluida: "Concluída",
};

const STATUS_VARIANT: Record<AvaliacaoStatus, "secondary" | "default" | "outline"> = {
  pendente: "secondary",
  em_avaliacao: "default",
  concluida: "outline",
};

const Atribuicoes = () => {
  const [avaliadores, setAvaliadores] = useState<Avaliador[]>([]);
  const [trabalhos, setTrabalhos] = useState<Trabalho[]>([]);
  const [avaliacoes, setAvaliacoes] = useState<Avaliacao[]>([]);
  const [avaliadorId, setAvaliadorId] = useState<string>("");
  const [trabalhoId, setTrabalhoId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const carregar = async () => {
    setLoading(true);
    try {
      const [{ data: av }, { data: tr }, avs] = await Promise.all([
        supabase.from("avaliadores").select("*").order("nome"),
        supabase.from("trabalhos").select("*").order("titulo"),
        listarAvaliacoes(),
      ]);
      setAvaliadores((av ?? []) as Avaliador[]);
      setTrabalhos((tr ?? []) as Trabalho[]);
      setAvaliacoes(avs);
    } catch (e) {
      toast.error("Erro ao carregar dados");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregar();
  }, []);

  // Mapas auxiliares
  const cargaPorAvaliador = useMemo(() => {
    const m = new Map<string, number>();
    avaliacoes.forEach((a) => m.set(a.avaliador_id, (m.get(a.avaliador_id) ?? 0) + 1));
    return m;
  }, [avaliacoes]);

  const avaliadoresPorId = useMemo(
    () => new Map(avaliadores.map((a) => [a.id, a])),
    [avaliadores],
  );
  const trabalhosPorId = useMemo(
    () => new Map(trabalhos.map((t) => [t.id, t])),
    [trabalhos],
  );

  const handleAtribuir = async () => {
    if (!avaliadorId || !trabalhoId) {
      toast.error("Selecione um avaliador e um trabalho");
      return;
    }
    setSubmitting(true);
    try {
      await atribuirTrabalho(avaliadorId, trabalhoId);
      toast.success("Trabalho atribuído com sucesso");
      setTrabalhoId("");
      await carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao atribuir");
    } finally {
      setSubmitting(false);
    }
  };

  const handleAuto = async () => {
    setSubmitting(true);
    try {
      const criados = await distribuirAutomaticamente(avaliadores, trabalhos);
      if (criados === 0) {
        toast.info("Nenhum trabalho disponível para distribuição automática");
      } else {
        toast.success(`${criados} atribuição(ões) criada(s) automaticamente`);
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
      await removerAvaliacao(id);
      toast.success("Atribuição removida");
      await carregar();
    } catch {
      toast.error("Erro ao remover");
    }
  };

  const handleStatusChange = async (id: string, status: AvaliacaoStatus) => {
    try {
      await atualizarStatus(id, status);
      setAvaliacoes((prev) => prev.map((a) => (a.id === id ? { ...a, status } : a)));
    } catch {
      toast.error("Erro ao atualizar status");
    }
  };

  const cargaSelecionada = avaliadorId
    ? cargaPorAvaliador.get(avaliadorId) ?? 0
    : 0;
  const limiteAtingido = cargaSelecionada >= LIMITE_TRABALHOS_POR_AVALIADOR;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <ClipboardList className="h-6 w-6" /> Atribuições
          </h1>
          <p className="text-muted-foreground">
            Distribua trabalhos entre os avaliadores. Limite: {LIMITE_TRABALHOS_POR_AVALIADOR} por avaliador.
          </p>
        </div>
        <Button onClick={handleAuto} disabled={submitting || loading} variant="secondary">
          <Sparkles className="mr-2 h-4 w-4" />
          Distribuição automática
        </Button>
      </div>

      {/* Atribuição manual */}
      <Card>
        <CardHeader>
          <CardTitle>Atribuição manual</CardTitle>
          <CardDescription>Selecione um avaliador e um trabalho para criar uma atribuição.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-[1fr_1fr_auto]">
          <div>
            <label className="mb-1 block text-sm font-medium">Avaliador</label>
            <Select value={avaliadorId} onValueChange={setAvaliadorId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione um avaliador" />
              </SelectTrigger>
              <SelectContent>
                {avaliadores.map((a) => {
                  const carga = cargaPorAvaliador.get(a.id) ?? 0;
                  return (
                    <SelectItem key={a.id} value={a.id}>
                      {a.nome} — {carga}/{LIMITE_TRABALHOS_POR_AVALIADOR}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            {avaliadorId && (
              <p className={`mt-1 text-xs ${limiteAtingido ? "text-destructive" : "text-muted-foreground"}`}>
                Carga atual: {cargaSelecionada}/{LIMITE_TRABALHOS_POR_AVALIADOR}
                {limiteAtingido && " — limite atingido"}
              </p>
            )}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Trabalho</label>
            <Select value={trabalhoId} onValueChange={setTrabalhoId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione um trabalho" />
              </SelectTrigger>
              <SelectContent>
                {trabalhos.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.titulo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button
              onClick={handleAtribuir}
              disabled={submitting || limiteAtingido || !avaliadorId || !trabalhoId}
              className="w-full md:w-auto"
            >
              Atribuir
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Visualização */}
      <Tabs defaultValue="por-avaliador">
        <TabsList>
          <TabsTrigger value="por-avaliador">
            <UserCheck className="mr-2 h-4 w-4" /> Por avaliador
          </TabsTrigger>
          <TabsTrigger value="por-trabalho">
            <FileText className="mr-2 h-4 w-4" /> Por trabalho
          </TabsTrigger>
        </TabsList>

        <TabsContent value="por-avaliador" className="space-y-4">
          {avaliadores.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhum avaliador cadastrado.</p>
          )}
          {avaliadores.map((av) => {
            const lista = avaliacoes.filter((a) => a.avaliador_id === av.id);
            const carga = lista.length;
            return (
              <Card key={av.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-base">{av.nome}</CardTitle>
                      <CardDescription>{av.instituicao}</CardDescription>
                    </div>
                    <Badge variant={carga >= LIMITE_TRABALHOS_POR_AVALIADOR ? "destructive" : "secondary"}>
                      {carga}/{LIMITE_TRABALHOS_POR_AVALIADOR}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  {lista.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Sem trabalhos atribuídos.</p>
                  ) : (
                    <ul className="space-y-2">
                      {lista.map((a) => {
                        const t = trabalhosPorId.get(a.trabalho_id);
                        return (
                          <li
                            key={a.id}
                            className="flex items-center justify-between gap-3 rounded-md border border-border p-3"
                          >
                            <span className="flex-1 text-sm font-medium">
                              {t?.titulo ?? "Trabalho removido"}
                            </span>
                            <Select
                              value={a.status}
                              onValueChange={(v) => handleStatusChange(a.id, v as AvaliacaoStatus)}
                            >
                              <SelectTrigger className="h-8 w-40">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {(Object.keys(STATUS_LABEL) as AvaliacaoStatus[]).map((s) => (
                                  <SelectItem key={s} value={s}>
                                    {STATUS_LABEL[s]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <RemoverBotao onConfirm={() => handleRemover(a.id)} />
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

        <TabsContent value="por-trabalho" className="space-y-4">
          {trabalhos.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhum trabalho cadastrado.</p>
          )}
          {trabalhos.map((t) => {
            const lista = avaliacoes.filter((a) => a.trabalho_id === t.id);
            return (
              <Card key={t.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{t.titulo}</CardTitle>
                    <Badge variant="secondary">{lista.length} avaliador(es)</Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  {lista.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nenhum avaliador atribuído.</p>
                  ) : (
                    <ul className="space-y-2">
                      {lista.map((a) => {
                        const av = avaliadoresPorId.get(a.avaliador_id);
                        return (
                          <li
                            key={a.id}
                            className="flex items-center justify-between rounded-md border border-border p-3"
                          >
                            <span className="text-sm">
                              <span className="font-medium">{av?.nome ?? "Avaliador removido"}</span>
                              {av && (
                                <span className="text-muted-foreground"> — {av.instituicao}</span>
                              )}
                            </span>
                            <Badge variant={STATUS_VARIANT[a.status]}>{STATUS_LABEL[a.status]}</Badge>
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
        <AlertDialogTitle>Remover atribuição?</AlertDialogTitle>
        <AlertDialogDescription>
          Esta ação não pode ser desfeita. O avaliador deixará de avaliar este trabalho.
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