import { Link } from "react-router-dom";
import { CabecalhoPublico } from "@/components/publico/CabecalhoPublico";
import { RodapePublico } from "@/components/publico/RodapePublico";
import { ListaAnais } from "@/components/publico/ListaAnais";
import { useAnais } from "@/hooks/use-anais";

/**
 * Anais do Congresso — página pública, aberta ANTES do login.
 *
 * É a terceira rota pública que serve CONTEÚDO, ao lado de /cronograma e
 * /pitches: onde os trabalhos apresentados foram publicados, com o link
 * para cada volume. Como as outras duas, deve ser indexada — é o que um
 * interessado procura antes de decidir submeter, e não há dado de
 * ninguém aqui além do que já saiu publicado.
 *
 * A landing traz a mesma lista numa seção, e lá ela SOME quando não há
 * nada publicado. Aqui não some: quem clicou em "Anais" pediu esta
 * informação e merece a resposta "ainda não foi publicado" em vez de uma
 * página em branco. Quem cuida dessa mensagem é a própria <ListaAnais>.
 */
const Anais = () => {
  const { anais, carregando } = useAnais();

  return (
    <div style={{ fontFamily: "var(--font-family)", background: "#fff", minHeight: "100vh" }}>
      <CabecalhoPublico />

      <section className="cronograma-pagina">
        <div className="cronograma-inner">
          <div className="section-overline">PUBLICAÇÕES</div>
          <h1 className="section-title">Anais do congresso.</h1>
          <p className="section-description">
            Os trabalhos apresentados nas edições do congresso e onde cada conjunto foi publicado.
          </p>

          <ListaAnais anais={anais} carregando={carregando} />

          <div className="cronograma-rodape-acoes">
            <Link to="/pitches" className="btn btn-outline">VER OS PITCHES</Link>
            <Link to="/cadastro" className="btn btn-primary">CADASTRAR-SE</Link>
          </div>
        </div>
      </section>

      <RodapePublico />
    </div>
  );
};

export default Anais;
