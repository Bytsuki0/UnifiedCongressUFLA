import { Link } from "react-router-dom";
import { CabecalhoPublico } from "@/components/publico/CabecalhoPublico";
import { RodapePublico } from "@/components/publico/RodapePublico";
import { ListaCronograma } from "@/components/cronograma/ListaCronograma";
import { useCronograma } from "@/hooks/use-cronograma";

/**
 * Cronograma — página pública, aberta ANTES do login.
 *
 * A landing já traz a mesma lista numa seção; esta página existe para
 * quem chega pelo item CRONOGRAMA da barra superior ou por um link
 * direto, e para dar às datas a tela inteira.
 *
 * Diferente da landing, aqui a seção NÃO some quando não há nada
 * publicado: quem clicou em "Cronograma" pediu esta informação e merece
 * a resposta "ainda não foi publicado" em vez de uma página em branco.
 * Quem cuida dessa mensagem é a própria <ListaCronograma>.
 */
const Cronograma = () => {
  const { itens, carregando } = useCronograma();

  return (
    <div style={{ fontFamily: "var(--font-family)", background: "#fff", minHeight: "100vh" }}>
      <CabecalhoPublico />

      <section className="cronograma-pagina">
        <div className="cronograma-inner">
          <div className="section-overline">DATAS IMPORTANTES</div>
          <h1 className="section-title">Cronograma do congresso.</h1>
          <p className="section-description">
            Prazos de submissão, avaliação e realização do evento, em ordem cronológica.
          </p>

          <ListaCronograma itens={itens} carregando={carregando} />

          <div className="cronograma-rodape-acoes">
            <Link to="/cadastro" className="btn btn-primary">CADASTRAR-SE</Link>
            <Link to="/login" className="btn btn-outline">JÁ TENHO CONTA</Link>
          </div>
        </div>
      </section>

      <RodapePublico />
    </div>
  );
};

export default Cronograma;
