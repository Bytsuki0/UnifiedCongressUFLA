import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { APP_NAME } from "@/lib/brand";
import { MIN_SENHA } from "@/lib/cadastro";
import { TEXTO_ERRO_TROCA, validarNovaSenha, type CodigoTroca } from "@/lib/redefinirSenha";
import { trocarSenha } from "@/services/redefinirSenhaService";

/**
 * /redefinir-senha — o destino do link enviado por e-mail.
 *
 * Pública de propósito: quem esqueceu a senha não tem sessão. As duas
 * decisões herdadas de /confirmar-email continuam valendo aqui — e são
 * ainda mais importantes, porque este token autoriza TROCAR uma senha:
 *
 *  1. O token sai da URL (`history.replaceState`) assim que é lido e
 *     fica guardado só em memória. URL não vaza para o histórico nem
 *     para o `Referer` de qualquer link clicado depois.
 *  2. O consumo acontece no SUBMIT, nunca no mount. Antivírus e o
 *     pré-carregador de links do Gmail/Outlook abrem a URL sozinhos —
 *     aqui o mount só mostra o formulário, nada é gasto.
 */

/** Fases próprias da tela + os desfechos de erro que a function devolve. */
type Fase = "lendo" | "pronto" | "trocando" | "trocada" | CodigoTroca;

const RedefinirSenha = () => {
  const navigate = useNavigate();

  const token = useRef<string | null>(null);
  const jaLeuUrl = useRef(false);
  const [fase, setFase] = useState<Fase>("lendo");
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [avisoForm, setAvisoForm] = useState<string | null>(null);

  // Leitura única da URL. O guard de ref sobrevive ao duplo-efeito do
  // StrictMode em desenvolvimento — sem ele, a segunda passada não
  // acharia mais o token e a tela diria "inválido".
  useEffect(() => {
    if (jaLeuUrl.current) return;
    jaLeuUrl.current = true;

    const url = new URL(window.location.href);
    const bruto = url.searchParams.get("token");

    if (!bruto) {
      setFase("token_invalido");
      return;
    }

    token.current = bruto;
    url.searchParams.delete("token");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    setFase("pronto");
  }, []);

  const submeter = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!token.current) {
        setFase("token_invalido");
        return;
      }

      const erroForm = validarNovaSenha(senha, confirmacao);
      if (erroForm) {
        setAvisoForm(erroForm);
        return;
      }

      setAvisoForm(null);
      setFase("trocando");
      const resposta = await trocarSenha(token.current, senha);

      if (resposta.estado === "trocada") {
        setFase("trocada");
        toast.success("Senha redefinida! Entre com a nova senha.");
        return;
      }

      // Erros do formulário voltam para o formulário (o link continua
      // bom); vereditos sobre o token viram tela terminal.
      if (resposta.erro === "senha_curta") {
        setAvisoForm(TEXTO_ERRO_TROCA.senha_curta);
        setFase("pronto");
        return;
      }

      setFase(resposta.erro);
    },
    [senha, confirmacao],
  );

  // Trocou: leva para o login (as sessões antigas foram derrubadas).
  useEffect(() => {
    if (fase !== "trocada") return;
    const t = setTimeout(() => navigate("/login", { replace: true }), 1800);
    return () => clearTimeout(t);
  }, [fase, navigate]);

  const olho = showPass ? (
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
  );

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
          <span className="logo-text">{APP_NAME}</span>
        </Link>
      </header>

      <main className="cadastro-wrapper">
        <div className="cadastro-card" style={{ maxWidth: 520 }}>
          {fase === "lendo" && (
            <>
              <p className="card-overline">REDEFINIÇÃO DE SENHA</p>
              <h1 className="card-title">Abrindo seu link...</h1>
              <p className="card-description">Só um instante.</p>
            </>
          )}

          {(fase === "pronto" || fase === "trocando") && (
            <>
              <p className="card-overline">REDEFINIÇÃO DE SENHA</p>
              <h1 className="card-title">Escolha sua nova senha.</h1>
              <p className="card-description">
                Ela substitui a anterior imediatamente e desconecta os outros
                aparelhos onde sua conta estiver aberta.
              </p>

              <form onSubmit={submeter} noValidate>
                <div className="form-group">
                  <label className="form-label" htmlFor="novaSenha">Nova senha</label>
                  <div className="password-wrapper">
                    <input
                      type={showPass ? "text" : "password"}
                      id="novaSenha"
                      className="form-input"
                      placeholder={`Mínimo ${MIN_SENHA} caracteres`}
                      value={senha}
                      onChange={(e) => setSenha(e.target.value)}
                      required
                    />
                    <button type="button" className="password-toggle" onClick={() => setShowPass(!showPass)} aria-label="Mostrar senha">
                      {olho}
                    </button>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="confirmaSenha">Confirmar nova senha</label>
                  <div className="password-wrapper">
                    <input
                      type={showPass ? "text" : "password"}
                      id="confirmaSenha"
                      className="form-input"
                      placeholder="Repita a senha"
                      value={confirmacao}
                      onChange={(e) => setConfirmacao(e.target.value)}
                      required
                    />
                  </div>
                </div>

                {avisoForm && (
                  <p
                    role="status"
                    style={{
                      fontSize: "var(--fs-sm)",
                      color: "var(--color-text-secondary)",
                      marginBottom: 16,
                      lineHeight: "var(--lh-relaxed)",
                    }}
                  >
                    {avisoForm}
                  </p>
                )}

                <button
                  type="submit"
                  className="btn btn-primary btn-block btn-lg"
                  disabled={fase === "trocando"}
                >
                  {fase === "trocando" ? "TROCANDO..." : "TROCAR SENHA"}
                </button>
              </form>
            </>
          )}

          {fase === "trocada" && (
            <>
              <p className="card-overline">TUDO CERTO</p>
              <h1 className="card-title">Senha redefinida!</h1>
              <p className="card-description">
                Sua senha nova já vale. Estamos te levando para a tela de
                entrada...
              </p>
              <Link to="/login" className="btn btn-primary btn-block btn-lg">
                ENTRAR
              </Link>
            </>
          )}

          {fase === "token_invalido" && (
            <>
              <p className="card-overline">LINK INVÁLIDO</p>
              <h1 className="card-title">Não reconhecemos este link.</h1>
              <p className="card-description">
                Confira se o endereço foi copiado inteiro do e-mail — alguns
                aplicativos quebram links longos em duas linhas. Se preferir,
                peça um novo e-mail de redefinição.
              </p>
              <Link to="/esqueci-senha" className="btn btn-primary btn-block btn-lg">
                PEDIR NOVO LINK
              </Link>
            </>
          )}

          {fase === "token_usado" && (
            <>
              <p className="card-overline">LINK JÁ USADO</p>
              <h1 className="card-title">Este link já foi usado.</h1>
              <p className="card-description">
                Cada link troca a senha uma única vez. Se foi você, é só entrar
                com a senha nova. Se não reconhece essa troca, peça um novo
                link agora e redefina a senha.
              </p>
              <Link to="/esqueci-senha" className="btn btn-primary btn-block btn-lg">
                PEDIR NOVO LINK
              </Link>
              <p className="cadastro-footer">
                Já trocou? <Link to="/login">Entre com a senha nova</Link>
              </p>
            </>
          )}

          {fase === "token_expirado" && (
            <>
              <p className="card-overline">LINK EXPIRADO</p>
              <h1 className="card-title">Este link não vale mais.</h1>
              <p className="card-description">
                Os links de redefinição valem por 2 horas. Peça um novo e-mail —
                leva um clique.
              </p>
              <Link to="/esqueci-senha" className="btn btn-primary btn-block btn-lg">
                PEDIR NOVO LINK
              </Link>
            </>
          )}

          {fase === "rede" && (
            <>
              <p className="card-overline">SEM RESPOSTA</p>
              <h1 className="card-title">Não conseguimos falar com o servidor.</h1>
              <p className="card-description">
                Seu link continua válido — isto foi a conexão, não o link.
                Verifique a internet e tente de novo.
              </p>
              <button
                type="button"
                className="btn btn-primary btn-block btn-lg"
                onClick={() => setFase("pronto")}
              >
                TENTAR DE NOVO
              </button>
            </>
          )}

          {(fase === "falha_troca" ||
            fase === "corpo_invalido" ||
            fase === "config_ausente" ||
            fase === "desconhecido" ||
            fase === "senha_curta") && (
            <>
              <p className="card-overline">ALGO DEU ERRADO</p>
              <h1 className="card-title">Não conseguimos trocar sua senha.</h1>
              <p className="card-description">{TEXTO_ERRO_TROCA[fase]}</p>
              <button
                type="button"
                className="btn btn-primary btn-block btn-lg"
                onClick={() => setFase("pronto")}
              >
                TENTAR DE NOVO
              </button>
            </>
          )}
        </div>
      </main>
    </>
  );
};

export default RedefinirSenha;
