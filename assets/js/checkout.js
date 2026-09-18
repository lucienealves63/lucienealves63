/* Censura 18 — campos auxiliares do checkout */
(function (global) {
  "use strict";

  function normalizeCode(value, maxLength) {
    return String(value ?? "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "")
      .replace(/[^A-Z0-9._/-]/g, "")
      .slice(0, maxLength);
  }

  function normalizeSellerCode(value) {
    return normalizeCode(value, 24);
  }

  function normalizeCouponCode(value) {
    return normalizeCode(value, 32);
  }

  /* Cartão presente: C18-XXXX-XXXX — validação de saldo fica com a loja. */
  function normalizeGiftCardCode(value) {
    return normalizeCode(value, 16);
  }

  /* Parcelamento: até 6x sem juros, parcela mínima de R$ 49,00.
     O cálculo usa centavos inteiros para não errar por arredondamento
     de ponto flutuante (294,00 / 49,00 = exatamente 6). */
  const MAX_INSTALLMENTS = 6;
  const MIN_INSTALLMENT = 49;

  function maxInstallments(total, rules) {
    const maxValue = Math.max(1, Math.floor(Number(rules?.max ?? MAX_INSTALLMENTS)));
    const minCents = Math.round(Number(rules?.min ?? MIN_INSTALLMENT) * 100);
    const totalCents = Math.round(Number(total) * 100);
    if (!Number.isFinite(totalCents) || totalCents <= 0 || !Number.isFinite(minCents) || minCents <= 0) {
      return 0;
    }
    return Math.min(maxValue, Math.max(1, Math.floor(totalCents / minCents)));
  }

  function installmentPlan(total, rules) {
    const count = maxInstallments(total, rules);
    if (!count) return null;
    const totalCents = Math.round(Number(total) * 100);
    return { count, each: Math.round(totalCents / count) / 100 };
  }

  function installmentText(total, rules) {
    const plan = installmentPlan(total, rules);
    if (!plan) return "";
    const min = Number(rules?.min ?? MIN_INSTALLMENT);
    const minText = `R$ ${min.toFixed(2).replace(".", ",")}`;
    if (plan.count < 2) return `à vista no Pix ou cartão (parcela mínima de ${minText})`;
    return `até ${plan.count}x de R$ ${plan.each.toFixed(2).replace(".", ",")} sem juros (parcela mínima de ${minText})`;
  }

  function checkoutMessageLines(values) {
    const sellerCode = normalizeSellerCode(values?.sellerCode);
    const couponCode = normalizeCouponCode(values?.couponCode);
    const giftCardCode = normalizeGiftCardCode(values?.giftCardCode);
    const couponDescription = String(values?.couponDescription || "").trim();
    const lines = [];
    if (sellerCode) lines.push(`*Código do vendedor:* ${sellerCode}`);
    if (couponCode) {
      lines.push(
        `*Cupom informado:* ${couponCode}${couponDescription ? ` — ${couponDescription}` : ""} (validar desconto)`
      );
    }
    if (giftCardCode) lines.push(`*Cartão presente:* ${giftCardCode} (validar saldo)`);
    return lines;
  }

  global.C18Checkout = {
    MAX_INSTALLMENTS,
    MIN_INSTALLMENT,
    checkoutMessageLines,
    installmentPlan,
    installmentText,
    maxInstallments,
    normalizeCouponCode,
    normalizeGiftCardCode,
    normalizeSellerCode,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = global.C18Checkout;
  }
})(typeof window !== "undefined" ? window : globalThis);
