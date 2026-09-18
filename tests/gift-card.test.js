const test = require("node:test");
const assert = require("node:assert/strict");
const giftCard = require("../assets/js/gift-card.js");
const checkout = require("../assets/js/checkout.js");

test("normaliza e valida o código do cartão presente", () => {
  assert.equal(giftCard.normalizeGiftCardCode(" c18-abcd-1234 "), "C18-ABCD-1234");
  assert.equal(giftCard.normalizeGiftCardCode("<script>x</script>"), "SCRIPTXSCRIPT");
  assert.equal(giftCard.isValidGiftCardCode("c18-abcd-1234"), true);
  assert.equal(giftCard.isValidGiftCardCode("C18-AB"), false);
  assert.equal(giftCard.isValidGiftCardCode("XXXX-ABCD-1234"), false);
});

test("só aceita os valores anunciados no site", () => {
  assert.deepEqual(giftCard.AMOUNTS, [50, 100, 150, 200, 300, 500]);
  assert.equal(giftCard.isSupportedAmount(100), true);
  assert.equal(giftCard.isSupportedAmount("150"), true);
  assert.equal(giftCard.isSupportedAmount(500), true);
  assert.equal(giftCard.isSupportedAmount(99.9), false);
  assert.equal(giftCard.isSupportedAmount(-50), false);
  assert.equal(giftCard.isSupportedAmount(null), false);
});

test("formata os valores em reais", () => {
  assert.equal(giftCard.formatAmountBRL(50), "R$ 50,00");
  assert.equal(giftCard.formatAmountBRL(129.9), "R$ 129,90");
  assert.equal(giftCard.formatAmountBRL(0), "R$ 0,00");
});

test("monta a mensagem do WhatsApp só com o que foi informado", () => {
  assert.deepEqual(giftCard.giftCardLines({ amount: 100 }), [
    "*Cartão presente:* R$ 100,00",
  ]);
  assert.deepEqual(
    giftCard.giftCardLines({ amount: 150, recipient: "  maria ", sender: "joão" }),
    ["*Cartão presente:* R$ 150,00", "*Para:* maria", "*De:* joão"]
  );
  assert.deepEqual(giftCard.giftCardLines({ amount: 99.9 }), []);
  assert.equal(giftCard.buildWhatsMessage({}), "");

  const msg = giftCard.buildWhatsMessage({ amount: 200, recipient: "Ana" });
  assert.match(msg, /cartão presente/);
  assert.match(msg, /R\$ 200,00/);
  assert.match(msg, /\*Para:\* Ana/);

  /* integração com o checkout: o código entra na mensagem do pedido */
  assert.deepEqual(checkout.checkoutMessageLines({ giftCardCode: "c18-abcd-1234" }), [
    "*Cartão presente:* C18-ABCD-1234 (validar saldo)",
  ]);
  assert.equal(checkout.normalizeGiftCardCode(" c18-abcd-1234 "), "C18-ABCD-1234");
});
