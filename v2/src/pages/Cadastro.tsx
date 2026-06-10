import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const Cadastro = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const emailFromState = (location.state as { email?: string })?.email || "";
  const [form, setForm] = useState({ nome: "", matricula: "", periodo: "", email: emailFromState, curso: "", senha: "" });
  const [loading, setLoading] = useState(false);

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.nome || !form.matricula || !form.email || !form.curso || !form.senha) {
      toast.error("Preencha todos os campos obrigatórios.");
      return;
    }
    if (form.senha.length < 6) {
      toast.error("A senha deve ter no mínimo 6 caracteres.");
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email: form.email,
      password: form.senha,
      options: {
        data: {
          nome: form.nome,
          matricula: form.matricula,
          periodo: form.periodo,
          curso: form.curso,
          perfil: "estudante",
        },
        emailRedirectTo: undefined,
      },
    });

    if (error) {
      toast.error(error.message || "Erro ao criar conta. Tente novamente.");
      setLoading(false);
      return;
    }

    if (data.user) {
      const { error: dbError } = await supabase.from("estudantes" as never).insert({
        user_id: data.user.id,
        nome: form.nome,
        email: form.email,
        matricula: form.matricula,
        periodo: form.periodo,
        curso: form.curso,
      } as never);
      if (dbError) {
        console.error("Erro ao salvar perfil estudante:", dbError.message);
      }
      toast.success("Conta criada com sucesso! Faça login para continuar.");
      navigate("/login");
    } else {
      toast.error("Erro inesperado ao criar conta. Tente novamente.");
    }
    setLoading(false);
  };

  return (
    <>
      <header className="auth-header">
        <Link to="/" className="auth-header-logo">
          <span className="logo-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18 }}>
              <path d="M12 2L2 7l10 5 10-5-10-5z"/>
              <path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
            </svg>
          </span>
          <span className="logo-text">NEXUS CORP</span>
        </Link>
        <Link to="/" className="auth-header-back">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/>
          </svg>
          VOLTAR
        </Link>
      </header>

      <main className="cadastro-wrapper">
        <div className="cadastro-card">
          <div>
            <p className="card-overline">CADASTRO DE AUTOR</p>
            <h1 className="card-title">Criar conta institucional.</h1>
            <p className="card-description">
              Informe seus dados acadêmicos para iniciar submissões no congresso.
            </p>
          </div>

          <form onSubmit={handleSubmit} noValidate>
            <div className="form-group">
              <label className="form-label" htmlFor="nome">Nome Completo</label>
              <input type="text" id="nome" className="form-input" placeholder="Maria Silva Costa" value={form.nome} onChange={set("nome")} required />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label" htmlFor="matricula">Matrícula</label>
                <input type="text" id="matricula" className="form-input" placeholder="202310123" value={form.matricula} onChange={set("matricula")} required />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="periodo">Período</label>
                <select id="periodo" className="form-select" value={form.periodo} onChange={set("periodo")}>
                  <option value="">Selecione</option>
                  {[1,2,3,4,5,6,7,8,9,10].map(n => <option key={n} value={n}>{n}º Período</option>)}
                </select>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="email">E-mail Institucional</label>
              <div className="email-locked-wrapper">
                <input
                  type="email"
                  id="email"
                  className={`form-input${emailFromState ? " email-locked" : ""}`}
                  placeholder="maria.silva@estudante.ufla.br"
                  value={form.email}
                  onChange={emailFromState ? undefined : set("email")}
                  readOnly={!!emailFromState}
                  tabIndex={emailFromState ? -1 : 0}
                  required
                />
                {emailFromState && (
                  <div className="email-locked-badge">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                    </svg>
                    Verificado
                  </div>
                )}
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="curso">Curso</label>
              <select id="curso" className="form-select" value={form.curso} onChange={set("curso")} required>
                <option value="">Selecione seu curso</option>
                <option value="cc">Ciência da Computação</option>
                <option value="si">Sistemas de Informação</option>
                <option value="eng-comp">Engenharia de Computação</option>
                <option value="eng-soft">Engenharia de Software</option>
                <option value="eng-civil">Engenharia Civil</option>
                <option value="eng-mec">Engenharia Mecânica</option>
                <option value="eng-amb">Engenharia Ambiental</option>
                <option value="adm">Administração</option>
                <option value="mat">Matemática</option>
                <option value="fis">Física</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="senha">Senha</label>
              <input type="password" id="senha" className="form-input" placeholder="Mínimo 6 caracteres" value={form.senha} onChange={set("senha")} required />
            </div>

            <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={loading}>
              {loading ? "CRIANDO CONTA..." : "CRIAR CONTA"}
              {!loading && (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14"/><path d="M12 5l7 7-7 7"/>
                </svg>
              )}
            </button>
          </form>

          <p className="cadastro-footer">
            Já possui conta? <Link to="/login">Entrar</Link>
          </p>
        </div>
      </main>
    </>
  );
};

export default Cadastro;
