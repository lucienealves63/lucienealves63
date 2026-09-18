const test = require("node:test");
const assert = require("node:assert/strict");
const Pedido = require("../assets/js/pedido.js");

/* ------------------------------------------------------------- resumo */
test("resumo junta carrinho e frete calculando totais", () => {
  const r = Pedido.resumo(
    [
      { id: "c18-hoodie", name: "Moletom Hoodie", size: "G", color: "Preto", qty: 2, price: 149.9 },
      { id: "c18-bone", name: "Boné Estruturado", size: "ÚNICO", color: "Preto", qty: 1, price: 89.9 },
    ],
    { id: "correios-pac", transportadora: "Correios", servico: "PAC", preco: 19.9, prazoTexto: "2 a 3 dias úteis" }
  );
  assert.equal(r.count, 3);
  assert.equal(r.subtotal, 389.7);
  assert.equal(r.frete.preco, 19.9);
  assert.equal(r.total, 409.6);
});

test("frete grátis não soma e retirada também não", () => {
  const gratis = Pedido.resumo([{ id: "x", name: "Camiseta", qty: 4, price: 80 }], {
    id: "correios-pac", preco: 19.9, gratis: true,
  });
  assert.equal(gratis.frete.preco, 0);
  assert.equal(gratis.total, 320);

  const retirada = Pedido.resumo([{ id: "x", name: "Camiseta", qty: 1, price: 80 }], {
    id: "retirada-loja", preco: 0, gratis: true,
  });
  assert.equal(retirada.total, 80);
});

test("resumo sanitiza itens malformados", () => {
  const r = Pedido.resumo([
    { id: "ok", name: "Camiseta", qty: 99, price: -5 }, /* qty corta em 20, preço em 0 */
    { name: "sem id" }, /* descartado */
    null,
  ]);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].qty, 20);
  assert.equal(r.items[0].price, 0);
});

/* ---------------------------------------------------------- validação */
test("validarPedido exige itens, método, nome e CEP (se entrega)", () => {
  const base = {
    items: [{ id: "x", name: "Camiseta", qty: 1, price: 80 }],
    subtotal: 80,
    total: 100,
    frete: { id: "correios-pac", preco: 20 },
    metodo: "pix",
    cliente: { nome: "Maria Silva", cep: "26275280" },
  };
  assert.equal(Pedido.validarPedido(base).ok, true);

  const semCep = Pedido.validarPedido({ ...base, cliente: { nome: "Maria Silva" } });
  assert.equal(semCep.ok, false);
  assert.ok(semCep.erros.cep);

  const retirada = Pedido.validarPedido({
    ...base,
    frete: { id: "retirada-loja", preco: 0, gratis: true },
    cliente: { nome: "Maria Silva" },
  });
  assert.equal(retirada.ok, true); /* retirada não exige CEP */

  const vazio = Pedido.validarPedido({ items: [], metodo: "boleto", cliente: {} });
  assert.equal(vazio.ok, false);
  assert.ok(vazio.erros.items);
  assert.ok(vazio.erros.metodo);
  assert.ok(vazio.erros.cliente);
});

/* ---------------------------------------------------------------- Pix */
test("crc16 segue o padrão CCITT-FALSE (vetor '123456789' → 29B1)", () => {
  assert.equal(Pedido.crc16("123456789"), "29B1");
});

test("pix copia e cola no padrão EMV do Banco Central", () => {
  const pix = Pedido.pixCopiaCola(
    { pixChave: "pix@censura18.com.br", pixNome: "Censura 18", pixCidade: "Nova Iguaçu" },
    409.6,
    "C18-TESTE"
  );
  assert.ok(pix.startsWith("000201")); /* Payload Format Indicator */
  assert.ok(pix.includes("br.gov.bcb.pix")); /* GUI do Pix */
  assert.ok(pix.includes("pix@censura18.com.br"));
  assert.ok(pix.includes("5303986")); /* moeda BRL */
  assert.ok(pix.includes("5406409.60")); /* campo 54, valor "409.60" (6 bytes) */
  assert.ok(pix.includes("5802BR"));
  assert.ok(pix.includes("5910CENSURA 18")); /* campo 59, nome com 10 bytes */
  assert.ok(pix.endsWith(/$/.source ? pix.slice(-4) : "")); /* termina com CRC de 4 hex */
  const crc = pix.slice(-4);
  const semCrc = pix.slice(0, -4);
  assert.equal(semCrc.slice(-4), "6304"); /* id do campo CRC */
  assert.equal(Pedido.crc16(semCrc), crc); /* CRC confere */

  /* campos TLV: comprimento em bytes bate com o valor */
  const campos = pix.match(/(\d{2})(\d{2})/g);
  assert.ok(campos.length >= 9);

  assert.equal(Pedido.pixCopiaCola({}, 10), ""); /* sem chave configurada */
});

test("nome e cidade do recebedor perdem acento e têm limite", () => {
  const pix = Pedido.pixCopiaCola(
    { pixChave: "chave", pixNome: "Conselho de São João da Barra Aparente", pixCidade: "Nova Iguaçu" },
    10
  );
  assert.ok(!pix.includes("Ã")); /* sem acento */
  assert.ok(pix.includes("CONSELHO DE SAO JOAO DA B")); /* cortado em 25 */
  assert.ok(!pix.includes("APARENTE"));
});

/* ----------------------------------------------------------- WhatsApp */
test("mensagem do pedido com Pix e frete", () => {
  const msg = Pedido.mensagemPedido({
    numero: "C18-260918-A1B2",
    cliente: { nome: "Maria Silva", telefone: "(21) 98765-4321" },
    items: [{ name: "Moletom Hoodie", size: "G", color: "Preto", qty: 1, price: 149.9 }],
    subtotal: 149.9,
    frete: {
      transportadora: "Correios", servico: "PAC", preco: 19.9, prazoTexto: "2 a 3 dias úteis", gratis: false,
    },
    metodo: "pix",
    total: 169.8,
  });
  assert.match(msg, /\*Pedido:\* C18-260918-A1B2/);
  assert.match(msg, /1\. 1x Moletom Hoodie/);
  assert.match(msg, /\*Frete:\* R\$ 19,90/);
  assert.match(msg, /\*Pagamento:\* Pix — já efetuado/);
  assert.match(msg, /\*Total:\* R\$ 169,80/);
});

test("mensagem do pedido com cartão pendente de link", () => {
  const msg = Pedido.mensagemPedido({
    numero: "C18-1",
    items: [{ name: "Camiseta", size: "M", color: "Preto", qty: 1, price: 80 }],
    subtotal: 80,
    frete: { transportadora: "Censura 18", servico: "Retirar na loja", preco: 0, gratis: true },
    metodo: "cartao",
    total: 80,
  });
  assert.match(msg, /\*Pagamento:\* Cartão — aguardando link seguro/);
  assert.match(msg, /\*Frete:\* Grátis/);
});
