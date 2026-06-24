import { Link } from "react-router-dom";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ShieldCheck, Search, ArrowLeft, XCircle, CheckCircle2 } from "lucide-react";
import { DecorativeBg } from "@/components/event/DecorativeBg";
import { Logo } from "@/components/event/Logo";

const sb = supabase as any;

export default function VerificarPublico() {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any | null>(null);
  const [notFound, setNotFound] = useState(false);

  const extractCode = (raw: string) => {
    const t = raw.trim();
    const m = t.match(/verificar\/([A-Za-z0-9]+)/i);
    return (m ? m[1] : t).replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  };

  const onSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const c = extractCode(code);
    if (!c) return;
    setLoading(true);
    setResult(null);
    setNotFound(false);
    const { data, error } = await sb.rpc("verify_certificate", { _code: c });
    setLoading(false);
    if (error || !data || data.length === 0) {
      setNotFound(true);
      return;
    }
    setResult(data[0]);
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <DecorativeBg />
      <div className="relative mx-auto flex min-h-screen max-w-2xl flex-col p-6 md:p-10">
        <div className="flex items-center justify-between">
          <Logo />
          <Link to="/" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Início
          </Link>
        </div>

        <div className="my-auto flex flex-col gap-6 py-10">
          <div className="text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 text-primary">
              <ShieldCheck className="h-7 w-7" />
            </div>
            <h1
              className="text-3xl md:text-4xl font-extrabold"
              style={{ backgroundImage: "var(--gradient-primary)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}
            >
              Verificar Certificado
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Informe o código de verificação para conferir a autenticidade.
            </p>
          </div>

          <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5">
            <label className="text-xs font-medium text-muted-foreground">Código ou link do certificado</label>
            <input
              value={code}
              onChange={(ev) => setCode(ev.target.value)}
              placeholder="ex.: 13b113a0576... ou https://.../verificar/abc123"
              className="rounded-xl border border-border bg-background px-4 py-3 text-sm font-mono outline-none focus:border-primary"
              autoFocus
            />
            <button
              type="submit"
              disabled={loading || !code.trim()}
              className="flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
              style={{ backgroundImage: "var(--gradient-primary)" }}
            >
              <Search className="h-4 w-4" />
              {loading ? "Verificando..." : "Verificar"}
            </button>
          </form>

          {notFound && (
            <div className="flex items-start gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm">
              <XCircle className="h-5 w-5 text-destructive shrink-0" />
              <div>
                <p className="font-semibold text-destructive">Certificado não encontrado</p>
                <p className="text-muted-foreground">Verifique o código e tente novamente.</p>
              </div>
            </div>
          )}

          {result && (
            <div className="flex flex-col gap-3 rounded-2xl border border-success/40 bg-success/10 p-5">
              <div className="flex items-center gap-2 text-success-foreground">
                <CheckCircle2 className="h-5 w-5 text-success" />
                <span className="font-semibold">Certificado autêntico</span>
              </div>
              <Field label="Participante" value={result.participante_nome ?? "—"} />
              <Field label="Instituição" value={result.participante_instituicao ?? "—"} />
              <Field label="Atividade" value={result.atividade} />
              <Field label="Carga horária" value={`${result.carga_horaria}h`} />
              <Field label="Emitido em" value={new Date(result.data_liberacao).toLocaleString("pt-BR")} />
              <Field label="Código" value={result.verification_code} mono />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={`text-sm ${mono ? "font-mono" : "font-medium"}`}>{value}</span>
    </div>
  );
}
