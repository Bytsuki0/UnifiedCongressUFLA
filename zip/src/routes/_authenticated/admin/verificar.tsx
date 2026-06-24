import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { generateCertificatePdf } from "@/lib/certificate-pdf";
import { Camera, X, Search, CheckCircle2, XCircle, Users, Award, RefreshCw } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/verificar")({
  head: () => ({ meta: [{ title: "Presença & Certificados — Admin" }] }),
  component: Verifier,
});

type EventType = "minicourse" | "schedule";
type Feedback = { ok: boolean; title: string; subtitle?: string; already?: boolean } | null;

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function Verifier() {
  const qc = useQueryClient();
  const [eventType, setEventType] = useState<EventType>("minicourse");
  const [eventId, setEventId] = useState<string>("");
  const [carga, setCarga] = useState<number>(4);
  const [code, setCode] = useState("");
  const [scanning, setScanning] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);
  const scannerRef = useRef<any>(null);
  const lastRef = useRef<{ code: string; at: number } | null>(null);

  const { data: minicourses } = useQuery({
    queryKey: ["mc-options"],
    queryFn: async () => {
      const { data } = await supabase
        .from("minicourses")
        .select("id, nome, carga_horaria, certificate_template_url")
        .order("data");
      return (data ?? []).map((m: any) => ({
        id: m.id,
        titulo: m.nome,
        carga_horaria: m.carga_horaria,
        template_url: m.certificate_template_url,
      }));
    },
  });
  const { data: schedule } = useQuery({
    queryKey: ["sch-options"],
    queryFn: async () =>
      (
        (
          await supabase
            .from("schedule")
            .select("id, titulo, certificate_template_url")
            .order("data")
        ).data ?? []
      ).map((s: any) => ({ ...s, template_url: s.certificate_template_url })),
  });

  const { data: attendances } = useQuery({
    queryKey: ["attendances", eventType, eventId],
    enabled: !!eventId,
    queryFn: async () => {
      const { data: atts, error } = await supabase
        .from("attendances")
        .select("id, user_id, checked_in_at")
        .eq("event_type", eventType)
        .eq("event_id", eventId)
        .order("checked_in_at", { ascending: false });
      if (error) throw error;
      const ids = Array.from(new Set((atts ?? []).map((a) => a.user_id)));
      let profMap: Record<string, { nome: string | null; email: string | null }> = {};
      if (ids.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, nome, email")
          .in("id", ids);
        profMap = Object.fromEntries(
          (profs ?? []).map((p) => [p.id, { nome: p.nome, email: p.email }]),
        );
      }
      return (atts ?? []).map((a) => ({ ...a, profile: profMap[a.user_id] ?? null }));
    },
  });

  useEffect(() => {
    if (!eventId) return;
    const ch = supabase
      .channel(`att-${eventType}-${eventId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "attendances", filter: `event_id=eq.${eventId}` },
        () => qc.invalidateQueries({ queryKey: ["attendances", eventType, eventId] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [eventId, eventType, qc]);

  // Auto-set carga from selected minicourse
  useEffect(() => {
    if (eventType === "minicourse" && eventId) {
      const m = (minicourses ?? []).find((x: any) => x.id === eventId);
      if (m?.carga_horaria) setCarga(m.carga_horaria);
    }
  }, [eventId, eventType, minicourses]);

  const eventLabel = useMemo(() => {
    const list = eventType === "minicourse" ? minicourses : schedule;
    return (list ?? []).find((x: any) => x.id === eventId)?.titulo ?? "";
  }, [eventId, eventType, minicourses, schedule]);

  const eventInfo = useMemo(() => {
    const list = eventType === "minicourse" ? minicourses : schedule;
    return (list ?? []).find((x: any) => x.id === eventId) ?? null;
  }, [eventId, eventType, minicourses, schedule]);

  const mark = async (raw: string) => {
    if (busy) return;
    const text = (raw || "").trim();
    if (!text) return;

    // Token format from participant QR: "att:<type>:<eventId>:<userId>"
    let useType: EventType = eventType;
    let useEventId = eventId;
    let uid = "";

    const tokenMatch = text.match(/^att:(minicourse|schedule):([0-9a-f-]{36}):([0-9a-f-]{36})$/i);
    if (tokenMatch) {
      useType = tokenMatch[1] as EventType;
      useEventId = tokenMatch[2];
      uid = tokenMatch[3];
      // Sync UI so the admin sees which event was just used
      if (useType !== eventType) setEventType(useType);
      if (useEventId !== eventId) setEventId(useEventId);
    } else {
      if (!eventId) {
        toast.error("QR sem evento — selecione um evento antes");
        return;
      }
      const m = text.match(UUID_RE);
      uid = m ? m[0] : text;
    }
    if (!uid) return;

    const dedupKey = `${useType}:${useEventId}:${uid}`;
    const now = Date.now();
    if (lastRef.current && lastRef.current.code === dedupKey && now - lastRef.current.at < 2500)
      return;
    lastRef.current = { code: dedupKey, at: now };

    setBusy(true);
    const { data, error } = await supabase.rpc("mark_attendance", {
      _event_type: useType,
      _event_id: useEventId,
      _user_id: uid,
    });
    setBusy(false);
    if (error) {
      setFeedback({ ok: false, title: "Erro", subtitle: error.message });
      toast.error("Falha ao marcar");
    } else {
      const row = (data?.[0] ?? null) as any;
      if (!row) {
        setFeedback({ ok: false, title: "Participante não encontrado" });
      } else {
        setFeedback({
          ok: true,
          title: row.participante_nome ?? row.participante_email ?? "Presença OK",
          subtitle: [row.evento_titulo, row.participante_email].filter(Boolean).join(" • "),
          already: row.already,
        });
        toast.success(row.already ? "Já estava presente" : "Presença marcada");
      }
    }
    setCode("");
    setTimeout(() => setFeedback(null), 3500);
  };

  useEffect(() => {
    if (!scanning) return;
    let cancelled = false;
    (async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        const inst = new Html5Qrcode("qr-reader");
        scannerRef.current = inst;
        await inst.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: 250 },
          (decoded) => {
            if (!cancelled) mark(decoded);
          },
          () => {},
        );
      } catch {
        toast.error("Não foi possível abrir a câmera");
        setScanning(false);
      }
    })();
    return () => {
      cancelled = true;
      if (scannerRef.current) {
        scannerRef.current
          .stop()
          .then(() => scannerRef.current?.clear())
          .catch(() => {});
        scannerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanning, eventId, eventType]);

  const closeEvent = async () => {
    if (!eventId) return;
    if (!attendances || attendances.length === 0) {
      toast.error("Nenhuma presença registrada");
      return;
    }
    if (
      !confirm(
        `Encerrar "${eventLabel}" e emitir ${attendances.length} certificado(s) com ${carga}h?`,
      )
    )
      return;
    setClosing(true);
    const { data, error } = await supabase.rpc("close_event_and_issue_certificates", {
      _event_type: eventType,
      _event_id: eventId,
      _carga_horaria: carga,
    });
    if (error) {
      toast.error(error.message);
      setClosing(false);
      return;
    }

    try {
      const certIds = (data ?? []).map((r: any) => r.certificate_id).filter(Boolean);
      const { data: certs, error: certErr } = await supabase
        .from("certificates")
        .select("id, user_id, atividade, carga_horaria, verification_code, arquivo_url")
        .in("id", certIds);
      if (certErr) throw certErr;

      const missing = (certs ?? []).filter((c: any) => !c.arquivo_url);
      if (missing.length) {
        const userIds = Array.from(new Set(missing.map((c: any) => c.user_id)));
        const { data: profiles, error: profErr } = await supabase
          .from("profiles")
          .select("id, nome")
          .in("id", userIds);
        if (profErr) throw profErr;
        const profileMap = Object.fromEntries((profiles ?? []).map((p: any) => [p.id, p]));

        let templateBytes: Uint8Array | null = null;
        if (eventInfo?.template_url) {
          const { data: template, error: tplErr } = await supabase.storage
            .from("certificate-templates")
            .download(eventInfo.template_url);
          if (tplErr) throw tplErr;
          templateBytes = new Uint8Array(await template.arrayBuffer());
        }

        const today = new Date().toLocaleDateString("pt-BR");
        const origin = typeof window !== "undefined" ? window.location.origin : "";
        for (const cert of missing as any[]) {
          const pdfBytes = await generateCertificatePdf(templateBytes, {
            nome: profileMap[cert.user_id]?.nome ?? "Participante",
            atividade: cert.atividade,
            carga_horaria: cert.carga_horaria,
            data: today,
            verificationCode: cert.verification_code ?? "",
            verifyUrl: `${origin}/verificar/${cert.verification_code ?? ""}`,
          });
          const path = `${cert.user_id}/${cert.id}-clickable.pdf`;
          const { error: uploadErr } = await supabase.storage
            .from("certificates")
            .upload(path, pdfBytes, { upsert: true, contentType: "application/pdf" });
          if (uploadErr) throw uploadErr;
          const { error: updateErr } = await supabase
            .from("certificates")
            .update({ arquivo_url: path })
            .eq("id", cert.id);
          if (updateErr) throw updateErr;
        }
      }
    } catch (e) {
      toast.error(`Certificado criado, mas PDF falhou: ${(e as Error).message}`);
      setClosing(false);
      return;
    }

    setClosing(false);
    const created = (data ?? []).filter((r: any) => r.created).length;
    const skipped = (data ?? []).length - created;
    toast.success(`${created} emitido(s)${skipped ? `, ${skipped} já existia(m)` : ""}`);
  };

  return (
    <AppLayout>
      <div className="flex flex-col gap-6 max-w-3xl">
        <div>
          <h1
            className="text-3xl font-extrabold"
            style={{
              backgroundImage: "var(--gradient-primary)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            Presença & Certificados
          </h1>
          <p className="text-sm text-muted-foreground">
            Escaneie o QR do participante — o evento é identificado automaticamente. Para colar
            UUID, selecione o evento abaixo.
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
          <div className="grid sm:grid-cols-2 gap-2">
            <select
              value={eventType}
              onChange={(e) => {
                setEventType(e.target.value as EventType);
                setEventId("");
              }}
              className="rounded-xl border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="minicourse">Minicurso</option>
              <option value="schedule">Programação</option>
            </select>
            <select
              value={eventId}
              onChange={(e) => setEventId(e.target.value)}
              className="rounded-xl border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">Selecione o evento…</option>
              {(eventType === "minicourse" ? minicourses : schedule)?.map((x: any) => (
                <option key={x.id} value={x.id}>
                  {x.titulo}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground">Carga horária do certificado:</label>
            <input
              type="number"
              min={1}
              value={carga}
              onChange={(e) => setCarga(parseInt(e.target.value || "0"))}
              className="w-20 rounded-lg border border-input bg-background px-2 py-1 text-sm"
            />
            <span className="text-xs text-muted-foreground">h</span>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
          <div className="flex gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && mark(code)}
              placeholder="Cole o código (UUID) do participante"
              className="flex-1 rounded-xl border border-input bg-background px-3 py-2 text-sm"
            />
            <button
              onClick={() => mark(code)}
              disabled={busy}
              className="flex items-center gap-2 rounded-xl px-4 text-sm font-semibold text-white disabled:opacity-60"
              style={{ backgroundImage: "var(--gradient-primary)" }}
            >
              <Search className="h-4 w-4" /> Marcar
            </button>
          </div>

          {!scanning ? (
            <button
              onClick={() => setScanning(true)}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-primary/40 p-6 text-primary"
            >
              <Camera className="h-5 w-5" /> Abrir câmera (leitura contínua)
            </button>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium">Aponte para o QR de cada participante</span>
                <button
                  onClick={() => setScanning(false)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div id="qr-reader" className="overflow-hidden rounded-xl" />
            </div>
          )}

          {feedback && (
            <div
              className={`rounded-xl border p-3 flex items-center gap-3 ${feedback.ok ? "border-success/40 bg-success/10" : "border-destructive/40 bg-destructive/10"}`}
            >
              {feedback.ok ? (
                <CheckCircle2 className="h-6 w-6 text-success" />
              ) : (
                <XCircle className="h-6 w-6 text-destructive" />
              )}
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm truncate">{feedback.title}</div>
                {feedback.subtitle && (
                  <div className="text-xs text-muted-foreground truncate">{feedback.subtitle}</div>
                )}
                {feedback.already && (
                  <div className="text-[11px] text-muted-foreground">
                    Já havia sido marcado anteriormente
                  </div>
                )}
              </div>
              <button onClick={() => setFeedback(null)} className="text-muted-foreground">
                <RefreshCw className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold flex items-center gap-2">
              <Users className="h-4 w-4" /> Presentes ({attendances?.length ?? 0})
            </h2>
            <button
              onClick={closeEvent}
              disabled={closing || !eventId || !(attendances && attendances.length)}
              className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              style={{ backgroundImage: "var(--gradient-primary)" }}
            >
              <Award className="h-4 w-4" />{" "}
              {closing ? "Emitindo…" : "Encerrar & Emitir certificados"}
            </button>
          </div>
          {(!attendances || attendances.length === 0) && (
            <p className="text-sm text-muted-foreground">
              Nenhuma presença registrada{eventId ? "" : " — selecione um evento"}.
            </p>
          )}
          <ul className="divide-y divide-border">
            {attendances?.map((a: any) => (
              <li key={a.id} className="py-2 flex items-center justify-between text-sm">
                <div className="min-w-0">
                  <div className="font-medium truncate">{a.profile?.nome ?? "—"}</div>
                  <div className="text-xs text-muted-foreground truncate">{a.profile?.email}</div>
                </div>
                <span className="text-[11px] text-muted-foreground shrink-0 ml-3">
                  {new Date(a.checked_in_at).toLocaleTimeString("pt-BR", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </AppLayout>
  );
}
