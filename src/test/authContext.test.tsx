import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";

/**
 * AuthContext — a janela entre "tem sessão" e "sei o papel".
 *
 * Este teste existe por um bug concreto: quem entrava era devolvido para
 * /login. O <ProtectedRoute> lê `role === null` com `loading === false` como
 * "não autenticado", e o `navigate` do Login chegava ANTES de o papel ter
 * sido resolvido — então o portal recém-aberto mandava a pessoa de volta.
 *
 * A correção é o provider voltar a `loading` enquanto resolve o papel de uma
 * conta nova. O que não pode acontecer junto: piscar `loading` a cada
 * renovação de token, que desmontaria a tela do usuário de hora em hora.
 */

type Sessao = { user: { id: string; email: string; user_metadata?: { nome?: string } } };
type Callback = (evento: string, sessao: Sessao | null) => void;

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  getSession: vi.fn(),
  emailEstaConfirmado: vi.fn(),
  callbacks: [] as Callback[],
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: mocks.rpc,
    auth: {
      getSession: mocks.getSession,
      onAuthStateChange: (cb: Callback) => {
        mocks.callbacks.push(cb);
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    },
  },
}));

vi.mock("@/services/verificacaoEmailService", () => ({
  emailEstaConfirmado: mocks.emailEstaConfirmado,
}));

import { AuthProvider, useAuth } from "@/contexts/AuthContext";

const sessaoDe = (id: string): Sessao => ({
  user: { id, email: `${id}@estudante.ufla.br`, user_metadata: { nome: "Maria" } },
});

function Espiao() {
  const { role, loading } = useAuth();
  return <div data-testid="estado">{`${loading ? "carregando" : "pronto"}:${role ?? "sem-papel"}`}</div>;
}

const estado = () => screen.getByTestId("estado").textContent;

/** Promessa que só resolve quando o teste mandar — segura a RPC no ar. */
function adiada<T>() {
  let resolver!: (v: T) => void;
  const promessa = new Promise<T>((r) => { resolver = r; });
  return { promessa, resolver };
}

/** Emite o evento de auth e deixa o setTimeout(0) do provider rodar. */
async function emitir(sessao: Sessao | null) {
  await act(async () => {
    mocks.callbacks.forEach((cb) => cb("SIGNED_IN", sessao));
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe("AuthContext — resolução do papel", () => {
  beforeEach(() => {
    mocks.callbacks.length = 0;
    mocks.rpc.mockReset();
    mocks.getSession.mockReset().mockResolvedValue({ data: { session: null } });
    mocks.emailEstaConfirmado.mockReset().mockResolvedValue(true);
  });

  it("fica em `loading` enquanto resolve o papel de uma conta nova", async () => {
    const papel = adiada<{ data: string[]; error: null }>();
    mocks.rpc.mockReturnValue(papel.promessa);

    render(<AuthProvider><Espiao /></AuthProvider>);
    // Sem sessão: o provider já terminou, e `role` nulo aqui é "deslogado"
    // de verdade — é o único caso em que o ProtectedRoute pode ir a /login.
    await waitFor(() => expect(estado()).toBe("pronto:sem-papel"));

    await emitir(sessaoDe("u1"));

    // ESTE é o assert do bug: sessão existe, papel ainda não. O provider tem
    // de estar em `loading` — senão o ProtectedRoute lê "deslogado".
    expect(estado()).toBe("carregando:sem-papel");

    await act(async () => { papel.resolver({ data: ["estudante"], error: null }); });
    await waitFor(() => expect(estado()).toBe("pronto:estudante"));
  });

  it("não volta a `loading` quando o token da MESMA conta é renovado", async () => {
    mocks.rpc.mockResolvedValue({ data: ["estudante"], error: null });

    render(<AuthProvider><Espiao /></AuthProvider>);
    await emitir(sessaoDe("u1"));
    await waitFor(() => expect(estado()).toBe("pronto:estudante"));

    // TOKEN_REFRESHED da mesma conta: nada pode piscar. Se `loading` voltasse
    // a true aqui, a tela do usuário mostraria "Verificando acesso..." e
    // desmontaria o que estivesse aberto.
    await emitir(sessaoDe("u1"));
    expect(estado()).toBe("pronto:estudante");
  });

  it("descarta a resolução atrasada da sessão anterior", async () => {
    const primeira = adiada<{ data: string[]; error: null }>();
    mocks.rpc.mockReturnValueOnce(primeira.promessa);

    render(<AuthProvider><Espiao /></AuthProvider>);
    await emitir(sessaoDe("u1"));

    // Troca de conta antes de a primeira RPC responder.
    mocks.rpc.mockResolvedValue({ data: ["admin"], error: null });
    await emitir(sessaoDe("u2"));
    await waitFor(() => expect(estado()).toBe("pronto:admin"));

    // A resposta velha chega agora: não pode repor o papel da sessão morta.
    await act(async () => { primeira.resolver({ data: ["estudante"], error: null }); });
    expect(estado()).toBe("pronto:admin");
  });

  it("logout limpa o papel e sai de `loading`", async () => {
    mocks.rpc.mockResolvedValue({ data: ["estudante"], error: null });

    render(<AuthProvider><Espiao /></AuthProvider>);
    await emitir(sessaoDe("u1"));
    await waitFor(() => expect(estado()).toBe("pronto:estudante"));

    await emitir(null);
    expect(estado()).toBe("pronto:sem-papel");
  });
});
