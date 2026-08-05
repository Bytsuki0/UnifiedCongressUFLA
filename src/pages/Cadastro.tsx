import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  AREAS,
  MIN_SENHA,
  PERFIL_INFO,
  PERIODOS,
  classifyEmail,
} from "@/lib/cadastro";

const Cadastro = () => {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    email: "",
    nome: "",
    senha: "",
    confirmarSenha: "",
    matricula: "",
    periodo: "",
    curso: "",
    departamento: "",
  });
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);

  // O perfil é decidido pelo domínio do e-mail e define quais campos
  // aparecem no formulário.
  const perfil = classifyEmail(form.email);
  const info = perfil ? PERFIL_INFO[perfil] : null;

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!perfil) {
      toast.error("Informe um e-mail válido para continuar.");
      return;
    }
    if (!form.nome.trim()) {
      toast.error("Informe seu nome completo.");
      return;
    }
    if (perfil === "estudante" && (!form.matricula.trim() || !form.periodo || !form.curso)) {
      toast.error("Preencha matrícula, período e curso.");
      return;
    }
    if (perfil === "professor" && !form.departamento) {
      toast.error("Selecione seu departamento.");
      return;
    }
    if (form.senha.length < MIN_SENHA) {
      toast.error(`A senha deve ter no mínimo ${MIN_SENHA} caracteres.`);
      return;
    }
    if (form.senha !== form.confirmarSenha) {
      toast.error("As senhas não coincidem.");
      return;
    }

    setLoading(true);
    // O perfil (estudantes/professores), o papel e a validação do domínio
    // acontecem no servidor, no trigger handle_new_user — estes metadados
    // são apenas a entrada dele.
    const { data, error } = await supabase.auth.signUp({
      email: form.email.trim().toLowerCase(),
      password: form.senha,
      options: {
        data: {
          nome: form.nome.trim(),
          ...(perfil === "estudante" && {
            matricula: form.matricula.trim(),
            periodo: form.periodo,
            curso: form.curso,
          }),
          ...(perfil === "professor" && { departamento: form.departamento }),
        },
        emailRedirectTo: `${window.location.origin}/login`,
      },
    });

    if (error) {
      toast.error(error.message || "Erro ao criar conta. Tente novamente.");
      setLoading(false);
      return;
    }

    if (data.user) {
      if (!data.session) {
        toast.success("Conta criada! Enviamos um link de confirmação para o seu e-mail. Confirme antes de entrar.");
      } else {
        toast.success("Conta criada com sucesso! Faça login para continuar.");
      }
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
            <p className="card-overline">{info ? info.overline : "NOVO CADASTRO"}</p>
            <h1 className="card-title">{info ? info.titulo : "Criar sua conta."}</h1>
            <p className="card-description">
              {info
                ? info.descricao
                : "Comece pelo seu e-mail. O tipo de conta é identificado automaticamente pelo domínio do endereço informado."}
            </p>
          </div>

          <form onSubmit={handleSubmit} noValidate>
            <div className="form-group">
              <label className="form-label" htmlFor="email">E-mail</label>
              <input
                type="email"
                id="email"
                className="form-input"
                placeholder="seu.nome@estudante.ufla.br"
                value={form.email}
                onChange={set("email")}
                autoFocus
                required
              />
              {perfil ? (
                <div className="precad-hint">
                  Detectamos uma conta de <strong>{perfil === "externo" ? "participante externo" : perfil}</strong>.
                </div>
              ) : (
                <div className="precad-hint">
                  Estudantes: <code>@estudante.ufla.br</code> · Professores: <code>@ufla.br</code> · Demais e-mails criam conta externa.
                </div>
              )}
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="nome">Nome Completo</label>
              <input
                type="text"
                id="nome"
                className="form-input"
                placeholder="Maria Silva Costa"
                value={form.nome}
                onChange={set("nome")}
                required
              />
            </div>

            {perfil === "estudante" && (
              <>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label" htmlFor="matricula">Matrícula</label>
                    <input type="text" id="matricula" className="form-input" placeholder="202310123" value={form.matricula} onChange={set("matricula")} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="periodo">Período</label>
                    <select id="periodo" className="form-select" value={form.periodo} onChange={set("periodo")} required>
                      <option value="">Selecione</option>
                      {PERIODOS.map((n) => <option key={n} value={n}>{n}º Período</option>)}
                    </select>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="curso">Curso</label>
                  <select id="curso" className="form-select" value={form.curso} onChange={set("curso")} required>
                    <option value="">Selecione seu curso</option>
                    {AREAS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                  </select>
                </div>
              </>
            )}

            {perfil === "professor" && (
              <div className="form-group">
                <label className="form-label" htmlFor="departamento">Departamento</label>
                <select id="departamento" className="form-select" value={form.departamento} onChange={set("departamento")} required>
                  <option value="">Selecione seu departamento</option>
                  {AREAS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                </select>
              </div>
            )}

            <div className="form-row">
              <div className="form-group">
                <label className="form-label" htmlFor="senha">Senha</label>
                <div className="password-wrapper">
                  <input
                    type={showPass ? "text" : "password"}
                    id="senha"
                    className="form-input"
                    placeholder={`Mínimo ${MIN_SENHA} caracteres`}
                    value={form.senha}
                    onChange={set("senha")}
                    required
                  />
                  <button type="button" className="password-toggle" onClick={() => setShowPass(!showPass)} aria-label="Mostrar senha">
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
                <label className="form-label" htmlFor="confirmarSenha">Confirmar Senha</label>
                <input
                  type={showPass ? "text" : "password"}
                  id="confirmarSenha"
                  className="form-input"
                  placeholder="Repita a senha"
                  value={form.confirmarSenha}
                  onChange={set("confirmarSenha")}
                  required
                />
              </div>
            </div>

            <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={loading} style={{ marginTop: 8 }}>
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
