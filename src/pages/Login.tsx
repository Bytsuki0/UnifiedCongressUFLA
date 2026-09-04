import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { resolveMyRole } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { APP_MARK, APP_NAME, APP_TAGLINE, SUPPORT_EMAIL } from "@/lib/brand";
import { portalDoPapel, saudacaoDoPapel } from "@/lib/portais";
import { emailEstaConfirmado } from "@/services/verificacaoEmailService";
import { BotaoBaixar } from "@/components/BotaoBaixar";
import { useArquivosDownload } from "@/hooks/use-arquivos-download";

const Login = () => {
  const navigate = useNavigate();
  const { arquivos } = useArquivosDownload("estudante");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !senha) {
      toast.error("Preencha todos os campos.");
      return;
    }
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({ email, password: senha });

    if (error) {
      // "Email not confirmed" é do GoTrue e hoje não acontece: o autoconfirm
      // está ligado e a confirmação é nossa, por RLS. Fica como rede de
      // segurança caso alguém desligue o autoconfirm no painel.
      if (/email not confirmed/i.test(error.message)) {
        toast.error("Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada.");
      } else {
        toast.error("Credenciais inválidas. Verifique seu e-mail e senha.");
      }
      setLoading(false);
      return;
    }

    const [profile, confirmado] = await Promise.all([resolveMyRole(), emailEstaConfirmado()]);

    // Login é permitido sem confirmar — o que o RLS recusa são os dados.
    // Mandar direto para a sala de espera evita a tela vazia sem explicação.
    if (confirmado === false) {
      toast.info("Falta confirmar seu e-mail para liberar a conta.");
      navigate("/verifique-email", { replace: true });
      setLoading(false);
      return;
    }

    // `replace`: depois de entrar, o "voltar" do navegador não pode devolver
    // à tela de login de uma sessão que já existe.
    toast.success(saudacaoDoPapel(profile));
    navigate(portalDoPapel(profile), { replace: true });

    setLoading(false);
  };

  return (
    <div className="login-wrapper">
      <aside className="login-left">
        <div>
          <Link to="/" className="login-left-logo" title="Voltar ao início">
            <span className="logo-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 20, height: 20 }}>
                <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                <path d="M2 17l10 5 10-5"/>
                <path d="M2 12l10 5 10-5"/>
              </svg>
            </span>
            <span className="logo-info">
              <span className="logo-name">{APP_MARK}</span>
              <span className="logo-sub">{APP_TAGLINE}</span>
            </span>
          </Link>

          <Link to="/" className="login-left-back">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>
            </svg>
            VOLTAR AO INÍCIO
          </Link>
        </div>

        <div className="login-left-content">
          {/* Marca da universidade: a tela de acesso é institucional, e o
              logotipo branco só funciona sobre este painel escuro. */}
          <img
            className="login-ufla-logo"
            src="/imagens/logo-ufla-branca.png"
            alt="Universidade Federal de Lavras"
            width={753}
            height={317}
          />
          <h1 className="hero-title">O Congresso unificado - Campus paraiso.</h1>
          <p className="hero-description">
            Sistema oficial do {APP_NAME}.
          </p>
        </div>

        <footer className="login-left-footer">
          © 2026 {APP_NAME} · Todos os direitos reservados.
          <br />
          Suporte: <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: "inherit", textDecoration: "underline" }}>{SUPPORT_EMAIL}</a>
        </footer>
      </aside>

      <main className="login-right">
        <div className="login-right-inner">
          <section className="login-form-section">
            <p className="section-overline">ACESSO À PLATAFORMA</p>
            <h2 className="section-title">Bem-vindo de volta.</h2>
            <p className="section-description">
              Entre com suas credenciais institucionais. O sistema identificará automaticamente o seu perfil, estudante, professor ou administrador.
            </p>

            <form onSubmit={handleSubmit} noValidate>
              <div className="form-group">
                <label className="form-label" htmlFor="loginEmail">E-mail Institucional</label>
                <input
                  type="email"
                  id="loginEmail"
                  className="form-input"
                  placeholder="seu.email@ufla.br"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="loginSenha">Senha</label>
                <div className="password-wrapper">
                  <input
                    type={showPass ? "text" : "password"}
                    id="loginSenha"
                    className="form-input"
                    placeholder="Sua senha"
                    value={senha}
                    onChange={(e) => setSenha(e.target.value)}
                    required
                  />
                  <button type="button" className="password-toggle" onClick={() => setShowPass(!showPass)} aria-label="Mostrar senha">
                    {showPass ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18 }}>
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                        <line x1="1" y1="1" x2="23" y2="23"/>
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18 }}>
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                        <circle cx="12" cy="12" r="3"/>
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={loading}>
                {loading ? "ENTRANDO..." : "ENTRAR"}
                {!loading && (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12h14"/><path d="M12 5l7 7-7 7"/>
                  </svg>
                )}
              </button>
            </form>

            <p style={{ textAlign: "center", marginTop: 24, fontSize: "var(--fs-sm)", color: "var(--color-text-secondary)" }}>
              <Link to="/esqueci-senha" style={{ color: "var(--color-primary)", fontWeight: "var(--fw-semibold)" }}>Esqueceu sua senha?</Link>
            </p>
            <p style={{ textAlign: "center", marginTop: 8, fontSize: "var(--fs-sm)", color: "var(--color-text-secondary)" }}>
              Não tem conta? <Link to="/cadastro" style={{ color: "var(--color-primary)", fontWeight: "var(--fw-semibold)" }}>Cadastre-se</Link>
            </p>
          </section>

          {/* Some inteira quando a organização não publicou nada — a
              coluna da direita do /login vira só o formulário. */}
          {arquivos.length > 0 && (
            <section className="downloads-section">
              <p className="section-overline">DOWNLOADS RÁPIDOS</p>
              <h3 style={{ fontSize: "var(--fs-h3)", fontWeight: "var(--fw-black)", marginBottom: 8, color: "var(--color-text)" }}>Templates e Modelos</h3>
              <p style={{ fontSize: "var(--fs-sm)", color: "var(--color-text-secondary)", marginBottom: 24, lineHeight: "var(--lh-relaxed)" }}>
                Baixe os modelos oficiais de formatação antes de preparar sua submissão.
              </p>

              <div className="downloads-grid">
                {arquivos.map((a) => (
                  <div className="download-card" key={a.id}>
                    <div className="download-card-top">
                      <div className="download-card-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 20, height: 20 }}>
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                          <polyline points="14 2 14 8 20 8"/>
                        </svg>
                      </div>
                      {a.formato && <span className="download-card-meta">{a.formato}</span>}
                    </div>
                    <p className="download-card-name">{a.titulo}</p>
                    <BotaoBaixar url={a.url} className="btn btn-primary btn-sm btn-block">
                      BAIXAR
                    </BotaoBaixar>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  );
};

export default Login;
