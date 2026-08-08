#!/usr/bin/env node
/**
 * Etapa 1 do plano de deploy — verifica se o domínio já está sob controle
 * da Cloudflare (nameservers propagados no registrador).
 *
 * Sai com código 0 somente quando os NS autoritativos do domínio apontam
 * para *.ns.cloudflare.com. Enquanto a propagação não terminar, sai com
 * código != 0 — nenhum domínio personalizado deve ser anexado ao Pages
 * antes disso (Etapa 5).
 *
 * O plano original descreve um check-dns.sh usando `dig`. Esta máquina de
 * desenvolvimento é Windows e não tem `dig`; a versão em Node faz a mesma
 * verificação, sem dependências e funcionando em qualquer plataforma.
 *
 * A consulta é feita contra resolvers públicos (Cloudflare e Google) em vez
 * do resolver do sistema, para não ler um cache local desatualizado.
 *
 * Uso:
 *   npm run check:dns
 *   node scripts/check-dns.js outrodominio.com.br
 */

import { Resolver } from "dns/promises";

const DOMINIO = process.argv[2] || "ciuflaictin.com.br";

// Resolvers públicos: evitam cache do sistema/roteador durante a propagação.
const RESOLVERS = [
  { nome: "Cloudflare 1.1.1.1", ip: "1.1.1.1" },
  { nome: "Google 8.8.8.8", ip: "8.8.8.8" },
];

// Zonas de cliente recebem NS no formato <nome>.ns.cloudflare.com; zonas
// internas da própria Cloudflare usam nsN.cloudflare.com. Aceitar os dois.
const ehCloudflare = (ns) => /(^|\.)cloudflare\.com\.?$/i.test(ns.trim());

async function consultarNs(ip) {
  const resolver = new Resolver({ timeout: 5000, tries: 2 });
  resolver.setServers([ip]);
  const ns = await resolver.resolveNs(DOMINIO);
  return ns.map((n) => n.toLowerCase()).sort();
}

console.log(`Consultando NS de ${DOMINIO}\n`);

let algumOk = false;
let algumRespondeu = false;

for (const { nome, ip } of RESOLVERS) {
  try {
    const ns = await consultarNs(ip);
    algumRespondeu = true;
    const ok = ns.length > 0 && ns.every(ehCloudflare);
    if (ok) algumOk = true;
    console.log(`  ${nome}:`);
    for (const n of ns) console.log(`    ${ehCloudflare(n) ? "✓" : "✗"} ${n}`);
  } catch (err) {
    console.log(`  ${nome}:`);
    console.log(`    erro na consulta (${err.code || err.message})`);
  }
}

console.log("");

if (!algumRespondeu) {
  console.error(
    "NÃO PRONTO: nenhum resolver respondeu. Domínio ainda não registrado, " +
      "sem rede, ou os resolvers públicos estão bloqueados nesta rede."
  );
  process.exit(2);
}

if (!algumOk) {
  console.error(
    "NÃO PRONTO: os nameservers ainda não são da Cloudflare.\n" +
      "Troque os NS no Registro.br pelos dois que a Cloudflare atribuiu à zona " +
      "e aguarde a propagação (pode levar horas). NÃO avançar para a Etapa 5."
  );
  process.exit(1);
}

console.log(`OK: a zona ${DOMINIO} está na Cloudflare.`);
