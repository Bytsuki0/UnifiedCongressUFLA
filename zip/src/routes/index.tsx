import { createFileRoute, Link } from "@tanstack/react-router";
import { UserPlus, Calendar, Award, LogIn, Code2, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/Logo";
import { DecorativeBg } from "@/components/DecorativeBg";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Congresso Unificado UFLA Paraíso — QuadCode" },
      {
        name: "description",
        content:
          "Sistema de inscrição, programação e certificados do Congresso Unificado UFLA Paraíso.",
      },
    ],
  }),
  component: Home,
});

function Home() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <DecorativeBg />
      <div className="relative mx-auto flex min-h-screen max-w-5xl flex-col p-6 md:p-10">
        <div className="flex items-center justify-between">
          <Logo />
          <Code2 className="h-5 w-5 text-primary/70" />
        </div>

        <div className="my-auto flex flex-col items-center text-center py-12">
          <div className="rounded-2xl border-2 border-primary/70 px-6 py-5 md:px-12 md:py-8">
            <h1
              className="bg-clip-text text-4xl font-extrabold leading-tight text-transparent md:text-6xl"
              style={{
                backgroundImage: "var(--gradient-primary)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              Congresso Unificado
              <br />
              UFLA Paraíso
            </h1>
            <p className="mt-4 text-sm md:text-base text-muted-foreground">
              Sistema de Inscrição, Programação e Certificados
            </p>
          </div>

          <span
            className="mt-6 rounded-full px-4 py-1.5 text-xs font-medium text-primary"
            style={{ backgroundImage: "var(--gradient-soft)" }}
          >
            Congresso Unificado UFLA Paraíso
          </span>

          <div className="mt-8 flex w-full max-w-sm flex-col gap-3">
            <HomeButton to="/auth" icon={UserPlus} variant="primary">
              Cadastrar / Entrar
            </HomeButton>
            <HomeButton to="/programacao" icon={Calendar} variant="purple">
              Ver programação
            </HomeButton>
            <HomeButton to="/auth" icon={Award} variant="cyan">
              Meus certificados
            </HomeButton>
            <HomeButton to="/verificar" icon={ShieldCheck} variant="purple">
              Verificar certificado
            </HomeButton>
            <HomeButton to="/informacoes" icon={LogIn} variant="outline">
              Informações
            </HomeButton>
          </div>
        </div>
      </div>
    </div>
  );
}

function HomeButton({
  to,
  icon: Icon,
  variant,
  children,
}: {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  variant: "primary" | "purple" | "cyan" | "outline";
  children: React.ReactNode;
}) {
  const gradients: Record<string, string> = {
    primary: "var(--gradient-primary)",
    purple: "var(--gradient-purple)",
    cyan: "var(--gradient-cyan)",
  };

  if (variant === "outline") {
    return (
      <Link
        to={to}
        className="flex items-center justify-center gap-3 rounded-xl border-2 border-primary/60 bg-card px-5 py-3.5 text-sm font-semibold text-primary transition-all hover:bg-primary/5"
      >
        <Icon className="h-4 w-4" />
        {children}
      </Link>
    );
  }

  return (
    <Link
      to={to}
      className="flex items-center justify-center gap-3 rounded-xl px-5 py-3.5 text-sm font-semibold text-white shadow-[var(--shadow-soft)] transition-all hover:opacity-95"
      style={{ backgroundImage: gradients[variant] }}
    >
      <Icon className="h-4 w-4" />
      {children}
    </Link>
  );
}
