import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";

const UFLA_DOMAINS = ["@ufla.br", "@ufla-br", "@ufla_br"];

function classifyEmail(email: string): "estudante" | "professor" | "invalido" {
  const lower = email.toLowerCase().trim();
  if (lower.endsWith("@estudante.ufla.br")) return "estudante";
  for (const d of UFLA_DOMAINS) {
    if (lower.endsWith(d)) return "professor";
  }
  if (lower.includes("ufla")) return "invalido";
  return "invalido";
}

const PreCadastro = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!email.trim()) {
      setError("Informe seu e-mail institucional.");
      return;
    }
    setLoading(true);
    const tipo = classifyEmail(email.trim());

    setTimeout(() => {
      if (tipo === "estudante") {
        navigate("/cadastro", { state: { email: email.trim() } });
      } else if (tipo === "professor") {
        navigate("/professor-cadastro", { state: { email: email.trim() } });
      } else {
        setError("Você precisa usar um e-mail UFLA para se cadastrar. Utilize seu e-mail @estudante.ufla.br ou @ufla.br.");
        setLoading(false);
      }
    }, 300);
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
          <h1 className="hero-title">Faça parte da comunidade científica.</h1>
          <p className="hero-description">
            Cadastre-se com seu e-mail institucional UFLA para submeter trabalhos, acompanhar avaliações e participar do congresso acadêmico.
          </p>
          <div className="login-features">
            {[
              { label: "E-mail @estudante.ufla.br → Conta Estudante", icon: <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></> },
              { label: "E-mail @ufla.br → Conta Professor", icon: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></> },
              { label: "Cadastro rápido e seguro", icon: <><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></> },
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
        <div className="login-right-inner" style={{ maxWidth: 480, margin: "auto" }}>
          <section className="login-form-section">
            <p className="section-overline">NOVO CADASTRO</p>
            <h2 className="section-title">Crie sua conta.</h2>
            <p className="section-description">
              Informe seu e-mail institucional para identificarmos seu tipo de perfil e direcionar o cadastro correto.
            </p>

            <form onSubmit={handleSubmit} noValidate>
              <div className="form-group">
                <label className="form-label" htmlFor="preCadEmail">E-mail Institucional UFLA</label>
                <input
                  type="email"
                  id="preCadEmail"
                  className={`form-input${error ? " error" : ""}`}
                  placeholder="seu.nome@estudante.ufla.br"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError(""); }}
                  autoFocus
                  required
                />
                {error && (
                  <div className="precad-error">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                    </svg>
                    {error}
                  </div>
                )}
                <div className="precad-hint">
                  Estudantes: <code>@estudante.ufla.br</code> · Professores: <code>@ufla.br</code>
                </div>
              </div>

              <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={loading}>
                {loading ? "VERIFICANDO..." : "CONTINUAR"}
                {!loading && (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12h14"/><path d="M12 5l7 7-7 7"/>
                  </svg>
                )}
              </button>
            </form>

            <p style={{ textAlign: "center", marginTop: 24, fontSize: "var(--fs-sm)", color: "var(--color-text-secondary)" }}>
              Já tem conta? <Link to="/login" style={{ color: "var(--color-primary)", fontWeight: "var(--fw-semibold)" }}>Entrar</Link>
            </p>
          </section>

          <div className="precad-type-cards">
            <div className="precad-type-card">
              <div className="precad-type-icon" style={{ background: "var(--blue-50, #eff6ff)", color: "var(--color-primary)" }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 22, height: 22 }}>
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
                </svg>
              </div>
              <div>
                <div className="precad-type-label">Estudante</div>
                <div className="precad-type-desc">@estudante.ufla.br · Submeta trabalhos, acompanhe avaliações.</div>
              </div>
            </div>
            <div className="precad-type-card">
              <div className="precad-type-icon" style={{ background: "var(--purple-50, #faf5ff)", color: "var(--color-secondary)" }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 22, height: 22 }}>
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
              </div>
              <div>
                <div className="precad-type-label">Professor / Revisor</div>
                <div className="precad-type-desc">@ufla.br · Avalie trabalhos, emita pareceres técnicos.</div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default PreCadastro;
