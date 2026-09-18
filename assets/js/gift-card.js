/* Censura 18 — cartão presente
 *
 * Dois fluxos, um só módulo:
 *
 *   1. Comprar: a página cartao-presente.html monta a mensagem do WhatsApp
 *      com o valor escolhido e os nomes de quem presenteia/recebe.
 *   2. Usar: no carrinho, o código do cartão (C18-XXXX-XXXX) é informado
 *      no campo "Cartão presente" e segue identificado na mensagem do
 *      pedido — igual ao cupom, o saldo é confirmado com segurança pela
 *      loja antes do pagamento (nada de validar saldo no navegador).
 */
(function (global) {
  "use strict";

  /* Faixas vendidas no site — o seletor da página nasce daqui. */
  const AMOUNTS = [50, 100, 150, 200, 300, 500];

  const CODE_PATTERN = /^C18-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

  function isSupportedAmount(value) {
    const amount = Number(value);
    return Number.isFinite(amount) && AMOUNTS.indexOf(amount) !== -1;
  }

  function formatAmountBRL(value) {
    const amount = Number(value) || 0;
    return `R$ ${amount.toFixed(2).replace(".", ",")}`;
  }

  /* Mesma normalização dos códigos do checkout: sem espaços, maiúsculas,
     só o que pode existir em C18-XXXX-XXXX. */
  function normalizeGiftCardCode(value) {
    return String(value ?? "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "")
      .replace(/[^A-Z0-9-]/g, "")
      .slice(0, 16);
  }

  function isValidGiftCardCode(value) {
    return CODE_PATTERN.test(normalizeGiftCardCode(value));
  }

  function normalizeName(value) {
    return String(value ?? "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 60);
  }

  /* Linhas da mensagem — só o que foi informado aparece. */
  function giftCardLines(values) {
    const v = values || {};
    const recipient = normalizeName(v.recipient);
    const sender = normalizeName(v.sender);
    const lines = [];
    if (isSupportedAmount(v.amount)) {
      lines.push(`*Cartão presente:* ${formatAmountBRL(v.amount)}`);
    }
    if (recipient) lines.push(`*Para:* ${recipient}`);
    if (sender) lines.push(`*De:* ${sender}`);
    return lines;
  }

  function buildWhatsMessage(values) {
    const lines = giftCardLines(values);
    if (!lines.length) return "";
    return [
      "Olá! Vim pelo site e quero comprar um cartão presente 🎁",
      "",
      ...lines,
      "",
      "Podem me explicar o pagamento e como o cartão é entregue?",
    ].join("\n");
  }

  global.C18GiftCard = {
    AMOUNTS,
    CODE_PATTERN,
    buildWhatsMessage,
    formatAmountBRL,
    giftCardLines,
    isSupportedAmount,
    isValidGiftCardCode,
    normalizeGiftCardCode,
    normalizeName,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = global.C18GiftCard;
  }
})(typeof window !== "undefined" ? window : globalThis);
