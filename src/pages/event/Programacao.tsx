import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Calendar, Search, Filter, MapPin, Clock, User as UserIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { AppLayout } from "@/components/event/AppLayout";
import { DecorativeBg } from "@/components/event/DecorativeBg";
import { Logo } from "@/components/event/Logo";

const sb = supabase as any;

export default function Programacao() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState("Todos");

  const { data } = useQuery({
    queryKey: ["public-schedule"],
    queryFn: async () => (await sb.from("schedule").select("*").order("data").order("horario_inicio")).data ?? [],
  });

  const cats = ["Todos", "Palestra", "Oficina", "Minicurso", "Mesa redonda", "Cerimônia"];
  const filtered = ((data ?? []) as any[]).filter((a) => {
    if (cat !== "Todos" && a.categoria !== cat) return false;
    if (search && !`${a.titulo} ${a.palestrante ?? ""} ${a.local}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });
  const byDay: Record<string, any[]> = {};
  filtered.forEach((a) => { (byDay[a.data] ??= []).push(a); });

  const content = (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl md:text-5xl font-extrabold"
            style={{ backgroundImage: "var(--gradient-primary)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            Programação do Evento
          </h1>
          <p className="mt-2 text-muted-foreground">Palestras, minicursos e atividades</p>
        </div>
        <span className="flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-xs font-medium">
          <Calendar className="h-3.5 w-3.5 text-primary" /> 14 a 16 de maio, 2026
        </span>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar atividade, palestrante…"
            className="w-full rounded-xl border border-input bg-card pl-10 pr-4 py-2.5 text-sm" />
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-input bg-card px-3">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <select value={cat} onChange={(e) => setCat(e.target.value)} className="bg-transparent py-2.5 text-sm outline-none">
            {cats.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
      </div>

      {Object.keys(byDay).length === 0 && (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">
          Nenhuma atividade encontrada.
        </div>
      )}

      {Object.entries(byDay).map(([day, items]) => (
        <div key={day} className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-primary">{day}</h2>
          {items.map((a) => (
            <div key={a.id} className="flex flex-wrap items-start gap-4 rounded-2xl border border-border bg-card p-4">
              <div className="flex flex-col items-center px-2">
                <span className="text-lg font-bold">{a.horario_inicio}</span>
                <span className="text-xs text-muted-foreground">{a.horario_fim}</span>
              </div>
              <div className="flex-1 min-w-[180px]">
                <span className="inline-block rounded-full bg-primary/15 px-3 py-0.5 text-xs font-medium text-primary">{a.categoria}</span>
                <h3 className="mt-1 font-semibold">{a.titulo}</h3>
                {a.descricao && <p className="mt-1 text-sm text-muted-foreground">{a.descricao}</p>}
                <p className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                  {a.palestrante && <span className="flex items-center gap-1"><UserIcon className="h-3 w-3" /> {a.palestrante}</span>}
                  <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {a.local}</span>
                  <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {a.horario_inicio}–{a.horario_fim}</span>
                </p>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );

  if (user) return <AppLayout>{content}</AppLayout>;
  return (
    <div className="relative min-h-screen bg-background">
      <DecorativeBg />
      <div className="relative mx-auto max-w-5xl p-6 md:p-10">
        <div className="mb-6 flex items-center justify-between">
          <Link to="/"><Logo /></Link>
          <Link to="/login" className="rounded-xl px-4 py-2 text-sm font-semibold text-white" style={{ backgroundImage: "var(--gradient-primary)" }}>
            Entrar
          </Link>
        </div>
        <div className="rounded-3xl bg-card p-6 md:p-10 shadow-[var(--shadow-card)]">{content}</div>
      </div>
    </div>
  );
}
