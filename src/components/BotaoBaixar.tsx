import type { ReactNode } from "react";

/**
 * Botão de download de um arquivo hospedado no Drive da organização.
 *
 * Sem link cadastrado o botão fica desabilitado em vez de sumir: some e
 * o usuário não sabe que o modelo existe; desabilitado com o motivo no
 * `title` ele sabe que falta a organização publicar. É o mesmo botão em
 * quatro telas com CSS diferente, então a classe vem de fora — o que se
 * compartilha aqui é a regra do link vazio, não a aparência.
 */
export function BotaoBaixar({
  url,
  className,
  children,
}: {
  url: string;
  className: string;
  children: ReactNode;
}) {
  if (!url) {
    return (
      <button className={className} disabled title="Link ainda não configurado pela organização.">
        {children}
      </button>
    );
  }

  // Aba nova + noopener: o destino é externo (Drive) e não deve poder
  // mexer na janela que o abriu.
  return (
    <a className={className} href={url} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}
