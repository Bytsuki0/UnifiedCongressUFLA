import { useEffect, useState } from "react";
import { toast } from "sonner";
import { nomeDoArquivo, TITULO_USO, type Uso } from "@/lib/certificados";
import {
  baixarCertificado,
  carregarMeusCertificados,
  type MeuCertificado,
} from "@/services/certificadosService";
import { PreviaCertificado } from "@/components/PreviaCertificado";

/**
 * Os certificados de quem está logado, em três portais: Submissão (base e
 * pódio), Revisão e Avaliação — `usos` diz quais cabem em cada um.
 *
 * QUEM recebe e SE já foi liberado é do servidor (`meus_certificados()`);
 * aqui só se recorta por portal e se desenha. O PNG é gerado no navegador
 * na hora do clique, no tamanho do modelo.
 */
export function MeusCertificados({ usos }: { usos: Uso[] }) {
  const [lista, setLista] = useState<MeuCertificado[] | null>(null);
  const [baixando, setBaixando] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    carregarMeusCertificados().then((c) => vivo && setLista(c));
    return () => {
      vivo = false;
    };
  }, []);

  const meus = lista?.filter((c) => usos.includes(c.uso)) ?? [];

  async function baixar(c: MeuCertificado) {
    const id = `${c.uso}:${c.chave}`;
    setBaixando(id);
    try {
      await baixarCertificado(c.modelo, c.imagem, c.variaveis, nomeDoArquivo(c.uso, c.variaveis));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível gerar o certificado.");
    } finally {
      setBaixando(null);
    }
  }

  return (
    <div className="section active">
      <div className="content-area">
        <div className="page-header">
          <div className="page-overline">CERTIFICADOS</div>
          <h1 className="page-title">Meus certificados</h1>
          <p className="page-description">
            Os certificados que a organização já liberou para você. Cada um é gerado na hora, em PNG.
          </p>
        </div>

        {lista === null ? (
          <div style={{ textAlign: "center", padding: 48, color: "var(--color-text-muted)" }}>
            Carregando certificados...
          </div>
        ) : meus.length === 0 ? (
          // A página existe só para isto: vazia, ela AVISA.
          <div className="empty-state">
            <h3 className="empty-state-title">Nenhum certificado disponível</h3>
            <p className="empty-state-description">
              Quando a organização liberar os certificados, eles aparecem aqui e você recebe um aviso
              por e-mail.
            </p>
          </div>
        ) : (
          <div style={{ display: "grid", gap: "var(--space-4)", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 340px), 1fr))" }}>
            {meus.map((c) => {
              const id = `${c.uso}:${c.chave}`;
              return (
                <article className="card" key={id}>
                  <PreviaCertificado modelo={c.modelo} imagem={c.imagem} variaveis={c.variaveis} />
                  <h2 style={{ fontSize: "var(--fs-h4)", fontWeight: "var(--fw-semibold)", margin: "var(--space-3) 0 4px" }}>
                    {TITULO_USO[c.uso]}
                  </h2>
                  {c.variaveis.titulo && (
                    <p style={{ fontSize: "var(--fs-sm)", color: "var(--color-text-secondary)", marginBottom: "var(--space-3)" }}>
                      {c.variaveis.titulo}
                    </p>
                  )}
                  <button className="btn btn-primary" disabled={baixando === id} onClick={() => baixar(c)}>
                    {baixando === id ? "Gerando..." : "Baixar certificado"}
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
