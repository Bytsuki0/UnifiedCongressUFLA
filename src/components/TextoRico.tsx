import { Fragment } from "react";
import { blocosDoTexto, type Trecho } from "@/lib/avisos";

/**
 * Exibe um texto com a marcação leve dos avisos (negrito, itálico e
 * lista).
 *
 * ⚠ Não existe `dangerouslySetInnerHTML` aqui, e não pode passar a
 * existir. O aviso é o único texto do sistema escrito por uma pessoa que
 * aparece no navegador de TODAS as outras sem que ninguém tenha clicado
 * em nada: injetar marcação transformaria uma conta de co-chair
 * comprometida num `<script>` na tela do congresso inteiro. `blocosDoTexto`
 * devolve uma árvore de dados, e o pior que um texto malicioso consegue
 * daqui é ficar em negrito.
 *
 * É componente separado (e não JSX solto dentro do diálogo) porque duas
 * telas mostram o mesmo texto: o pop-up do login e a pré-visualização de
 * quem escreve o aviso. Ver o que o destinatário verá é a única
 * conferência que vale antes de publicar.
 */

const Formatado = ({ trechos }: { trechos: Trecho[] }) => (
  <>
    {trechos.map((t, i) => {
      let no = <>{t.texto}</>;
      if (t.italico) no = <em>{no}</em>;
      if (t.negrito) no = <strong>{no}</strong>;
      return <Fragment key={i}>{no}</Fragment>;
    })}
  </>
);

export const TextoRico = ({ texto, className }: { texto: string; className?: string }) => {
  const blocos = blocosDoTexto(texto);
  if (blocos.length === 0) return null;

  return (
    <div className={className}>
      {blocos.map((bloco, i) =>
        bloco.tipo === "lista" ? (
          <ul key={i} className="my-2 list-disc space-y-1 pl-5">
            {bloco.itens.map((item, j) => (
              <li key={j}>
                <Formatado trechos={item} />
              </li>
            ))}
          </ul>
        ) : (
          <p key={i} className="my-2 whitespace-pre-wrap first:mt-0 last:mb-0">
            {bloco.linhas.map((linha, j) => (
              <Fragment key={j}>
                {/* A quebra vai ANTES da linha, e não depois: um <br/> no
                    fim da última deixaria uma linha em branco pendurada
                    no rodapé do parágrafo. */}
                {j > 0 && <br />}
                <Formatado trechos={linha} />
              </Fragment>
            ))}
          </p>
        ),
      )}
    </div>
  );
};

export default TextoRico;
