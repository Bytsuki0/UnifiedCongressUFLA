import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, XCircle, Award, Calendar, Clock, User } from "lucide-react";

export const Route = createFileRoute("/verificar/$codigo")({
  head: () => ({ meta: [{ title: "Verificar Certificado — UFLA Paraíso" }] }),
  component: Verify,
});

function Verify() {
  const { codigo } = Route.useParams();
  const { data, isLoading } = useQuery({
    queryKey: ["verify", codigo],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("verify_certificate", { _code: codigo });
      if (error) throw error;
      return (data?.[0] ?? null) as null | {
        verification_code: string;
        atividade: string;
        carga_horaria: number;
        data_liberacao: string;
        participante_nome: string | null;
        participante_instituicao: string | null;
      };
    },
  });

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-3xl border border-border bg-card p-8 shadow-[var(--shadow-card)]">
        {isLoading && <p className="text-center text-muted-foreground">Verificando…</p>}
        {!isLoading && !data && (
          <div className="text-center">
            <XCircle className="mx-auto h-16 w-16 text-destructive" />
            <h1 className="mt-4 text-2xl font-bold">Certificado não encontrado</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              O código <span className="font-mono">{codigo}</span> não corresponde a nenhum certificado liberado.
            </p>
          </div>
        )}
        {!isLoading && data && (
          <div>
            <div className="text-center">
              <CheckCircle2 className="mx-auto h-16 w-16 text-success" />
              <h1 className="mt-3 text-2xl font-bold">Certificado autêntico</h1>
              <p className="text-sm text-muted-foreground">Congresso Unificado UFLA Paraíso</p>
            </div>
            <div className="mt-6 space-y-3 rounded-2xl bg-muted/40 p-5 text-sm">
              <Row icon={<User className="h-4 w-4" />} label="Participante" value={data.participante_nome ?? "—"} />
              <Row icon={<Award className="h-4 w-4" />} label="Atividade" value={data.atividade} />
              <Row icon={<Clock className="h-4 w-4" />} label="Carga horária" value={`${data.carga_horaria}h`} />
              <Row icon={<Calendar className="h-4 w-4" />} label="Emitido em" value={new Date(data.data_liberacao).toLocaleDateString("pt-BR")} />
              {data.participante_instituicao && (
                <Row icon={<User className="h-4 w-4" />} label="Instituição" value={data.participante_instituicao} />
              )}
            </div>
            <p className="mt-4 text-center font-mono text-xs text-muted-foreground">{data.verification_code}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 text-primary">{icon}</div>
      <div className="flex-1">
        <div className="text-xs uppercase text-muted-foreground">{label}</div>
        <div className="font-medium">{value}</div>
      </div>
    </div>
  );
}
