import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { APP_NAME } from "@/lib/brand";
import { portalDoPapel } from "@/lib/portais";
import { COOLDOWN_PADRAO_SEGUNDOS, mensagemDoErroEnvio } from "@/lib/verificacaoEmail";
import { enviarEmailDeVerificacao } from "@/services/verificacaoEmailService";

/**
 * /verifique-email — a sala de espera de quem entrou mas ainda não confirmou.
 *
 * A rota é autenticada de propósito (decisão 5 do roteiro): como o login é
 * permitido, o reenvio é sempre "para mim mesmo". Ninguém consegue descobrir
 * se um e-mail alheio tem conta, nem disparar mensagem para terceiros — a
 * Edge Function tira o destinatário do JWT e ignora o corpo.
 *
 * O cooldown do botão espelha o throttle de 60 s que a RPC impõe. Quando o
 * servidor recusa, o número de segundos vem DELE, não de um palpite daqui.
 */

/** Estado vindo do /cadastro: o e-mail já saiu, o cooldown começa contado. */
type EstadoDaNavegacao = { enviado?: boolean } | null;

const VerifiqueEmail = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, role, emailConfirmado, loading, revalidarEmailConfirmado } = useAuth();

  const [enviando, setEnviando] = useState(false);
  const [restante, setRestante] = useState(() =>
    (location.state as EstadoDaNavegacao)?.enviado ? COOLDOWN_PADRAO_SEGUNDOS : 0,
  );
  const [aviso, setAviso] = useState<string | null>(
    (location.state as EstadoDaNavegacao)?.enviado
      ? "Enviamos o link de confirmação. Confira a caixa de entrada — e o spam."
      : null,
  );

  // Quem já confirmou não tem o que fazer aqui.
  useEffect(() => {
    if (loading || !role) return;
    if (emailConfirmado === true) navigate(portalDoPapel(role), { replace: true });
  }, [emailConfirmado, role, loading, navigate]);

  // Confirmar acontece em OUTRA aba (ou no celular). Ao voltar para esta,
  // relê o estado — senão a pessoa fica presa numa tela já vencida.
  const revalidar = useRef(revalidarEmailConfirmado);
  revalidar.current = revalidarEmailConfirmado;

  useEffect(() => {
    const aoVoltar = () => {
      if (document.visibilityState === "visible") revalidar.current();
    };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => document.removeEventListener("visibilitychange", aoVoltar);
  }, []);

  // Contagem regressiva do botão.
  useEffect(() => {
    if (restante <= 0) return;
    const t = setTimeout(() => setRestante((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [restante]);

  const reenviar = useCallback(async () => {
    setEnviando(true);
    setAviso(null);
    const resposta = await enviarEmailDeVerificacao();
    setEnviando(false);

    if (resposta.estado === "enviado") {
      setRestante(COOLDOWN_PADRAO_SEGUNDOS);
      setAviso("E-mail enviado. Confira a caixa de entrada — e o spam.");
      toast.success("E-mail de confirmação enviado.");
      return;
    }

    // O 429 traz o tempo que falta: é ele quem manda no botão.
    if (resposta.erro === "aguarde") {
      setRestante(resposta.segundos ?? COOLDOWN_PADRAO_SEGUNDOS);
      setAviso(mensagemDoErroEnvio(resposta.erro, resposta.segundos));
      return;
    }

    if (resposta.erro === "ja_confirmado") {
      const confirmado = await revalidarEmailConfirmado();
      if (confirmado !== true) setAviso(mensagemDoErroEnvio(resposta.erro, null));
      return;
    }

    if (resposta.erro === "sem_sessao") {
      toast.error(mensagemDoErroEnvio(resposta.erro, null));
      navigate("/login", { replace: true });
      return;
    }

    setAviso(mensagemDoErroEnvio(resposta.erro, resposta.segundos));
    toast.error(mensagemDoErroEnvio(resposta.erro, resposta.segundos));
  }, [navigate, revalidarEmailConfirmado]);

  const jaConfirmei = useCallback(async () => {
    const confirmado = await revalidarEmailConfirmado();
    if (confirmado !== true) {
      setAviso("Ainda não recebemos a confirmação. Abra o link do e-mail e volte aqui.");
    }
  }, [revalidarEmailConfirmado]);

  const sair = useCallback(async () => {
    await supabase.auth.signOut();
    navigate("/login", { replace: true });
  }, [navigate]);

  const bloqueado = enviando || restante > 0;

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
        <button
          type="button"
          className="auth-header-back"
          onClick={sair}
          style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
          SAIR
        </button>
      </header>

      <main className="cadastro-wrapper">
        <div className="cadastro-card" style={{ maxWidth: 520 }}>
          <p className="card-overline">FALTA UM PASSO</p>
          <h1 className="card-title">Confirme seu e-mail.</h1>
          <p className="card-description">
            Enviamos um link de confirmação para{" "}
            <strong style={{ color: "var(--color-text)" }}>{user?.email ?? "seu endereço"}</strong>.
            Abra o e-mail e clique no botão de confirmação para liberar sua conta.
          </p>

          <div className="precad-hint" style={{ marginBottom: 24 }}>
            Não achou? Procure na caixa de <strong>spam</strong> ou em
            "promoções" — o link vale por 24 horas.
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
            type="button"
            className="btn btn-primary btn-block btn-lg"
            onClick={reenviar}
            disabled={bloqueado}
          >
            {enviando
              ? "ENVIANDO..."
              : restante > 0
                ? `REENVIAR EM ${restante}s`
                : "REENVIAR E-MAIL"}
          </button>

          <button
            type="button"
            className="btn btn-outline btn-block"
            onClick={jaConfirmei}
            style={{ marginTop: 12 }}
          >
            JÁ CONFIRMEI — ATUALIZAR
          </button>

          <p className="cadastro-footer">
            E-mail errado? <Link to="/cadastro">Faça um novo cadastro</Link> ou{" "}
            <button
              type="button"
              onClick={sair}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                font: "inherit",
                fontWeight: "var(--fw-semibold)",
                color: "var(--color-primary)",
              }}
            >
              entre com outra conta
            </button>
            .
          </p>
        </div>
      </main>
    </>
  );
};

export default VerifiqueEmail;
