import { useRef } from "react";
import { Bold, Italic, List } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { alternarLista, envolverSelecao, type EdicaoTexto } from "@/lib/avisos";

/**
 * Área de texto com barra de negrito, itálico e lista.
 *
 * O que a barra escreve é MARCAÇÃO no próprio texto (`**assim**`), e não
 * um documento rico paralelo: o campo continua sendo um `<textarea>`
 * comum, o que está no estado é exatamente o que vai para o banco, e
 * quem preferir digitar os asteriscos à mão obtém o mesmo resultado.
 * Um editor de verdade (contentEditable) traria a árvore do navegador
 * junto HTML colado de outro site, `<script>` incluído e é
 * exatamente o que o aviso não pode guardar. Ver `TextoRico`.
 *
 * As três edições são funções puras em `src/lib/avisos.ts`: aqui só se
 * lê a seleção do campo e se devolve a nova. É o que permite testar o
 * caso que mais quebra clicar no botão com a seleção JÁ marcada, que
 * tem de DESMARCAR e não empilhar mais um par de asteriscos.
 */

type Props = {
  valor: string;
  onChange: (valor: string) => void;
  id?: string;
  rows?: number;
  placeholder?: string;
};

export const EditorTextoRico = ({ valor, onChange, id, rows = 8, placeholder }: Props) => {
  const campo = useRef<HTMLTextAreaElement>(null);

  const aplicar = (edicao: (texto: string, inicio: number, fim: number) => EdicaoTexto) => {
    const el = campo.current;
    if (!el) return;

    const { texto, inicio, fim } = edicao(valor, el.selectionStart, el.selectionEnd);
    onChange(texto);

    // O React só reescreve o valor do campo no render seguinte; mexer na
    // seleção agora seria posicionar o cursor no texto ANTIGO. O
    // requestAnimationFrame devolve o foco e a seleção depois da
    // pintura sem isso o cursor pula para o fim a cada clique na
    // barra, e escrever uma lista de três itens vira uma briga.
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(inicio, fim);
    });
  };

  const botao = (rotulo: string, Icone: typeof Bold, aoClicar: () => void) => (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      title={rotulo}
      aria-label={rotulo}
      onMouseDown={(e) => e.preventDefault() /* não roubar a seleção do campo */}
      onClick={aoClicar}
      className="h-8 px-2"
    >
      <Icone className="h-4 w-4" />
    </Button>
  );

  return (
    <div className="rounded-md border border-input">
      <div className="flex items-center gap-1 border-b border-input px-1 py-1">
        {botao("Negrito", Bold, () =>
          aplicar((t, i, f) => envolverSelecao(t, i, f, "**")),
        )}
        {botao("Itálico", Italic, () => aplicar((t, i, f) => envolverSelecao(t, i, f, "*")))}
        {botao("Lista", List, () => aplicar(alternarLista))}
        <span className="ml-auto pr-2 text-[11px] text-muted-foreground">
          **negrito** · *itálico* · “- ” para item
        </span>
      </div>
      <Textarea
        id={id}
        ref={campo}
        rows={rows}
        value={valor}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="resize-y rounded-none border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
      />
    </div>
  );
};

export default EditorTextoRico;
