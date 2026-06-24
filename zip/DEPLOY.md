# Guia de Deploy - PDS UFLA

Este projeto é um aplicativo React com TanStack Start, otimizado para deploy no **Vercel** e **Hostinger**.

## 📋 Pré-requisitos

- Node.js 18+ 
- npm 9+
- Conta Supabase configurada
- Variáveis de ambiente configuradas

## 🚀 Deploy no Vercel

### 1. Preparação

```bash
# Instalar dependências
npm install

# Testar build localmente
npm run build
```

### 2. Conectar ao Vercel

```bash
# Instalar Vercel CLI (se não tiver)
npm i -g vercel

# Deploy
vercel
```

### 3. Configurar Variáveis de Ambiente

No painel do Vercel:
1. Vá para **Settings** → **Environment Variables**
2. Adicione as seguintes variáveis:
   - `VITE_SUPABASE_URL`: URL do seu projeto Supabase
   - `VITE_SUPABASE_ANON_KEY`: Chave anônima do Supabase
   - `NODE_ENV`: production

### 4. Deploy Automático

O Vercel detectará automaticamente o framework e fará deploy a cada push para o repositório Git.

---

## 🌐 Deploy no Hostinger

### 1. Preparação Local

```bash
# Instalar dependências
npm install

# Build para produção
npm run build
```

### 2. Preparar Arquivos para Upload

Após rodar `npm run build`, você terá:
- `.output/public/` - Arquivos estáticos (frontend)
- `.output/server/` - Servidor Node.js (backend)

### 3. Conectar via SSH/FTP

#### Via SSH (Recomendado):

```bash
# Conectar ao servidor
ssh seu_usuario@seu_dominio.com

# Navegar para diretório public_html
cd public_html

# Clonar repositório ou fazer upload dos arquivos
git clone seu_repositorio .
# OU
# Fazer upload via FTP/SCP
```

### 4. Instalar Dependências no Servidor

```bash
# No servidor Hostinger
npm install --production

# Ou com pnpm
pnpm install --production
```

### 5. Configurar Variáveis de Ambiente

Criar arquivo `.env` no diretório raiz:

```env
VITE_SUPABASE_URL=https://seu-projeto.supabase.co
VITE_SUPABASE_ANON_KEY=sua-chave-anon
NODE_ENV=production
```

### 6. Iniciar Aplicação

#### Opção A: Usar PM2 (Recomendado)

```bash
# Instalar PM2 globalmente
npm install -g pm2

# Iniciar aplicação
pm2 start .output/server/index.mjs --name "pds-ufla"

# Salvar configuração
pm2 save

# Configurar para iniciar com o servidor
pm2 startup
```

#### Opção B: Usar Node Diretamente

```bash
node .output/server/index.mjs
```

### 7. Configurar Reverse Proxy (Apache/Nginx)

#### Apache (.htaccess):

O arquivo `.htaccess` já está incluído no projeto. Ele redireciona todas as requisições para o servidor Node.js.

#### Nginx:

Se usar Nginx, adicione ao seu bloco `server`:

```nginx
location / {
    proxy_pass http://localhost:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
}
```

### 8. Configurar SSL/HTTPS

No painel Hostinger:
1. Vá para **SSL/TLS**
2. Ative **Let's Encrypt** (gratuito)
3. Aguarde a ativação

---

## 🔧 Variáveis de Ambiente

Copie `.env.example` para `.env` e preencha com seus valores:

```bash
cp .env.example .env
```

| Variável | Descrição | Exemplo |
|----------|-----------|---------|
| `VITE_SUPABASE_URL` | URL do projeto Supabase | `https://seu-projeto.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Chave pública do Supabase | `eyJhbGc...` |
| `NODE_ENV` | Ambiente de execução | `production` |

---

## 📦 Scripts Disponíveis

```bash
# Desenvolvimento
npm run dev

# Build para produção
npm run build

# Preview do build
npm run preview

# Lint
npm run lint

# Formatação de código
npm run format

# Iniciar servidor (após build)
npm start
```

---

## 🐛 Troubleshooting

### Erro: "Cannot find module"

```bash
# Limpar cache e reinstalar
rm -rf node_modules package-lock.json
npm install
```

### Erro: "Port already in use"

```bash
# Mudar porta (padrão é 3000)
PORT=3001 npm start
```

### Erro: "Supabase connection failed"

- Verificar se as variáveis de ambiente estão corretas
- Verificar se o projeto Supabase está ativo
- Verificar permissões de CORS no Supabase

### Erro: "Build fails on Vercel"

1. Verificar logs no painel Vercel
2. Garantir que `npm run build` funciona localmente
3. Verificar se todas as variáveis de ambiente estão definidas

---

## 📝 Notas Importantes

- ✅ Todas as funcionalidades e visual foram mantidos
- ✅ React é a linguagem predominante
- ✅ Compatível com Vercel e Hostinger
- ✅ Suporta SSR (Server-Side Rendering)
- ✅ Otimizado para performance

---

## 🆘 Suporte

Para problemas ou dúvidas:
1. Verificar documentação do TanStack Start
2. Verificar documentação do Supabase
3. Consultar logs de erro do servidor

---

**Última atualização:** Junho 2026
