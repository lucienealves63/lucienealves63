const test = require("node:test");
const assert = require("node:assert/strict");
const checkout = require("../assets/js/checkout.js");

test("normaliza o código do vendedor", () => {
  assert.equal(checkout.normalizeSellerCode("  vendedor 042 "), "VENDEDOR042");
  assert.equal(checkout.normalizeSellerCode("A/B-10"), "A/B-10");
});

test("normaliza cupom sem permitir caracteres de controle", () => {
  assert.equal(checkout.normalizeCouponCode(" primeira-c18! "), "PRIMEIRA-C18");
  assert.equal(checkout.normalizeCouponCode("<script>"), "SCRIPT");
});

test("gera somente os campos informados para o WhatsApp", () => {
  assert.deepEqual(checkout.checkoutMessageLines({
    sellerCode: "042",
    couponCode: "bemvindo10",
  }), [
    "*Código do vendedor:* 042",
    "*Cupom informado:* BEMVINDO10 (validar desconto)",
  ]);

  assert.deepEqual(checkout.checkoutMessageLines({}), []);
});
