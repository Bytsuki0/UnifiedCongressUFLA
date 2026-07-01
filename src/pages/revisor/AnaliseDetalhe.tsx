import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { PdfViewer } from "@/components/PdfViewer";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Criterio,
  ParecerItem,
  ResultadoParecer,
  RESULTADO_OPTIONS,
} from "@/lib/types";
import {
  AssociacaoComTrabalho,
  listarCriterios,
  obterAssociacao,
  obterParecer,
  salvarParecer,
  espelharParecerEmAvaliacao,
} from "@/services/revisorService";
import { NOTA_OPCOES, TRABALHO_STATUS_LABEL } from "./shared";

const AnaliseDetalhe = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();

  const [assoc, setAssoc] = useState<AssociacaoComTrabalho | null>(null);
  const [categorias, setCategorias] = useState<Record<string, string>>({});
  const [criterios, setCriterios] = useState<Criterio[]>([]);
  const [resultado, setResultado] = useState<ResultadoParecer | "">("");
  const [notas, setNotas] = useState<Record<string, { nota: string; comentario: string }>>({});
  const [comentarioGeral, setComentarioGeral] = useState("");
  const [jaAvaliado, setJaAvaliado] = useState(false);
  const [saving, setSaving] = useState(false);

  const carregar = useCallback(async () => {
    if (!id) return;
    try {
      const [a, { data: cats }] = await Promise.all([
        obterAssociacao(id),
        supabase.from("categorias").select("id, nome"),
      ]);
      const map: Record<string, string> = {};
      (cats ?? []).forEach((c) => { map[c.id] = c.nome; });
      setCategorias(map);

      const trab = a?.trabalho;
      if (!trab) {
        toast.error("Trabalho indisponível.");
        navigate("/revisor/analise");
        return;
      }
      setAssoc(a);
      const crits = trab.categoria_id ? await listarCriterios(trab.categoria_id) : [];
      setCriterios(crits);
      const parecer = user?.email ? await obterParecer(trab.id, user.email) : null;
      if (parecer) {
        setJaAvaliado(true);
        setResultado(parecer.resultado);
        setComentarioGeral(parecer.comentario_geral ?? "");
        const nmap: Record<string, { nota: string; comentario: string }> = {};
        parecer.itens.forEach((it) => {
          nmap[it.criterio_id] = { nota: String(it.nota), comentario: it.comentario };
        });
        setNotas(nmap);
      }
    } catch {
      toast.error("Erro ao carregar critérios ou parecer.");
    }
  }, [id, user?.email, navigate]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // Download apenas por clique explícito: busca o arquivo e salva localmente,
  // garantindo o download mesmo quando o navegador está configurado para abrir PDFs.
  async function baixarPdf() {
    const trab = assoc?.trabalho;
    if (!trab?.pdf_url) return;
    const nome = `${(trab.titulo || "trabalho").replace(/[^a-zA-Z0-9._-]+/g, "_")}.pdf`;
    try {
      const resp = await fetch(trab.pdf_url);
      const blob = await resp.blob();
      const obj = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = obj;
      a.download = nome;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(obj);
    } catch {
      window.open(trab.pdf_url, "_blank", "noopener,noreferrer");
    }
  }

  function setNota(critId: string, nota: string) {
    setNotas((r) => ({ ...r, [critId]: { ...(r[critId] ?? { nota: "", comentario: "" }), nota } }));
  }
  function setComentarioCrit(critId: string, comentario: string) {
    setNotas((r) => ({ ...r, [critId]: { ...(r[critId] ?? { nota: "", comentario: "" }), comentario } }));
  }

  async function enviarParecer() {
    if (!assoc?.trabalho || !user?.email) return;
    if (!resultado) { toast.error("Selecione o resultado final."); return; }
    if (criterios.length === 0) { toast.error("Esta categoria não possui critérios definidos."); return; }
    const faltando = criterios.some((c) => !notas[c.id]?.nota);
    if (faltando) { toast.error("Atribua uma nota a todos os critérios."); return; }

    setSaving(true);
    try {
      const itens: ParecerItem[] = criterios.map((c) => ({
        criterio_id: c.id,
        titulo: c.titulo,
        nota: Number(notas[c.id]?.nota || 0),
        comentario: notas[c.id]?.comentario?.trim() || "",
      }));
      await salvarParecer({
        trabalhoId: assoc.trabalho.id,
        revisorEmail: user.email,
        revisorNome: user.nome,
        resultado,
        itens,
        comentarioGeral: comentarioGeral.trim() || null,
      });
      // Espelha nota/decisão na tabela de avaliações para alimentar os Rankings.
      await espelharParecerEmAvaliacao({
        trabalhoId: assoc.trabalho.id,
        revisorEmail: user.email,
        notas: itens,
        resultado,
        comentarioGeral: comentarioGeral.trim() || null,
      });
      toast.success("Parecer registrado com sucesso!");
      navigate("/revisor/analise");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar parecer.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="section active">
      <div className="avaliacao-subheader">
        <button className="back-btn" onClick={() => navigate("/revisor/analise")}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          VOLTAR AOS TRABALHOS
        </button>
        <span className="sub-id">
          {assoc?.trabalho
            ? `${assoc.trabalho.categoria_id ? (categorias[assoc.trabalho.categoria_id] ?? "—") : "—"} · ${TRABALHO_STATUS_LABEL[assoc.trabalho.status] ?? assoc.trabalho.status}`
            : "—"}
        </span>
        {assoc?.trabalho?.pdf_url && (
          <span style={{ display: "inline-flex", gap: "var(--space-2)" }}>
            <button type="button" className="btn btn-primary btn-sm" onClick={baixarPdf}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              BAIXAR PDF
            </button>
            <a className="btn btn-outline btn-sm" href={assoc.trabalho.pdf_url} target="_blank" rel="noopener noreferrer">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              ABRIR EM NOVA ABA
            </a>
          </span>
        )}
      </div>

      <div className="avaliacao-layout">
        <div className="pdf-viewer">
          {assoc?.trabalho?.pdf_url ? (
            <PdfViewer url={assoc.trabalho.pdf_url} />
          ) : (
            <>
              <svg className="pdf-viewer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 64, height: 64, color: "var(--gray-400)" }}>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
              </svg>
              <div className="pdf-viewer-filename">PDF NÃO DISPONÍVEL</div>
              <div className="pdf-viewer-description">Este trabalho não possui arquivo PDF anexado.</div>
            </>
          )}
        </div>

        <div className="review-panel">
          <div className="review-panel-body">
            <div className="review-section-overline">DADOS DO TRABALHO</div>
            <div className="review-section-title">{assoc?.trabalho?.titulo ?? "—"}</div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: "var(--fs-xs)", color: "var(--color-text-secondary)", marginBottom: "var(--space-4)" }}>
              <div><strong>Autores:</strong> {assoc?.trabalho?.autores ?? "—"}</div>
              <div><strong>Orientador:</strong> {assoc?.trabalho?.orientador_email ?? "—"}</div>
              <div><strong>Categoria:</strong> {assoc?.trabalho?.categoria_id ? (categorias[assoc.trabalho.categoria_id] ?? "—") : "—"}</div>
              <div><strong>Data de submissão:</strong> {assoc?.trabalho ? new Date(assoc.trabalho.data_submissao).toLocaleDateString("pt-BR") : "—"}</div>
              {assoc?.trabalho?.resumo && (
                <div style={{ marginTop: 4, padding: 8, background: "var(--gray-50)", borderRadius: 4, lineHeight: "var(--lh-normal)" }}>{assoc.trabalho.resumo}</div>
              )}
            </div>

            {jaAvaliado && (
              <div className="alert" style={{ background: "var(--blue-50)", border: "1px solid var(--blue-200)", color: "var(--blue-700)", display: "flex", alignItems: "center", gap: "var(--space-3)", marginBottom: "var(--space-4)" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                Você já emitiu um parecer para este trabalho. Ao enviar novamente, o parecer será atualizado.
              </div>
            )}

            <div className="review-section-overline">PARECER TÉCNICO</div>

            <div className="form-group">
              <label className="form-label" htmlFor="analiseResultado">RESULTADO FINAL</label>
              <select className="form-select" id="analiseResultado" value={resultado} onChange={(e) => setResultado(e.target.value as ResultadoParecer)}>
                <option value="">Selecione o resultado</option>
                {RESULTADO_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            <div className="review-section-overline" style={{ marginTop: "var(--space-4)", marginBottom: "var(--space-2)" }}>
              Critérios de Avaliação {criterios.length > 0 ? `(${criterios.length})` : ""}
            </div>

            {criterios.length === 0 ? (
              <div className="alert alert-warning" style={{ marginBottom: "var(--space-4)" }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18, flexShrink: 0 }}>
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                <span>A categoria deste trabalho ainda não possui critérios definidos. Defina-os na página de Categorias.</span>
              </div>
            ) : (
              criterios.map((c, i) => (
                <div className="form-group" style={{ marginBottom: "var(--space-4)", paddingBottom: "var(--space-3)", borderBottom: "1px solid var(--color-border)" }} key={c.id}>
                  <label className="form-label" style={{ fontSize: 11, fontWeight: "var(--fw-semibold)", color: "var(--color-text-secondary)", textTransform: "none", letterSpacing: "normal" }} htmlFor={`nota-${c.id}`}>
                    {i + 1}. {c.titulo}
                  </label>
                  <select className="form-select criteria-rating" id={`nota-${c.id}`} value={notas[c.id]?.nota || ""} onChange={(e) => setNota(c.id, e.target.value)}>
                    <option value="">Nota (1 a 5)</option>
                    {NOTA_OPCOES.map((n) => (
                      <option key={n.value} value={n.value}>{n.label}</option>
                    ))}
                  </select>
                  <textarea className="form-textarea" style={{ marginTop: "var(--space-2)" }} rows={2} placeholder="Comentário sobre este critério (opcional)" value={notas[c.id]?.comentario || ""} onChange={(e) => setComentarioCrit(c.id, e.target.value)} />
                </div>
              ))
            )}

            <div className="form-group">
              <label className="form-label" htmlFor="analiseComentarioGeral">COMENTÁRIO GERAL</label>
              <textarea className="form-textarea" id="analiseComentarioGeral" rows={5} placeholder="Considerações gerais, pontos fortes, fragilidades e sugestões de correção..." value={comentarioGeral} onChange={(e) => setComentarioGeral(e.target.value)} />
            </div>

            <div className="review-actions mt-6">
              <button className="btn btn-primary" disabled={saving} onClick={enviarParecer}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                {saving ? "SALVANDO..." : jaAvaliado ? "ATUALIZAR PARECER" : "ENVIAR PARECER"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AnaliseDetalhe;
