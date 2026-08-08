#!/usr/bin/env node
/**
 * Etapa 2 do plano de deploy — trava da consolidação de acesso ao Supabase.
 *
 * Regra: nenhuma página ou componente fala com o Supabase direto. Consulta
 * e RPC vivem em src/services/*.ts; o cliente e os helpers de Storage
 * vivem em src/lib e src/integrations. Isso é o que torna a Fase 2 (sair
 * do Supabase) uma mudança numa pasta em vez de uma reescrita, e é o que
 * mantém a auditoria da Etapa 4 possível — dá para ler todas as consultas
 * num lugar só.
 *
 * Por que não basta `grep supabase.from(`: o padrão `const sb = supabase`
 * é comum no portal do evento e esconde as chamadas de qualquer grep que
 * procure só pelo identificador `supabase`. A verificação do plano
 * original passaria com dezenas de chamadas fora da camada de serviço.
 * Aqui a busca é pelo ALIAS de fato importado em cada arquivo.
 *
 * Uso:
 *   npm run check:consolidacao
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(__dirname, "..", "src");

/** Onde falar com o Supabase é legítimo. */
const PERMITIDOS = [
  path.join("src", "services"),
  path.join("src", "lib"),
  path.join("src", "integrations"),
  path.join("src", "contexts"), // AuthContext: sessão é responsabilidade dele
];

/** Métodos de acesso a DADOS. `auth` fica de fora: é sessão, não consulta. */
const METODOS = ["from", "storage", "rpc", "channel"];

const arquivos = [];
(function varrer(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const completo = path.join(dir, item.name);
    if (item.isDirectory()) varrer(completo);
    else if (/\.(ts|tsx)$/.test(item.name) && !/\.d\.ts$/.test(item.name)) {
      arquivos.push(completo);
    }
  }
})(RAIZ);

const violacoes = [];

for (const arquivo of arquivos) {
  const relativo = path.relative(path.join(__dirname, ".."), arquivo);
  if (PERMITIDOS.some((p) => relativo.startsWith(p))) continue;

  const conteudo = fs.readFileSync(arquivo, "utf8");

  // Sob que nome o cliente entrou neste arquivo?
  const importado = conteudo.match(
    /import\s*\{[^}]*\bsupabase\b[^}]*\}\s*from\s*["']@\/integrations\/supabase\/client["']/,
  );
  if (!importado) continue;

  // Aliases locais: const sb = supabase;
  const nomes = new Set(["supabase"]);
  for (const m of conteudo.matchAll(/(?:const|let)\s+(\w+)\s*=\s*supabase\s*;/g)) {
    nomes.add(m[1]);
  }

  // A busca é no arquivo inteiro, não linha a linha: o encadeamento do
  // supabase-js quebra em várias linhas com frequência
  //   const { data } = await sb
  //     .from("minicourses")
  // e um casamento por linha não enxerga isso — foi assim que 4 chamadas
  // passaram batido na primeira versão desta trava.
  for (const nome of nomes) {
    const padrao = new RegExp(`\\b${nome}\\s*\\.\\s*(?:${METODOS.join("|")})\\b`, "g");
    for (const m of conteudo.matchAll(padrao)) {
      const linha = conteudo.slice(0, m.index).split(/\r?\n/).length;
      violacoes.push({
        arquivo: relativo.replace(/\\/g, "/"),
        linha,
        trecho: m[0].replace(/\s+/g, " "),
      });
    }
  }
}

if (violacoes.length === 0) {
  console.log("OK: todo acesso ao Supabase passa pela camada de serviços.");
  process.exit(0);
}

const porArquivo = new Map();
for (const v of violacoes) {
  porArquivo.set(v.arquivo, (porArquivo.get(v.arquivo) ?? 0) + 1);
}

console.error(
  `${violacoes.length} chamada(s) diretas ao Supabase fora de services/lib, ` +
    `em ${porArquivo.size} arquivo(s):\n`,
);
for (const [arquivo, total] of [...porArquivo].sort((a, b) => b[1] - a[1])) {
  console.error(`  ${String(total).padStart(3)}  ${arquivo}`);
}
console.error(
  "\nMover para um serviço em src/services/. Ver a regra em CLAUDE.md:\n" +
    '"Página não chama RPC direto; passa pelo service."',
);
process.exit(1);
