import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { submeterTrabalho } from "@/services/trabalhosService";
import { parsePalavrasChave, TIPO_RESUMO_PADRAO } from "@/lib/submissao";
import { idDoVideo } from "@/lib/youtube";
import { toast } from "sonner";
import { MAX_PDF_BYTES, formatarData, usePrazo, useTrabalhos } from "./shared";

const NovaSubmissao = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { categorias } = useTrabalhos();
  const { prazo, carregando: carregandoPrazo, aberto, fase } = usePrazo();

  const [form, setForm] = useState({
    titulo: "", categoria: "", orientador: "",
    // Digitadas como texto separado por vírgula; viram lista só no envio.
    palavrasChave: "", videoUrl: "",
  });
  const [coauthors, setCoauthors] = useState([{ nome: "", email: "" }]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const palavrasChave = parsePalavrasChave(form.palavrasChave);

  const handleSubmitWork = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.titulo || !form.categoria) {
      toast.error("Preencha todos os campos obrigatórios.");
      return;
    }
    if (palavrasChave.length === 0) {
      toast.error("Informe ao menos uma palavra-chave.");
      return;
    }
    if (!idDoVideo(form.videoUrl)) {
      toast.error("Informe um link válido de vídeo do YouTube.");
      return;
    }
    if (!selectedFile) {
      toast.error("Anexe o PDF do trabalho.");
      return;
    }
    if (selectedFile.type !== "application/pdf") {
      toast.error("O arquivo precisa estar em formato PDF.");
      return;
    }
    if (selectedFile.size > MAX_PDF_BYTES) {
      toast.error("O PDF excede o limite de 10MB.");
      return;
    }
    if (!user) {
      toast.error("Sessão expirada. Entre novamente.");
      return;
    }
    setSubmitting(true);

    const coautores = coauthors
      .map(c => ({ nome: c.nome.trim(), email: c.email.trim() }))
      .filter(c => c.nome || c.email);
    const autores = [
      user?.nome ?? "Autor",
      ...coautores.filter(c => c.nome).map(c => c.nome),
    ].join(", ");

    try {
      await submeterTrabalho({
        titulo: form.titulo,
        palavrasChave,
        videoUrl: form.videoUrl.trim(),
        tipoResumo: TIPO_RESUMO_PADRAO,
        categoriaId: form.categoria,
        autores,
        orientadorEmail: form.orientador.trim() || null,
        coautores,
        arquivo: selectedFile,
        ownerId: user.id,
      });
      toast.success("Trabalho submetido com sucesso!");
      navigate("/estudante/papeis-submetidos");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao submeter trabalho. Tente novamente.",
      );
      setSubmitting(false);
    }
  };

  const voltar = (
    <button className="back-link" onClick={() => navigate("/estudante/papeis-submetidos")}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
      Voltar
    </button>
  );

  if (carregandoPrazo) {
    return (
      <div className="section active">
        <div className="content-area">
          <div style={{ textAlign: "center", padding: 48, color: "var(--color-text-muted)" }}>Carregando...</div>
        </div>
      </div>
    );
  }

  // Fora da janela de submissão. `aberto === null` ("não sei", falha de
  // rede) NÃO bloqueia: quem recusa de verdade é o trigger no banco, e
  // esconder o formulário por causa de um erro de transporte tiraria a
  // submissão de quem ainda está dentro do prazo.
  if (aberto === false) {
    // Por que está fechado: "antes" (ainda vai abrir) ou "encerrado". Ver
    // `fasePrazo` em ./shared — a comparação é feita só com datas do servidor.
    const aindaVaiAbrir = fase === "antes";
    return (
      <div className="section active">
        <div className="content-area">
          {voltar}
          <div className="page-header">
            <div className="page-overline">Nova Submissão</div>
            <h1 className="page-title">Submeter trabalho científico</h1>
          </div>
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
              {aindaVaiAbrir ? "As submissões ainda não abriram" : "Prazo de submissão encerrado"}
            </h3>
            <p className="empty-state-description">
              {aindaVaiAbrir
                ? `O envio de trabalhos abre em ${formatarData(prazo?.abertura ?? null)}${prazo?.encerramento ? ` e vai até ${formatarData(prazo.encerramento)}` : ""}. Até lá nada pode ser enviado.`
                : `O prazo terminou em ${formatarData(prazo?.encerramento ?? null)}. Novos trabalhos não podem mais ser enviados, e os que já estão aprovados com correções continuam podendo ser corrigidos.`}
            </p>
            <button className="btn btn-primary btn-sm" onClick={() => navigate("/estudante/papeis-submetidos")}>
              VER MEUS TRABALHOS
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="section active">
      <div className="content-area">
        {voltar}

        <div className="page-header">
          <div className="page-overline">Nova Submissão</div>
          <h1 className="page-title">Submeter trabalho científico</h1>
          <p style={{ fontSize: "var(--fs-sm)", color: "var(--color-text-secondary)" }}>
            Preencha todos os campos obrigatórios para enviar seu trabalho.
            {prazo?.encerramento ? ` O prazo se encerra em ${formatarData(prazo.encerramento)}.` : ""}
          </p>
        </div>

        <form onSubmit={handleSubmitWork}>
          <div className="step-card">
            <div className="step-card-header">
              <div className="step-number">01</div>
              <div><div className="step-title">Informações do Trabalho</div></div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="titulo">Título do Trabalho *</label>
              <input type="text" id="titulo" className="form-input" placeholder="Digite o título completo do trabalho" value={form.titulo} onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))} required />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="palavras-chave">Palavras-chave *</label>
              <input type="text" id="palavras-chave" className="form-input" placeholder="aprendizado de máquina, visão computacional, agricultura" value={form.palavrasChave} onChange={e => setForm(f => ({ ...f, palavrasChave: e.target.value }))} />
              <div className="form-hint">Separe os termos por vírgula ou ponto e vírgula.</div>
              {palavrasChave.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                  {palavrasChave.map(p => <span className="badge badge-gray" key={p}>{p}</span>)}
                </div>
              )}
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="video-url">Vídeo de Apresentação (YouTube) *</label>
              <input type="url" id="video-url" className="form-input" placeholder="https://www.youtube.com/watch?v=..." value={form.videoUrl} onChange={e => setForm(f => ({ ...f, videoUrl: e.target.value }))} />
              <div className="form-hint">Cole o endereço do vídeo. Os avaliadores o assistem dentro do sistema.</div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="categoria">Categoria *</label>
              <select id="categoria" className="form-select" value={form.categoria} onChange={e => setForm(f => ({ ...f, categoria: e.target.value }))}>
                <option value="">Selecione a categoria</option>
                {categorias.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </div>
          </div>

          <div className="step-card">
            <div className="step-card-header">
              <div className="step-number">02</div>
              <div><div className="step-title">Autoria</div></div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="orientador">E-mail do Orientador</label>
              <input type="email" id="orientador" className="form-input" placeholder="orientador@ufla.br" value={form.orientador} onChange={e => setForm(f => ({ ...f, orientador: e.target.value }))} />
            </div>

            <div className="coauthor-section">
              <div className="coauthor-header">
                <span className="coauthor-label">Coautores</span>
                <button type="button" className="coauthor-add" onClick={() => setCoauthors(c => [...c, { nome: "", email: "" }])}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  Adicionar
                </button>
              </div>
              {coauthors.map((c, i) => (
                <div className="coauthor-row" key={i}>
                  <input type="text" className="form-input" placeholder="Nome completo" value={c.nome} onChange={e => { const nc = [...coauthors]; nc[i].nome = e.target.value; setCoauthors(nc); }} />
                  <input type="email" className="form-input" placeholder="email@ufla.br" value={c.email} onChange={e => { const nc = [...coauthors]; nc[i].email = e.target.value; setCoauthors(nc); }} />
                  {coauthors.length > 1 && (
                    <button type="button" className="coauthor-remove" onClick={() => setCoauthors(coauthors.filter((_, j) => j !== i))}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16 }}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="step-card">
            <div className="step-card-header">
              <div className="step-number">03</div>
              <div>
                <div className="step-title">Arquivo Final</div>
                <div className="step-subtitle">Anexe o PDF do trabalho · Limite 10MB</div>
              </div>
            </div>
            <div className="drop-zone" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setSelectedFile(f); }}>
              <div className="drop-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 48, height: 48 }}>
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
              </div>
              {selectedFile ? (
                <div style={{ color: "var(--color-success)", fontSize: "var(--fs-sm)", display: "flex", alignItems: "center", gap: 8, justifyContent: "center" }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
                  {selectedFile.name}
                </div>
              ) : (
                <>
                  <div className="drop-title">Arraste seu PDF aqui</div>
                  <div className="drop-subtitle">ou clique para selecionar do computador</div>
                  <label className="btn btn-primary btn-sm" style={{ cursor: "pointer" }}>
                    Selecionar Arquivo
                    <input type="file" accept=".pdf" style={{ display: "none" }} onChange={e => { if (e.target.files?.[0]) setSelectedFile(e.target.files[0]); }} />
                  </label>
                </>
              )}
            </div>
          </div>

          <div className="form-footer">
            <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? "Enviando..." : "Enviar Submissão"}</button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default NovaSubmissao;
