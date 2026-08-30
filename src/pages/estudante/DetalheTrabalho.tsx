import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { obterMeuTrabalho } from "@/services/trabalhosService";
import { carregarPareceresDoTrabalho, type ParecerAnonimo } from "@/services/correcaoService";
import {
  carregarDecisaoEditorial,
  type DecisaoDoAutor,
} from "@/services/parecerEditorialService";
import { PareceresRecebidos } from "@/components/estudante/PareceresRecebidos";
import { openPdf } from "@/lib/pdfStorage";
import {
  AGUARDANDO_CORRECAO,
  AGUARDANDO_EDITORIAL,
  AGUARDANDO_REENVIO,
  PENDENTE,
  statusBadge,
  statusLabel,
  type Coautor,
  type Submission,
} from "./shared";

/**
 * O resultado da avaliação, do ponto de vista do autor.
 *
 * Existe porque antes não havia lugar nenhum onde ver as notas: os
 * pareceres só apareciam dentro da tela de correção, que só abre para
 * "aprovado com correções". Quem foi aprovado ou reprovado ficava sem
 * saber o que o avaliador escreveu.
 *
 * O que pode ser visto e quando é decisão do servidor
 * (`pareceres_do_meu_trabalho`): sem identificação do revisor, e só
 * depois do PARECER EDITORIAL — não mais assim que o 3º parecer entra.
 * A diferença importa: entre uma coisa e outra existe uma janela em que
 * os três vereditos existem e a organização ainda pode contrariá-los.
 */

/** Mensagem de topo por desfecho — o que a pessoa faz com esta tela. */
const ORIENTACAO: Record<string, { overline: string; titulo: string; texto: string }> = {
  [PENDENTE]: {
    overline: "Aguardando avaliação",
    titulo: "Trabalho recebido",
    texto: "A avaliação ainda não começou. Os pareceres aparecem aqui quando os avaliadores concluírem.",
  },
  em_avaliacao: {
    overline: "Em avaliação",
    titulo: "Avaliação em andamento",
    texto: "Os pareceres já emitidos só são revelados quando a decisão fecha, é o que mantém a avaliação às cegas.",
  },
  // Os 3 pareceres chegaram, a organização ainda não decidiu. Para o
  // autor isto continua sendo "espere" — dizer que os pareceres já
  // existem convidaria a perguntar um resultado que não existe.
  [AGUARDANDO_EDITORIAL]: {
    overline: "Em análise final",
    titulo: "Avaliação concluída, decisão em andamento",
    texto: "Os avaliadores concluíram e a organização está analisando o conjunto. A decisão e os pareceres aparecem aqui assim que ela for registrada.",
  },
  [AGUARDANDO_REENVIO]: {
    overline: "Reenvio solicitado",
    titulo: "Reenvie o trabalho para nova avaliação",
    texto: "A organização pediu um novo envio. Você pode alterar tudo — inclusive autoria e categoria — mas só uma vez: depois de reenviar, o trabalho não poderá mais ser editado.",
  },
  aprovado: {
    overline: "Aprovado",
    titulo: "Trabalho aprovado",
    texto: "Abaixo estão as notas e os comentários que os avaliadores registraram.",
  },
  [AGUARDANDO_CORRECAO]: {
    overline: "Aprovado com correções",
    titulo: "Correções solicitadas",
    texto: "Leia os apontamentos abaixo e reenvie o PDF corrigido pelo botão “Enviar correção”.",
  },
  reprovado: {
    overline: "Não aprovado",
    titulo: "Trabalho não aprovado",
    texto: "As notas e os comentários dos avaliadores estão abaixo, com a justificativa da decisão.",
  },
};

const DetalheTrabalho = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();

  const [trabalho, setTrabalho] = useState<Submission | null>(null);
  const [pareceres, setPareceres] = useState<ParecerAnonimo[]>([]);
  const [decisao, setDecisao] = useState<DecisaoDoAutor | null>(null);
  const [loading, setLoading] = useState(true);

  const carregar = useCallback(async () => {
    if (!id || !user) return;
    setLoading(true);
    // Recorte por dono: a RLS deixa a organização ler qualquer trabalho,
    // e esta tela é sempre "o MEU trabalho".
    const data = await obterMeuTrabalho(id, user.id).catch(() => null);
    if (!data) {
      toast.error("Trabalho não encontrado.");
      navigate("/estudante/papeis-submetidos");
      return;
    }
    setTrabalho({
      ...data,
      coautores: Array.isArray(data.coautores) ? (data.coautores as Coautor[]) : [],
    } as Submission);

    try {
      setPareceres(await carregarPareceresDoTrabalho(id));
    } catch {
      // Decisão ainda não fechada, ou falha de rede: a tela funciona
      // sem os pareceres, e o texto de orientação já explica o estado.
      setPareceres([]);
    }
    try {
      setDecisao(await carregarDecisaoEditorial(id));
    } catch {
      setDecisao(null);
    }
    setLoading(false);
  }, [id, user, navigate]);

  useEffect(() => { carregar(); }, [carregar]);

  const verPdf = async () => {
    if (!(await openPdf(trabalho?.pdf_url))) toast.error("Não foi possível abrir o PDF.");
  };

  if (loading) {
    return (
      <div className="section active">
        <div className="content-area">
          <div style={{ textAlign: "center", padding: 48, color: "var(--color-text-muted)" }}>Carregando...</div>
        </div>
      </div>
    );
  }
  if (!trabalho) return null;

  const guia = ORIENTACAO[trabalho.status] ?? {
    overline: "Submissão",
    titulo: trabalho.titulo,
    texto: "Acompanhe aqui o andamento do seu trabalho.",
  };
  const coautores = (trabalho.coautores ?? []).filter((c) => c.nome || c.email);
  const palavrasChave = trabalho.palavras_chave ?? [];

  return (
    <div className="section active">
      <div className="content-area">
        <button className="back-link" onClick={() => navigate("/estudante/papeis-submetidos")}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
          Voltar
        </button>

        <div className="page-header">
          <div className="page-overline">{guia.overline}</div>
          <h1 className="page-title">{guia.titulo}</h1>
          <p style={{ fontSize: "var(--fs-sm)", color: "var(--color-text-secondary)" }}>{guia.texto}</p>
        </div>

        <div className="step-card">
          <div className="step-card-header">
            <div className="step-number">01</div>
            <div>
              <div className="step-title">{trabalho.titulo}</div>
              <div className="step-subtitle">
                Enviado em {new Date(trabalho.data_submissao).toLocaleDateString("pt-BR")}
                {trabalho.correcoes_enviadas_em
                  ? ` · correção enviada em ${new Date(trabalho.correcoes_enviadas_em).toLocaleDateString("pt-BR")}`
                  : ""}
              </div>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Situação</label>
            <div><span className={statusBadge(trabalho.status)}>{statusLabel[trabalho.status] ?? trabalho.status}</span></div>
          </div>

          <div className="form-group">
            <label className="form-label">Autores</label>
            <div style={{ fontSize: "var(--fs-sm)" }}>{trabalho.autores}</div>
          </div>

          {coautores.length > 0 && (
            <div className="form-group">
              <label className="form-label">Coautores</label>
              <div style={{ fontSize: "var(--fs-sm)", color: "var(--color-text-secondary)" }}>
                {coautores.map((c) => [c.nome, c.email].filter(Boolean).join(" · ")).join(" | ")}
              </div>
            </div>
          )}

          {palavrasChave.length > 0 && (
            <div className="form-group">
              <label className="form-label">Palavras-chave</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {palavrasChave.map((p) => <span className="badge badge-gray" key={p}>{p}</span>)}
              </div>
            </div>
          )}

          {trabalho.video_url && (
            <div className="import-row">
              <div className="import-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 20, height: 20 }}>
                  <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
                </svg>
              </div>
              <div className="import-info">
                <div className="import-label">Vídeo de apresentação</div>
                <div className="import-desc">O link que os avaliadores assistem</div>
              </div>
              <a className="btn btn-outline btn-sm" href={trabalho.video_url} target="_blank" rel="noopener noreferrer">Ver vídeo</a>
            </div>
          )}

          {trabalho.pdf_url && (
            <div className="import-row">
              <div className="import-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 20, height: 20 }}>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                </svg>
              </div>
              <div className="import-info">
                <div className="import-label">Arquivo registrado</div>
                <div className="import-desc">A versão que está no sistema hoje</div>
              </div>
              <button type="button" className="btn btn-outline btn-sm" onClick={verPdf}>Ver PDF</button>
            </div>
          )}
        </div>

        {/* A decisão da organização vem ANTES dos pareceres: é ela que
            vale, e os pareceres são a fundamentação. Até 20260820140000
            não havia o que mostrar aqui — o desfecho saía da média sem
            que ninguém escrevesse uma linha de justificativa. */}
        {decisao && (
          <div className="step-card">
            <div className="step-card-header">
              <div className="step-number">02</div>
              <div>
                <div className="step-title">Decisão da organização</div>
                <div className="step-subtitle">O parecer editorial sobre o seu trabalho</div>
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

        <div className="step-card">
          <div className="step-card-header">
            <div className="step-number">{decisao ? "03" : "02"}</div>
            <div>
              <div className="step-title">Notas e comentários dos avaliadores</div>
              <div className="step-subtitle">Avaliação às cegas, a identificação dos avaliadores é omitida</div>
            </div>
          </div>

          {pareceres.length > 0 ? (
            <PareceresRecebidos pareceres={pareceres} />
          ) : (
            <div className="empty-state">
              <div className="empty-state-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 28, height: 28 }}>
                  <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                </svg>
              </div>
              <h3 className="empty-state-title">Nenhum parecer disponível ainda</h3>
              <p className="empty-state-description">
                Os pareceres são revelados junto com a decisão da organização. Até lá, nem as notas
                nem os comentários ficam visíveis, é o que mantém a avaliação às cegas.
              </p>
            </div>
          )}
        </div>

        {trabalho.status === AGUARDANDO_CORRECAO && (
          <div className="form-footer">
            <button className="btn btn-primary" onClick={() => navigate(`/estudante/correcao/${trabalho.id}`)}>
              Enviar correção
            </button>
          </div>
        )}

        {trabalho.status === AGUARDANDO_REENVIO && (
          <div className="form-footer">
            <button className="btn btn-primary" onClick={() => navigate(`/estudante/reenvio/${trabalho.id}`)}>
              Reenviar trabalho
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default DetalheTrabalho;
