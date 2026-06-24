import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { Calendar, MapPin, FileText, CheckCircle2, XCircle, QrCode, GraduationCap, Clock, User } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

export const Route = createFileRoute("/_authenticated/inscricao")({
  head: () => ({ meta: [{ title: "Minhas inscrições — Congresso UFLA Paraíso" }] }),
  component: Inscricao,
});

function Inscricao() {
  const { user } = useAuth();
  const uid = user!.id;
  const qc = useQueryClient();

  const reg = useQuery({
    queryKey: ["congress-reg", uid],
    queryFn: async () => (await supabase.from("congress_registrations").select("*").eq("user_id", uid).maybeSingle()).data,
  });

  const myMinis = useQuery({
    queryKey: ["my-minis-full", uid],
    queryFn: async () => {
      const { data } = await supabase
        .from("minicourse_registrations")
        .select("id, minicourse_id, status, minicourses(id, nome, descricao, ministrante, data, horario_inicio, horario_fim, local)")
        .eq("user_id", uid);
      return data ?? [];
    },
  });

  const register = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("congress_registrations").insert({ user_id: uid });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Inscrição realizada!"); qc.invalidateQueries({ queryKey: ["congress-reg", uid] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const cancel = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("congress_registrations").delete().eq("user_id", uid);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Inscrição cancelada"); qc.invalidateQueries({ queryKey: ["congress-reg", uid] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const unsubMini = useMutation({
    mutationFn: async (minicourse_id: string) => {
      const { error } = await supabase.from("minicourse_registrations").delete().eq("user_id", uid).eq("minicourse_id", minicourse_id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Inscrição cancelada"); qc.invalidateQueries(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const inscrito = !!reg.data;
  const minis = myMinis.data ?? [];

  return (
    <AppLayout>
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-3xl md:text-4xl font-extrabold"
            style={{ backgroundImage: "var(--gradient-primary)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            Minhas inscrições
          </h1>
          <p className="mt-1 text-muted-foreground">Congresso, minicursos e seu QR Code de presença em um só lugar.</p>
        </div>


        {/* CONGRESSO */}
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-bold">Congresso</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <InfoCard icon={Calendar} title="Data" text="14 a 16 de maio, 2026" />
            <InfoCard icon={MapPin} title="Local" text="UFLA — Campus Paraíso" />
            <InfoCard icon={FileText} title="Carga horária" text="40 horas certificadas" />
          </div>

          <div className="rounded-2xl p-6" style={{ backgroundImage: "var(--gradient-soft)" }}>
            {inscrito ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-primary font-semibold">
                  <CheckCircle2 className="h-5 w-5" /> Você está inscrito no congresso!
                </div>
                <button
                  onClick={() => cancel.mutate()} disabled={cancel.isPending}
                  className="flex items-center gap-1 rounded-xl border border-destructive bg-card px-4 py-2 text-sm font-medium text-destructive hover:bg-destructive/5"
                >
                  <XCircle className="h-4 w-4" /> Cancelar inscrição
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm">Você ainda não está inscrito no congresso.</p>
                <button
                  onClick={() => register.mutate()} disabled={register.isPending}
                  className="rounded-xl px-6 py-3 text-sm font-semibold text-white disabled:opacity-60"
                  style={{ backgroundImage: "var(--gradient-primary)" }}
                >
                  {register.isPending ? "Inscrevendo..." : "Realizar inscrição"}
                </button>
              </div>
            )}
          </div>
        </section>

        {/* MINICURSOS */}
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-bold">Meus minicursos</h2>
            <Link to="/minicursos" className="text-sm font-medium text-primary hover:underline">
              Explorar minicursos →
            </Link>
          </div>

          {myMinis.isLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}
          {!myMinis.isLoading && minis.length === 0 && (
            <div className="rounded-2xl border border-dashed border-border p-6 text-center">
              <GraduationCap className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-2 text-sm text-muted-foreground">Você ainda não se inscreveu em nenhum minicurso.</p>
              <Link to="/minicursos" className="mt-3 inline-block rounded-xl px-4 py-2 text-sm font-semibold text-white"
                style={{ backgroundImage: "var(--gradient-primary)" }}>
                Ver minicursos disponíveis
              </Link>
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            {minis.map((r) => {
              const m = r.minicourses as { id: string; nome: string; descricao: string | null; ministrante: string; data: string; horario_inicio: string; horario_fim: string; local: string } | null;
              if (!m) return null;
              return (
                <div key={r.id} className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-5">
                  <h3 className="font-bold">{m.nome}</h3>
                  {m.descricao && <p className="text-xs text-muted-foreground line-clamp-2">{m.descricao}</p>}
                  <div className="grid grid-cols-1 gap-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><User className="h-3 w-3" /> {m.ministrante}</span>
                    <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {m.data} · {m.horario_inicio}–{m.horario_fim}</span>
                    <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {m.local}</span>
                  </div>

                  <div className="mt-2 flex flex-col items-center gap-2 rounded-xl border border-border bg-background p-3">
                    <div className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                      <QrCode className="h-3 w-3" /> QR de presença deste minicurso
                    </div>
                    <div className="rounded-lg bg-white p-2">
                      <QRCodeSVG value={`att:minicourse:${m.id}:${uid}`} size={150} />
                    </div>
                  </div>

                  <button
                    onClick={() => unsubMini.mutate(m.id)}
                    className="mt-1 flex items-center justify-center gap-1 rounded-xl border border-destructive px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/5"
                  >
                    <XCircle className="h-3 w-3" /> Cancelar inscrição
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </AppLayout>
  );
}

function InfoCard({ icon: Icon, title, text }: { icon: React.ComponentType<{ className?: string }>; title: string; text: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <Icon className="h-5 w-5 text-primary" />
      <p className="mt-2 text-xs uppercase text-muted-foreground">{title}</p>
      <p className="mt-1 font-semibold">{text}</p>
    </div>
  );
}
