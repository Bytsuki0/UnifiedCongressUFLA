import { Link } from "react-router-dom";
import { CabecalhoPublico } from "@/components/publico/CabecalhoPublico";
import { RodapePublico } from "@/components/publico/RodapePublico";
import { ListaApresentacoes } from "@/components/apresentacoes/ListaApresentacoes";
import { useApresentacoes } from "@/hooks/use-apresentacoes";

/**
 * Cronograma de apresentações — página pública, aberta ANTES do login.
 *
 * É a lista inteira, com busca; a landing traz só uma chamada para cá (uma
 * tabela de centenas de trabalhos no meio da página inicial empurraria
 * tudo o que vem depois dela). Os dados vêm da RPC
 * `apresentacoes_publicas()`, aberta a `anon`.
 *
 * Aqui não há quadro de destaque: ele é do portal do autor, que sabe quem
 * está logado. Como em /cronograma, a seção NÃO some quando está vazia —
 * quem clicou em "Apresentações" pediu a informação e merece a resposta
 * "ainda não foi publicado".
 */
const Apresentacoes = () => {
  const { itens, carregando } = useApresentacoes();

  return (
    <div style={{ fontFamily: "var(--font-family)", background: "#fff", minHeight: "100vh" }}>
      <CabecalhoPublico />

      <section className="cronograma-pagina">
        <div className="cronograma-inner">
          <div className="section-overline">APRESENTAÇÕES</div>
          <h1 className="section-title">Cronograma de apresentações.</h1>
          <p className="section-description">
            Dia, horário, sala e formato de apresentação de cada trabalho aprovado. Busque pelo
            título do trabalho.
          </p>

          <ListaApresentacoes itens={itens} carregando={carregando} />

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

export default Apresentacoes;
