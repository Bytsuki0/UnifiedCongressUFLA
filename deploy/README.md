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
| Netlify / Cloudflare Pages | [`public/_redirects`](../public/_redirects) e [`public/_headers`](../public/_headers) | nada, o Vite copia para `dist/` |
| nginx | [`nginx.conf.example`](./nginx.conf.example) | copiar para `sites-available`, ajustar `server_name` e `root` |
| Apache | [`apache.htaccess.example`](./apache.htaccess.example) | renomear para `.htaccess` na raiz publicada; exige `AllowOverride All` e `mod_rewrite` |

Os arquivos de Vercel/Netlify/Cloudflare convivem sem conflito: cada
plataforma ignora os das outras.

## Indexação

`public/robots.txt` pede aos robôs que não visitem as áreas logadas.
Isso **não** impede a indexação da URL em si — o bloqueio de verdade é o
cabeçalho `X-Robots-Tag: noindex`, já configurado nos quatro arquivos
acima. Como a aplicação é client-side, não há como emitir
`<meta name="robots">` por rota; o cabeçalho HTTP é o caminho correto.

## Variáveis de ambiente

Só as `VITE_*` são embutidas no bundle e, portanto, **públicas**:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_SUPABASE_PDF_BUCKET` (opcional, padrão `Pdfs`)

`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ACCESS_TOKEN` e a senha do banco
são segredos de linha de comando (migrações, scripts) e **nunca** devem
entrar no `.env` do build nem nas variáveis da hospedagem.
