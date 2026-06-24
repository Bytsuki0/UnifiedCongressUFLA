import { createFileRoute, Link, useNavigate, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Eye, EyeOff, LogIn, UserPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Logo } from "@/components/Logo";
import { DecorativeBg } from "@/components/DecorativeBg";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Entrar — Congresso UFLA Paraíso" }] }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: "/dashboard" });
  },
  component: AuthPage,
});

const loginSchema = z.object({
  email: z.string().email("E-mail inválido"),
  password: z.string().min(1, "Informe a senha"),
});

const signupSchema = z
  .object({
    nome: z.string().min(3, "Nome obrigatório").max(120),
    cpf: z.string().min(11, "CPF obrigatório").max(14),
    email: z.string().email("E-mail inválido"),
    telefone: z.string().min(8).max(20),
    instituicao: z.string().min(2).max(120),
    curso: z.string().min(2).max(120),
    password: z.string().min(8, "Mínimo 8 caracteres"),
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, { message: "Senhas não conferem", path: ["confirm"] });

function AuthPage() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  return (
    <div className="relative min-h-screen bg-background">
      <DecorativeBg />
      <div className="relative mx-auto flex min-h-screen max-w-md flex-col p-6">
        <Link to="/" className="self-start"><Logo /></Link>
        <div className="my-auto rounded-3xl bg-card p-8 shadow-[var(--shadow-card)]">
          <div className="mb-6 flex gap-2 rounded-xl bg-muted p-1">
            <button
              onClick={() => setMode("login")}
              className={`flex-1 rounded-lg py-2 text-sm font-medium ${mode === "login" ? "bg-card shadow-sm text-primary" : "text-muted-foreground"}`}
            >
              <LogIn className="mr-1 inline h-4 w-4" /> Entrar
            </button>
            <button
              onClick={() => setMode("signup")}
              className={`flex-1 rounded-lg py-2 text-sm font-medium ${mode === "signup" ? "bg-card shadow-sm text-primary" : "text-muted-foreground"}`}
            >
              <UserPlus className="mr-1 inline h-4 w-4" /> Cadastrar
            </button>
          </div>
          {mode === "login" ? <LoginForm /> : <SignupForm onSuccess={() => setMode("login")} />}
        </div>
      </div>
    </div>
  );
}

function Field({
  label, error, children,
}: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium text-foreground">{label}</span>
      {children}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </label>
  );
}

const inputCls =
  "rounded-xl border border-input bg-background px-4 py-2.5 text-sm outline-none focus:border-primary";

function LoginForm() {
  const navigate = useNavigate();
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: z.infer<typeof loginSchema>) => {
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword(data);
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Bem-vindo!");
    navigate({ to: "/dashboard" });
  };

  const onReset = async () => {
    const email = (document.querySelector<HTMLInputElement>("input[name='email']"))?.value;
    if (!email) { toast.error("Digite seu e-mail acima primeiro"); return; }
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) toast.error(error.message);
    else toast.success("E-mail de recuperação enviado");
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <Field label="E-mail" error={errors.email?.message}>
        <input className={inputCls} type="email" {...register("email")} />
      </Field>
      <Field label="Senha" error={errors.password?.message}>
        <div className="relative">
          <input className={inputCls + " w-full pr-10"} type={showPwd ? "text" : "password"} {...register("password")} />
          <button type="button" onClick={() => setShowPwd((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
            {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </Field>
      <button type="button" onClick={onReset} className="self-end text-xs text-primary hover:underline">
        Esqueci minha senha
      </button>
      <button
        disabled={loading}
        type="submit"
        className="rounded-xl py-3 text-sm font-semibold text-white shadow-[var(--shadow-soft)] disabled:opacity-60"
        style={{ backgroundImage: "var(--gradient-primary)" }}
      >
        {loading ? "Entrando..." : "Entrar"}
      </button>
    </form>
  );
}

function SignupForm({ onSuccess }: { onSuccess: () => void }) {
  const [loading, setLoading] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm<z.infer<typeof signupSchema>>({
    resolver: zodResolver(signupSchema),
  });

  const onSubmit = async (d: z.infer<typeof signupSchema>) => {
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email: d.email,
      password: d.password,
      options: {
        emailRedirectTo: `${window.location.origin}/dashboard`,
        data: {
          nome: d.nome, cpf: d.cpf.replace(/\D/g, ""),
          telefone: d.telefone, instituicao: d.instituicao, curso: d.curso,
        },
      },
    });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Cadastro realizado! Faça login.");
    onSuccess();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-3">
      <Field label="Nome completo" error={errors.nome?.message}>
        <input className={inputCls} {...register("nome")} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="CPF" error={errors.cpf?.message}>
          <input className={inputCls} {...register("cpf")} />
        </Field>
        <Field label="Telefone" error={errors.telefone?.message}>
          <input className={inputCls} {...register("telefone")} />
        </Field>
      </div>
      <Field label="E-mail" error={errors.email?.message}>
        <input className={inputCls} type="email" {...register("email")} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Instituição" error={errors.instituicao?.message}>
          <input className={inputCls} {...register("instituicao")} />
        </Field>
        <Field label="Curso" error={errors.curso?.message}>
          <input className={inputCls} {...register("curso")} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Senha" error={errors.password?.message}>
          <input className={inputCls} type="password" {...register("password")} />
        </Field>
        <Field label="Confirmar senha" error={errors.confirm?.message}>
          <input className={inputCls} type="password" {...register("confirm")} />
        </Field>
      </div>
      <button
        disabled={loading}
        type="submit"
        className="mt-2 rounded-xl py-3 text-sm font-semibold text-white shadow-[var(--shadow-soft)] disabled:opacity-60"
        style={{ backgroundImage: "var(--gradient-primary)" }}
      >
        {loading ? "Cadastrando..." : "Criar conta"}
      </button>
    </form>
  );
}
