import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { APP_NAME } from "@/lib/brand";
import { portalDoPapel } from "@/lib/portais";
import type { EstadoConfirmacao } from "@/lib/verificacaoEmail";
import { confirmarEmailComToken } from "@/services/verificacaoEmailService";

/**
 * /confirmar-email — o destino do link enviado por e-mail.
 *
 * Pública de propósito: o link costuma ser aberto no celular, em um
 * navegador sem sessão. A RPC `confirmar_email` é executável por `anon`.
 *
 * Duas decisões que parecem detalhe e não são:
 *
 *  1. O token sai da URL (`history.replaceState`) assim que é lido. Ele fica
 *     guardado só em memória. URL não vaza para o histórico, para o título
 *     da aba compartilhada, nem para o `Referer` de qualquer link clicado
 *     depois.
 *  2. A confirmação acontece no CLIQUE, nunca no mount. Antivírus e o
 *     pré-carregador de links do Gmail/Outlook abrem a URL sozinhos — se
 *     consumíssemos no mount, o token morreria antes de a pessoa ver a tela.
 */

/** Fases próprias da tela, somadas aos desfechos que a RPC devolve. */
type Fase = "lendo" | "pronto" | "confirmando" | EstadoConfirmacao;

const REDIRECIONA_APOS_MS = 1800;

const ConfirmarEmail = () => {
  const navigate = useNavigate();
  const { user, role, loading, revalidarEmailConfirmado } = useAuth();

  const token = useRef<string | null>(null);
  const jaLeuUrl = useRef(false);
  const [fase, setFase] = useState<Fase>("lendo");

  // Leitura única da URL. O guard de ref sobrevive ao duplo-efeito do
  // StrictMode em desenvolvimento — sem ele, a segunda passada não acharia
  // mais o token (a primeira acabou de removê-lo) e a tela diria "inválido".
  useEffect(() => {
    if (jaLeuUrl.current) return;
    jaLeuUrl.current = true;

    const url = new URL(window.location.href);
    const bruto = url.searchParams.get("token");

    if (!bruto) {
      setFase("invalido");
      return;
    }

    token.current = bruto;
    url.searchParams.delete("token");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    setFase("pronto");
  }, []);

  const confirmar = useCallback(async () => {
    if (!token.current) {
      setFase("invalido");
      return;
    }
    setFase("confirmando");
    const resultado = await confirmarEmailComToken(token.current);
    // Quem tem sessão aberta carrega em memória o "não confirmado" antigo;
    // sem reler, o ProtectedRoute devolveria a pessoa para /verifique-email.
    if (resultado === "confirmado" || resultado === "ja_confirmado") {
      await revalidarEmailConfirmado();
    }
    setFase(resultado);
  }, [revalidarEmailConfirmado]);

  // Confirmou: leva ao portal do papel (com sessão) ou ao login (sem).
  useEffect(() => {
    if (fase !== "confirmado" || loading) return;
    const comSessao = Boolean(user && role);
    const destino = comSessao && role ? portalDoPapel(role) : "/login";
    const t = setTimeout(() => {
      if (!comSessao) toast.success("E-mail confirmado! Entre para continuar.");
      navigate(destino, { replace: true });
    }, REDIRECIONA_APOS_MS);
    return () => clearTimeout(t);
  }, [fase, loading, user, role, navigate]);

  const destinoDoPortal = user && role ? portalDoPapel(role) : "/login";

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
          {(fase === "lendo" || fase === "confirmando") && (
            <>
              <p className="card-overline">CONFIRMAÇÃO DE E-MAIL</p>
              <h1 className="card-title">
                {fase === "lendo" ? "Abrindo seu link..." : "Confirmando..."}
              </h1>
              <p className="card-description">Só um instante.</p>
            </>
          )}

          {fase === "pronto" && (
            <>
              <p className="card-overline">CONFIRMAÇÃO DE E-MAIL</p>
              <h1 className="card-title">Confirme seu e-mail.</h1>
              <p className="card-description">
                Clique no botão abaixo para liberar sua conta no {APP_NAME}. O link
                vale por 24 horas e pode ser usado uma única vez.
              </p>
              <button type="button" className="btn btn-primary btn-block btn-lg" onClick={confirmar}>
                CONFIRMAR E-MAIL
              </button>
            </>
          )}

          {fase === "confirmado" && (
            <>
              <p className="card-overline">TUDO CERTO</p>
              <h1 className="card-title">E-mail confirmado!</h1>
              <p className="card-description">
                Sua conta está liberada. Estamos te levando
                {user && role ? " para o seu portal" : " para a tela de entrada"}...
              </p>
              <Link to={destinoDoPortal} className="btn btn-primary btn-block btn-lg">
                CONTINUAR
              </Link>
            </>
          )}

          {fase === "ja_confirmado" && (
            <>
              <p className="card-overline">TUDO CERTO</p>
              <h1 className="card-title">Este e-mail já estava confirmado.</h1>
              <p className="card-description">
                Nada a fazer aqui — sua conta já está liberada. Isso acontece quando
                o link é aberto duas vezes ou quando você recebeu mais de um e-mail.
              </p>
              <Link to={destinoDoPortal} className="btn btn-primary btn-block btn-lg">
                {user && role ? "IR PARA O PORTAL" : "ENTRAR"}
              </Link>
            </>
          )}

          {fase === "expirado" && (
            <>
              <p className="card-overline">LINK EXPIRADO</p>
              <h1 className="card-title">Este link não vale mais.</h1>
              <p className="card-description">
                Os links de confirmação valem por 24 horas. Entre na sua conta e peça
                um novo e-mail — leva um clique.
              </p>
              <Link to={user ? "/verifique-email" : "/login"} className="btn btn-primary btn-block btn-lg">
                {user ? "PEDIR OUTRO E-MAIL" : "ENTRAR E REENVIAR"}
              </Link>
            </>
          )}

          {fase === "invalido" && (
            <>
              <p className="card-overline">LINK INVÁLIDO</p>
              <h1 className="card-title">Não reconhecemos este link.</h1>
              <p className="card-description">
                Confira se o endereço foi copiado inteiro do e-mail — alguns
                aplicativos quebram links longos em duas linhas. Se sua conta já
                existe, entre e peça um novo e-mail de confirmação.
              </p>
              <Link to={user ? "/verifique-email" : "/login"} className="btn btn-primary btn-block btn-lg">
                {user ? "PEDIR OUTRO E-MAIL" : "ENTRAR"}
              </Link>
              <p className="cadastro-footer">
                Ainda não tem conta? <Link to="/cadastro">Cadastre-se</Link>
              </p>
            </>
          )}

          {fase === "rede" && (
            <>
              <p className="card-overline">SEM RESPOSTA</p>
              <h1 className="card-title">Não conseguimos falar com o servidor.</h1>
              <p className="card-description">
                Seu link continua válido — isto foi a conexão, não o link. Verifique
                a internet e tente de novo.
              </p>
              <button type="button" className="btn btn-primary btn-block btn-lg" onClick={confirmar}>
                TENTAR DE NOVO
              </button>
            </>
          )}
        </div>
      </main>
    </>
  );
};

export default ConfirmarEmail;
