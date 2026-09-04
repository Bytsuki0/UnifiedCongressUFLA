import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { obterMeuTrabalho } from "@/services/trabalhosService";
import { listarAnexosDoTrabalho } from "@/services/anexosService";
import { PareceresRecebidos } from "@/components/estudante/PareceresRecebidos";
import {
  carregarPareceresDoTrabalho,
  enviarCorrecao,
  type ParecerAnonimo,
} from "@/services/correcaoService";
import { formatarPalavrasChave, parsePalavrasChave } from "@/lib/submissao";
import {
  rascunhoInicial,
  resumoDoPasso,
  validarAnexos,
  type AnexoDoTrabalho,
  type RascunhoAnexos,
} from "@/lib/anexos";
import { CamposAnexos } from "@/components/estudante/CamposAnexos";
import { AGUARDANDO_CORRECAO, useExigencias, type Coautor, type Submission } from "./shared";

/**
 * Rodada de correção: aberta quando a organização decide "aprovado com
 * correções" em /co-chairs/parecer-editorial. O autor ajusta título e
 * palavras-chave e reenvia os anexos que a categoria exige; orientador,
 * coautores e categoria ficam travados — foram eles que definiram os
 * impedimentos e os critérios já aplicados.
 */
const Correcao = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();

  const { exigenciasDe, carregando: carregandoExigencias } = useExigencias();

  const [trabalho, setTrabalho] = useState<Submission | null>(null);
  const [pareceres, setPareceres] = useState<ParecerAnonimo[]>([]);
  const [titulo, setTitulo] = useState("");
  const [palavrasChaveTexto, setPalavrasChaveTexto] = useState("");
  const [atuais, setAtuais] = useState<AnexoDoTrabalho[]>([]);
  const [anexos, setAnexos] = useState<RascunhoAnexos>({});
  const [loading, setLoading] = useState(true);
  const [enviando, setEnviando] = useState(false);

  // A categoria não muda na correção, então as exigências também não.
  const exigencias = exigenciasDe(trabalho?.categoria_id);

  const carregar = useCallback(async () => {
    if (!id || !user) return;
    setLoading(true);
    // Só o autor abre esta tela. A RLS deixa a organização ler qualquer
    // trabalho, então o recorte por dono é feito aqui — e o banco recusa
    // a correção de terceiros de qualquer forma (RPC enviar_correcao).
    const data = await obterMeuTrabalho(id, user.id).catch(() => null);

    if (!data) {
      toast.error("Trabalho não encontrado.");
      navigate("/estudante/papeis-submetidos");
      return;
    }

    const sub = {
      ...data,
      coautores: Array.isArray(data.coautores) ? (data.coautores as Coautor[]) : [],
    } as Submission;
    setTrabalho(sub);
    setTitulo(sub.titulo ?? "");
    setPalavrasChaveTexto(formatarPalavrasChave(sub.palavras_chave));
    setAtuais(await listarAnexosDoTrabalho(sub.id).catch(() => []));

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

  // Links de vídeo pré-preenchidos; PDFs vazios, o que a RPC lê como
  // "mantém o arquivo atual".
  useEffect(() => {
    if (exigencias.length === 0) return;
    setAnexos((atual) =>
      Object.keys(atual).length > 0 ? atual : rascunhoInicial(exigencias, atuais),
    );
  }, [exigencias, atuais]);

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
    const erroAnexos = validarAnexos({ exigencias, rascunho: anexos, atuais });
    if (erroAnexos) {
      toast.error(erroAnexos);
      return;
    }

    setEnviando(true);
    try {
      await enviarCorrecao({
        trabalhoId: trabalho.id,
        ownerId: user.id,
        titulo: titulo.trim(),
        palavrasChave,
        exigencias,
        anexos,
      });
      toast.success("Versão corrigida enviada. Seu trabalho está aprovado.");
      navigate("/estudante/papeis-submetidos");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao enviar a correção.");
      setEnviando(false);
    }
  }

  if (loading || carregandoExigencias) {
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
          <button className="back-link" onClick={() => navigate("/estudante/papeis-submetidos")}>
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
        <button className="back-link" onClick={() => navigate("/estudante/papeis-submetidos")}>
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
                <div className="step-subtitle">Título e palavras-chave podem ser alterados</div>
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

          {exigencias.length > 0 && (
            <div className="step-card">
              <div className="step-card-header">
                <div className="step-number">{pareceres.length > 0 ? "04" : "03"}</div>
                <div>
                  <div className="step-title">Arquivos e Vídeos Corrigidos</div>
                  <div className="step-subtitle">{resumoDoPasso(exigencias)}</div>
                </div>
              </div>
              <CamposAnexos
                exigencias={exigencias}
                rascunho={anexos}
                onMudar={setAnexos}
                atuais={atuais}
              />
            </div>
          )}

          <div className="form-footer">
            <button type="button" className="btn btn-outline" onClick={() => navigate("/estudante/papeis-submetidos")}>
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
