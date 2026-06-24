import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Ticket, GraduationCap, Award, Calendar, ChevronRight } from "lucide-react";
import { AppLayout } from "@/components/event/AppLayout";
import { e } from "@/components/event/paths";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const sb = supabase as any;

export default function Dashboard() {
  const { user } = useAuth();
  const uid = user!.id;

  const profile = useQuery({
    queryKey: ["profile", uid],
    queryFn: async () => (await sb.from("profiles").select("*").eq("id", uid).maybeSingle()).data,
  });
  const congress = useQuery({
    queryKey: ["congress-reg", uid],
    queryFn: async () => (await sb.from("congress_registrations").select("*").eq("user_id", uid).maybeSingle()).data,
  });
  const minis = useQuery({
    queryKey: ["my-minis", uid],
    queryFn: async () =>
      (await sb
        .from("minicourse_registrations")
        .select("id, minicourses(nome, data, horario_inicio, local)")
        .eq("user_id", uid)).data ?? [],
  });
  const certs = useQuery({
    queryKey: ["my-certs", uid],
    queryFn: async () =>
      (await sb.from("certificates").select("*").eq("user_id", uid).not("data_liberacao", "is", null)).data ?? [],
  });
  const next = useQuery({
    queryKey: ["next-schedule"],
    queryFn: async () =>
      (await sb.from("schedule").select("*").order("data").order("horario_inicio").limit(3)).data ?? [],
  });

  const nome = profile.data?.nome?.split(" ")[0] ?? "Participante";

  return (
    <AppLayout>
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-3xl md:text-4xl font-extrabold"
            style={{ backgroundImage: "var(--gradient-primary)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            Olá, {nome}!
          </h1>
          <p className="mt-1 text-muted-foreground">Bem-vindo ao seu painel do congresso</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat icon={Ticket} label="Inscrição congresso"
            value={congress.data ? (congress.data.status === "approved" ? "Confirmada" : "Pendente") : "Não inscrito"} />
          <Stat icon={GraduationCap} label="Minicursos" value={String(minis.data?.length ?? 0)} />
          <Stat icon={Award} label="Certificados" value={String(certs.data?.length ?? 0)} />
          <Stat icon={Calendar} label="Próx. atividades" value={String(next.data?.length ?? 0)} />
        </div>

        <Section title="Próximas atividades">
          {next.data?.length === 0 && <Empty>Programação ainda não publicada</Empty>}
          {next.data?.map((a: any) => (
            <div key={a.id} className="flex items-center justify-between rounded-xl border border-border p-4">
              <div>
                <p className="font-semibold">{a.titulo}</p>
                <p className="text-xs text-muted-foreground">{a.data} • {a.horario_inicio} • {a.local}</p>
              </div>
              <span className="rounded-full bg-primary/10 px-3 py-0.5 text-xs text-primary">{a.categoria}</span>
            </div>
          ))}
          <Link to={e("/programacao")} className="self-end text-sm text-primary hover:underline">
            Ver tudo <ChevronRight className="inline h-3 w-3" />
          </Link>
        </Section>

        <Section title="Meus minicursos">
          {minis.data?.length === 0 && <Empty>Você ainda não inscreveu em minicursos. <Link to={e("/minicursos")} className="text-primary hover:underline">Ver minicursos</Link></Empty>}
          {minis.data?.map((m: any) => (
            <div key={m.id} className="rounded-xl border border-border p-4">
              <p className="font-semibold">{m.minicourses?.nome}</p>
              <p className="text-xs text-muted-foreground">{m.minicourses?.data} • {m.minicourses?.horario_inicio} • {m.minicourses?.local}</p>
            </div>
          ))}
        </Section>
      </div>
    </AppLayout>
  );
}

function Stat({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <Icon className="h-5 w-5 text-primary" />
      <p className="mt-3 text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-bold">{value}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{children}</div>;
}
