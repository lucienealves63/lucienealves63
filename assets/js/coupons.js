/* Censura 18 — cupons de desconto
 *
 * Módulo compartilhado entre o painel (admin/) e a loja (assets/js/app.js):
 *
 *   - createCoupon(payload)  → valida e normaliza o cupom criado no painel
 *     (código, tipo percentual/fixo, valor e escopo: loja toda, referência,
 *     categoria ou coleção — os mesmos conceitos da planilha Alterdata);
 *   - describeCoupon(coupon) → texto curto para exibir ao cliente e à loja;
 *   - findCoupon(code, list) → acha o cupom ativo dentro da janela de datas;
 *   - discountForPrice/discountForCart → quanto desconta em cada item.
 *
 * O site não aplica o desconto no navegador: o cupom informado segue
 * identificado (e descrito) na mensagem do WhatsApp e a loja confirma o
 * valor antes do pagamento — mesma filosofia do cartão presente.
 */
(function (global) {
  "use strict";

  const KINDS = { PERCENT: "percent", AMOUNT: "amount" };
  const SCOPES = {
    ALL: "all",
    REFERENCE: "reference",
    CATEGORY: "category",
    COLLECTION: "collection",
  };

  const SCOPE_LABELS = {
    all: "Loja toda",
    reference: "Referência",
    category: "Categoria",
    collection: "Coleção",
  };

  const KIND_LABELS = {
    percent: "Percentual",
    amount: "Valor fixo",
  };

  const CODE_PATTERN = /^[A-Z0-9._/-]{3,32}$/;

  /* Limites de segurança: percentual nunca acima de 90%; valor fixo
     até R$ 5.000 — descontos maiores precisam ser tratados como troca
     comercial, não como cupom de site. */
  const LIMITS = {
    percent: { min: 1, max: 90 },
    amount: { min: 0.01, max: 5000 },
  };

  function normalizeCouponCode(value) {
    return String(value ?? "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "")
      .replace(/[^A-Z0-9._/-]/g, "")
      .slice(0, 32);
  }

  function isValidCouponCode(value) {
    return CODE_PATTERN.test(normalizeCouponCode(value));
  }

  function formatAmountBRL(value) {
    const amount = Number(value) || 0;
    return `R$ ${amount.toFixed(2).replace(".", ",")}`;
  }

  function formatPercent(value) {
    return `${String(value).replace(".", ",")}%`;
  }

  function normalizeTarget(scope, value) {
    if (scope === SCOPES.ALL) return "";
    return String(value ?? "").trim().slice(0, 60);
  }

  /* Valida o payload do painel. options.existing recebe a lista atual
     para bloquear código duplicado. → { ok, errors[], coupon } */
  function createCoupon(payload, options) {
    const errors = [];
    const data = payload || {};
    const code = normalizeCouponCode(data.code);
    const kind = data.kind === KINDS.AMOUNT ? KINDS.AMOUNT : KINDS.PERCENT;
    const scope = Object.values(SCOPES).includes(data.scope) ? data.scope : null;
    const target = normalizeTarget(scope, data.target);
    const rawValue = typeof data.value === "string"
      ? data.value.trim().replace(",", ".")
      : data.value;
    const value = Number(rawValue);
    const startsAt = data.starts_at ? String(data.starts_at) : "";
    const endsAt = data.ends_at ? String(data.ends_at) : "";

    if (!code) errors.push("Informe o código do cupom.");
    else if (!CODE_PATTERN.test(code)) {
      errors.push("O código deve ter de 3 a 32 caracteres entre letras, números, ponto, hífen, barra e underline.");
    }

    if (!scope) errors.push("Escolha onde o cupom se aplica.");
    else if (scope !== SCOPES.ALL && !target) {
      errors.push(`Informe o alvo do desconto (${SCOPE_LABELS[scope].toLowerCase()}).`);
    }

    const limits = LIMITS[kind];
    if (rawValue === "" || rawValue === null || rawValue === undefined || !Number.isFinite(value)) {
      errors.push("Informe um valor de desconto válido.");
    } else if (value < limits.min || value > limits.max) {
      errors.push(kind === KINDS.PERCENT
        ? `O percentual deve ficar entre ${String(limits.min).replace(".", ",")}% e ${String(limits.max).replace(".", ",")}%.`
        : `O valor fixo deve ficar entre ${formatAmountBRL(limits.min)} e ${formatAmountBRL(limits.max)}.`);
    }

    if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
      errors.push("A data de expiração precisa ser depois da data inicial.");
    }

    const existing = Array.isArray(options?.existing) ? options.existing : [];
    const duplicated = existing.some((item) =>
      item && item.code === code && String(item.id || "") !== String(data.id || "")
    );
    if (duplicated) errors.push("Já existe um cupom com este código.");

    if (errors.length) return { ok: false, errors, coupon: null };

    return {
      ok: true,
      errors: [],
      coupon: {
        id: String(data.id || ""),
        code,
        kind,
        value,
        scope,
        target,
        starts_at: startsAt,
        ends_at: endsAt,
        active: Boolean(data.active),
      },
    };
  }

  function describeCoupon(coupon) {
    if (!coupon) return "";
    const valueText = coupon.kind === KINDS.AMOUNT
      ? formatAmountBRL(coupon.value)
      : formatPercent(coupon.value);
    const target = String(coupon.target || "").trim();
    const scopeText = {
      [SCOPES.ALL]: "em toda a loja",
      [SCOPES.REFERENCE]: `na referência ${target}`,
      [SCOPES.CATEGORY]: `na categoria ${target}`,
      [SCOPES.COLLECTION]: `na coleção ${target}`,
    }[coupon.scope];
    if (!scopeText) return valueText;
    return `${valueText} ${scopeText}`;
  }

  function isActive(coupon, now) {
    if (!coupon || !coupon.active) return false;
    const today = now instanceof Date ? now : new Date();
    if (coupon.starts_at && new Date(coupon.starts_at) > today) return false;
    if (coupon.ends_at && new Date(coupon.ends_at) < today) return false;
    return true;
  }

  function findCoupon(code, coupons, now) {
    const wanted = normalizeCouponCode(code);
    if (!wanted || !Array.isArray(coupons)) return null;
    return coupons.find((item) => item && item.code === wanted && isActive(item, now)) || null;
  }

  const sameText = (a, b) =>
    String(a ?? "").trim().toUpperCase() === String(b ?? "").trim().toUpperCase();

  /* Produto aceita { reference, code, id, category, collection } — os
     campos vindos do estoque (admin) ou do catálogo. */
  function matchesProduct(coupon, product) {
    if (!coupon) return false;
    switch (coupon.scope) {
      case SCOPES.ALL:
        return true;
      case SCOPES.REFERENCE:
        return sameText(coupon.target, product?.reference) ||
          sameText(coupon.target, product?.code) ||
          sameText(coupon.target, product?.id);
      case SCOPES.CATEGORY:
        return sameText(coupon.target, product?.category);
      case SCOPES.COLLECTION:
        return sameText(coupon.target, product?.collection);
      default:
        return false;
    }
  }

  function discountForPrice(coupon, price) {
    if (!coupon) return 0;
    const full = Number(price);
    if (!Number.isFinite(full) || full <= 0) return 0;
    const raw = coupon.kind === KINDS.AMOUNT
      ? Math.min(Number(coupon.value) || 0, full)
      : full * ((Number(coupon.value) || 0) / 100);
    return Math.round(raw * 100) / 100;
  }

  function discountForCart(coupon, items) {
    if (!coupon || !Array.isArray(items)) return 0;
    const total = items.reduce((sum, item) => {
      if (!matchesProduct(coupon, item)) return sum;
      return sum + discountForPrice(coupon, Number(item.price || 0) * Number(item.qty || 1));
    }, 0);
    return Math.round(total * 100) / 100;
  }

  global.C18Coupons = {
    CODE_PATTERN,
    KINDS,
    KIND_LABELS,
    LIMITS,
    SCOPES,
    SCOPE_LABELS,
    createCoupon,
    describeCoupon,
    discountForCart,
    discountForPrice,
    findCoupon,
    formatAmountBRL,
    formatPercent,
    isActive,
    isValidCouponCode,
    matchesProduct,
    normalizeCouponCode,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = global.C18Coupons;
  }
})(typeof window !== "undefined" ? window : globalThis);
