import { useEffect, useMemo, useState } from "react";
import {
  MAX_REVISORES_POR_TRABALHO,
  META_TRABALHOS_POR_REVISOR,
  Trabalho,
  TrabalhoRevisor,
} from "@/lib/types";
import {
  MotivoConflito,
  opcoesParaSlot,
  ParDistribuicao,
  RevisorOption,
} from "@/services/revisorService";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Radix recusa `SelectItem value=""`, então o slot vago precisa de um
 * valor de mentira. Ele nunca sai deste arquivo: vira `null` na saída.
 */
const VAZIO = "__vazio__";

const TIPO_LABEL: Record<"avaliador" | "professor", string> = {
  avaliador: "Avaliador",
  professor: "Professor",
};

type Props = {
  aberto: boolean;
  onOpenChange: (aberto: boolean) => void;
  /** Proposta vinda de `recomendar_distribuicao` — ponto de partida, não decisão. */
  plano: ParDistribuicao[];
  trabalhos: Trabalho[];
  pool: RevisorOption[];
  conflitos: Map<string, Map<string, MotivoConflito>>;
  /** Associações JÁ gravadas, de todos os trabalhos. */
  revisoresAtuais: TrabalhoRevisor[];
  confirmando: boolean;
  onConfirmar: (pares: { trabalho_id: string; revisor_email: string }[]) => void;
};

/**
 * A janela onde a distribuição deixa de ser automática.
 *
 * O que ela mostra é uma PROPOSTA: nada foi gravado quando ela abre, e
 * fechar no "Cancelar" não deixa rastro. Cada trabalho traz um seletor
 * por vaga, e o co-chair troca, esvazia ou completa o que quiser antes de
 * confirmar. Só o que estiver na tela no momento do "Confirmar" vira
 * associação — e vira tudo de uma vez, numa transação (`confirmar_distribuicao`).
 *
 * Os impedimentos aparecem desabilitados com o motivo ao lado, mas quem
 * recusa de verdade continua sendo o banco: `trg_conflito_revisor` e
 * `trg_max_revisores` disparam no INSERT. Isto aqui é cortesia, para a
 * pessoa não montar um lote que a transação inteira vai rejeitar no fim.
 */
const DialogoDistribuicao = ({
  aberto,
  onOpenChange,
  plano,
  trabalhos,
  pool,
  conflitos,
  revisoresAtuais,
  confirmando,
  onConfirmar,
}: Props) => {
  // trabalho_id -> e-mail escolhido por slot (null = vaga deixada em branco).
  const [escolhas, setEscolhas] = useState<Map<string, (string | null)[]>>(new Map());

  const revisoresPorTrabalho = useMemo(() => {
    const m = new Map<string, TrabalhoRevisor[]>();
    revisoresAtuais.forEach((r) => {
      const lista = m.get(r.trabalho_id) ?? [];
      lista.push(r);
      m.set(r.trabalho_id, lista);
    });
    return m;
  }, [revisoresAtuais]);

  // Carga já gravada, por e-mail em minúsculas — é assim que
  // `opcoesParaSlot` procura, e o pool vem do servidor em minúsculas.
  const cargaBase = useMemo(() => {
    const m = new Map<string, number>();
    revisoresAtuais.forEach((r) => {
      const chave = r.revisor_email.toLowerCase();
      m.set(chave, (m.get(chave) ?? 0) + 1);
    });
    return m;
  }, [revisoresAtuais]);

  // Só entram os trabalhos com vaga: os que já têm 3 revisores não têm o
  // que recomendar, e removê-los continua sendo pela lixeira da página.
  const linhas = useMemo(
    () =>
      trabalhos
        .map((t) => ({
          trabalho: t,
          associados: revisoresPorTrabalho.get(t.id) ?? [],
        }))
        .filter((l) => l.associados.length < MAX_REVISORES_POR_TRABALHO),
    [trabalhos, revisoresPorTrabalho],
  );

  // Semeia os slots com a proposta toda vez que a janela abre — reabrir
  // depois de um erro tem de trazer a recomendação nova, não a anterior.
  useEffect(() => {
    if (!aberto) return;
    const inicial = new Map<string, (string | null)[]>();
    linhas.forEach(({ trabalho, associados }) => {
      const vagas = MAX_REVISORES_POR_TRABALHO - associados.length;
      const propostos = plano
        .filter((p) => p.trabalho_id === trabalho.id)
        .map((p) => p.revisor_email);
      inicial.set(
        trabalho.id,
        Array.from({ length: vagas }, (_, i) => propostos[i] ?? null),
      );
    });
    setEscolhas(inicial);
    // `linhas` é derivado de props e muda de identidade a cada render do
    // pai; semear por ele reescreveria as escolhas do co-chair no meio da
    // edição. O gatilho é abrir a janela com uma proposta nova.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, plano]);

  const definirSlot = (trabalhoId: string, slot: number, email: string | null) => {
    setEscolhas((anterior) => {
      const proxima = new Map(anterior);
      const slots = [...(proxima.get(trabalhoId) ?? [])];
      slots[slot] = email;
      proxima.set(trabalhoId, slots);
      return proxima;
    });
  };

  const pares = useMemo(() => {
    const lista: { trabalho_id: string; revisor_email: string }[] = [];
    escolhas.forEach((slots, trabalhoId) => {
      slots.forEach((email) => {
        if (email) lista.push({ trabalho_id: trabalhoId, revisor_email: email });
      });
    });
    return lista;
  }, [escolhas]);

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Distribuição recomendada</DialogTitle>
          <DialogDescription>
            Esta é uma proposta — nada foi gravado ainda. Troque ou deixe em branco o que quiser; só as
            associações que estiverem aqui quando você confirmar serão criadas, e todas de uma vez. Autor,
            orientador e coautores aparecem impedidos. A carga é distribuída por igual, evitando passar de{" "}
            {META_TRABALHOS_POR_REVISOR} trabalhos por revisor — acima disso, só quando não sobra ninguém.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {pool.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum revisor no pool — conceda o papel de professor ou avaliador em Papéis (Portal Admin).
            </p>
          ) : linhas.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Todos os trabalhos já têm {MAX_REVISORES_POR_TRABALHO} revisores.
            </p>
          ) : (
            linhas.map(({ trabalho, associados }) => {
              const slots = escolhas.get(trabalho.id) ?? [];
              const escolhidos = slots.filter(Boolean).length;
              return (
                <div key={trabalho.id} className="space-y-3 rounded-md border border-border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-sm font-medium">{trabalho.titulo}</h3>
                    <Badge variant="secondary" className="shrink-0">
                      {associados.length + escolhidos}/{MAX_REVISORES_POR_TRABALHO}
                    </Badge>
                  </div>

                  {associados.length > 0 && (
                    <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      Já associado:
                      {associados.map((r) => (
                        <Badge key={r.id} variant="outline" className="font-normal">
                          {r.revisor_nome ?? r.revisor_email}
                        </Badge>
                      ))}
                    </p>
                  )}

                  <div className="grid gap-2">
                    {slots.map((emailDoSlot, i) => {
                      const opcoes = opcoesParaSlot({
                        pool,
                        conflitos,
                        cargaBase,
                        escolhas,
                        jaAssociados: associados.map((r) => r.revisor_email),
                        trabalhoId: trabalho.id,
                        slotAtual: i,
                      });
                      return (
                        <Select
                          key={i}
                          value={emailDoSlot ?? VAZIO}
                          onValueChange={(v) =>
                            definirSlot(trabalho.id, i, v === VAZIO ? null : v)
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione um revisor" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={VAZIO}>— deixar vago —</SelectItem>
                            {opcoes.map(({ opcao, desabilitado, motivo, carga, acimaDaMeta }) => (
                              <SelectItem
                                key={opcao.email}
                                value={opcao.email}
                                disabled={desabilitado}
                              >
                                {opcao.nome} · {TIPO_LABEL[opcao.tipo]}, {carga}/
                                {META_TRABALHOS_POR_REVISOR}
                                {/* Acima da meta continua selecionável — só avisa. */}
                                {acimaDaMeta && !motivo && " · acima da meta"}
                                {motivo && ` · ${motivo}`}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={confirmando}>
            Cancelar
          </Button>
          <Button onClick={() => onConfirmar(pares)} disabled={confirmando || pares.length === 0}>
            {confirmando
              ? "Confirmando..."
              : `Confirmar distribuição (${pares.length})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default DialogoDistribuicao;
