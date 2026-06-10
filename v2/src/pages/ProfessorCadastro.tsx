import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const DEPARTAMENTOS = [
  { value: "BICT", label: "BICT — Bacharelado Interdisciplinar em Ciência e Tecnologia" },
  { value: "Engenharia Elétrica", label: "Engenharia Elétrica" },
  { value: "Engenharia de Software", label: "Engenharia de Software" },
  { value: "Engenharia de Produção", label: "Engenharia de Produção" },
];

const ProfessorCadastro = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const emailFromState = (location.state as { email?: string })?.email || "";

  const [form, setForm] = useState({ nome: "", departamento: "", senha: "", confirmarSenha: "" });
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.nome.trim()) { toast.error("Informe seu nome completo."); return; }
    if (!form.departamento) { toast.error("Selecione seu departamento."); return; }
    if (form.senha.length < 6) { toast.error("A senha deve ter no mínimo 6 caracteres."); return; }
    if (form.senha !== form.confirmarSenha) { toast.error("As senhas não coincidem."); return; }
    if (!emailFromState) { toast.error("E-mail não encontrado. Volte e tente novamente."); return; }

    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email: emailFromState,
      password: form.senha,
      options: {
        data: {
          nome: form.nome.trim(),
          departamento: form.departamento,
          perfil: "professor",
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
      const { error: dbError } = await supabase.from("professores" as never).insert({
        user_id: data.user.id,
        nome: form.nome.trim(),
        email: emailFromState,
        departamento: form.departamento,
      } as never);
      if (dbError) {
        console.error("Erro ao salvar perfil professor:", dbError.message);
      }
      toast.success("Conta de professor criada com sucesso! Faça login para continuar.");
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
        <Link to="/pre-cadastro" className="auth-header-back">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/>
          </svg>
          VOLTAR
        </Link>
      </header>

      <main className="cadastro-wrapper">
        <div className="cadastro-card" style={{ maxWidth: 520 }}>
          <div>
            <div className="precad-profile-badge">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16 }}>
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
              CADASTRO DE PROFESSOR / REVISOR
            </div>
            <h1 className="card-title">Criar conta institucional.</h1>
            <p className="card-description">
              Preencha seus dados para criar sua conta de professor e acessar o painel de revisão de trabalhos.
            </p>
          </div>

          <form onSubmit={handleSubmit} noValidate>
            <div className="form-group">
              <label className="form-label" htmlFor="profEmail">E-mail Institucional</label>
              <div className="email-locked-wrapper">
                <input
                  type="email"
                  id="profEmail"
                  className="form-input email-locked"
                  value={emailFromState}
                  readOnly
                  tabIndex={-1}
                />
                <div className="email-locked-badge">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                  </svg>
                  Verificado
                </div>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="profNome">Nome Completo</label>
              <input
                type="text"
                id="profNome"
                className="form-input"
                placeholder="Prof. Dr. Carlos Almeida"
                value={form.nome}
                onChange={set("nome")}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="profDept">Departamento</label>
              <select id="profDept" className="form-select" value={form.departamento} onChange={set("departamento")} required>
                <option value="">Selecione seu departamento</option>
                {DEPARTAMENTOS.map(d => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </select>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label" htmlFor="profSenha">Senha</label>
                <div className="password-wrapper">
                  <input
                    type={showPass ? "text" : "password"}
                    id="profSenha"
                    className="form-input"
                    placeholder="Mínimo 6 caracteres"
                    value={form.senha}
                    onChange={set("senha")}
                    required
                  />
                  <button type="button" className="password-toggle" onClick={() => setShowPass(!showPass)}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18 }}>
                      {showPass
                        ? <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></>
                        : <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>
                      }
                    </svg>
                  </button>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="profConfirmar">Confirmar Senha</label>
                <div className="password-wrapper">
                  <input
                    type={showConfirm ? "text" : "password"}
                    id="profConfirmar"
                    className="form-input"
                    placeholder="Repita a senha"
                    value={form.confirmarSenha}
                    onChange={set("confirmarSenha")}
                    required
                  />
                  <button type="button" className="password-toggle" onClick={() => setShowConfirm(!showConfirm)}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18 }}>
                      {showConfirm
                        ? <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></>
                        : <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>
                      }
                    </svg>
                  </button>
                </div>
              </div>
            </div>

            <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={loading} style={{ marginTop: 8 }}>
              {loading ? "CRIANDO CONTA..." : "CRIAR CONTA DE PROFESSOR"}
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

export default ProfessorCadastro;
