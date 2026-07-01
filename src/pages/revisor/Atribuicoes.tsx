import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import {
  LS,
  REVIEWER_EMAIL,
  Submissao,
  deadlineOf,
  getAlertHours,
} from "./shared";

const Atribuicoes = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [subs, setSubs] = useState<Submissao[]>([]);

  const loadSubs = useCallback(() => {
    const all = LS.get<Submissao[]>("nexus_submissoes", []);
    setSubs(all);
  }, []);

  useEffect(() => {
    loadSubs();
    const interval = setInterval(loadSubs, 4000);
    return () => clearInterval(interval);
  }, [loadSubs]);

  const reviewerEmail = user?.email || REVIEWER_EMAIL;
  const alertHours = getAlertHours();

  const myAssignments = subs
    .filter(s => s.status === "Em Avaliação" && s.revisorEmail === reviewerEmail)
    .map(sub => {
      const dl = deadlineOf(sub);
      const now = new Date();
      const diffMs = dl.getTime() - now.getTime();
      const diffDays = Math.ceil(diffMs / 86400000);
      const hoursRem = Math.max(0, Math.ceil(diffMs / 3600000));
      const latest = sub.rodadas?.[sub.rodadas.length - 1] ?? null;
      return { sub, dl, diffDays, hoursRem, isEval: !!latest?.parecer };
    })
    .sort((a, b) => a.dl.getTime() - b.dl.getTime());

  const stats = {
    total: myAssignments.length,
    pending: myAssignments.filter(x => !x.isEval).length,
    done: myAssignments.filter(x => x.isEval).length,
    critical: myAssignments.filter(x => !x.isEval && x.hoursRem <= alertHours).length,
  };

  const DL = ({ sub, diffDays, hoursRem, isEval }: { sub: Submissao; diffDays: number; hoursRem: number; isEval: boolean }) => {
    const dl = deadlineOf(sub);
    const urgent = !isEval && hoursRem <= alertHours;
    const rem = diffDays < 0 ? "Atrasado" : diffDays === 0 ? `Hoje (${hoursRem}h)` : `${diffDays} dias restantes`;
    return (
      <div className="work-card-deadline">
        <div className="deadline-date">Prazo: {dl.toLocaleDateString("pt-BR")}</div>
        <div className={`deadline-remaining${urgent ? " danger" : ""}`}>{rem}</div>
      </div>
    );
  };

  return (
    <div className="section active">
      <div className="content-area">
        <div className="page-header">
          <div className="page-overline">DASHBOARD DE ATRIBUIÇÕES</div>
          <h1 className="page-title">Trabalhos para Avaliação</h1>
          <p className="page-subtitle">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            Modo Double-Blind ativo · identidade dos autores ocultada em todas as rodadas.
          </p>
        </div>

        <div className="stats-grid">
          {[
            { label: "ATRIBUÍDOS", value: stats.total, cls: "" },
            { label: "PENDENTES", value: stats.pending, cls: "amber" },
            { label: "AVALIADOS", value: stats.done, cls: "" },
            { label: "PRAZO CRÍTICO", value: stats.critical || "-", cls: "red" },
          ].map((s, i) => (
            <div className="stat-card" key={i}>
              <div>
                <div className="stat-label">{s.label}</div>
                <div className={`stat-value${s.cls ? " " + s.cls : ""}`}>{s.value}</div>
              </div>
              <div className={`stat-icon${s.cls ? " " + s.cls : ""}`}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  {i === 0 && <><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></>}
                  {i === 1 && <><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></>}
                  {i === 2 && <><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M9 16l2 2 4-4"/></>}
                  {i === 3 && <><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></>}
                </svg>
              </div>
            </div>
          ))}
        </div>

        <div className="work-list-header">
          <h3>Trabalhos Atribuídos</h3>
          <span className="sort-label">ORDENADOS POR PRAZO</span>
        </div>

        {myAssignments.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
                <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
              </svg>
            </div>
            <h3 className="empty-state-title">Nenhum trabalho atribuído</h3>
            <p className="empty-state-description">Você não possui trabalhos pendentes para avaliação no momento. Assim que a comissão organizadora distribuir novas submissões, elas aparecerão aqui.</p>
          </div>
        ) : (
          <div className="work-cards">
            {myAssignments.map(({ sub, diffDays, hoursRem, isEval }) => {
              const urgent = !isEval && hoursRem <= alertHours;
              const latest = sub.rodadas?.[sub.rodadas.length - 1];
              return (
                <div
                  key={sub.id}
                  className={`work-card${urgent ? " urgent" : ""}`}
                  onClick={() => navigate(`/revisor/avaliacao/${sub.id}`)}
                >
                  <div className="work-card-left">
                    <div className="work-card-meta">
                      <span className="work-card-id">{sub.id}</span>
                      <span className="badge badge-gray">{sub.categoria?.toUpperCase()}</span>
                      {urgent && <span className="work-card-flag">⚠ URGENTE</span>}
                    </div>
                    <div className="work-card-title">{sub.titulo}</div>
                  </div>
                  <div className="work-card-right">
                    <DL sub={sub} diffDays={diffDays} hoursRem={hoursRem} isEval={isEval} />
                    {isEval
                      ? <span className={`badge ${latest?.parecer === "Reprovado" || latest?.parecer === "Desclassificado" ? "badge-solid-red" : latest?.parecer?.includes("Correções") ? "badge-solid-blue" : "badge-solid-green"}`}>{latest?.parecer}</span>
                      : <span className="badge badge-solid-amber">PENDENTE</span>
                    }
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default Atribuicoes;
