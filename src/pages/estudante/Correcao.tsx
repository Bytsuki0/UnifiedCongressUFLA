import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { obterMeuTrabalho } from "@/services/trabalhosService";
import { openPdf } from "@/lib/pdfStorage";
import { PareceresRecebidos } from "@/components/estudante/PareceresRecebidos";
import {
  carregarPareceresDoTrabalho,
  enviarCorrecao,
  type ParecerAnonimo,
} from "@/services/correcaoService";
import {
  formatarPalavrasChave,
  parsePalavrasChave,
  TIPO_RESUMO_OPTIONS,
  type TipoResumo,
} from "@/lib/submissao";
import { idDoVideo } from "@/lib/youtube";
import { AGUARDANDO_CORRECAO, MAX_PDF_BYTES, type Coautor, type Submission } from "./shared";

/**
 * Rodada de correção: aberta quando os pareceres consolidam em
 * "aprovado com correções" (2 votos nesse sentido, ou os 3 votos
 * diferentes entre si). O autor troca o PDF e ajusta título, tipo de
 * resumo, palavras-chave e vídeo;
 * orientador, coautores e categoria ficam travados — foram eles que
 * definiram os impedimentos e os critérios já aplicados.
 */
const Correcao = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();

  const [trabalho, setTrabalho] = useState<Submission | null>(null);
  const [pareceres, setPareceres] = useState<ParecerAnonimo[]>([]);
  const [titulo, setTitulo] = useState("");
  const [palavrasChaveTexto, setPalavrasChaveTexto] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [tipoResumo, setTipoResumo] = useState<TipoResumo>("simples");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [enviando, setEnviando] = useState(false);

  const carregar = useCallback(async () => {
    if (!id || !user) return;
    setLoading(true);
    // Só o autor abre esta tela. A RLS deixa a organização ler qualquer
    // trabalho, então o recorte por dono é feito aqui — e o banco recusa
    // a correção de terceiros de qualquer forma (RPC enviar_correcao).
    const data = await obterMeuTrabalho(id, user.id).catch(() => null);

    if (!data) {
      toast.error("Trabalho não encontrado.");
      navigate("/estudante/historico");
      return;
    }

    const sub = {
      ...data,
      coautores: Array.isArray(data.coautores) ? (data.coautores as Coautor[]) : [],
    } as Submission;
    setTrabalho(sub);
    setTitulo(sub.titulo ?? "");
    setPalavrasChaveTexto(formatarPalavrasChave(sub.palavras_chave));
    setVideoUrl(sub.video_url ?? "");
    setTipoResumo(sub.tipo_resumo === "estendido" ? "estendido" : "simples");

    try {
      setPareceres(await carregarPareceresDoTrabalho(id));
    } catch {
      // Sem pareceres visíveis: a correção continua possível.
      setPareceres([]);
    }
    setLoading(false);
  }, [id, user, navigate]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const verPdf = async () => {
    if (!(await openPdf(trabalho?.pdf_url))) toast.error("Não foi possível abrir o PDF.");
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!trabalho || !user) return;
    if (!titulo.trim()) {
      toast.error("O título é obrigatório.");
      return;
    }
    const palavrasChave = parsePalavrasChave(palavrasChaveTexto);
    if (palavrasChave.length === 0) {
      toast.error("Informe ao menos uma palavra-chave.");
      return;
    }
    if (!idDoVideo(videoUrl)) {
      toast.error("Informe um link válido de vídeo do YouTube.");
      return;
    }
    if (arquivo) {
      if (arquivo.type !== "application/pdf") {
        toast.error("O arquivo precisa estar em formato PDF.");
        return;
      }
      if (arquivo.size > MAX_PDF_BYTES) {
        toast.error("O PDF excede o limite de 10MB.");
        return;
      }
    }

    setEnviando(true);
    try {
      await enviarCorrecao({
        trabalhoId: trabalho.id,
        ownerId: user.id,
        titulo: titulo.trim(),
        palavrasChave,
        videoUrl: videoUrl.trim(),
        tipoResumo,
        arquivo,
      });
      toast.success("Versão corrigida enviada. Seu trabalho está aprovado.");
      navigate("/estudante/historico");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao enviar a correção.");
      setEnviando(false);
    }
  }

  if (loading) {
    return (
      <div className="section active">
        <div className="content-area">
          <div style={{ textAlign: "center", padding: 48, color: "var(--color-text-muted)" }}>
            Carregando...
          </div>
        </div>
      </div>
    );
  }

  // O banco recusa a correção fora deste status; a interface avisa antes.
  if (trabalho && trabalho.status !== AGUARDANDO_CORRECAO) {
    return (
      <div className="section active">
        <div className="content-area">
          <button className="back-link" onClick={() => navigate("/estudante/historico")}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
            Voltar
          </button>
          <div className="empty-state">
            <div className="empty-state-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 28, height: 28 }}>
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <h3 className="empty-state-title">Nada a corrigir</h3>
            <p className="empty-state-description">
              Este trabalho não está aguardando correções. Correções só ficam disponíveis
              quando os pareceres resultam em “aprovado com correções”.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const coautores = (trabalho?.coautores ?? []).filter((c) => c.nome || c.email);

  return (
    <div className="section active">
      <div className="content-area">
        <button className="back-link" onClick={() => navigate("/estudante/historico")}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
          Voltar
        </button>

        <div className="page-header">
          <div className="page-overline">Aprovado com correções</div>
          <h1 className="page-title">Enviar versão corrigida</h1>
          <p style={{ fontSize: "var(--fs-sm)", color: "var(--color-text-secondary)" }}>
            Ajuste o texto conforme os pareceres e reenvie o PDF. O arquivo novo substitui o anterior.
          </p>
        </div>

        {pareceres.length > 0 && (
          <div className="step-card">
            <div className="step-card-header">
              <div className="step-number">01</div>
              <div>
                <div className="step-title">Notas e comentários dos avaliadores</div>
                <div className="step-subtitle">Avaliação às cegas, a identificação dos avaliadores é omitida</div>
              </div>
            </div>
            <PareceresRecebidos pareceres={pareceres} />
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="step-card">
            <div className="step-card-header">
              <div className="step-number">{pareceres.length > 0 ? "02" : "01"}</div>
              <div>
                <div className="step-title">Informações do Trabalho</div>
                <div className="step-subtitle">Título, tipo de resumo, palavras-chave e vídeo podem ser alterados</div>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="correcao-titulo">Título do Trabalho *</label>
              <input
                type="text"
                id="correcao-titulo"
                className="form-input"
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Tipo de Resumo *</label>
              <div className="profile-select-group">
                {TIPO_RESUMO_OPTIONS.map((o) => (
                  <label className="profile-select-btn" key={o.value}>
                    <input
                      type="radio"
                      name="correcao-tipo-resumo"
                      value={o.value}
                      checked={tipoResumo === o.value}
                      onChange={() => setTipoResumo(o.value)}
                    />
                    <span className="profile-select-text">{o.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="correcao-palavras-chave">Palavras-chave *</label>
              <input
                type="text"
                id="correcao-palavras-chave"
                className="form-input"
                value={palavrasChaveTexto}
                onChange={(e) => setPalavrasChaveTexto(e.target.value)}
              />
              <div className="form-hint">Separe os termos por vírgula ou ponto e vírgula.</div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="correcao-video">Vídeo de Apresentação (YouTube) *</label>
              <input
                type="url"
                id="correcao-video"
                className="form-input"
                placeholder="https://www.youtube.com/watch?v=..."
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
              />
            </div>
          </div>

          <div className="step-card">
            <div className="step-card-header">
              <div className="step-number">{pareceres.length > 0 ? "03" : "02"}</div>
              <div>
                <div className="step-title">Autoria</div>
                <div className="step-subtitle">Bloqueada nesta etapa, orientador e coautores não mudam após a avaliação</div>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">E-mail do Orientador</label>
              <input type="text" className="form-input" value={trabalho?.orientador_email ?? "—"} disabled readOnly />
            </div>

            <div className="form-group">
              <label className="form-label">Coautores</label>
              {coautores.length === 0 ? (
                <input type="text" className="form-input" value="Nenhum coautor informado" disabled readOnly />
              ) : (
                coautores.map((c, i) => (
                  <input
                    key={i}
                    type="text"
                    className="form-input"
                    style={{ marginBottom: 8 }}
                    value={[c.nome, c.email].filter(Boolean).join(" · ")}
                    disabled
                    readOnly
                  />
                ))
              )}
            </div>
          </div>

          <div className="step-card">
            <div className="step-card-header">
              <div className="step-number">{pareceres.length > 0 ? "04" : "03"}</div>
              <div>
                <div className="step-title">Arquivo Corrigido</div>
                <div className="step-subtitle">Opcional · Limite 10MB · o PDF novo substitui e apaga o anterior</div>
              </div>
            </div>

            {trabalho?.pdf_url && (
              <div className="import-row">
                <div className="import-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 20, height: 20 }}>
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                  </svg>
                </div>
                <div className="import-info">
                  <div className="import-label">Versão atual</div>
                  <div className="import-desc">Confira o arquivo que está registrado hoje</div>
                </div>
                <button type="button" className="btn btn-outline btn-sm" onClick={verPdf}>Ver PDF</button>
              </div>
            )}

            <div
              className="drop-zone"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setArquivo(f); }}
            >
              <div className="drop-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 48, height: 48 }}>
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
              </div>
              {arquivo ? (
                <div style={{ color: "var(--color-success)", fontSize: "var(--fs-sm)", display: "flex", alignItems: "center", gap: 8, justifyContent: "center" }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
                  {arquivo.name}
                </div>
              ) : (
                <>
                  <div className="drop-title">Arraste o PDF corrigido aqui</div>
                  <div className="drop-subtitle">Sem arquivo novo, o PDF atual é mantido</div>
                  <label className="btn btn-primary btn-sm" style={{ cursor: "pointer" }}>
                    Selecionar Arquivo
                    <input type="file" accept=".pdf" style={{ display: "none" }} onChange={(e) => { if (e.target.files?.[0]) setArquivo(e.target.files[0]); }} />
                  </label>
                </>
              )}
            </div>
          </div>

          <div className="form-footer">
            <button type="button" className="btn btn-outline" onClick={() => navigate("/estudante/historico")}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={enviando}>
              {enviando ? "Enviando..." : "Enviar Correção"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default Correcao;
