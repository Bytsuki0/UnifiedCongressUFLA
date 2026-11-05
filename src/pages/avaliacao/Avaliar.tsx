import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { AbasDeAnexos, AcoesDoAnexo, CorpoDoAnexo } from "@/components/AnexosDoTrabalho";
import { useAnexoAtivo } from "@/hooks/use-anexo-ativo";
import type { AnexoDoTrabalho } from "@/lib/anexos";
import type { TrabalhoAvaliavel } from "@/lib/avaliacaoEvento";
import {
  avaliarTrabalhoEvento,
  carregarAvaliacaoEvento,
  listarCriteriosEvento,
  listarPdfsParaAvaliacao,
} from "@/services/avaliacaoEventoService";
import { mapaCategorias, type Criterio } from "@/services/categoriasService";
import { NOTA_OPCOES } from "@/pages/revisor/shared";

/**
 * `/avaliacao/avaliar/:id` — as notas de UM trabalho, nos critérios do
 * evento da categoria dele, ao lado do PDF da submissão na versão em
 * vigor (`anexos_para_avaliacao`: a correção sobrescreve o arquivo, nunca
 * o pôster). Sem comentário: quem avalia está assistindo à apresentação.
 * A tela confere só para dar a frase certa; quem recusa é
 * `avaliar_trabalho_evento`.
 */
const Avaliar = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [trabalho, setTrabalho] = useState<TrabalhoAvaliavel | null>(null);
  const [categoria, setCategoria] = useState("—");
  const [criterios, setCriterios] = useState<Criterio[]>([]);
  const [notas, setNotas] = useState<Record<string, string>>({});
  const [jaAvaliado, setJaAvaliado] = useState(false);
  const [saving, setSaving] = useState(false);
  const [anexos, setAnexos] = useState<AnexoDoTrabalho[]>([]);
  const { indice, setIndice, ativo, url } = useAnexoAtivo(anexos);

  useEffect(() => {
    if (!id || !user?.id) return;
    let vivo = true;
    // ponytail: recarrega a lista inteira para achar um trabalho; uma RPC
    // por id só se a lista do evento ficar grande.
    Promise.all([carregarAvaliacaoEvento(user.id), listarCriteriosEvento(), mapaCategorias(),
      // O PDF é apoio: falhar nele não pode impedir a nota no meio do evento.
      listarPdfsParaAvaliacao(id).catch((): AnexoDoTrabalho[] => [])])
      .then(([dados, porCategoria, cats, pdfs]) => {
        if (!vivo) return;
        const t = dados.trabalhos.find((x) => x.id === id);
        if (!t) {
          toast.error("Trabalho indisponível para avaliação.");
          navigate("/avaliacao/buscar");
          return;
        }
        setTrabalho(t);
        setAnexos(pdfs);
        setCategoria(t.categoria_id ? (cats[t.categoria_id] ?? "—") : "—");
        setCriterios(t.categoria_id ? (porCategoria[t.categoria_id] ?? []) : []);
        const minha = dados.minhas[t.id];
        if (minha) {
          setJaAvaliado(true);
          setNotas(Object.fromEntries(minha.itens.map((i) => [i.criterio_id, String(i.nota)])));
        }
      })
      .catch(() => toast.error("Erro ao carregar o trabalho."));
    return () => {
      vivo = false;
    };
  }, [id, user?.id, navigate]);

  async function enviar() {
    if (!trabalho) return;
    if (criterios.some((c) => !notas[c.id])) {
      toast.error("Atribua uma nota a todos os critérios.");
      return;
    }
    setSaving(true);
    try {
      await avaliarTrabalhoEvento(
        trabalho.id,
        Object.fromEntries(criterios.map((c) => [c.id, Number(notas[c.id])])),
      );
      toast.success(jaAvaliado ? "Avaliação atualizada." : "Avaliação registrada.");
      navigate("/avaliacao/minhas");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar a avaliação.");
    } finally {
      setSaving(false);
    }
  }

  const bloqueado = !trabalho || trabalho.em_conflito || criterios.length === 0;

  return (
    <div className="section active">
      <div className="avaliacao-subheader">
        <button className="back-btn" onClick={() => navigate(-1)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          VOLTAR
        </button>
        <span className="sub-id">AVALIAÇÃO AO VIVO · {categoria}</span>
        <AbasDeAnexos anexos={anexos} indice={indice} onEscolher={setIndice} />
        <AcoesDoAnexo anexo={ativo} url={url} nomeBase={trabalho?.titulo} />
      </div>

      <div className="avaliacao-layout">
        <div className="pdf-viewer">
          <CorpoDoAnexo anexo={ativo} url={url} vazio="A categoria deste trabalho não exigia PDF." />
        </div>

        <div className="review-panel">
          <div className="review-panel-body">
            <div className="review-section-overline">DADOS DO TRABALHO</div>
            <div className="review-section-title">{trabalho?.titulo ?? "Carregando..."}</div>
            {trabalho && (
              <p style={{ fontSize: "var(--fs-xs)", color: "var(--color-text-secondary)", marginBottom: "var(--space-4)" }}>
                {trabalho.autores}
              </p>
            )}

            {trabalho?.em_conflito && (
              <div className="alert alert-warning" style={{ marginBottom: "var(--space-4)" }}>
                <span>Você é autor, orientador ou coautor deste trabalho e não pode avaliá-lo.</span>
              </div>
            )}
            {trabalho && !trabalho.em_conflito && criterios.length === 0 && (
              <div className="alert alert-warning" style={{ marginBottom: "var(--space-4)" }}>
                <span>A categoria deste trabalho ainda não tem critérios de avaliação. A organização os define em Critérios do Evento.</span>
              </div>
            )}
            {jaAvaliado && (
              <div className="alert" style={{ background: "var(--blue-50)", border: "1px solid var(--blue-200)", color: "var(--blue-700)", marginBottom: "var(--space-4)" }}>
                Você já avaliou este trabalho. Ao enviar de novo, suas notas são substituídas.
              </div>
            )}

            {criterios.map((c, i) => (
              <div className="form-group" key={c.id}>
                <label className="form-label" style={{ textTransform: "none", letterSpacing: "normal" }} htmlFor={`nota-${c.id}`}>
                  {i + 1}. {c.titulo}
                </label>
                <select
                  className="form-select"
                  id={`nota-${c.id}`}
                  disabled={bloqueado}
                  value={notas[c.id] ?? ""}
                  onChange={(e) => setNotas((n) => ({ ...n, [c.id]: e.target.value }))}
                >
                  <option value="">Nota (1 a 5)</option>
                  {NOTA_OPCOES.map((n) => (
                    <option key={n.value} value={n.value}>{n.label}</option>
                  ))}
                </select>
              </div>
            ))}

            <div className="review-actions mt-6">
              <button className="btn btn-primary" disabled={bloqueado || saving} onClick={enviar}>
                {saving ? "SALVANDO..." : jaAvaliado ? "ATUALIZAR AVALIAÇÃO" : "ENVIAR AVALIAÇÃO"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Avaliar;
