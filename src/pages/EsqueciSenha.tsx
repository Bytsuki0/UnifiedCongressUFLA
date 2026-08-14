import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { APP_NAME } from "@/lib/brand";
import {
  mensagemDoErroSolicitacao,
  TEXTO_SOLICITACAO_ACEITA,
} from "@/lib/redefinirSenha";
import { solicitarRedefinicao } from "@/services/redefinirSenhaService";

/**
 * /esqueci-senha — o formulário público que pede o link de redefinição.
 *
 * ANTI-ENUMERAÇÃO: o desfecho é o MESMO para conta existente,
 * inexistente, não confirmada ou em cooldown — o servidor responde
 * `{ok:true}` genérico e esta tela mostra a frase condicional
 * ("SE este e-mail pertencer a uma conta..."). Nunca dizemos
 * "e-mail não cadastrado": o formulário viraria um oráculo de quem
 * tem conta no congresso.
 *
 * O único erro com contagem é o limite por IP (5 pedidos/hora), que
 * não revela nada sobre contas — o cooldown de 2 h por conta é
 * silencioso de propósito.
 */

type Fase = "formulario" | "enviando" | "aceito";

const EsqueciSenha = () => {
  const [email, setEmail] = useState("");
  const [fase, setFase] = useState<Fase>("formulario");
  const [restante, setRestante] = useState(0);
  const [aviso, setAviso] = useState<string | null>(null);

  // Contagem regressiva do limite por IP.
  useEffect(() => {
    if (restante <= 0) return;
    const t = setTimeout(() => setRestante((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [restante]);

  const enviar = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!email.trim()) {
        toast.error("Informe seu e-mail.");
        return;
      }

      setFase("enviando");
      setAviso(null);
      const resposta = await solicitarRedefinicao(email.trim());

      if (resposta.estado === "aceito") {
        setFase("aceito");
        return;
      }

      setFase("formulario");

      if (resposta.erro === "aguarde") {
        setRestante(resposta.segundos ?? 0);
        setAviso(mensagemDoErroSolicitacao(resposta.erro, resposta.segundos));
        return;
      }

      if (resposta.erro === "email_invalido") {
        setAviso(mensagemDoErroSolicitacao(resposta.erro, null));
        return;
      }

      toast.error(mensagemDoErroSolicitacao(resposta.erro, null));
    },
    [email],
  );

  const bloqueado = fase === "enviando" || restante > 0;

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
          {fase !== "aceito" && (
            <>
              <p className="card-overline">REDEFINIÇÃO DE SENHA</p>
              <h1 className="card-title">Esqueceu sua senha?</h1>
              <p className="card-description">
                Informe o e-mail da sua conta no {APP_NAME}. Se ele pertencer a
                uma conta confirmada, enviaremos um link para você escolher uma
                senha nova. O link vale por 2 horas.
              </p>

              <form onSubmit={enviar} noValidate>
                <div className="form-group">
                  <label className="form-label" htmlFor="esqueciEmail">E-mail</label>
                  <input
                    type="email"
                    id="esqueciEmail"
                    className="form-input"
                    placeholder="seu.email@ufla.br"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>

                {aviso && (
                  <p
                    role="status"
                    style={{
                      fontSize: "var(--fs-sm)",
                      color: "var(--color-text-secondary)",
                      marginBottom: 16,
                      lineHeight: "var(--lh-relaxed)",
                    }}
                  >
                    {aviso}
                  </p>
                )}

                <button
                  type="submit"
                  className="btn btn-primary btn-block btn-lg"
                  disabled={bloqueado}
                >
                  {fase === "enviando" ? "ENVIANDO..." : "ENVIAR LINK"}
                </button>
              </form>
            </>
          )}

          {fase === "aceito" && (
            <>
              <p className="card-overline">PEDIDO RECEBIDO</p>
              <h1 className="card-title">Confira seu e-mail.</h1>
              <p className="card-description" role="status">
                {TEXTO_SOLICITACAO_ACEITA}
              </p>
              <Link to="/login" className="btn btn-primary btn-block btn-lg">
                VOLTAR PARA A ENTRADA
              </Link>
            </>
          )}

          <p className="cadastro-footer">
            Lembrou a senha? <Link to="/login">Entre</Link> · Ainda não tem
            conta? <Link to="/cadastro">Cadastre-se</Link>
          </p>
        </div>
      </main>
    </>
  );
};

export default EsqueciSenha;
