import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ResultadoParecer } from "@/lib/types";
import { AssociacaoComTrabalho, listarTrabalhosAssociados } from "@/services/revisorService";
import {
  RESULTADO_BADGE,
  RESULTADO_LABEL,
  TRABALHO_STATUS_BADGE,
  TRABALHO_STATUS_LABEL,
} from "./shared";

const Analise = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [assocs, setAssocs] = useState<AssociacaoComTrabalho[]>([]);
  const [loading, setLoading] = useState(true);
  const [categorias, setCategorias] = useState<Record<string, string>>({});
  const [pareceres, setPareceres] = useState<Record<string, ResultadoParecer>>({});

  const carregar = useCallback(async () => {
    if (!user?.email) return;
    setLoading(true);
    try {
      const [rows, { data: cats }, { data: pars }] = await Promise.all([
        listarTrabalhosAssociados(user.email),
        supabase.from("categorias").select("id, nome"),
        supabase.from("pareceres").select("trabalho_id, resultado").eq("revisor_email", user.email),
      ]);
      setAssocs(rows);
      const map: Record<string, string> = {};
      (cats ?? []).forEach((c) => { map[c.id] = c.nome; });
      setCategorias(map);
      const pmap: Record<string, ResultadoParecer> = {};
      (pars ?? []).forEach((p) => { pmap[p.trabalho_id] = p.resultado as ResultadoParecer; });
      setPareceres(pmap);
    } catch {
      toast.error("Erro ao carregar trabalhos associados.");
    } finally {
      setLoading(false);
    }
  }, [user?.email]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  return (
    <div className="section active">
      <div className="content-area">
        <div className="page-header">
          <div className="page-overline">ANÁLISE DE TRABALHOS</div>
          <h1 className="page-title">Trabalhos associados a você</h1>
          <p className="page-subtitle">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
            </svg>
            Trabalhos vinculados a <strong>{user?.email}</strong> · abra o PDF, avalie cada critério e emita seu parecer.
          </p>
        </div>

        {loading ? (
          <div style={{ padding: 48, textAlign: "center", color: "var(--color-text-muted)", fontSize: "var(--fs-sm)" }}>Carregando trabalhos...</div>
        ) : assocs.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
              </svg>
            </div>
            <h3 className="empty-state-title">Nenhum trabalho associado</h3>
            <p className="empty-state-description">Não há trabalhos vinculados ao seu e-mail no momento. Assim que a comissão organizadora associar trabalhos a você, eles aparecerão aqui para análise.</p>
          </div>
        ) : (
          <div className="table-container" style={{ marginTop: 24 }}>
            <table className="table" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th>TÍTULO</th>
                  <th>CATEGORIA</th>
                  <th>AUTORES</th>
                  <th>STATUS</th>
                  <th>DATA</th>
                  <th>PDF</th>
                  <th>SEU PARECER</th>
                  <th>AÇÃO</th>
                </tr>
              </thead>
              <tbody>
                {assocs.map((a) => {
                  const t = a.trabalho;
                  const resultado = t ? pareceres[t.id] : undefined;
                  return (
                    <tr key={a.id}>
                      <td style={{ fontWeight: "var(--fw-semibold)" }}>{t?.titulo ?? "Trabalho removido"}</td>
                      <td>{t?.categoria_id ? (categorias[t.categoria_id] ?? "—") : "—"}</td>
                      <td style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t?.autores ?? "—"}</td>
                      <td>{t ? <span className={`badge ${TRABALHO_STATUS_BADGE[t.status] ?? "badge-gray"}`}>{TRABALHO_STATUS_LABEL[t.status] ?? t.status}</span> : "—"}</td>
                      <td>{t ? new Date(t.data_submissao).toLocaleDateString("pt-BR") : "—"}</td>
                      <td>{t?.pdf_url ? <a href={t.pdf_url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--color-primary)", fontWeight: "var(--fw-semibold)" }}>Ver PDF</a> : "—"}</td>
                      <td>{resultado ? <span className={`badge ${RESULTADO_BADGE[resultado]}`}>{RESULTADO_LABEL[resultado]}</span> : <span className="badge badge-amber">Pendente</span>}</td>
                      <td>
                        <button className="btn btn-primary btn-sm" disabled={!t} onClick={() => navigate(`/revisor/analise/${a.id}`)}>
                          {resultado ? "Revisar" : "Analisar"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default Analise;
