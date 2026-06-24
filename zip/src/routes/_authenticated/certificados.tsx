import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Award, Download, Eye, Clock, X, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/certificados")({
  head: () => ({ meta: [{ title: "Certificados — Congresso UFLA Paraíso" }] }),
  component: Certificados,
});

function Certificados() {
  const { user } = useAuth();
  const uid = user!.id;
  const qc = useQueryClient();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const { data } = useQuery({
    queryKey: ["my-certs", uid],
    queryFn: async () => (await supabase.from("certificates").select("*").eq("user_id", uid).order("created_at", { ascending: false })).data ?? [],
  });

  useEffect(() => {
    const ch = supabase
      .channel("my-certs-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "certificates", filter: `user_id=eq.${uid}` },
        () => qc.invalidateQueries({ queryKey: ["my-certs", uid] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [uid, qc]);

  const getBlobUrl = async (path: string) => {
    const { data: file, error } = await supabase.storage.from("certificates").download(path);
    if (error || !file) { toast.error("Não foi possível baixar o arquivo"); return null; }
    return URL.createObjectURL(new Blob([file], { type: "application/pdf" }));
  };

  const closePreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
  };
  const preview = async (path: string) => { const url = await getBlobUrl(path); if (url) setPreviewUrl(url); };
  const download = async (path: string) => {
    const url = await getBlobUrl(path);
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = path.split("/").pop() || "certificado.pdf";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <AppLayout>
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-3xl md:text-4xl font-extrabold"
            style={{ backgroundImage: "var(--gradient-primary)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            Meus Certificados
          </h1>
          <p className="mt-1 text-muted-foreground">Pré-visualize ou baixe os certificados liberados</p>
        </div>

        {data?.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">
            <Award className="mx-auto mb-3 h-10 w-10" />
            Nenhum certificado emitido ainda.
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          {data?.map((c: any) => {
            const available = !!c.data_liberacao && !!c.arquivo_url;
            const validated = !!c.verified_at;
            return (
              <div key={c.id} className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5">
                <div className="flex items-start justify-between">
                  <Award className="h-8 w-8 text-primary" />
                  <div className="flex flex-col items-end gap-1">
                    <span className={`rounded-full px-3 py-0.5 text-xs ${available ? "bg-success/30 text-success-foreground" : "bg-muted text-muted-foreground"}`}>
                      {available ? "Disponível" : "Pendente"}
                    </span>
                    {validated && (
                      <span className="flex items-center gap-1 rounded-full bg-primary/15 text-primary px-2 py-0.5 text-[10px] font-medium">
                        <ShieldCheck className="h-3 w-3" /> Presença validada
                      </span>
                    )}
                  </div>
                </div>
                <h3 className="font-bold">{c.atividade}</h3>
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" /> {c.carga_horaria}h
                </p>
                {validated && (
                  <p className="text-[11px] text-muted-foreground">
                    Validado em {new Date(c.verified_at).toLocaleString("pt-BR")}
                  </p>
                )}
                <div className="flex gap-2">
                  <button disabled={!available} onClick={() => c.arquivo_url && preview(c.arquivo_url)}
                    className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-border px-3 py-2 text-sm font-medium disabled:opacity-50">
                    <Eye className="h-4 w-4" /> Pré-visualizar
                  </button>
                  <button disabled={!available} onClick={() => c.arquivo_url && download(c.arquivo_url)}
                    className="flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    style={{ backgroundImage: "var(--gradient-primary)" }}>
                    <Download className="h-4 w-4" /> Baixar
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {previewUrl && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/80 p-4" onClick={closePreview}>
          <div className="mb-2 flex items-center justify-end gap-2">
            <a href={previewUrl} target="_blank" rel="noreferrer" className="rounded-xl bg-card px-3 py-2 text-sm font-medium">
              Abrir em nova aba
            </a>
            <button onClick={closePreview} className="rounded-full bg-card p-2">
              <X className="h-5 w-5" />
            </button>
          </div>
          <object data={previewUrl} type="application/pdf" className="flex-1 rounded-2xl bg-white" onClick={(e) => e.stopPropagation()}>
            <iframe title="Pré-visualização do certificado" src={previewUrl} className="h-full w-full rounded-2xl bg-white" />
          </object>
        </div>
      )}
    </AppLayout>
  );
}
