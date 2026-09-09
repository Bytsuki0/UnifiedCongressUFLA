import { ArquivosDownloadPanel } from "@/components/co-chairs/ArquivosDownloadPanel";

/**
 * Links de Downloads (Google Drive) — a tela própria dos arquivos que a
 * organização publica.
 *
 * Vivia dentro de /admin/configuracoes, entre a configuração de prazo e
 * a de notificações. Saiu de lá na 20260909120000 por duas razões que
 * andam juntas:
 *
 *   1. o conteúdo é do congresso, não da administração do sistema —
 *      modelo de artigo, normas de formatação, manual do revisor. Quem
 *      cuida disso é a mesma organização que cuida do cronograma, das
 *      categorias e das vitrines, e todas essas telas moram aqui;
 *   2. dentro de /admin/configuracoes o painel convivia com um botão
 *      SALVAR CONFIGURAÇÕES que NÃO o salvava (a lista grava na hora, e
 *      em outra tabela). A página ficava com duas semânticas de
 *      gravação, e o painel precisava ficar abaixo do botão só para
 *      dizer isso pela posição.
 *
 * A permissão foi junto: a policy de escrita de `arquivos_download`
 * passou de `is_app_admin()` para `is_event_staff()`. O admin continua
 * dentro (`is_event_staff()` = admin OU avaliador) — o conjunto só
 * cresceu.
 *
 * A página é uma casca: o painel inteiro é
 * `components/co-chairs/ArquivosDownloadPanel`, que também é onde
 * moram as razões de o botão de adicionar ser um POR GRUPO.
 */
const Downloads = () => {
  return (
    <div>
      <div className="page-header">
        <div className="page-overline">MATERIAL DO CONGRESSO</div>
        <h1 className="page-title">Links de downloads.</h1>
        <p style={{ fontSize: "var(--fs-sm)", color: "var(--color-text-secondary)" }}>
          Os arquivos que aparecem na página inicial, na tela de login, em Templates e no arquivo
          do revisor. O que está publicado aqui é o que o visitante vê.
        </p>
      </div>

      {/* `config-cards` é o mesmo empilhamento de /admin/configuracoes:
          o painel é desenhado com as classes `config-*` do index.css e
          espera esse contêiner em volta. */}
      <div className="config-cards">
        <ArquivosDownloadPanel />
      </div>
    </div>
  );
};

export default Downloads;
