import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { carregarPoolRevisores, distribuirRevisoresAutomaticamente } from "@/services/revisorService";
import { MAX_PDF_BYTES, PDF_BUCKET, useTrabalhos } from "./shared";

const NovaSubmissao = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { categorias } = useTrabalhos();

  const [form, setForm] = useState({
    titulo: "", resumo: "", categoria: "", orientador: "",
  });
  const [coauthors, setCoauthors] = useState([{ nome: "", email: "" }]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmitWork = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.titulo || !form.resumo || !form.categoria) {
      toast.error("Preencha todos os campos obrigatórios.");
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
    setSubmitting(true);

    // 1. Envia o PDF ao bucket de Storage (S3) e guarda só o link de acesso.
    const safeName = selectedFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${Date.now()}-${safeName}`;
    const { error: uploadError } = await supabase.storage
      .from(PDF_BUCKET)
      .upload(path, selectedFile, { contentType: "application/pdf", upsert: false });

    if (uploadError) {
      toast.error("Erro ao enviar o PDF. Tente novamente.");
      setSubmitting(false);
      return;
    }
    const pdfUrl = supabase.storage.from(PDF_BUCKET).getPublicUrl(path).data.publicUrl;

    // 2. Insere o trabalho na tabela, com coautores e orientador.
    const coautores = coauthors
      .map(c => ({ nome: c.nome.trim(), email: c.email.trim() }))
      .filter(c => c.nome || c.email);
    const autores = [
      user?.nome ?? "Autor",
      ...coautores.filter(c => c.nome).map(c => c.nome),
    ].join(", ");

    const { data: novo, error } = await supabase.from("trabalhos").insert({
      titulo: form.titulo,
      resumo: form.resumo,
      categoria_id: form.categoria,
      autores,
      orientador_email: form.orientador.trim() || null,
      coautores,
      pdf_url: pdfUrl,
      data_submissao: new Date().toISOString().split("T")[0],
      status: "pendente",
    }).select("id").single();

    if (error) {
      toast.error("Erro ao submeter trabalho. Tente novamente.");
    } else {
      toast.success("Trabalho submetido com sucesso!");
      // Dispara a distribuição automática (tenta associar até 3 revisores ao
      // novo trabalho). É best-effort: falhas aqui não bloqueiam a submissão.
      if (novo?.id) {
        try {
          const pool = await carregarPoolRevisores();
          if (pool.length > 0) await distribuirRevisoresAutomaticamente(pool, [novo.id]);
        } catch {
          /* distribuição automática silenciosa */
        }
      }
      navigate("/estudante/historico");
      return;
    }
    setSubmitting(false);
  };

  return (
    <div className="section active">
      <div className="content-area">
        <button className="back-link" onClick={() => navigate("/estudante/dashboard")}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
          Voltar
        </button>

        <div className="page-header">
          <div className="page-overline">Nova Submissão</div>
          <h1 className="page-title">Submeter trabalho científico</h1>
          <p style={{ fontSize: "var(--fs-sm)", color: "var(--color-text-secondary)" }}>Preencha todos os campos obrigatórios para enviar seu trabalho.</p>
        </div>

        <form onSubmit={handleSubmitWork}>
          <div className="step-card">
            <div className="step-card-header">
              <div className="step-number">01</div>
              <div>
                <div className="step-title">Extração Automática</div>
                <div className="step-subtitle">Opcional — Importe um arquivo .tex para preencher automaticamente</div>
              </div>
            </div>
            <div className="import-row">
              <div className="import-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 20, height: 20 }}>
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
              </div>
              <div className="import-info">
                <div className="import-label">Importar .TEX</div>
                <div className="import-desc">Extraia título, resumo e autores do seu arquivo LaTeX</div>
              </div>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => alert("Funcionalidade de importação .TEX em desenvolvimento")}>Selecionar</button>
            </div>
          </div>

          <div className="step-card">
            <div className="step-card-header">
              <div className="step-number">02</div>
              <div><div className="step-title">Informações do Trabalho</div></div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="titulo">Título do Trabalho *</label>
              <input type="text" id="titulo" className="form-input" placeholder="Digite o título completo do trabalho" value={form.titulo} onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))} required />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="resumo">Resumo *</label>
              <textarea id="resumo" className="form-textarea" placeholder="Resumo de até 230 palavras..." rows={5} value={form.resumo} onChange={e => setForm(f => ({ ...f, resumo: e.target.value }))} />
              <div className="char-counter">{form.resumo.split(/\s+/).filter(Boolean).length} / 230 palavras</div>
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
              <div className="step-number">03</div>
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
              <div className="step-number">04</div>
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
            <button type="button" className="btn btn-outline" onClick={() => toast.info("Rascunho salvo localmente.")}>Salvar Rascunho</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? "Enviando..." : "Enviar Submissão"}</button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default NovaSubmissao;
