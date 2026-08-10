# Verificação de e-mail — o que ficou para depois

> Itens deliberadamente **fora do escopo** das Etapas 0–4 (decisão registrada no
> `email-verification-prompt.md`, seção "Fora do escopo"). Nada aqui está implementado.
> O contexto de como a feature funciona hoje está em `email-verification-notas.md`.
>
> Os dois itens são independentes: dá para fazer um sem o outro, em qualquer ordem.

---

## 1. Reset de senha e troca de e-mail

**O schema já comporta os dois — é o motivo de a coluna `proposito` existir.**

`public.tokens_email` foi desenhada na Etapa 1 com `proposito TEXT NOT NULL CHECK
(proposito IN ('verificacao_email', 'redefinir_senha'))`. O valor `'redefinir_senha'` está
no CHECK desde o primeiro dia e **é recusado de propósito** pela RPC de cunhagem, que
levanta `PT400` para qualquer propósito que não seja `verificacao_email`. Ou seja: a tabela
aceita, a função barra. Implementar é tirar a trava, não criar uma camada nova.

### O que reaproveita sem tocar

- A tabela e o índice `idx_tokens_email_user (user_id, proposito, created_at DESC)` — o
  índice já é composto **com o propósito**, então o throttle de 60 s funciona por propósito
  separadamente (pedir reset não bloqueia reenvio de confirmação, e vice-versa).
- O hash sha256, a expiração e o `used_at` (uso único registrado, não deletado).
- A Edge Function `enviar-email` — o corpo já recebe `{ proposito }`; hoje ela recusa
  qualquer valor diferente de `verificacao_email` **antes** de chamar a RPC.
- `message_id` para rastrear o e-mail que a pessoa jura não ter recebido.

### O que precisa ser feito

| Camada | Trabalho |
|---|---|
| SQL | `criar_token_email` passa a aceitar `'redefinir_senha'`. RPC de consumo **separada** (`redefinir_senha(p_token, p_nova_senha)`) — não reusar `confirmar_email`, que confirma o e-mail e nada mais |
| SQL | A troca de senha em si: `auth.users.encrypted_password` com `crypt(nova, gen_salt('bf'))`. **Validar o custo do bcrypt contra o que o GoTrue usa**, senão o login quebra |
| SQL | Expiração mais curta que 24 h (30 min é o usual para reset) e **invalidar as sessões ativas** ao trocar a senha, senão quem roubou a sessão continua dentro |
| Function | Liberar `redefinir_senha` na allowlist de propósitos + template de e-mail próprio |
| SPA | Rota pública `/redefinir-senha` (mesma disciplina de `/confirmar-email`: token sai da URL no mount, consumo só no clique) + o pedido em `/login` |
| Rotas | As 3 edições de sempre: `App.tsx`, `pageTitles.ts` (ordem importa), `robots.txt` + os 4 configs de deploy |

### Armadilhas específicas deste fluxo

- **Pedido de reset é anônimo** — ao contrário do reenvio de confirmação, que exige sessão
  (decisão 5 do prompt). Isso reabre a enumeração de contas e o spam por e-mail, que o
  desenho atual evitava **por construção**. Precisa de rate limit por IP e por e-mail alvo,
  no mesmo padrão de `liberar_email_nao_confirmado` (migration `20260809000000`), e de
  resposta **uniforme** — "se existir conta, enviamos" — para não confirmar endereços.
- **Reset em conta não confirmada**: decidir explicitamente. O caminho coerente com a
  postura atual é que redefinir a senha **não** confirma o e-mail (são posses diferentes:
  uma prova acesso à caixa, a outra também… na verdade prova a mesma coisa). Vale
  reconsiderar: quem clica num link enviado à caixa provou posse, e confirmar junto
  eliminaria um passo. Decisão de produto, não de segurança.
- **Troca de e-mail** é mais delicada que reset: exige token para o endereço NOVO **e**
  aviso ao antigo, senão vira sequestro de conta silencioso. E o `handle_new_user` deriva
  o papel do domínio do e-mail — trocar de `@estudante.ufla.br` para `@gmail.com` deveria
  mudar o papel? Quase certamente **não** automaticamente. Definir antes de codar.

---

## 2. Fila/outbox e retries automáticos de envio

**Hoje:** o envio é síncrono dentro da Edge Function. Se o Brevo falhar, a function
devolve 502 `falha_envio`, a conta **continua criada** (o envio está fora da transação de
cadastro, por desenho — §6 do blueprint) e o botão de reenvio da `/verifique-email` é o
mecanismo de recuperação. Quem recupera é o usuário, manualmente.

Isso foi testado duas vezes e funcionou: com a chave revogada de propósito, e por acidente
durante dias com a chave SMTP no lugar da chave da API (§6c das notas).

**O que uma outbox acrescentaria:** recuperação sem depender de o usuário clicar de novo.
Uma tabela `emails_pendentes` (ou uma coluna de estado em `tokens_email`), um worker
periódico e retry com backoff.

### Por que ainda não vale

- O modo de falha real observado **não é transitório** — foi configuração errada. Retry
  automático não conserta chave inválida; só transforma uma falha visível em 300 tentativas
  silenciosas, e ainda queima a cota diária do Brevo.
- Não há worker agendado no projeto hoje. Introduzir um significa pg_cron ou um agendador
  externo, e mais uma peça para monitorar.
- O botão de reenvio já cobre o caso do usuário presente. O caso que ele não cobre é o da
  pessoa que fechou a aba e não voltou — que também não é resolvido por retry, e sim por
  um lembrete agendado, que é outra feature.

### Se for feito um dia, o mínimo honesto

- Estado por tentativa (`pendente | enviado | falhou`), com contador e último erro.
- Backoff exponencial e **teto de tentativas**, para não consumir a cota de 300/dia.
- **Circuit breaker por erro de autenticação**: `401` do provedor deve parar a fila e
  alertar, não repetir — foi exatamente o modo de falha que aconteceu de verdade.
- Métrica visível: quantos `tokens_email` estão com `message_id IS NULL`. É o sinal precoce
  de envio quebrado, e hoje ninguém o observa automaticamente (§8 das notas).
