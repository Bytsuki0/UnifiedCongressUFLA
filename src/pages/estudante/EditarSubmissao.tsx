import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { editarSubmissao, obterMeuTrabalho } from "@/services/trabalhosService";
import { listarAnexosDoTrabalho } from "@/services/anexosService";
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
  PENDENTE,
  formatarData,
  usePrazo,
  useExigencias,
  type Coautor,
  type Submission,
} from "./shared";

/**
 * Edição da submissão antes de a avaliação começar.
 *
 * Irmã da tela de correção, com o gatilho trocado: aquela abre com
 * "aprovado com correções" e ignora o prazo; esta abre com 'pendente' e
 * só dentro da janela de submissão.
 *
 * Mesmo conjunto de campos das duas — título, palavras-chave e os anexos
 * que a categoria exige. Autoria e categoria ficam travadas mesmo com o
 * prazo aberto, e não por descuido: a distribuição de revisores sai do
 * orientador e dos coautores (é assim que o conflito de interesse é
 * barrado) e os critérios do parecer saem da categoria. Um co-chair pode
 * já ter confirmado a distribuição deste trabalho a qualquer momento —
 * trocar autoria depois invalidaria em silêncio a checagem de conflito
 * que escolheu aqueles revisores.
 *
 * ⚠ A categoria travada é o que garante que as EXIGÊNCIAS de anexo não
 * mudam no meio da edição: trocá-la trocaria os campos do formulário.
 * Só o reenvio (`Reenvio.tsx`) abre esse caminho.
 *
 * Quem recusa de fato é a RPC `editar_submissao`. Esta tela só evita que
 * a pessoa preencha um formulário que o banco vai rejeitar.
 */
const EditarSubmissao = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { prazo, carregando: carregandoPrazo, aberto, fase } = usePrazo();
  const { exigenciasDe, carregando: carregandoExigencias } = useExigencias();

  const [trabalho, setTrabalho] = useState<Submission | null>(null);
  const [titulo, setTitulo] = useState("");
  const [palavrasChaveTexto, setPalavrasChaveTexto] = useState("");
  const [atuais, setAtuais] = useState<AnexoDoTrabalho[]>([]);
  const [anexos, setAnexos] = useState<RascunhoAnexos>({});
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);

  // A categoria não muda nesta tela, então as exigências também não.
  const exigencias = exigenciasDe(trabalho?.categoria_id);

  const carregar = useCallback(async () => {
    if (!id || !user) return;
    setLoading(true);
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
    setLoading(false);
  }, [id, user, navigate]);

  useEffect(() => { carregar(); }, [carregar]);

  // Os links de vídeo nascem preenchidos com o que está gravado; os PDFs
  // nascem vazios, o que a RPC lê como "mantém o arquivo atual". Só roda
  // quando as duas cargas terminam — antes disso não há o que preencher.
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

    setSalvando(true);
    try {
      await editarSubmissao({
        trabalhoId: trabalho.id,
        ownerId: user.id,
        titulo: titulo.trim(),
        palavrasChave,
        exigencias,
        anexos,
      });
      toast.success("Alterações salvas.");
      navigate("/estudante/papeis-submetidos");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar as alterações.");
      setSalvando(false);
    }
  }

  if (loading || carregandoPrazo || carregandoExigencias) {
    return (
      <div className="section active">
        <div className="content-area">
          <div style={{ textAlign: "center", padding: 48, color: "var(--color-text-muted)" }}>Carregando...</div>
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

  // Já entrou em avaliação: nada a editar por aqui. Trabalho aprovado com
  // correções tem tela própria, que continua valendo depois do prazo.
  if (trabalho && trabalho.status !== PENDENTE) {
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
            <h3 className="empty-state-title">Este trabalho não pode mais ser editado</h3>
            <p className="empty-state-description">
              A avaliação já começou. Se os pareceres pedirem ajustes, a tela de correção abre
              automaticamente, e ela continua disponível mesmo depois do prazo.
            </p>
            <button className="btn btn-primary btn-sm" onClick={() => navigate(`/estudante/trabalho/${trabalho.id}`)}>
              VER SITUAÇÃO
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Fora da janela de submissão. `aberto === null` (não sei) não bloqueia:
  // quem recusa de verdade é o banco, e uma falha de rede não pode trancar
  // quem ainda está dentro do prazo.
  if (aberto === false) {
    // "antes" e "encerrado" fecham a edição do mesmo jeito, mas dizem
    // coisas opostas: um é espera, o outro é fim. Ver `fasePrazo`.
    const aindaVaiAbrir = fase === "antes";
    return (
      <div className="section active">
        <div className="content-area">
          {voltar}
          <div className="empty-state">
            <div className="empty-state-icon">
              {aindaVaiAbrir ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 28, height: 28 }}>
                  <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 28, height: 28 }}>
                  <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                </svg>
              )}
            </div>
            <h3 className="empty-state-title">
              {aindaVaiAbrir ? "As submissões ainda não abriram" : "Prazo encerrado"}
            </h3>
            <p className="empty-state-description">
              {aindaVaiAbrir ? (
                <>
                  A janela de submissão abre em {formatarData(prazo?.abertura ?? null)}; até lá o
                  trabalho não pode ser alterado.
                </>
              ) : (
                <>
                  As submissões foram encerradas em {formatarData(prazo?.encerramento ?? null)} e o
                  trabalho não pode mais ser alterado. Trabalhos aprovados com correções continuam
                  editáveis pela tela de correção.
                </>
              )}
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
        {voltar}

        <div className="page-header">
          <div className="page-overline">Submissão pendente</div>
          <h1 className="page-title">Editar submissão</h1>
          <p style={{ fontSize: "var(--fs-sm)", color: "var(--color-text-secondary)" }}>
            Ajuste o texto ou troque o arquivo enquanto a avaliação não começa.
            {prazo?.encerramento
              ? ` As submissões se encerram em ${formatarData(prazo.encerramento)}.`
              : ""}
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="step-card">
            <div className="step-card-header">
              <div className="step-number">01</div>
              <div>
                <div className="step-title">Informações do Trabalho</div>
                <div className="step-subtitle">Título e palavras-chave podem ser alterados</div>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="editar-titulo">Título do Trabalho *</label>
              <input
                type="text"
                id="editar-titulo"
                className="form-input"
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="editar-palavras-chave">Palavras-chave *</label>
              <input
                type="text"
                id="editar-palavras-chave"
                className="form-input"
                value={palavrasChaveTexto}
                onChange={(e) => setPalavrasChaveTexto(e.target.value)}
              />
              <div className="form-hint">Separe os termos por vírgula ou ponto e vírgula.</div>
            </div>
          </div>

          <div className="step-card">
            <div className="step-card-header">
              <div className="step-number">02</div>
              <div>
                <div className="step-title">Autoria e Categoria</div>
                <div className="step-subtitle">Travadas, definiram os revisores sorteados e os critérios da avaliação</div>
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
                <div className="step-number">03</div>
                <div>
                  <div className="step-title">Arquivos e Vídeos</div>
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
            <button type="submit" className="btn btn-primary" disabled={salvando}>
              {salvando ? "Salvando..." : "Salvar Alterações"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default EditarSubmissao;
