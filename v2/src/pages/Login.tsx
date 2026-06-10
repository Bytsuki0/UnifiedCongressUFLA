import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const ADMIN_EMAIL = "bytsuki066@gmail.com";

async function detectProfile(userEmail: string): Promise<"estudante" | "professor" | "admin"> {
  // Admin bypass
  if (userEmail === ADMIN_EMAIL) return "admin";

  // Try database tables first (available after migration is applied)
  try {
    const [estRes, profRes] = await Promise.all([
      supabase.from("estudantes" as never).select("id").eq("email" as never, userEmail).maybeSingle(),
      supabase.from("professores" as never).select("id").eq("email" as never, userEmail).maybeSingle(),
    ]);

    const estData = (estRes as { data: unknown; error: unknown }).data;
    const profData = (profRes as { data: unknown; error: unknown }).data;
    const estErr = (estRes as { error: { code?: string } | null }).error;

    // If table exists and has a row, trust it
    if (!estErr && estData) return "estudante";
    if (profData) return "professor";

    // If tables exist but user has no row yet (shouldn't happen for valid accounts)
    // Fall through to metadata fallback
  } catch {
    // Tables not yet created — fall through to metadata fallback
  }

  // Fallback: use user_metadata.perfil set during signup
  const { data: { user } } = await supabase.auth.getUser();
  const perfil = user?.user_metadata?.perfil;
  if (perfil === "professor") return "professor";
  if (perfil === "estudante") return "estudante";

  // Last resort: detect by email domain
  if (userEmail.endsWith("@estudante.ufla.br")) return "estudante";
  if (userEmail.endsWith("@ufla.br") || userEmail.endsWith("@ufla-br") || userEmail.endsWith("@ufla_br")) return "professor";

  return "estudante";
}

const Login = () => {
  const navigate = useNavigate();
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
      toast.error("Credenciais inválidas. Verifique seu e-mail e senha.");
      setLoading(false);
      return;
    }

    const userEmail = email.toLowerCase().trim();
    const profile = await detectProfile(userEmail);

    if (profile === "admin") {
      toast.success("Bem-vindo, Administrador!");
      navigate("/dashboard");
    } else if (profile === "professor") {
      toast.success("Bem-vindo ao Portal Revisor!");
      navigate("/revisor");
    } else {
      toast.success("Bem-vindo ao Portal Estudante!");
      navigate("/estudante");
    }

    setLoading(false);
  };

  return (
    <div className="login-wrapper">
      <aside className="login-left">
        <div className="login-left-logo">
          <span className="logo-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 20, height: 20 }}>
              <path d="M12 2L2 7l10 5 10-5-10-5z"/>
              <path d="M2 17l10 5 10-5"/>
              <path d="M2 12l10 5 10-5"/>
            </svg>
          </span>
          <span className="logo-info">
            <span className="logo-name">NEXUS CORP</span>
            <span className="logo-sub">Submissões Científicas</span>
          </span>
        </div>

        <div className="login-left-content">
          <h1 className="hero-title">Pesquisa que move o conhecimento.</h1>
          <p className="hero-description">
            Plataforma institucional para submissão, avaliação e publicação de trabalhos acadêmicos com revisão por pares e acompanhamento em tempo real.
          </p>
          <div className="login-features">
            {[
              { label: "Avaliação Double-Blind", icon: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></> },
              { label: "Acompanhamento em Tempo Real", icon: <><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></> },
              { label: "Múltiplas Categorias", icon: <><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></> },
            ].map((f) => (
              <div className="login-feature-item" key={f.label}>
                <span className="feature-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16 }}>{f.icon}</svg>
                </span>
                <span className="feature-label">{f.label}</span>
              </div>
            ))}
          </div>
        </div>

        <footer className="login-left-footer">
          © 2026 Nexus Corp · Todos os direitos reservados.
        </footer>
      </aside>

      <main className="login-right">
        <div className="login-right-inner">
          <section className="login-form-section">
            <p className="section-overline">ACESSO À PLATAFORMA</p>
            <h2 className="section-title">Bem-vindo de volta.</h2>
            <p className="section-description">
              Entre com suas credenciais institucionais. O sistema identificará automaticamente o seu perfil — estudante, professor ou administrador.
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
                    placeholder="Mínimo 6 caracteres"
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
              Não tem conta? <Link to="/pre-cadastro" style={{ color: "var(--color-primary)", fontWeight: "var(--fw-semibold)" }}>Cadastre-se</Link>
            </p>
          </section>

          <section className="downloads-section">
            <p className="section-overline">DOWNLOADS RÁPIDOS</p>
            <h3 style={{ fontSize: "var(--fs-h3)", fontWeight: "var(--fw-black)", marginBottom: 8, color: "var(--color-text)" }}>Templates e Modelos</h3>
            <p style={{ fontSize: "var(--fs-sm)", color: "var(--color-text-secondary)", marginBottom: 24, lineHeight: "var(--lh-relaxed)" }}>
              Baixe os modelos oficiais de formatação antes de preparar sua submissão.
            </p>

            <div className="downloads-grid">
              {[
                { name: "Template Artigo Completo", meta: ".DOCX · 245 KB", file: "template_artigo_word.docx" },
                { name: "Template Resumo Expandido", meta: ".DOCX · 198 KB", file: "template_resumo_expandido_word.docx" },
                { name: "Normas de Formatação", meta: ".PDF · 312 KB", file: "normas_formatacao_nexus.pdf" },
                { name: "Template Apresentação", meta: ".PPTX · 1.2 MB", file: "template_slides_powerpoint.pptx" },
              ].map((d) => (
                <div className="download-card" key={d.file}>
                  <div className="download-card-top">
                    <div className="download-card-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 20, height: 20 }}>
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                      </svg>
                    </div>
                    <span className="download-card-meta">{d.meta}</span>
                  </div>
                  <p className="download-card-name">{d.name}</p>
                  <button className="btn btn-primary btn-sm btn-block" onClick={() => alert(`Download de ${d.file} (simulação)`)}>
                    BAIXAR
                  </button>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
};

export default Login;
