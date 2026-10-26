/**
 * E-mails aos revisores — envio pela conta congressoparaiso@ufla.br
 * ==================================================================
 * Fonte versionada no repositório (apps-script/emails-revisores.gs). O que
 * roda de verdade é a cópia colada em https://script.google.com, num projeto
 * criado LOGADO COMO congressoparaiso@ufla.br: é essa conta que aparece como
 * remetente e que recebe as respostas dos revisores.
 *
 * Este script não decide nada. A cada minuto ele pergunta à Edge Function
 * `emails-revisores` o que está devido (designação, lembrete, atraso — a
 * regra é SQL, migration 20261014120000), envia, e conta à função o que o
 * MailApp respondeu para CADA e-mail (migration 20261026120000) — é o que a
 * tela de Atribuições mostra como enviado ou falhou, com o motivo.
 * O Supabase nunca chama este script: não há web app publicado aqui.
 *
 * Instalação (uma vez):
 *   1. Novo projeto → apagar o conteúdo de Código.gs → colar este arquivo.
 *   2. Configurações do projeto (engrenagem) → Propriedades do script:
 *        URL_FUNCAO = https://<ref>.supabase.co/functions/v1/emails-revisores
 *        SEGREDO    = o mesmo valor gravado como SEGREDO_FILA_EMAILS no Supabase
 *   3. No editor, escolher a função `instalarGatilho` → Executar → autorizar
 *      (pede "enviar e-mail como você" e "conectar a um serviço externo").
 *   4. Conferir em "Execuções" que `buscarEEnviar` passa a rodar todo minuto.
 *
 * Trocar o SEGREDO = trocar nos DOIS lugares (aqui e `npm run config:secrets`).
 * Atualizar o código = colar a versão nova por cima; o gatilho continua.
 *
 * MailApp, e não GmailApp, de propósito: MailApp só pede permissão de
 * ENVIAR; GmailApp pediria acesso à caixa de entrada inteira da conta.
 */

/** Revisores por busca (a função aceita até 50). */
const LOTE = 20;

/** O Apps Script derruba execuções com 6 min; parar antes evita lote pela metade. */
const TEMPO_MAXIMO_MS = 4 * 60 * 1000;

/** Disparada pelo gatilho de 1 em 1 minuto. */
function buscarEEnviar() {
  const trava = LockService.getScriptLock();
  // A execução do minuto anterior ainda está enviando: fica para a próxima.
  if (!trava.tryLock(1000)) return;

  try {
    const inicio = Date.now();
    while (Date.now() - inicio < TEMPO_MAXIMO_MS) {
      // Conta Workspace: 1.500 destinatários por dia. Esgotou, a fila espera
      // a cota de amanhã — e nada é reservado sem poder ser enviado.
      const cota = MailApp.getRemainingDailyQuota();
      if (cota <= 0) return;

      const lote = chamar({ acao: 'pegar', limite: Math.min(LOTE, cota) });
      if (lote.emails.length === 0) return;

      const resultados = [];
      lote.emails.forEach(function (e) {
        try {
          MailApp.sendEmail({
            to: e.para,
            subject: e.assunto,
            htmlBody: e.html,
            body: e.texto,
            name: lote.remetente,
          });
          resultados.push({ id: e.id, erro: null });
        } catch (erro) {
          // Sem o endereço no log: o tipo e o motivo bastam para diagnosticar.
          // A frase do Google vai para o registro, que só a organização lê.
          console.error('Envio falhou (' + e.tipo + '): ' + erro);
          resultados.push({ id: e.id, erro: String((erro && erro.message) || erro) });
        }
      });

      // Sem esta chamada o envio fica "sem confirmação" na tela — inclusive
      // o que saiu. Se ela falhar, a execução falha alto, em "Execuções".
      chamar({ acao: 'concluir', resultados: resultados });

      // Lembrete e atraso que falharam voltam à fila: tenta no próximo
      // minuto, não em laço agora.
      if (resultados.some(function (r) { return r.erro; })) return;
    }
  } finally {
    trava.releaseLock();
  }
}

/** POST na Edge Function. Resposta fora de 200 falha alto, de propósito. */
function chamar(corpo) {
  const props = PropertiesService.getScriptProperties();
  const resposta = UrlFetchApp.fetch(props.getProperty('URL_FUNCAO'), {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-segredo': props.getProperty('SEGREDO') },
    payload: JSON.stringify(corpo),
    muteHttpExceptions: true,
  });
  if (resposta.getResponseCode() !== 200) {
    // Aparece em "Execuções" e no resumo de falhas que o Google manda para a
    // conta — é o sinal de que a fila parou (segredo trocado, função fora).
    throw new Error(
      'emails-revisores respondeu HTTP ' + resposta.getResponseCode() + ': ' +
        resposta.getContentText().slice(0, 300)
    );
  }
  return JSON.parse(resposta.getContentText());
}

/** Rodar UMA vez pelo editor. Recria o gatilho de 1 em 1 minuto. */
function instalarGatilho() {
  ScriptApp.getProjectTriggers().forEach(function (gatilho) {
    ScriptApp.deleteTrigger(gatilho);
  });
  ScriptApp.newTrigger('buscarEEnviar').timeBased().everyMinutes(1).create();
}
