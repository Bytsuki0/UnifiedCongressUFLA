import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Logo } from "@/components/Logo";
import { DecorativeBg } from "@/components/DecorativeBg";

export const Route = createFileRoute("/reset-password")({
  head: () => ({ meta: [{ title: "Redefinir senha" }] }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [pwd, setPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pwd.length < 8) return toast.error("Mínimo 8 caracteres");
    if (pwd !== confirm) return toast.error("Senhas não conferem");
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: pwd });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Senha atualizada!");
    navigate({ to: "/dashboard" });
  };

  return (
    <div className="relative min-h-screen bg-background">
      <DecorativeBg />
      <div className="relative mx-auto flex min-h-screen max-w-md flex-col p-6">
        <Logo />
        <form onSubmit={onSubmit} className="my-auto flex flex-col gap-4 rounded-3xl bg-card p-8 shadow-[var(--shadow-card)]">
          <h1 className="text-2xl font-bold">Redefinir senha</h1>
          <input
            type="password" placeholder="Nova senha"
            className="rounded-xl border border-input bg-background px-4 py-2.5 text-sm"
            value={pwd} onChange={(e) => setPwd(e.target.value)}
          />
          <input
            type="password" placeholder="Confirmar senha"
            className="rounded-xl border border-input bg-background px-4 py-2.5 text-sm"
            value={confirm} onChange={(e) => setConfirm(e.target.value)}
          />
          <button
            disabled={loading}
            className="rounded-xl py-3 text-sm font-semibold text-white"
            style={{ backgroundImage: "var(--gradient-primary)" }}
          >
            {loading ? "Salvando..." : "Atualizar senha"}
          </button>
        </form>
      </div>
    </div>
  );
}
