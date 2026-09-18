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

test("parcela em até 6x sem juros com parcela mínima de R$ 49,00", () => {
  assert.equal(checkout.MAX_INSTALLMENTS, 6);
  assert.equal(checkout.MIN_INSTALLMENT, 49);

  /* limite de parcelas pelo valor total (em centavos, sem erro de ponto flutuante) */
  assert.equal(checkout.maxInstallments(294), 6);     /* exatamente 6x de 49,00 */
  assert.equal(checkout.maxInstallments(293.99), 5);
  assert.equal(checkout.maxInstallments(259.8), 5);   /* 5x de 51,96 */
  assert.equal(checkout.maxInstallments(149.7), 3);   /* 3x de 49,90 */
  assert.equal(checkout.maxInstallments(98), 2);      /* exatamente 2x de 49,00 */
  assert.equal(checkout.maxInstallments(97.99), 1);
  assert.equal(checkout.maxInstallments(49), 1);
  assert.equal(checkout.maxInstallments(0), 0);

  assert.deepEqual(checkout.installmentPlan(259.8), { count: 5, each: 51.96 });
  assert.deepEqual(checkout.installmentPlan(100), { count: 2, each: 50 });
  assert.equal(checkout.installmentPlan(0), null);

  assert.equal(
    checkout.installmentText(259.8),
    "até 5x de R$ 51,96 sem juros (parcela mínima de R$ 49,00)"
  );
  assert.equal(
    checkout.installmentText(80),
    "à vista no Pix ou cartão (parcela mínima de R$ 49,00)"
  );
});
