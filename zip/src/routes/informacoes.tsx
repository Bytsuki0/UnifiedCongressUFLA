import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Heart, MapPin, Clock, Wifi, Utensils, Award, Headphones, Trophy,
} from "lucide-react";
import { AppLayout } from "@/components/AppLayout";

export const Route = createFileRoute("/informacoes")({
  head: () => ({ meta: [{ title: "Informações — Congresso UFLA Paraíso" }] }),
  component: Informacoes,
});

const cards = [
  { icon: MapPin, title: "Local do evento", strong: "UFLA Paraíso", sub: "Bloco principal", color: "oklch(0.85 0.1 250)" },
  { icon: Clock, title: "Horário", strong: "08:00 às 22:00", sub: "Horário oficial do evento", color: "oklch(0.85 0.12 60)" },
  { icon: Wifi, title: "Wifi", strong: "Rede: UFLA_1", sub: "Senha: ufla_paraiso123", color: "oklch(0.85 0.12 160)" },
  { icon: Utensils, title: "Alimentação", strong: "Praça de alimentação", sub: "Diversas opções disponíveis", color: "oklch(0.85 0.1 295)" },
  { icon: Award, title: "Certificados", strong: "Liberados após confirmação", sub: "Disponíveis em certificado", color: "oklch(0.85 0.12 0)" },
  { icon: Headphones, title: "Suporte", strong: "quadcode@ufla.br", sub: "Atendimento via e-mail", color: "oklch(0.85 0.1 220)" },
];

function Informacoes() {
  return (
    <AppLayout>
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-3xl md:text-5xl font-extrabold"
            style={{ backgroundImage: "var(--gradient-primary)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            Informações Gerais
          </h1>
          <p className="mt-2 text-muted-foreground">Confira detalhes importantes do evento</p>
        </div>

        <div className="flex items-center gap-4 rounded-2xl bg-[var(--gradient-soft)] p-5">
          <Heart className="h-6 w-6 text-primary" />
          <div className="flex-1">
            <p className="font-semibold text-primary">Obrigado por participar do Congresso Unificado!</p>
            <p className="text-sm text-muted-foreground">
              Estamos felizes por ter você com a gente nesse grande evento.
            </p>
          </div>
          <Trophy className="h-8 w-8 text-[oklch(0.75_0.18_70)]" />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {cards.map((c) => (
            <div key={c.title} className="flex items-center gap-4 rounded-2xl border border-border bg-card p-4 shadow-sm">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl" style={{ background: c.color }}>
                <c.icon className="h-5 w-5 text-foreground/70" />
              </div>
              <div>
                <p className="font-semibold">{c.title}</p>
                <p className="text-sm font-medium text-primary">{c.strong}</p>
                <p className="text-xs text-muted-foreground">{c.sub}</p>
              </div>
            </div>
          ))}
        </div>

        <Link to="/"
          className="mt-4 flex items-center justify-center rounded-xl px-5 py-3.5 text-sm font-semibold text-white shadow-[var(--shadow-soft)] hover:opacity-95"
          style={{ backgroundImage: "var(--gradient-primary)" }}>
          Voltar ao início
        </Link>
      </div>
    </AppLayout>
  );
}
