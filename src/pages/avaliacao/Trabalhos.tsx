import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { filtrarTrabalhos, type MinhaAvaliacao, type TrabalhoAvaliavel } from "@/lib/avaliacaoEvento";
import { carregarAvaliacaoEvento } from "@/services/avaliacaoEventoService";
import { mapaCategorias } from "@/services/categoriasService";

/**
 * As duas listas do portal, numa tela só: `/avaliacao/minhas` (o que eu já
 * avaliei — a tela inicial, como /revisor/analise) e `/avaliacao/buscar`
 * (tudo o que o servidor me deixa avaliar, com busca). Não há distribuição:
 * quem avalia acha o trabalho e clica.
 */
const Trabalhos = ({ minhas: soMinhas = false }: { minhas?: boolean }) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [trabalhos, setTrabalhos] = useState<TrabalhoAvaliavel[]>([]);
  const [minhas, setMinhas] = useState<Record<string, MinhaAvaliacao>>({});
  const [categorias, setCategorias] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [categoriaId, setCategoriaId] = useState("");
  const [termo, setTermo] = useState("");

  useEffect(() => {
    if (!user?.id) return;
    let vivo = true;
    Promise.all([carregarAvaliacaoEvento(user.id), mapaCategorias()])
      .then(([dados, cats]) => {
        if (!vivo) return;
        setTrabalhos(dados.trabalhos);
        setMinhas(dados.minhas);
        setCategorias(cats);
      })
      .catch(() => toast.error("Erro ao carregar trabalhos."))
      .finally(() => vivo && setLoading(false));
    return () => {
      vivo = false;
    };
  }, [user?.id]);

  const linhas = soMinhas
    ? trabalhos.filter((t) => minhas[t.id])
    : filtrarTrabalhos(trabalhos, { categoriaId, termo });

  // Só as categorias que têm trabalho na lista: escolher uma vazia não acharia nada.
  const categoriasNaLista = [...new Set(trabalhos.map((t) => t.categoria_id).filter(Boolean))]
    .map((id) => ({ id, nome: categorias[id] ?? "—" }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

  return (
    <div className="section active">
      <div className="content-area">
        <div className="page-header">
          <div className="page-overline">AVALIAÇÃO AO VIVO</div>
          <h1 className="page-title">{soMinhas ? "Minhas avaliações" : "Buscar trabalhos"}</h1>
          <p className="page-subtitle">
            {soMinhas
              ? "Os trabalhos que você já avaliou. Abra um deles para revisar as notas."
              : "Procure o trabalho apresentado pela categoria, pelo título ou pelo nome de um autor e clique em Avaliar."}
          </p>
        </div>

        {!soMinhas && (
          <div className="toolbar">
            <div className="search-wrapper">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input
                type="search"
                className="search-input"
                placeholder="Buscar por título ou autor..."
                aria-label="Buscar por título ou autor"
                value={termo}
                onChange={(e) => setTermo(e.target.value)}
              />
            </div>
            <select
              className="form-select"
              style={{ width: "auto" }}
              aria-label="Filtrar por categoria"
              value={categoriaId}
              onChange={(e) => setCategoriaId(e.target.value)}
            >
              <option value="">Todas as categorias</option>
              {categoriasNaLista.map((c) => (
                <option key={c.id} value={c.id}>{c.nome}</option>
              ))}
            </select>
          </div>
        )}

        {loading ? (
          <div style={{ padding: 48, textAlign: "center", color: "var(--color-text-muted)", fontSize: "var(--fs-sm)" }}>Carregando trabalhos...</div>
        ) : soMinhas && linhas.length === 0 ? (
          <div className="empty-state">
            <h3 className="empty-state-title">Nenhuma avaliação ainda</h3>
            <p className="empty-state-description">Os trabalhos que você avaliar durante o congresso aparecem aqui.</p>
            <button className="btn btn-primary btn-sm" style={{ marginTop: 16 }} onClick={() => navigate("/avaliacao/buscar")}>
              Buscar trabalhos
            </button>
          </div>
        ) : !soMinhas && trabalhos.length === 0 ? (
          <div className="empty-state">
            <h3 className="empty-state-title">Nenhum trabalho para avaliar</h3>
            <p className="empty-state-description">Só os trabalhos aprovados entram na avaliação ao vivo, e ainda não há nenhum.</p>
          </div>
        ) : (
          <div className="table-container">
            <table className="table" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th>TÍTULO</th>
                  <th>AUTORES</th>
                  <th>CATEGORIA</th>
                  <th>SUA MÉDIA</th>
                  <th>AÇÃO</th>
                </tr>
              </thead>
              <tbody>
                {linhas.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="celula-plena" style={{ textAlign: "center", color: "var(--color-text-muted)" }}>
                      Nenhum trabalho encontrado.
                    </td>
                  </tr>
                ) : (
                  linhas.map((t) => {
                    const minha = minhas[t.id];
                    return (
                      <tr key={t.id}>
                        <td data-rotulo="TÍTULO" className="celula-titulo" style={{ fontWeight: "var(--fw-semibold)" }}>{t.titulo}</td>
                        <td data-rotulo="AUTORES">{t.autores}</td>
                        <td data-rotulo="CATEGORIA">{t.categoria_id ? (categorias[t.categoria_id] ?? "—") : "—"}</td>
                        <td data-rotulo="SUA MÉDIA">
                          {minha ? <span className="badge badge-green">{Number(minha.media).toFixed(2)}</span> : "—"}
                        </td>
                        <td data-rotulo="AÇÃO" className="celula-acoes">
                          {t.em_conflito ? (
                            <button className="btn btn-outline btn-sm" disabled title="Você é autor, orientador ou coautor deste trabalho">
                              Conflito de interesse
                            </button>
                          ) : (
                            <button className="btn btn-primary btn-sm" onClick={() => navigate(`/avaliacao/avaliar/${t.id}`)}>
                              {minha ? "Revisar" : "Avaliar"}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default Trabalhos;
