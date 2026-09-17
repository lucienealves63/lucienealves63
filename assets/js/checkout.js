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

  function checkoutMessageLines(values) {
    const sellerCode = normalizeSellerCode(values?.sellerCode);
    const couponCode = normalizeCouponCode(values?.couponCode);
    const lines = [];
    if (sellerCode) lines.push(`*Código do vendedor:* ${sellerCode}`);
    if (couponCode) lines.push(`*Cupom informado:* ${couponCode} (validar desconto)`);
    return lines;
  }

  global.C18Checkout = {
    checkoutMessageLines,
    normalizeCouponCode,
    normalizeSellerCode,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = global.C18Checkout;
  }
})(typeof window !== "undefined" ? window : globalThis);
