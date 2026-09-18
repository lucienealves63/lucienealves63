const test = require("node:test");
const assert = require("node:assert/strict");
const coupons = require("../assets/js/coupons.js");
const checkout = require("../assets/js/checkout.js");

test("cria e valida cupons do painel", () => {
  const ok = coupons.createCoupon({
    code: " primeira-c18 ",
    kind: "percent",
    value: "10",
    scope: "all",
    active: true,
  });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.coupon, {
    id: "",
    code: "PRIMEIRA-C18",
    kind: "percent",
    value: 10,
    scope: "all",
    target: "",
    starts_at: "",
    ends_at: "",
    active: true,
  });

  /* valor fixo em reais com vírgula */
  const fixed = coupons.createCoupon({ code: "VOLTA20", kind: "amount", value: "20,00", scope: "all" });
  assert.equal(fixed.ok, true);
  assert.equal(fixed.coupon.value, 20);

  const cases = [
    [{ code: "   ", kind: "percent", value: 10, scope: "all" }, /Informe o código/],
    [{ code: "A", kind: "percent", value: 10, scope: "all" }, /3 a 32 caracteres/],
    [{ code: "QUASE", kind: "percent", value: 95, scope: "all" }, /percentual/i],
    [{ code: "QUASE", kind: "amount", value: 9999, scope: "all" }, /valor fixo/i],
    [{ code: "QUASE", kind: "percent", value: "abc", scope: "all" }, /valor de desconto/],
    [{ code: "QUASE", kind: "percent", value: 10, scope: "collection" }, /alvo do desconto/],
    [{ code: "QUASE", kind: "percent", value: 10, scope: "all", starts_at: "2026-09-18T10:00:00Z", ends_at: "2026-09-18T09:00:00Z" }, /depois da data inicial/],
  ];
  for (const [payload, pattern] of cases) {
    const result = coupons.createCoupon(payload);
    assert.equal(result.ok, false, JSON.stringify(payload));
    assert.match(result.errors.join(" "), pattern);
  }

  /* código duplicado na lista atual (edit não bloqueia a si mesmo) */
  const existing = [{ id: "1", code: "PRIMEIRAC18" }];
  assert.match(
    coupons.createCoupon({ code: "primeirac18", kind: "percent", value: 10, scope: "all" }, { existing }).errors.join(" "),
    /Já existe um cupom/
  );
  const editing = coupons.createCoupon(
    { id: "1", code: "primeirac18", kind: "percent", value: 15, scope: "all" },
    { existing }
  );
  assert.equal(editing.ok, true);
});

test("descreve o desconto por escopo", () => {
  assert.equal(
    coupons.describeCoupon({ kind: "percent", value: 10, scope: "all" }),
    "10% em toda a loja"
  );
  assert.equal(
    coupons.describeCoupon({ kind: "amount", value: 20, scope: "all" }),
    "R$ 20,00 em toda a loja"
  );
  assert.equal(
    coupons.describeCoupon({ kind: "percent", value: 15, scope: "collection", target: "VERÃO 09" }),
    "15% na coleção VERÃO 09"
  );
  assert.equal(
    coupons.describeCoupon({ kind: "percent", value: 10, scope: "category", target: "T SHIRT" }),
    "10% na categoria T SHIRT"
  );
  assert.equal(
    coupons.describeCoupon({ kind: "amount", value: 30, scope: "reference", target: "0000000946" }),
    "R$ 30,00 na referência 0000000946"
  );
});

test("acha somente cupom ativo e dentro da janela de datas", () => {
  const now = new Date("2026-09-18T12:00:00Z");
  const list = [
    { code: "ATIVO", kind: "percent", value: 10, scope: "all", active: true },
    { code: "INATIVO", kind: "percent", value: 10, scope: "all", active: false },
    { code: "FUTURO", kind: "percent", value: 10, scope: "all", active: true, starts_at: "2026-10-01T00:00:00Z" },
    { code: "EXPIRADO", kind: "percent", value: 10, scope: "all", active: true, ends_at: "2026-09-01T00:00:00Z" },
    { code: "NAJANELA", kind: "percent", value: 10, scope: "all", active: true, starts_at: "2026-09-01T00:00:00Z", ends_at: "2026-09-30T00:00:00Z" },
  ];
  assert.equal(coupons.findCoupon("ativo", list, now)?.code, "ATIVO");
  assert.equal(coupons.findCoupon("naJanela", list, now)?.code, "NAJANELA");
  assert.equal(coupons.findCoupon("inativo", list, now), null);
  assert.equal(coupons.findCoupon("futuro", list, now), null);
  assert.equal(coupons.findCoupon("expirado", list, now), null);
  assert.equal(coupons.findCoupon("naoexiste", list, now), null);
});

test("calcula o desconto por item e no carrinho", () => {
  const coupon = { kind: "percent", value: 15, scope: "collection", target: "VERÃO 09" };
  const items = [
    { reference: "0000000946", collection: "VERÃO 09", price: 49.9, qty: 2 },
    { reference: "0000000063", collection: "VERÃO 08", price: 15, qty: 1 },
  ];
  assert.equal(coupons.matchesProduct(coupon, items[0]), true);
  assert.equal(coupons.matchesProduct(coupon, items[1]), false);
  assert.equal(coupons.matchesProduct({ kind: "percent", value: 10, scope: "all" }, items[1]), true);

  /* 15% de R$ 99,80 = R$ 14,97 — só nos itens da coleção */
  assert.equal(coupons.discountForCart(coupon, items), 14.97);

  const fixed = { kind: "amount", value: 20, scope: "all" };
  assert.equal(coupons.discountForPrice(fixed, 15), 15); /* nunca desconta mais que o item */
  assert.equal(coupons.discountForPrice(fixed, 129.9), 20);
  assert.equal(coupons.discountForPrice({ kind: "percent", value: 10, scope: "all" }, 129.9), 12.99);
});

test("integração: mensagem do pedido descreve o cupom do painel", () => {
  const list = [{ code: "PRIMEIRAC18", kind: "amount", value: 20, scope: "all", active: true }];
  const found = coupons.findCoupon("primeirac18", list);
  const description = coupons.describeCoupon(found);

  assert.deepEqual(
    checkout.checkoutMessageLines({ couponCode: "primeirac18", couponDescription: description }),
    ["*Cupom informado:* PRIMEIRAC18 — R$ 20,00 em toda a loja (validar desconto)"]
  );
  /* sem catálogo, o formato original se mantém */
  assert.deepEqual(
    checkout.checkoutMessageLines({ couponCode: "primeirac18" }),
    ["*Cupom informado:* PRIMEIRAC18 (validar desconto)"]
  );
});
