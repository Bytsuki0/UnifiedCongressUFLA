import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { generateCertificatePdf } from "@/lib/certificate-pdf";
import {
  Award, CheckCircle2, GraduationCap, Calendar, ArrowLeft,
  Upload, Trash2, Search, FileText, ExternalLink,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/certificados")({
  head: () => ({ meta: [{ title: "Certificados — Admin" }] }),
  component: AdminCerts,
});

type Source = "minicourse" | "schedule";
type SelectedEvent = {
  source: Source;
  id: string;
  titulo: string;
  carga_horaria: number;
  template_url: string | null;
};

function AdminCerts() {
  const [tab, setTab] = useState<"emitir" | "emitidos">("emitir");
  const [selected, setSelected] = useState<SelectedEvent | null>(null);

  return (
    <AppLayout>
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-3xl font-extrabold"
            style={{ backgroundImage: "var(--gradient-primary)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            Gestão de Certificados
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Suba o template PDF do evento, selecione participantes e gere os certificados com QR code.
          </p>
        </div>

        <div className="flex gap-2 rounded-xl bg-muted p-1 w-fit">
          <button onClick={() => { setTab("emitir"); setSelected(null); }}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium ${tab === "emitir" ? "bg-card text-primary shadow-sm" : "text-muted-foreground"}`}>
            Emitir
          </button>
          <button onClick={() => setTab("emitidos")}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium ${tab === "emitidos" ? "bg-card text-primary shadow-sm" : "text-muted-foreground"}`}>
            Emitidos
          </button>
        </div>

        {tab === "emitir" && (selected
          ? <ParticipantPicker event={selected} setEvent={setSelected} onBack={() => setSelected(null)} />
          : <EventPicker onPick={setSelected} />)}

        {tab === "emitidos" && <IssuedList />}
      </div>
    </AppLayout>
  );
}

function EventPicker({ onPick }: { onPick: (e: SelectedEvent) => void }) {
  const minis = useQuery({
    queryKey: ["admin-cert-minis"],
    queryFn: async () => (await supabase.from("minicourses").select("id, nome, carga_horaria, data, horario_inicio, local, certificate_template_url").order("data")).data ?? [],
  });
  const sched = useQuery({
    queryKey: ["admin-cert-sched"],
    queryFn: async () => (await supabase.from("schedule").select("id, titulo, categoria, data, horario_inicio, horario_fim, local, certificate_template_url").order("data").order("horario_inicio")).data ?? [],
  });

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase text-muted-foreground">
          <GraduationCap className="h-4 w-4" /> Minicursos
        </h2>
        <div className="grid gap-3 md:grid-cols-2">
          {minis.data?.length === 0 && <Empty>Nenhum minicurso cadastrado.</Empty>}
          {minis.data?.map((m) => (
            <button key={m.id} onClick={() => onPick({ source: "minicourse", id: m.id, titulo: m.nome, carga_horaria: m.carga_horaria ?? 4, template_url: m.certificate_template_url })}
              className="flex flex-col items-start gap-1 rounded-2xl border border-border bg-card p-4 text-left hover:border-primary hover:shadow-[var(--shadow-soft)]">
              <span className="font-semibold">{m.nome}</span>
              <span className="text-xs text-muted-foreground">{m.data} • {m.horario_inicio} • {m.local}</span>
              <div className="mt-1 flex gap-2">
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">{m.carga_horaria ?? 4}h</span>
                {m.certificate_template_url && <span className="rounded-full bg-success/20 px-2 py-0.5 text-xs">Template OK</span>}
              </div>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase text-muted-foreground">
          <Calendar className="h-4 w-4" /> Programação
        </h2>
        <div className="grid gap-3 md:grid-cols-2">
          {sched.data?.length === 0 && <Empty>Nenhuma atividade cadastrada.</Empty>}
          {sched.data?.map((s) => (
            <button key={s.id} onClick={() => onPick({ source: "schedule", id: s.id, titulo: s.titulo, carga_horaria: 2, template_url: s.certificate_template_url })}
              className="flex flex-col items-start gap-1 rounded-2xl border border-border bg-card p-4 text-left hover:border-primary hover:shadow-[var(--shadow-soft)]">
              <span className="rounded-full bg-accent/40 px-2 py-0.5 text-xs">{s.categoria}</span>
              <span className="font-semibold">{s.titulo}</span>
              <span className="text-xs text-muted-foreground">{s.data} • {s.horario_inicio}–{s.horario_fim} • {s.local}</span>
              {s.certificate_template_url && <span className="mt-1 rounded-full bg-success/20 px-2 py-0.5 text-xs">Template OK</span>}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function ParticipantPicker({
  event, setEvent, onBack,
}: { event: SelectedEvent; setEvent: (e: SelectedEvent) => void; onBack: () => void }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [hours, setHours] = useState(event.carga_horaria);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const parts = useQuery({
    queryKey: ["cert-parts", event.source, event.id],
    queryFn: async () => {
      if (event.source === "minicourse") {
        const { data } = await supabase
          .from("minicourse_registrations")
          .select("user_id, profiles(id, nome, email, instituicao)")
          .eq("minicourse_id", event.id)
          .neq("status", "cancelled");
        return (data ?? []).map((r) => r.profiles).filter(Boolean) as Array<{ id: string; nome: string; email: string; instituicao: string }>;
      }
      const { data } = await supabase
        .from("congress_registrations")
        .select("user_id, profiles(id, nome, email, instituicao)")
        .eq("status", "approved");
      return (data ?? []).map((r) => r.profiles).filter(Boolean) as Array<{ id: string; nome: string; email: string; instituicao: string }>;
    },
  });

  const existing = useQuery({
    queryKey: ["cert-existing", event.titulo],
    queryFn: async () => (await supabase.from("certificates").select("user_id").eq("atividade", event.titulo)).data ?? [],
  });
  const alreadySet = useMemo(() => new Set((existing.data ?? []).map((c) => c.user_id)), [existing.data]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return (parts.data ?? []).filter((p) =>
      !q || p.nome?.toLowerCase().includes(q) || p.email?.toLowerCase().includes(q)
    );
  }, [parts.data, search]);

  const selectedIds = Object.keys(checked).filter((k) => checked[k]);
  const allSelected = filtered.length > 0 && filtered.every((p) => checked[p.id] || alreadySet.has(p.id));
  const toggleAll = () => {
    const next = { ...checked };
    if (allSelected) filtered.forEach((p) => { next[p.id] = false; });
    else filtered.forEach((p) => { if (!alreadySet.has(p.id)) next[p.id] = true; });
    setChecked(next);
  };

  const uploadTemplate = async (file: File) => {
    setUploading(true);
    try {
      const path = `${event.source}/${event.id}.pdf`;
      const { error } = await supabase.storage.from("certificate-templates").upload(path, file, { upsert: true, contentType: "application/pdf" });
      if (error) throw error;
      const table = event.source === "minicourse" ? "minicourses" : "schedule";
      const { error: upErr } = await supabase.from(table).update({ certificate_template_url: path }).eq("id", event.id);
      if (upErr) throw upErr;
      setEvent({ ...event, template_url: path });
      toast.success("Template salvo");
      qc.invalidateQueries({ queryKey: ["admin-cert-minis"] });
      qc.invalidateQueries({ queryKey: ["admin-cert-sched"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const previewTemplate = async () => {
    if (!event.template_url) return;
    const { data } = await supabase.storage.from("certificate-templates").createSignedUrl(event.template_url, 120);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  };

  const emit = useMutation({
    mutationFn: async () => {
      // Load template once
      let templateBytes: Uint8Array | null = null;
      if (event.template_url) {
        const { data, error } = await supabase.storage.from("certificate-templates").download(event.template_url);
        if (error) throw error;
        templateBytes = new Uint8Array(await data.arrayBuffer());
      }

      setProgress({ done: 0, total: selectedIds.length });
      const today = new Date().toLocaleDateString("pt-BR");
      const origin = typeof window !== "undefined" ? window.location.origin : "";

      for (let i = 0; i < selectedIds.length; i++) {
        const uid = selectedIds[i];
        const participant = (parts.data ?? []).find((p) => p.id === uid);
        if (!participant) continue;

        // 1) Insert row to get id & verification_code
        const { data: inserted, error: insErr } = await supabase
          .from("certificates")
          .insert({
            user_id: uid,
            atividade: event.titulo,
            carga_horaria: hours,
            event_id: event.id,
            event_source: event.source,
            data_liberacao: new Date().toISOString(),
          })
          .select("id, verification_code")
          .single();
        if (insErr) throw insErr;

        // 2) Generate PDF
        const pdfBytes = await generateCertificatePdf(templateBytes, {
          nome: participant.nome,
          atividade: event.titulo,
          carga_horaria: hours,
          data: today,
          verificationCode: inserted.verification_code ?? "",
          verifyUrl: `${origin}/verificar/${inserted.verification_code ?? ""}`,
        });

        // 3) Upload PDF
        const path = `${uid}/${inserted.id}-clickable.pdf`;
        const { error: upErr } = await supabase.storage.from("certificates")
          .upload(path, pdfBytes, { upsert: true, contentType: "application/pdf" });
        if (upErr) throw upErr;

        // 4) Save path
        await supabase.from("certificates").update({ arquivo_url: path }).eq("id", inserted.id);
        setProgress({ done: i + 1, total: selectedIds.length });
      }
    },
    onSuccess: () => {
      toast.success(`${selectedIds.length} certificado(s) gerado(s)`);
      setChecked({});
      setProgress(null);
      qc.invalidateQueries();
    },
    onError: (e: Error) => { toast.error(e.message); setProgress(null); },
  });

  return (
    <div className="flex flex-col gap-4">
      <button onClick={onBack} className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-primary">
        <ArrowLeft className="h-4 w-4" /> Voltar para eventos
      </button>

      <div className="rounded-2xl border border-border bg-card p-4">
        <p className="text-xs uppercase text-muted-foreground">{event.source === "minicourse" ? "Minicurso" : "Atividade"}</p>
        <h2 className="text-xl font-bold">{event.titulo}</h2>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm ${event.template_url ? "border-success/40 bg-success/10" : "border-dashed border-border bg-background text-muted-foreground"}`}>
            <Upload className="h-4 w-4" />
            {uploading ? "Enviando…" : event.template_url ? "Trocar template PDF" : "Subir template PDF"}
            <input type="file" accept="application/pdf" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadTemplate(f); }} />
          </label>
          {event.template_url && (
            <button onClick={previewTemplate}
              className="flex items-center gap-1 rounded-xl border border-border px-3 py-2 text-sm">
              <ExternalLink className="h-4 w-4" /> Ver template
            </button>
          )}
          {!event.template_url && (
            <span className="text-xs text-muted-foreground">
              <FileText className="inline h-3 w-3" /> Sem template, será usado um layout padrão.
            </span>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar nome ou e-mail"
            className="w-full rounded-xl border border-input bg-background py-2 pl-9 pr-3 text-sm" />
        </div>
        <label className="flex items-center gap-2 rounded-xl border border-input bg-background px-3 py-2 text-sm">
          <span className="text-muted-foreground">Horas</span>
          <input type="number" min={1} value={hours} onChange={(e) => setHours(+e.target.value)} className="w-16 bg-transparent outline-none" />
        </label>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase">
            <tr>
              <th className="w-10 p-3"><input type="checkbox" checked={allSelected} onChange={toggleAll} /></th>
              <th className="p-3 text-left">Participante</th>
              <th className="p-3 text-left">E-mail</th>
              <th className="p-3 text-center">Status</th>
            </tr>
          </thead>
          <tbody>
            {parts.isLoading && <tr><td colSpan={4} className="p-6 text-center text-muted-foreground">Carregando…</td></tr>}
            {!parts.isLoading && filtered.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-muted-foreground">Nenhum participante encontrado.</td></tr>}
            {filtered.map((p) => {
              const already = alreadySet.has(p.id);
              return (
                <tr key={p.id} className="border-t border-border">
                  <td className="p-3">
                    <input type="checkbox" disabled={already}
                      checked={!!checked[p.id]}
                      onChange={(e) => setChecked({ ...checked, [p.id]: e.target.checked })} />
                  </td>
                  <td className="p-3">{p.nome}</td>
                  <td className="p-3 text-muted-foreground">{p.email}</td>
                  <td className="p-3 text-center">
                    {already
                      ? <span className="rounded-full bg-success/30 px-2 py-0.5 text-xs text-success-foreground">Já emitido</span>
                      : <span className="text-xs text-muted-foreground">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between rounded-2xl border border-border bg-card p-4">
        <div className="text-sm">
          <span className="font-semibold">{selectedIds.length}</span>{" "}
          <span className="text-muted-foreground">selecionado(s)</span>
          {progress && (
            <span className="ml-3 text-xs text-primary">Gerando {progress.done}/{progress.total}…</span>
          )}
        </div>
        <button onClick={() => emit.mutate()} disabled={selectedIds.length === 0 || emit.isPending}
          className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          style={{ backgroundImage: "var(--gradient-primary)" }}>
          <CheckCircle2 className="h-4 w-4" />
          {emit.isPending ? "Gerando…" : "Gerar e liberar"}
        </button>
      </div>
    </div>
  );
}

function IssuedList() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const list = useQuery({
    queryKey: ["admin-certs-list"],
    queryFn: async () => (await supabase
      .from("certificates")
      .select("id, atividade, carga_horaria, data_liberacao, arquivo_url, verification_code, profiles(nome, email)")
      .order("created_at", { ascending: false })).data ?? [],
  });
  const del = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("certificates").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { toast.success("Removido"); qc.invalidateQueries(); },
  });

  const preview = async (path: string) => {
    const { data } = await supabase.storage.from("certificates").createSignedUrl(path, 120);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  };

  const filtered = (list.data ?? []).filter((c) => {
    if (!q) return true;
    const s = q.toLowerCase();
    return c.atividade?.toLowerCase().includes(s)
      || c.profiles?.nome?.toLowerCase().includes(s)
      || c.profiles?.email?.toLowerCase().includes(s);
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar atividade, nome ou e-mail"
          className="w-full rounded-xl border border-input bg-background py-2 pl-9 pr-3 text-sm" />
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase">
            <tr>
              <th className="p-3 text-left">Participante</th>
              <th className="p-3 text-left">Atividade</th>
              <th className="p-3 text-center">Horas</th>
              <th className="p-3 text-left">Código</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">Nenhum certificado emitido ainda.</td></tr>}
            {filtered.map((c) => (
              <tr key={c.id} className="border-t border-border">
                <td className="p-3">{c.profiles?.nome ?? "—"}<br /><span className="text-xs text-muted-foreground">{c.profiles?.email}</span></td>
                <td className="p-3">{c.atividade}</td>
                <td className="p-3 text-center">{c.carga_horaria}h</td>
                <td className="p-3 font-mono text-xs">{c.verification_code?.slice(0, 10)}…</td>
                <td className="p-3 text-right">
                  <div className="flex justify-end gap-1">
                    {c.arquivo_url && (
                      <button onClick={() => preview(c.arquivo_url!)} title="Ver"
                        className="rounded-lg border border-border p-1.5"><ExternalLink className="h-3.5 w-3.5" /></button>
                    )}
                    <button onClick={() => confirm("Excluir certificado?") && del.mutate(c.id)} title="Excluir"
                      className="rounded-lg border border-destructive p-1.5 text-destructive">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="col-span-full rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
      <Award className="mx-auto mb-2 h-6 w-6" /> {children}
    </div>
  );
}
