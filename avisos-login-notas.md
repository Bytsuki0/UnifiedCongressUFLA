# Avisos de Login — notas da feature

Migration `20260908120000_avisos_login.sql`. Escrita em 2026-09-08.

> **Estado: APLICADA em produção (2026-09-08).** A primeira tentativa falhou no
> canário da própria migration — que é o que ele existe para fazer; a segunda,
> com a correção, passou. Conferido **ao vivo** com a chave pública: a tabela e
> as duas funções existem e devolvem `42501 permission denied` para `anon`. Ver
> [A primeira tentativa](#a-primeira-tentativa-e-o-que-ela-pegou).
> Falta só `npm run gen:types` — ver [O que falta](#o-que-falta-antes-de-publicar).

---

## O que é

A organização passou a poder **falar com quem entra no sistema**, no instante
em que entra.

Até aqui todos os canais de comunicação eram passivos: o cronograma, os
templates, os anais — telas que a pessoa precisava **procurar**. Não havia como
dizer "a prorrogação saiu" ou "o formulário de parecer mudou" a quem acabou de
fazer login. Agora existe uma lista de **avisos**, cada um endereçado a um
conjunto de **papéis**, que aparecem em diálogo logo depois da entrada de quem
tem um daqueles papéis.

Duas formas de conteúdo, **exclusivas entre si**:

| Forma | O que é | Onde mora |
|---|---|---|
| **Texto** | Mensagem escrita, com negrito, itálico e listas | Coluna `corpo`, como texto |
| **Banner** | Uma imagem (cartaz, arte de divulgação) | Bucket privado `avisos`, servida por URL assinada |

A organização cadastra, edita e exclui em **`/co-chairs/avisos`**. Enquanto o
aviso existir, ele reaparece a cada novo login dos papéis marcados; **excluir é
o que faz o pop-up parar**.

Quem recebe vê o aviso em **dois lugares**:

| Onde | O que mostra | Quando |
|---|---|---|
| Pop-up | Um aviso por vez, os ainda **não fechados nesta aba** | Logo depois do login |
| Aba **Notificações** (barra superior) | **Todos** os avisos do seu perfil, inclusive os já fechados | Quando a pessoa quiser |

A aba existe porque o pop-up é efêmero: quem fechava o aviso (ou apertava Esc
sem querer) não tinha como voltar a ele até o login seguinte — e um recado que
diz "o prazo agora é dia 20" precisa poder ser relido.

---

## Como funciona

```
  CO-CHAIR                          BANCO                        QUEM ENTRA
  ────────                          ─────                        ──────────
  /co-chairs/avisos
   ├ escolhe a forma           →   INSERT em `avisos`
   │  (texto | banner)              tipo, titulo, corpo|imagem,
   ├ escreve/envia a imagem          papeis[], ordem
   └ marca os papéis                       │
     que devem receber                     │
                                           ▼
                              (banner) upload no bucket
                               privado `avisos`, path
                               `<uid>/<timestamp>-nome.png`
                                           │
                                           ▼
                                                              login concluído
                                                                    │
                                    meus_avisos()   ←─────── AvisosLogin monta
                                          │                   com a sessão
                                          │
                          papeis_efetivos() lê `user_roles`
                          da conta que chamou (fallback:
                          conta sem papel vale como `externo`)
                                          │
                             WHERE avisos.papeis && papeis_efetivos()
                             ORDER BY ordem, criado_em
                                          │
                                          ▼
                                                          diálogo, um por vez
                                                          ("Entendi (faltam 2)")
                                                                    │
                                                          (banner) assina a URL
                                                           só na vez dele
                                                                    │
                                                          fecha → sessionStorage
                                                          marca "visto nesta aba"
```

**O endereçamento é decidido no servidor.** O cliente não filtra nada: ele
pede `meus_avisos()` e mostra o que voltar.

---

## Modelo de dados

### Tabela `public.avisos`

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | `UUID` | PK, `gen_random_uuid()` |
| `tipo` | `TEXT` | `'texto'` ou `'banner'`. **Imutável depois de criado** |
| `titulo` | `TEXT` | Cabeçalho do diálogo. Obrigatório nos dois tipos |
| `corpo` | `TEXT` | Marcação leve. Vazio quando `tipo = 'banner'` |
| `imagem` | `TEXT` | Caminho no bucket. Vazio quando `tipo = 'texto'` |
| `papeis` | `TEXT[]` | Quem recebe. Pelo menos um, e só os cinco do sistema |
| `ordem` | `INTEGER` | Ordem da fila quando mais de um aviso alcança a pessoa |
| `criado_em` | `TIMESTAMPTZ` | `now()` |
| `criado_por` | `UUID` | `DEFAULT auth.uid()` — carimbado pelo banco, nunca pelo cliente |

**Dois CHECK, e os dois são a trava de verdade** (a tela também confere, para
dar a frase certa):

- `avisos_conteudo_check` — texto exige `corpo` e proíbe `imagem`; banner exige
  `imagem` e proíbe `corpo`. Não existe aviso com os dois.
- `avisos_papeis_check` — pelo menos um papel, e só dentro de
  `{estudante, externo, professor, avaliador, admin}`. O `<@` sozinho não
  bastaria: array vazio é subconjunto de qualquer coisa e passaria.

Índices: `avisos_ordem_idx (ordem, criado_em)` e `avisos_papeis_idx` **GIN**
sobre `papeis` — o operador de sobreposição é o único predicado da leitura, e
ela roda em todo login.

### Funções

**`public.papeis_efetivos() → text[]`** (STABLE, SECURITY DEFINER)

Os papéis reais da conta logada, lidos de `user_roles`, com **o mesmo fallback
do frontend**: conta sem linha nenhuma vale como `externo`, exatamente como
`resolveMyRole` no `AuthContext` ("sem papel resolvido, assume o menor
privilégio"). Sem sessão devolve `{}`.

**`public.meus_avisos() → TABLE(id, tipo, titulo, corpo, imagem)`** (STABLE,
SECURITY DEFINER)

Os avisos endereçados a quem chamou, em `ORDER BY ordem, criado_em`. **Não
devolve `papeis`**: o destinatário não tem o que fazer com a lista de quem mais
recebeu o mesmo recado.

### Bucket `avisos`

Privado, 5 MB, `allowed_mime_types` restrito a `image/png`, `image/jpeg`,
`image/webp` e `image/gif`. Quatro policies em `storage.objects`: leitura para
qualquer `authenticated`, escrita/alteração/remoção só para `is_event_staff()`.

O que se grava na coluna `imagem` é o **caminho**, nunca uma URL — o bucket é
privado e a assinatura expira.

---

## Autorização

| Quem | Pode |
|---|---|
| `anon` | **Nada.** `REVOKE ALL ON public.avisos FROM anon`, e `meus_avisos()` não tem GRANT para `anon` |
| `authenticated` comum | Ler **só os seus** avisos, pela RPC. Ler a imagem do bucket |
| `is_event_staff()` (avaliador/admin) | SELECT/INSERT/UPDATE/DELETE na tabela e no bucket |

**A policy de SELECT da tabela é só da organização**, e isso é deliberado: quem
entra lê pela RPC, que já recorta. Abrir o SELECT da tabela para todo
autenticado deixaria qualquer conta listar os avisos dos outros papéis —
inclusive um recado interno dirigido só a `admin`.

O `REVOKE ALL … FROM anon` **não é redundante com o RLS**: o projeto tem
`ALTER DEFAULT PRIVILEGES` concedendo tudo a `anon`, então sem ele o dia em que
alguém acrescentar uma policy `USING (true)` sem pensar abre a tabela inteira.
Mesmo desenho de `arquivos_download`, `cronograma_eventos`, `anais` e
`pitches_historico`.

A escrita é de `is_event_staff()` e não do admin porque **a tela mora em
`/co-chairs`** — é o mesmo critério que colocou `arquivos_download` sob o admin
(a tela dele fica em `/admin/configuracoes`).

---

## A marcação do aviso de texto

O corpo é **texto puro com marcação leve**, e é convertido numa árvore de blocos
que o React percorre montando elementos. **Não há HTML em ponto nenhum do
caminho.**

| Escreve | Vira |
|---|---|
| `**assim**` | **negrito** |
| `*assim*` | *itálico* |
| `**muito *urgente* mesmo**` | negrito com itálico dentro |
| `- item` no começo da linha | item de lista |
| linha em branco | separa parágrafos |
| linhas seguidas | **um** parágrafo com quebras dentro |

Regras de tolerância, para o texto não sair torto sem explicação:

- **Marcador sem par é texto literal.** `multiplique 5 * 3 = 15` sai como está;
  sem essa regra o asterisco solto italizaria toda a metade direita do aviso.
- **`-` sozinho não abre lista** — é um travessão que alguém digitou.

A barra de ferramentas (**B**, *I*, lista) escreve esses mesmos marcadores no
campo. Clicar de novo com a seleção já marcada **desmarca**, em vez de empilhar
(`****assim****` seria lido como asteriscos literais). O botão de lista opera em
**linhas inteiras**, mesmo com meia linha selecionada.

---

## Como a organização usa

1. **`/co-chairs/avisos`** (ou o cartão "Avisos de Login" no Painel de
   Controle).
2. Dois botões de criação: **"Aviso de texto"** e **"Aviso com banner"**. A
   forma é escolhida aqui e **não muda depois**.
3. No diálogo: **título** (obrigatório, é o cabeçalho da janela), **quem
   recebe** (uma ou mais das cinco caixas) e o conteúdo.
   - Texto: o editor com a barra, e logo abaixo a **pré-visualização** — "como
     o destinatário vai ver". Ver o resultado é a única conferência que vale.
   - Banner: o seletor de arquivo, com pré-visualização da imagem escolhida.
4. **Publicar aviso.** A partir daí ele aparece no login de quem tem os papéis
   marcados.
5. Para **parar** de exibir: **excluir**. Não existe "desligar" — a confirmação
   diz exatamente de quais papéis o aviso vai sumir.

> **Estudantes e participantes externos são papéis diferentes**, mesmo usando o
> mesmo portal. Para falar com todos os autores, marque os dois.

---

## Decisões de projeto, e por quê

### Não existe "cadastrado mas desligado"

Existir é estar no ar; tirar do ar é **excluir**. É a mesma escolha do
cronograma (`20260903120000`), pelo mesmo motivo: um segundo estado ("existe mas
não aparece") é um estado que nenhuma outra tela conhece, e que se descobre
tarde — o aviso some para o usuário e continua na lista de quem publica.

### Não existe registro de "quem já leu"

O aviso reaparece a cada login **de propósito** — é um recado da organização,
não uma caixa de entrada. Uma tabela de leitura seria uma linha por usuário por
aviso, cresceria com o congresso inteiro e teria de ser limpa junto com as
contas (ver `npm run purge:contas`).

O "já vi este", que evita o diálogo reabrir a cada F5 e a cada clique no
"voltar", é do **navegador**: `sessionStorage`, chave `nexus_avisos_vistos_<uid>`.
Vale enquanto a aba viver e morre com ela — que é aproximadamente o ciclo de uma
sessão de trabalho. A chave leva o id do usuário porque duas contas podem entrar
na mesma aba; sem isso, quem entrasse depois herdaria os avisos "já vistos" de
quem saiu.

### O endereçamento é do servidor, contra o conjunto INTEIRO de papéis

`meus_avisos()` compara com `papeis_efetivos()`, que lê `user_roles`. O papel
que o `AuthContext` guarda é **um só** (o de maior privilégio, por
`ROLE_PRIORITY`) — mandá-lo no request faria um professor que também é avaliador
perder o aviso dos professores. Mesma regra de `confirmar_distribuicao` e
`aplicar_anexos`: atributo de autorização nunca vem do corpo do request.

### Texto guardado como texto, nunca como HTML

⚠ **Esta é a decisão mais séria da feature.** O aviso é o único texto do sistema
escrito por uma pessoa que aparece no navegador de **todas as outras** sem que
ninguém tenha clicado em nada. Guardar HTML e injetá-lo com
`dangerouslySetInnerHTML` transformaria uma conta de co-chair comprometida num
`<script>` na tela do congresso inteiro.

Por isso:

- `blocosDoTexto` (`src/lib/avisos.ts`) devolve uma **árvore de dados**;
- `TextoRico` monta `<strong>`/`<em>`/`<li>` a partir dela;
- o editor é um `<textarea>` comum, **não** um `contentEditable` — este último
  traria junto a árvore do navegador, incluindo HTML colado de outro site.

O pior que um texto malicioso consegue por esse caminho é ficar em negrito.

### Dois botões de criação, nunca um seletor de tipo

Mesma convenção dos anexos por categoria e do painel de downloads: **num
seletor, escolher errado é o padrão.** E, como lá, o `tipo` não é editável
depois — trocar um banner para texto deixaria a imagem pendurada no bucket sem
nada apontando para ela (o blob não sai por SQL).

### O bucket é privado, como todos os outros

Um bucket público seria um endereço eterno e adivinhável para um cartaz que a
organização pode querer tirar do ar. `allowed_mime_types` é a trava de verdade
contra subir um HTML ou um SVG (que carrega script) fazendo-se passar por
imagem — o `accept` do `<input type="file">` é sugestão de interface, não recusa.

### Políticas de erro opostas nas duas leituras

| Função | Falha de rede | Por quê |
|---|---|---|
| `carregarMeusAvisos()` | devolve **lista vazia** | Um aviso é cortesia; uma consulta que não respondeu não pode segurar a entrada de ninguém no portal |
| `listarAvisos()` | **propaga o erro** | Quem publica não pode receber lista vazia e concluir que não há nada no ar |

Mesma dupla de `carregarArquivosDownload` / `listarArquivosDownload`, e o oposto
do prazo de submissão, que falha **aberto** porque lá quem recusa de verdade é o
banco.

### Limpeza do Storage

- **`removerAviso` lê o caminho da imagem ANTES do DELETE** e o devolve, como
  `excluirTrabalho`: depois a linha não existe mais e não haveria como saber o
  que apagar.
- **Upload aceito com gravação recusada é limpo na hora** — mesma regra de
  `prepararAnexos`: uma recusa da RLS não pode deixar arquivo pago no bucket a
  cada tentativa.
- **A imagem substituída só sai depois do UPDATE passar** — apagar antes e ver a
  gravação falhar deixaria o aviso apontando para um arquivo que já não existe.

### A aba Notificações e o pop-up dividem UM estado

`AvisosContext` é a fonte única dos dois. O contexto não é exagero aqui — são
dois componentes em pontos distantes da árvore (o diálogo na raiz do `App`, o
sino dentro de cada Layout), e sem ele haveria:

1. **duas requisições** idênticas a `meus_avisos()` por carregamento de página;
2. pior, **dois estados em memória** — fechar o pop-up não mexeria no contador
   do sino até o outro componente renderizar de novo. Os dois leriam o mesmo
   `sessionStorage`, mas em momentos diferentes, e o contador ficaria mentindo.

O contador conta os **pendentes**, nunca o total: um badge com o total ficaria
permanentemente aceso, e um número que nunca muda deixa de ser lido. E a aba
inteira **some** quando não há aviso nenhum para o papel — um sino que nunca tem
nada é enfeite fixo na barra.

⚠ A aba mostra **todos** os avisos, e não só os pendentes. Se mostrasse só os
pendentes seria uma segunda cópia do pop-up e não resolveria nada — reler
continuaria impossível, que é o problema de origem. Há teste preso nisso
(`src/test/botaoNotificacoes.test.tsx`).

⚠ **Não confundir com as outras "Notificações" do sistema**: a seção
`/admin/notificacoes` lista submissões recentes para a organização, e a tabela
`notifications` pertence ao `/congresso` (congelado, consumida só por
`components/event/NotificationsBell.tsx`). A aba da barra mostra **avisos**.

### O pop-up é montado uma vez, na raiz

`<AvisosLogin />` fica no `App.tsx`, não dentro de cada Layout: nos cinco
portais seria o mesmo diálogo, e ele reabriria a cada troca de tela. Ele se cala
sozinho quando não há papel resolvido, e quem tem `emailConfirmado === false`
(preso em `/verifique-email`) também não recebe — `null` **não** bloqueia, como
em toda parte no projeto.

---

## O que mudou

### Arquivos novos (9)

| Arquivo | Linhas | O que é |
|---|---:|---|
| `supabase/migrations/20260908120000_avisos_login.sql` | 326 | Tabela, 2 funções, RLS, bucket + policies, 6 conferências |
| `src/lib/avisos.ts` | 295 | Papéis e rótulos, parser da marcação, edições da barra — tudo puro |
| `src/services/avisosService.ts` | 199 | RPC, CRUD da tabela, upload/descarte/assinatura do banner |
| `src/components/TextoRico.tsx` | 66 | Renderiza a árvore de blocos. Sem `dangerouslySetInnerHTML` |
| `src/components/EditorTextoRico.tsx` | 93 | `<textarea>` + barra B / I / lista |
| `src/components/AvisosLogin.tsx` | 161 | O diálogo do login, com a fila e o `sessionStorage` |
| `src/pages/co-chairs/Avisos.tsx` | 492 | Tela de gestão: lista, editor em diálogo, exclusão confirmada |
| `src/contexts/AvisosContext.tsx` | 140 | Fonte única da lista e do "já vi este" — pop-up e aba dividem |
| `src/components/CorpoDoAviso.tsx` | 66 | Texto ou banner assinado; componente único das duas telas |
| `src/components/BotaoNotificacoes.tsx` | 92 | A aba "Notificações" da barra superior |
| `src/test/avisos.test.ts` | 229 | 21 testes: marcação, barra, políticas de erro |
| `src/test/botaoNotificacoes.test.tsx` | 96 | 5 testes: a aba lista tudo, o contador conta só pendentes |
| `avisos-login-notas.md` | — | Este documento |

### Arquivos alterados (5)

| Arquivo | Mudança |
|---|---|
| `src/App.tsx` | Import da tela + `<Route path="avisos">` em `/co-chairs`; monta `<AvisosLogin />` ao lado de `<DocumentTitle />` |
| `src/components/co-chairs/Layout.tsx` | Item "Avisos de Login" no menu lateral (com `title`, exigido pelo modo recolhido) |
| `src/pages/co-chairs/Index.tsx` | Cartão "Avisos de Login" na lista `SECOES` do Painel de Controle |
| `src/lib/pageTitles.ts` | `["/co-chairs/avisos", "Avisos de login"]` |
| `src/integrations/supabase/types.ts` | Tabela `avisos` + RPCs `meus_avisos` e `papeis_efetivos`, **escritos à mão** (ver abaixo) |
| `src/components/estudante/Layout.tsx`, `revisor/Layout.tsx`, `co-chairs/Layout.tsx`, `src/pages/AdminPortal.tsx` | `<BotaoNotificacoes />` na barra superior, ao lado do nome — os mesmos 4 pontos onde vive o `<BotaoSuporte />` |
| `src/index.css` | `.link-notificacoes` entra nos seletores da pílula `.link-suporte` (uma regra, dois botões) + o contador |

`CLAUDE.md` também ganhou a seção "Invariantes dos avisos de login", mas ele é
gitignored (`.gitignore:33`) e não aparece no diff.

**Não foi preciso mexer** em `public/robots.txt` nem nos configs de deploy: a
rota nova cai sob o `Disallow: /co-chairs` e o `X-Robots-Tag` de `/co-chairs/*`
que já existem.

> ⚠ `src/components/AnexosDoTrabalho.tsx` e `src/index.css` aparecem como
> modificados no `git status`, mas **já estavam assim antes desta feature** —
> não fazem parte destas mudanças.

### Rotas e endpoints novos

| | |
|---|---|
| Rota | `/co-chairs/avisos` (`avaliador`, `admin`) |
| RPCs | `meus_avisos()`, `papeis_efetivos()` |
| Tabela | `public.avisos` |
| Bucket | `avisos` (privado) |

---

## Verificação

Bateria completa, na ordem do `CLAUDE.md`, com a migration ainda **fora** do
banco:

| Comando | Resultado |
|---|---|
| `npm run lint` | 0 erros, **10** warnings — a baseline subiu de 9 para 10: `AvisosContext` exporta provider + hook, exatamente como `AuthContext`. CLAUDE.md atualizado |
| `npm run test` | **317 testes, 25 arquivos** — todos passam (26 novos) |
| `npx tsc --noEmit -p tsconfig.app.json` | limpo |
| `npm run build` | ok |
| `npm run check:consolidacao` | ok — o acesso ao Supabase só pelos services |
| `npm run check:seguranca` | as 5 travas passam **limpas** e **detectam o canário** |

A migration também se confere sozinha: o bloco `DO` final quebra se `anon`
ganhar privilégio na tabela, se `authenticated` perder o `EXECUTE` da RPC, se o
bucket deixar de ser privado, ou se qualquer um dos três canários de CHECK
(aviso de texto sem corpo, aviso sem papel, papel fora da lista) passar a ser
aceito.

**O que a bateria NÃO cobre:** nada disso roda SQL contra o banco. O
`meus_avisos()` com JWT real — um professor+avaliador recebendo os dois avisos,
uma conta sem papel recebendo o de `externo` — só se prova com o ensaio descrito
em CLAUDE.md ("Como provar mudança de servidor"). Foi justamente no primeiro
contato com o banco que apareceu o defeito abaixo.

### A primeira tentativa, e o que ela pegou

`npm run migrate`, 2026-09-08:

```
Applying 20260908120000_avisos_login.sql ... ✗
Migration failed: ERROR: P0001: anon não pode executar meus_avisos()
```

**A migration se recusou a entrar, e estava certa.** O defeito era real:

```sql
REVOKE ALL ON FUNCTION public.meus_avisos() FROM PUBLIC;   -- não bastava
```

O projeto tem `ALTER DEFAULT PRIVILEGES` concedendo tudo a `anon`, então **toda
função nova nasce com um GRANT direto para esse papel** — e revogar de `PUBLIC`
não remove grant direto. As duas funções ficavam executáveis sem sessão.

Eu havia documentado exatamente essa armadilha para a **tabela**
(`REVOKE ALL ON public.avisos FROM anon`, com o comentário explicando que não é
redundante com o RLS) e não a apliquei às **funções**. O precedente já existia no
repositório desde `20260806140000`, onde `email_confirmado()` revoga das duas
pontas.

Correção: `REVOKE ALL ON FUNCTION … FROM anon` nas duas funções, mais um segundo
canário cobrindo `papeis_efetivos()` — a primeira versão só conferia
`meus_avisos()`.

O impacto real seria pequeno (o predicado de `meus_avisos()` já devolve vazio
sem `auth.uid()`, porque `papeis_efetivos()` devolve `{}`), mas uma RPC
alcançável por `anon` é superfície que não precisa existir. O que importa aqui é
o método: **a conferência dentro da própria migration é o que transformou um
erro de privilégio numa migration que não entra**, em vez de numa função aberta
que ninguém notaria por meses. É a mesma lógica da suíte de segurança em dois
sentidos.

---

## O que falta antes de publicar

1. ~~`npm run migrate`~~ — **feito** em 2026-09-08, na segunda tentativa.
   Conferido ao vivo: `avisos`, `meus_avisos()` e `papeis_efetivos()` existem e
   respondem `42501 permission denied` a `anon` (o controle: objeto inexistente
   devolveria `PGRST205`/`PGRST202`, "Could not find").
2. **`npm run gen:types`** — ⬅ **é o passo pendente.** Regenera `src/integrations/supabase/types.ts` do
   schema vivo.
   ⚠ As entradas de `avisos`, `meus_avisos` e `papeis_efetivos` foram
   **escritas à mão** nesse arquivo para o `tsc` passar com a migration ainda
   pendente. Rodar `gen:types` **antes** do `migrate` apaga essas entradas e
   quebra o build; rodar **depois** é o correto e as substitui pelo schema real.
3. Ensaio do endereçamento com JWT real (opcional, mas é o que prova o `&&`).
4. `npm run deploy`.

---

## Operação

**Quantos avisos estão no ar, e para quem:**

```sql
SELECT titulo, tipo, papeis, ordem, criado_em
  FROM public.avisos
 ORDER BY ordem, criado_em;
```

**Um usuário não está vendo o aviso que deveria** — comece pelos papéis dele,
que é quase sempre a causa:

```sql
SELECT role FROM public.user_roles WHERE user_id = '<uuid>';
```

Conta **sem nenhuma linha** aqui vale como `externo` (é o fallback de
`papeis_efetivos()`), então só recebe avisos marcados para externos. Se os
papéis estão certos, o suspeito seguinte é o `sessionStorage`: o aviso já foi
fechado **naquela aba**. Fechar e reabrir a aba (ou entrar numa janela anônima)
o traz de volta.

**Banners órfãos no bucket** (arquivo sem aviso apontando para ele) — acontece
se uma exclusão falhar no meio:

```sql
SELECT name FROM storage.objects
 WHERE bucket_id = 'avisos'
   AND name NOT IN (SELECT imagem FROM public.avisos WHERE imagem <> '');
```

---

## Onde ler mais

- **Invariantes resumidos**: `CLAUDE.md`, seção "Invariantes dos avisos de
  login".
- **Comentários no código**: a migration e cada arquivo novo carregam o porquê
  das decisões no cabeçalho — é a convenção do projeto, e é onde o raciocínio
  está mais perto de quem vai mexer.
- **Features de desenho parecido**, na ordem em que o padrão foi se formando:
  `arquivos_download` (20260830120000), cronograma (20260903120000), anais e
  pitches (20260907120000).
