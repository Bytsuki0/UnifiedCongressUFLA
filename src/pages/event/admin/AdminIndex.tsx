import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AppLayout } from "@/components/event/AppLayout";
import { e } from "@/components/event/paths";
import { resumoDoEvento } from "@/services/usuariosService";
import { Users, Ticket, GraduationCap, IdCard, Calendar, ArrowRight } from "lucide-react";

export default function AdminIndex() {
  const stats = useQuery({
    queryKey: ["admin-stats"],
    queryFn: async () => {
      const r = await resumoDoEvento();
      return {
        users: r.estudantes + r.professores + r.avaliadores,
        regs: r.inscricoes,
        minis: r.minicursos,
        certs: r.certificados,
        sched: r.programacao,
      };
    },
  });

  const cards = [
    { to: e("/admin/usuarios"), label: "Usuários", icon: Users, value: stats.data?.users },
    { to: e("/admin/inscricoes"), label: "Inscrições", icon: Ticket, value: stats.data?.regs },
    { to: e("/admin/minicursos"), label: "Minicursos", icon: GraduationCap, value: stats.data?.minis },
    { to: e("/admin/programacao"), label: "Programação", icon: Calendar, value: stats.data?.sched },
    { to: e("/admin/certificados"), label: "Certificados", icon: IdCard, value: stats.data?.certs },
  ];

  return (
    <AppLayout>
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-3xl md:text-4xl font-extrabold"
            style={{ backgroundImage: "var(--gradient-primary)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            Painel Administrativo
          </h1>
          <p className="mt-1 text-muted-foreground">Gerencie o congresso, inscrições, minicursos e certificados</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((c) => (
            <Link key={c.to} to={c.to} className="group flex items-center justify-between rounded-2xl border border-border bg-card p-5 hover:shadow-[var(--shadow-soft)]">
              <div>
                <c.icon className="h-5 w-5 text-primary" />
                <p className="mt-3 text-xs uppercase text-muted-foreground">{c.label}</p>
                <p className="mt-1 text-2xl font-bold">{c.value ?? "—"}</p>
              </div>
              <ArrowRight className="h-5 w-5 text-muted-foreground transition group-hover:translate-x-1 group-hover:text-primary" />
            </Link>
          ))}
        </div>
      </div>
    </AppLayout>
  );
}
