import { useAvisos } from "@/contexts/AvisosContext";
import { CorpoDoAviso } from "@/components/CorpoDoAviso";

/**
 * Avisos dentro do Portal do Estudante.
 *
 * São os MESMOS avisos de login que a organização cadastra em
 * /co-chairs/avisos, numa página fixa do menu: o pop-up some ao ser
 * fechado, e a aba Notificações da barra superior vira só um ícone no
 * celular. Aqui o recado fica parado para ser relido.
 *
 * QUEM vê o quê continua sendo decisão do servidor: `meus_avisos()`
 * compara os papéis marcados no aviso com os papéis da conta, então um
 * estudante só recebe os avisos marcados para "Estudantes", e um
 * participante externo, os marcados para "Participantes externos". Esta
 * página não filtra nada. E lê do `AvisosContext`, a fonte única do
 * pop-up e da aba — uma segunda chamada à RPC seria uma segunda lista
 * em memória, livre para discordar das outras duas.
 */
const Avisos = () => {
  const { avisos, carregando } = useAvisos();

  return (
    <div className="section active">
      <div className="content-area">
        <div className="page-header">
          <div className="page-overline">Recados da organização</div>
          <h1 className="page-title">Avisos</h1>
          <p style={{ fontSize: "var(--fs-sm)", color: "var(--color-text-secondary)" }}>
            Os avisos da organização do congresso para você, os mesmos que aparecem ao entrar. Ficam
            aqui enquanto estiverem publicados.
          </p>
        </div>

        {/* A lista vazia AVISA, como em Templates: a página existe só para
            os avisos, e uma tela em branco não diria se há algo publicado. */}
        {carregando ? (
          <div style={{ textAlign: "center", padding: 48, color: "var(--color-text-muted)" }}>Carregando avisos...</div>
        ) : avisos.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 28, height: 28 }}>
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            </div>
            <h3 className="empty-state-title">Nenhum aviso publicado</h3>
            <p className="empty-state-description">A organização ainda não publicou avisos para você.</p>
          </div>
        ) : (
          <div style={{ display: "grid", gap: "var(--space-4)" }}>
            {avisos.map((aviso) => (
              <article className="card" key={aviso.id}>
                <h2 style={{ fontSize: "var(--fs-h4)", fontWeight: "var(--fw-semibold)", marginBottom: "var(--space-3)" }}>
                  {aviso.titulo}
                </h2>
                <CorpoDoAviso aviso={aviso} />
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Avisos;
