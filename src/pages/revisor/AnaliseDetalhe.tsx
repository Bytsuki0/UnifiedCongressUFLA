import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { AbasDeAnexos, AcoesDoAnexo, CorpoDoAnexo } from "@/components/AnexosDoTrabalho";
import { useAnexoAtivo } from "@/hooks/use-anexo-ativo";
import { toast } from "sonner";
import {
  Criterio,
  ParecerItem,
  ResultadoParecer,
  RESULTADO_OPTIONS,
} from "@/lib/types";
import { mapaCategorias } from "@/services/categoriasService";
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

  // As abas de leitura saem do que o trabalho ENTREGOU, não do que a
  // categoria exige hoje: a organização pode ter mudado as exigências
  // depois da submissão, e o revisor tem de ver o que existe. A ordem é a
  // que a organização definiu, então a primeira aba é a primeira
  // exigência — normalmente o arquivo principal.
  const anexos = assoc?.trabalho?.anexos ?? [];
  const { indice, setIndice, ativo, url } = useAnexoAtivo(anexos);

  const carregar = useCallback(async () => {
    if (!id) return;
    try {
      const [a, cats] = await Promise.all([obterAssociacao(id), mapaCategorias()]);
      setCategorias(cats);

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
      // Espelha nota/decisão na tabela legada de avaliações (Avaliadores).
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

  const palavrasChave = assoc?.trabalho?.palavras_chave ?? [];

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

        {/* Abas dos anexos entregues. Somem quando há um anexo só —
            uma aba sozinha não é escolha. */}
        <AbasDeAnexos anexos={anexos} indice={indice} onEscolher={setIndice} />

        <AcoesDoAnexo anexo={ativo} url={url} nomeBase={assoc?.trabalho?.titulo} />
      </div>

      <div className="avaliacao-layout">
        <div className="pdf-viewer">
          <CorpoDoAnexo
            anexo={ativo}
            url={url}
            vazio="A categoria deste trabalho não exigia arquivo nem vídeo."
          />
        </div>

        <div className="review-panel">
          <div className="review-panel-body">
            <div className="review-section-overline">DADOS DO TRABALHO</div>
            <div className="review-section-title">{assoc?.trabalho?.titulo ?? "—"}</div>

            {/* Autores, coautores, orientador e data de submissão NÃO
                aparecem aqui — e nem chegam ao navegador: `obterAssociacao`
                não pede essas colunas. É o que sustenta a avaliação às
                cegas. Categoria fica porque define os critérios do parecer
                e não identifica ninguém. */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: "var(--fs-xs)", color: "var(--color-text-secondary)", marginBottom: "var(--space-4)" }}>
              <div><strong>Categoria:</strong> {assoc?.trabalho?.categoria_id ? (categorias[assoc.trabalho.categoria_id] ?? "—") : "—"}</div>
              {palavrasChave.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginTop: 2 }}>
                  <strong>Palavras-chave:</strong>
                  {palavrasChave.map((p) => <span className="badge badge-gray" key={p}>{p}</span>)}
                </div>
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
