# Publicação

`npm run build` gera `dist/`. Publique **o conteúdo de `dist/`**, e não a
raiz do repositório.

> Use `npm run build`, nunca `npm run build:dev`. O segundo compila em
> modo development (`import.meta.env.DEV = true`) e pula otimizações.
> Nenhum dos dois emite source maps — `build.sourcemap` é `false` por
> padrão no Vite e não foi alterado.

## A regra que não pode faltar

A aplicação é client-side (React Router). O servidor precisa entregar o
`index.html` para **qualquer** rota que não corresponda a um arquivo
real, mantendo a URL. Sem isso, tudo funciona ao navegar pelos links,
mas **recarregar a página (F5) em `/estudante/historico` devolve 404** —
e o mesmo vale para qualquer link colado direto na barra de endereços.

Escolha o arquivo conforme a hospedagem — todos já estão prontos:

| Hospedagem | Arquivo | Precisa fazer |
|---|---|---|
| Vercel | [`vercel.json`](../vercel.json) (raiz) | nada, é detectado sozinho |
| Cloudflare Workers (**atual**) | [`wrangler.jsonc`](../wrangler.jsonc) + [`public/_headers`](../public/_headers) | nada: `npm run deploy` publica e o fallback de SPA vem de `assets.not_found_handling` |
| nginx | [`nginx.conf.example`](./nginx.conf.example) | copiar para `sites-available`, ajustar `server_name` e `root` |
| Apache | [`apache.htaccess.example`](./apache.htaccess.example) | renomear para `.htaccess` na raiz publicada; exige `AllowOverride All` e `mod_rewrite` |

A hospedagem em uso é a **Cloudflare Workers** (`npm run deploy`, ver o README
da raiz). As linhas restantes são alternativas; os arquivos convivem sem
conflito, porque cada plataforma ignora os das outras.

> `public/_redirects` **não existe mais**: a regra catch-all `/* /index.html 200`
> é rejeitada pela API da Cloudflare ("infinite loop detected").

## Indexação

`public/robots.txt` pede aos robôs que não visitem as áreas logadas.
Isso **não** impede a indexação da URL em si — o bloqueio de verdade é o
cabeçalho `X-Robots-Tag: noindex`, configurado em `public/_headers` (é ele
que vale no deploy atual, em Workers), em `vercel.json` e nos dois exemplos de
servidor. Como a aplicação é client-side, não há como emitir
`<meta name="robots">` por rota; o cabeçalho HTTP é o caminho correto.

## Variáveis de ambiente

Só as `VITE_*` são embutidas no bundle e, portanto, **públicas**:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_SUPABASE_PDF_BUCKET` (opcional, padrão `Pdfs`)

`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ACCESS_TOKEN` e a senha do banco
são segredos de linha de comando (migrações, scripts) e **nunca** devem
entrar no `.env` do build nem nas variáveis da hospedagem.
