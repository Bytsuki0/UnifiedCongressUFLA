import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  criarArquivoDownload,
  listarArquivosDownload,
  removerArquivoDownload,
  type ArquivoDownloadAdmin,
  type GrupoDownload,
} from "@/services/configuracoesService";

/**
 * Os arquivos que a organização publica para download, em
 * /admin/configuracoes.
 *
 * Antes eram oito campos de URL fixos no formulário, um por arquivo
 * previsto lá atrás: publicar um nono exigia migration, código e deploy.
 * Agora é uma lista — a organização acrescenta e remove sozinha
 * (migration 20260830120000).
 *
 * As duas listas abaixo NÃO são um detalhe visual: `grupo` é coluna com
 * CHECK no banco e decide em que tela o arquivo aparece. Publicar o
 * Manual do Revisor no grupo errado o coloca na página inicial do
 * congresso, e é por isso que o botão de adicionar é um por grupo, e
 * não um só com um seletor onde escolher errado é o padrão.
 *
 * Acrescentar e remover gravam NA HORA, sem passar pelo "SALVAR
 * CONFIGURAÇÕES" do rodapé da página: aquele botão escreve a linha
 * única de `configuracoes`, que é outra tabela. Um botão só para as
 * duas coisas deixaria o admin sem saber o que foi gravado quando uma
 * das duas falhasse.
 */

type Grupo = { valor: GrupoDownload; titulo: string; ajuda: string };

const GRUPOS: Grupo[] = [
  {
    valor: "estudante",
    titulo: "SUBMISSÃO E PÁGINAS PÚBLICAS",
    ajuda: "Aparecem no carrossel da página inicial, na tela de login e em Templates.",
  },
  {
    valor: "revisor",
    titulo: "REVISÃO",
    ajuda: "Aparecem no arquivo de documentos do revisor.",
  },
];

const RASCUNHO_VAZIO = { titulo: "", url: "", formato: "", descricao: "" };

export function ArquivosDownloadPanel() {
  const [arquivos, setArquivos] = useState<ArquivoDownloadAdmin[]>([]);
  const [carregando, setCarregando] = useState(true);
  // Qual grupo está com o formulário aberto. Um de cada vez: dois
  // formulários abertos convidam a preencher um e enviar o outro.
  const [formAberto, setFormAberto] = useState<GrupoDownload | null>(null);
  const [rascunho, setRascunho] = useState(RASCUNHO_VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [removendo, setRemovendo] = useState<string | null>(null);

  useEffect(() => {
    listarArquivosDownload()
      .then(setArquivos)
      .catch(() => toast.error("Não foi possível carregar os arquivos para download."))
      .finally(() => setCarregando(false));
  }, []);

  const abrirForm = (grupo: GrupoDownload) => {
    setFormAberto(grupo);
    setRascunho(RASCUNHO_VAZIO);
  };

  const fecharForm = () => {
    setFormAberto(null);
    setRascunho(RASCUNHO_VAZIO);
  };

  const adicionar = async (grupo: GrupoDownload) => {
    const titulo = rascunho.titulo.trim();
    const url = rascunho.url.trim();
    // Os mesmos dois CHECK do banco, avisados antes: a mensagem crua do
    // Postgres para um CHECK violado não diz ao admin qual campo faltou.
    if (!titulo || !url) {
      toast.error("Informe o nome do arquivo e o link.");
      return;
    }

    setSalvando(true);
    try {
      const doGrupo = arquivos.filter((a) => a.grupo === grupo);
      const criado = await criarArquivoDownload({
        grupo,
        titulo,
        url,
        formato: rascunho.formato,
        descricao: rascunho.descricao,
        // No fim da lista do grupo. `ordem` é por grupo, então o máximo
        // sai do recorte, nunca da lista inteira.
        ordem: doGrupo.reduce((maior, a) => Math.max(maior, a.ordem), 0) + 1,
      });
      setArquivos((atual) => [...atual, criado]);
      fecharForm();
      toast.success("Arquivo publicado.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível publicar o arquivo.");
    } finally {
      setSalvando(false);
    }
  };

  const remover = async (arquivo: ArquivoDownloadAdmin) => {
    if (!confirm(
      `Remover "${arquivo.titulo}" da lista de downloads?\n\n` +
      "O botão some das telas imediatamente. O arquivo no Google Drive não é apagado."
    )) return;

    setRemovendo(arquivo.id);
    try {
      await removerArquivoDownload(arquivo.id);
      setArquivos((atual) => atual.filter((a) => a.id !== arquivo.id));
      toast.success("Arquivo removido da lista.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível remover o arquivo.");
    } finally {
      setRemovendo(null);
    }
  };

  return (
    <div className="config-card">
      <div className="config-card-header">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 20, height: 20 }}>
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
        </svg>
        <span className="config-title">Links de Downloads (Google Drive)</span>
      </div>

      <p style={{ fontSize: "var(--fs-caption)", color: "var(--color-text-secondary)", marginBottom: 16 }}>
        Cole o link de compartilhamento do Drive e dê um nome ao arquivo. Lembre-se de deixar o
        arquivo acessível a quem tem o link. Acrescentar e remover valem na hora, sem passar pelo
        botão SALVAR CONFIGURAÇÕES.
      </p>

      {carregando ? (
        <div style={{ padding: 24, color: "var(--color-text-muted)", fontSize: "var(--fs-sm)" }}>
          Carregando arquivos...
        </div>
      ) : (
        GRUPOS.map((grupo) => {
          const doGrupo = arquivos.filter((a) => a.grupo === grupo.valor);
          return (
            <div key={grupo.valor} style={{ marginBottom: 24 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 4 }}>
                <div style={{ fontWeight: "var(--fw-bold)", fontSize: "var(--fs-caption)", letterSpacing: "var(--ls-label)", color: "var(--color-text-secondary)" }}>
                  {grupo.titulo}
                </div>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => (formAberto === grupo.valor ? fecharForm() : abrirForm(grupo.valor))}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 5v14"/><path d="M5 12h14"/>
                  </svg>
                  ADICIONAR ARQUIVO
                </button>
              </div>
              <div style={{ fontSize: "var(--fs-caption)", color: "var(--color-text-muted)", marginBottom: 12 }}>
                {grupo.ajuda}
              </div>

              {formAberto === grupo.valor && (
                <div className="config-card" style={{ marginBottom: 12, background: "var(--gray-50)" }}>
                  <div className="config-row">
                    <div className="form-group">
                      <label className="form-label" htmlFor={`novo-titulo-${grupo.valor}`}>Nome do arquivo *</label>
                      <input
                        type="text"
                        id={`novo-titulo-${grupo.valor}`}
                        className="form-input"
                        placeholder="Modelo de artigo · Word"
                        value={rascunho.titulo}
                        onChange={(e) => setRascunho((r) => ({ ...r, titulo: e.target.value }))}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label" htmlFor={`novo-url-${grupo.valor}`}>Link do Drive *</label>
                      <input
                        type="url"
                        id={`novo-url-${grupo.valor}`}
                        className="form-input"
                        placeholder="https://drive.google.com/..."
                        value={rascunho.url}
                        onChange={(e) => setRascunho((r) => ({ ...r, url: e.target.value }))}
                      />
                    </div>
                  </div>
                  <div className="config-row">
                    <div className="form-group">
                      <label className="form-label" htmlFor={`novo-formato-${grupo.valor}`}>Formato (opcional)</label>
                      <input
                        type="text"
                        id={`novo-formato-${grupo.valor}`}
                        className="form-input"
                        placeholder=".DOCX"
                        value={rascunho.formato}
                        onChange={(e) => setRascunho((r) => ({ ...r, formato: e.target.value }))}
                      />
                      <div className="form-hint">Vira o selo do cartão. Em branco, o selo não aparece.</div>
                    </div>
                    <div className="form-group">
                      <label className="form-label" htmlFor={`nova-descricao-${grupo.valor}`}>Descrição (opcional)</label>
                      <input
                        type="text"
                        id={`nova-descricao-${grupo.valor}`}
                        className="form-input"
                        placeholder="Regulamento completo e normas"
                        value={rascunho.descricao}
                        onChange={(e) => setRascunho((r) => ({ ...r, descricao: e.target.value }))}
                      />
                      <div className="form-hint">Hoje só o arquivo do revisor mostra esta linha.</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                    <button type="button" className="btn btn-outline btn-sm" onClick={fecharForm} disabled={salvando}>
                      CANCELAR
                    </button>
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => adicionar(grupo.valor)} disabled={salvando}>
                      {salvando ? "PUBLICANDO..." : "PUBLICAR ARQUIVO"}
                    </button>
                  </div>
                </div>
              )}

              {doGrupo.length === 0 ? (
                <div style={{ fontSize: "var(--fs-sm)", color: "var(--color-text-muted)", padding: "12px 0" }}>
                  Nenhum arquivo publicado neste grupo.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {doGrupo.map((a) => (
                    <div
                      key={a.id}
                      style={{
                        display: "flex", alignItems: "center", gap: 12, padding: 12,
                        border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)",
                        background: "var(--white)",
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          {a.formato && <span className="badge badge-gray">{a.formato}</span>}
                          <span style={{ fontWeight: "var(--fw-semibold)", fontSize: "var(--fs-sm)" }}>{a.titulo}</span>
                        </div>
                        {a.descricao && (
                          <div style={{ fontSize: "var(--fs-caption)", color: "var(--color-text-secondary)", marginTop: 2 }}>
                            {a.descricao}
                          </div>
                        )}
                        {/* `overflow: hidden` no pai + estas três: um link
                            do Drive tem 90 caracteres e esticaria o card
                            para fora da coluna sem quebrar linha. */}
                        <a
                          href={a.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            display: "block", fontSize: "var(--fs-caption)", color: "var(--color-primary)",
                            marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}
                        >
                          {a.url}
                        </a>
                      </div>
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={() => remover(a)}
                        disabled={removendo === a.id}
                        title={`Remover ${a.titulo}`}
                        style={{ flexShrink: 0 }}
                      >
                        {removendo === a.id ? "REMOVENDO..." : "REMOVER"}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
