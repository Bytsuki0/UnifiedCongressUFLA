import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AppLayout } from "@/components/event/AppLayout";
import {
  enviarAvatar,
  obterDadosDaConta,
  obterPerfil,
  salvarPerfil,
  urlAssinadaDoAvatar,
} from "@/services/perfilService";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Upload, UserCircle2, QrCode } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

const TIPO_POR_PAPEL: Record<string, string> = {
  admin: "Administrador",
  avaliador: "Avaliador",
  professor: "Professor",
  estudante: "Estudante",
  externo: "Participante externo",
};

export default function Perfil() {
  const { user, role } = useAuth();
  const uid = user!.id;
  const email = user!.email;
  const qc = useQueryClient();
  const { data: profile } = useQuery({
    queryKey: ["profile", uid],
    queryFn: () => obterPerfil(uid),
  });

  // Dados vindos do cadastro/login real (estudantes/professores/avaliadores).
  // Nome e curso são a fonte da verdade da conta logada.
  const { data: account } = useQuery({
    queryKey: ["account-perfil", email],
    queryFn: () => obterDadosDaConta(email!),
    enabled: !!email,
  });

  const [form, setForm] = useState({ telefone: "", instituicao: "" });
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  // Campos derivados da conta logada (somente leitura).
  const nome = account?.nome ?? user?.nome ?? "";
  const curso = account?.curso ?? profile?.curso ?? "";

  useEffect(() => {
    setForm({
      telefone: profile?.telefone ?? "",
      instituicao: profile?.instituicao ?? account?.instituicao ?? "",
    });
    if (profile?.foto_perfil) {
      urlAssinadaDoAvatar(profile.foto_perfil).then(setAvatarUrl);
    }
  }, [profile, account]);

  const save = useMutation({
    mutationFn: () =>
      // nome/curso vêm da conta logada e são gravados junto para manter o registro consistente.
      salvarPerfil({ userId: uid, email, nome, curso, ...form }),
    onSuccess: () => { toast.success("Perfil atualizado"); qc.invalidateQueries({ queryKey: ["profile", uid] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const upload = async (file: File) => {
    try {
      await enviarAvatar(uid, email, nome, file);
      qc.invalidateQueries({ queryKey: ["profile", uid] });
      toast.success("Foto atualizada");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao enviar a foto");
    }
  };

  return (
    <AppLayout>
      <div className="flex flex-col gap-6 max-w-2xl">
        <h1 className="text-3xl font-extrabold"
          style={{ backgroundImage: "var(--gradient-primary)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
          Meu Perfil
        </h1>

        <div className="flex items-center gap-4">
          <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full bg-muted">
            {avatarUrl ? <img src={avatarUrl} alt="" className="h-full w-full object-cover" /> : <UserCircle2 className="h-12 w-12 text-muted-foreground" />}
          </div>
          <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm hover:bg-accent/30">
            <Upload className="h-4 w-4" /> Trocar foto
            <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <ReadOnly label="Nome completo" value={nome} />
          <ReadOnly label="E-mail" value={email ?? ""} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Contas externas não têm curso/departamento. */}
          {curso && <ReadOnly label="Curso" value={curso} />}
          <ReadOnly label="Perfil" value={account?.tipo ?? (role ? TIPO_POR_PAPEL[role] ?? "" : "")} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Telefone" value={form.telefone} onChange={(v) => setForm({ ...form, telefone: v })} />
          <Input label="Instituição" value={form.instituicao} onChange={(v) => setForm({ ...form, instituicao: v })} />
        </div>

        <button
          onClick={() => save.mutate()} disabled={save.isPending}
          className="self-start rounded-xl px-6 py-3 text-sm font-semibold text-white disabled:opacity-60"
          style={{ backgroundImage: "var(--gradient-primary)" }}
        >
          {save.isPending ? "Salvando..." : "Salvar alterações"}
        </button>

        <div className="mt-2 rounded-2xl border border-border bg-card p-5 flex flex-col items-center gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <QrCode className="h-4 w-4 text-primary" /> Meu QR de presença
          </div>
          <p className="text-xs text-muted-foreground text-center max-w-xs">
            Mostre este QR para a organização confirmar sua presença em minicursos e atividades. O certificado é emitido automaticamente quando o evento é encerrado.
          </p>
          <div className="rounded-2xl bg-white p-4">
            <QRCodeSVG value={uid} size={192} includeMargin={false} />
          </div>
          <code className="text-[10px] text-muted-foreground break-all">{uid}</code>
        </div>
      </div>
    </AppLayout>
  );
}

function Input({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      <input className="rounded-xl border border-input bg-background px-4 py-2.5" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium text-muted-foreground">{label}</span>
      <input disabled className="rounded-xl border border-input bg-muted px-4 py-2.5 text-muted-foreground" value={value} />
    </label>
  );
}
