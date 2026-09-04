import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { obterMeuTrabalho } from "@/services/trabalhosService";
import { listarAnexosDoTrabalho } from "@/services/anexosService";
import { PareceresRecebidos } from "@/components/estudante/PareceresRecebidos";
import {
  carregarPareceresDoTrabalho,
  type ParecerAnonimo,
} from "@/services/correcaoService";
import {
  carregarDecisaoEditorial,
  reenviarTrabalho,
  type DecisaoDoAutor,
} from "@/services/parecerEditorialService";
import { formatarPalavrasChave, parsePalavrasChave } from "@/lib/submissao";
import {
  rascunhoInicial,
  resumoDoPasso,
  validarAnexos,
  type AnexoDoTrabalho,
  type RascunhoAnexos,
} from "@/lib/anexos";
import { CamposAnexos } from "@/components/estudante/CamposAnexos";
import {
  AGUARDANDO_REENVIO,
  useExigencias,
  useTrabalhos,
  type Coautor,
  type Submission,
} from "./shared";

/**
 * Reenvio do trabalho, depois da decisão editorial "resubmeter".
 *
 * É a ÚNICA tela do autor com o formulário completo. `EditarSubmissao` e
 * `Correcao` mostram autoria e categoria travadas, porque nas duas os
 * revisores já foram escolhidos a partir do orientador e dos coautores, e
 * os critérios já saíram da categoria. Aqui não: o trabalho volta ao
 * começo, os revisores da rodada nova ainda serão atribuídos, e é por
 * isso que abrir esses campos é seguro exatamente aqui.
 *
 * E é envio único. Depois dele, `reenviado_em` fica gravado e
 * `editar_submissao` recusa para sempre — o aviso na tela existe para
 * ninguém descobrir isso só depois de clicar.
 */
const Reenvio = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { categorias } = useTrabalhos();
  const { exigenciasDe, carregando: carregandoExigencias } = useExigencias();

  const [trabalho, setTrabalho] = useState<Submission | null>(null);
  const [pareceres, setPareceres] = useState<ParecerAnonimo[]>([]);
  const [decisao, setDecisao] = useState<DecisaoDoAutor | null>(null);

  const [titulo, setTitulo] = useState("");
  const [palavrasChaveTexto, setPalavrasChaveTexto] = useState("");
  const [categoriaId, setCategoriaId] = useState("");
  const [orientador, setOrientador] = useState("");
  const [coautores, setCoautores] = useState<Coautor[]>([{ nome: "", email: "" }]);
  const [atuais, setAtuais] = useState<AnexoDoTrabalho[]>([]);
  const [anexos, setAnexos] = useState<RascunhoAnexos>({});

  const [loading, setLoading] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);

  // ⚠ Esta é a única tela do autor em que a CATEGORIA muda — e trocar a
  // categoria troca as exigências. Por isso as exigências saem da
  // categoria ESCOLHIDA NO FORMULÁRIO, não da que está gravada: o autor
  // tem de ver na hora os campos da categoria nova.
  const exigencias = exigenciasDe(categoriaId);

  const carregar = useCallback(async () => {
    if (!id || !user) return;
    setLoading(true);
    const data = await obterMeuTrabalho(id, user.id).catch(() => null);
    if (!data) {
      toast.error("Trabalho não encontrado.");
      navigate("/estudante/papeis-submetidos");
      return;
    }

    const lista = Array.isArray(data.coautores) ? (data.coautores as Coautor[]) : [];
    const sub = { ...data, coautores: lista } as Submission;
    setTrabalho(sub);
    setTitulo(sub.titulo ?? "");
    setPalavrasChaveTexto(formatarPalavrasChave(sub.palavras_chave));
    setCategoriaId(sub.categoria_id ?? "");
    setOrientador(sub.orientador_email ?? "");
    setCoautores(lista.length > 0 ? lista : [{ nome: "", email: "" }]);
    setAtuais(await listarAnexosDoTrabalho(sub.id).catch(() => []));

    try {
      setPareceres(await carregarPareceresDoTrabalho(id));
    } catch {
      setPareceres([]);
    }
    try {
      setDecisao(await carregarDecisaoEditorial(id));
    } catch {
      setDecisao(null);
    }
    setLoading(false);
  }, [id, user, navigate]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // Pré-preenche os links de vídeo com o que está gravado. Depende de
  // `exigencias`, então roda de novo quando o autor troca a categoria —
  // aí `atuais` não casa com as exigências novas e os campos nascem
  // vazios, que é o correto: são outros anexos.
  useEffect(() => {
    if (exigencias.length === 0) return;
    setAnexos(rascunhoInicial(exigencias, atuais));
  }, [exigencias, atuais]);

  const setCoautor = (i: number, campo: keyof Coautor, valor: string) =>
    setCoautores((anterior) =>
      anterior.map((c, idx) => (idx === i ? { ...c, [campo]: valor } : c)),
    );

  /** Valida tudo e abre a confirmação — o envio em si é o `confirmar`. */
  function revisar(e: React.FormEvent) {
    e.preventDefault();
    if (!titulo.trim()) {
      toast.error("O título é obrigatório.");
      return;
    }
    if (!categoriaId) {
      toast.error("Selecione a categoria.");
      return;
    }
    if (parsePalavrasChave(palavrasChaveTexto).length === 0) {
      toast.error("Informe ao menos uma palavra-chave.");
      return;
    }
    // `atuais` só vale como "já entreguei isto" enquanto a categoria for a
    // mesma: trocada a categoria, as exigências são outras e nada do que
    // está gravado as cumpre.
    const mesmaCategoria = categoriaId === (trabalho?.categoria_id ?? "");
    const erroAnexos = validarAnexos({
      exigencias,
      rascunho: anexos,
      atuais: mesmaCategoria ? atuais : [],
    });
    if (erroAnexos) {
      toast.error(erroAnexos);
      return;
    }
    setConfirmando(true);
  }

  async function confirmar() {
    if (!trabalho || !user) return;
    setEnviando(true);
    try {
      const limpos = coautores
        .map((c) => ({ nome: (c.nome ?? "").trim(), email: (c.email ?? "").trim() }))
        .filter((c) => c.nome || c.email);
      const autores = [
        user.nome ?? "Autor",
        ...limpos.filter((c) => c.nome).map((c) => c.nome),
      ].join(", ");

      await reenviarTrabalho({
        trabalhoId: trabalho.id,
        ownerId: user.id,
        titulo: titulo.trim(),
        palavrasChave: parsePalavrasChave(palavrasChaveTexto),
        autores,
        orientadorEmail: orientador.trim() || null,
        coautores: limpos,
        categoriaId,
        exigencias,
        anexos,
      });
      toast.success("Trabalho reenviado. Ele voltou para a fila de avaliação.");
      navigate("/estudante/papeis-submetidos");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao reenviar o trabalho.");
      setEnviando(false);
      setConfirmando(false);
    }
  }

  if (loading || carregandoExigencias) {
    return (
      <div className="section active">
        <div className="content-area">
          <p style={{ color: "var(--color-text-muted)" }}>Carregando...</p>
        </div>
      </div>
    );
  }

  const voltar = (
    <button className="back-link" onClick={() => navigate("/estudante/papeis-submetidos")}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
      Voltar
    </button>
  );

  // O banco recusa fora deste status; a interface avisa antes.
  if (trabalho && trabalho.status !== AGUARDANDO_REENVIO) {
    return (
      <div className="section active">
        <div className="content-area">
          {voltar}
          <div className="empty-state">
            <div className="empty-state-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 28, height: 28 }}>
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <h3 className="empty-state-title">Nada a reenviar</h3>
            <p className="empty-state-description">
              Este trabalho não está aguardando reenvio. O reenvio só abre quando a organização
              devolve o trabalho com a decisão “reenviar para nova avaliação”.
            </p>
            <button className="btn btn-primary btn-sm" onClick={() => navigate(`/estudante/trabalho/${trabalho.id}`)}>
              VER SITUAÇÃO
            </button>
          </div>
        </div>
      </div>
    );
  }

  const passo = (n: number) => String(n).padStart(2, "0");
  let etapa = 0;

  return (
    <div className="section active">
      <div className="content-area">
        {voltar}

        <div className="page-header">
          <div className="page-overline">Reenvio solicitado</div>
          <h1 className="page-title">Reenviar trabalho</h1>
          <p style={{ fontSize: "var(--fs-sm)", color: "var(--color-text-secondary)" }}>
            Você pode alterar tudo — inclusive autoria e categoria. Depois do reenvio o trabalho
            volta para a fila e recebe três avaliadores novos.
          </p>
        </div>

        <div className="alert alert-warning" style={{ marginBottom: "var(--space-4)" }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18, flexShrink: 0, marginTop: 1 }}>
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <div>
            <strong>Este envio é único.</strong> Depois de reenviar, o trabalho não poderá mais ser
            editado — nem por esta tela, nem pela de edição. Confira tudo antes de confirmar.
          </div>
        </div>

        {decisao && (
          <div className="step-card">
            <div className="step-card-header">
              <div className="step-number">{passo(++etapa)}</div>
              <div>
                <div className="step-title">Decisão da organização</div>
                <div className="step-subtitle">O que foi pedido, e por quê</div>
              </div>
            </div>
            <div
              style={{
                fontSize: "var(--fs-sm)",
                background: "var(--gray-50)",
                padding: 12,
                borderRadius: 4,
                lineHeight: "var(--lh-normal)",
                whiteSpace: "pre-wrap",
              }}
            >
              {decisao.comentario}
            </div>
          </div>
        )}

        {pareceres.length > 0 && (
          <div className="step-card">
            <div className="step-card-header">
              <div className="step-number">{passo(++etapa)}</div>
              <div>
                <div className="step-title">Notas e comentários dos avaliadores</div>
                <div className="step-subtitle">Avaliação às cegas, a identificação dos avaliadores é omitida</div>
              </div>
            </div>
            <PareceresRecebidos pareceres={pareceres} />
          </div>
        )}

        <form onSubmit={revisar}>
          <div className="step-card">
            <div className="step-card-header">
              <div className="step-number">{passo(++etapa)}</div>
              <div>
                <div className="step-title">Informações do Trabalho</div>
                <div className="step-subtitle">Tudo editável nesta etapa</div>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="reenvio-titulo">Título do Trabalho *</label>
              <input type="text" id="reenvio-titulo" className="form-input" value={titulo} onChange={(e) => setTitulo(e.target.value)} required />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="reenvio-palavras-chave">Palavras-chave *</label>
              <input type="text" id="reenvio-palavras-chave" className="form-input" value={palavrasChaveTexto} onChange={(e) => setPalavrasChaveTexto(e.target.value)} />
              <div className="form-hint">Separe os termos por vírgula ou ponto e vírgula.</div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="reenvio-categoria">Categoria *</label>
              <select id="reenvio-categoria" className="form-select" value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)} required>
                <option value="">Selecione a categoria</option>
                {categorias.map((c) => (
                  <option key={c.id} value={c.id}>{c.nome}</option>
                ))}
              </select>
              <div className="form-hint">
                A categoria define os critérios da avaliação e quais arquivos e vídeos o trabalho
                precisa enviar. Trocá-la troca os campos abaixo.
              </div>
            </div>
          </div>

          <div className="step-card">
            <div className="step-card-header">
              <div className="step-number">{passo(++etapa)}</div>
              <div>
                <div className="step-title">Autoria</div>
                <div className="step-subtitle">Editável no reenvio — os avaliadores novos são escolhidos a partir daqui</div>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="reenvio-orientador">E-mail do Orientador</label>
              <input type="email" id="reenvio-orientador" className="form-input" value={orientador} onChange={(e) => setOrientador(e.target.value)} />
              <div className="form-hint">
                Orientador e coautores ficam impedidos de avaliar este trabalho.
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Coautores</label>
              {coautores.map((c, i) => (
                <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <input type="text" className="form-input" placeholder="Nome" value={c.nome ?? ""} onChange={(e) => setCoautor(i, "nome", e.target.value)} />
                  <input type="email" className="form-input" placeholder="E-mail" value={c.email ?? ""} onChange={(e) => setCoautor(i, "email", e.target.value)} />
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={() => setCoautores((a) => (a.length === 1 ? [{ nome: "", email: "" }] : a.filter((_, idx) => idx !== i)))}
                    title="Remover coautor"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  </button>
                </div>
              ))}
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setCoautores((a) => [...a, { nome: "", email: "" }])}>
                Adicionar coautor
              </button>
            </div>
          </div>

          {exigencias.length > 0 && (
            <div className="step-card">
              <div className="step-card-header">
                <div className="step-number">{passo(++etapa)}</div>
                <div>
                  <div className="step-title">Arquivos e Vídeos</div>
                  <div className="step-subtitle">{resumoDoPasso(exigencias)}</div>
                </div>
              </div>
              <CamposAnexos
                exigencias={exigencias}
                rascunho={anexos}
                onMudar={setAnexos}
                atuais={categoriaId === (trabalho?.categoria_id ?? "") ? atuais : []}
              />
            </div>
          )}

          {confirmando ? (
            <div className="alert alert-warning" style={{ marginBottom: "var(--space-4)" }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18, flexShrink: 0, marginTop: 1 }}>
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <div style={{ flex: 1 }}>
                <strong>Confirmar o reenvio?</strong> Esta é a última chance de editar. Depois de
                confirmar, o trabalho volta para avaliação e você não poderá mais alterá-lo.
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => setConfirmando(false)} disabled={enviando}>
                    Voltar e revisar
                  </button>
                  <button type="button" className="btn btn-primary btn-sm" onClick={confirmar} disabled={enviando}>
                    {enviando ? "Enviando..." : "Confirmar reenvio"}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="form-footer">
              <button type="button" className="btn btn-outline" onClick={() => navigate("/estudante/papeis-submetidos")}>
                Cancelar
              </button>
              <button type="submit" className="btn btn-primary">
                Revisar e reenviar
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
};

export default Reenvio;
