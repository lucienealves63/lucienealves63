const test = require("node:test");
const assert = require("node:assert/strict");
const Frete = require("../assets/js/frete.js");

/* ------------------------------------------------------------- CEP */
test("normaliza e formata o CEP", () => {
  assert.equal(Frete.normalizeCep(" 25.000-000 "), "25000000");
  assert.equal(Frete.normalizeCep("25a00-0b0"), "250000");
  assert.equal(Frete.normalizeCep("25000000111"), "25000000");
  assert.equal(Frete.formatCep("25000000"), "25000-000");
  assert.equal(Frete.formatCep("2500"), "2500");
  assert.equal(Frete.isCepValida("25000-000"), true);
  assert.equal(Frete.isCepValida("2500-000"), false);
  assert.equal(Frete.isCepValida("00000-000"), false);
  assert.equal(Frete.isCepValida("abcdefgh"), false);
});

/* ------------------------------------------------------------ zonas */
test("classifica a zona do CEP", () => {
  assert.equal(Frete.zonaDoCep("20550-000"), "rj-capital");
  assert.equal(Frete.zonaDoCep("26275-280"), "rj-baixada");
  assert.equal(Frete.zonaDoCep("24220-280"), "rj-leste");
  assert.equal(Frete.zonaDoCep("25685-000"), "rj-interior");
  assert.equal(Frete.zonaDoCep("01310-200"), "sudeste");
  assert.equal(Frete.zonaDoCep("29100-000"), "sudeste");
  assert.equal(Frete.zonaDoCep("30110-000"), "sudeste");
  assert.equal(Frete.zonaDoCep("40010-000"), "nordeste");
  assert.equal(Frete.zonaDoCep("51020-000"), "nordeste");
  assert.equal(Frete.zonaDoCep("69050-000"), "norte");
  assert.equal(Frete.zonaDoCep("70040-000"), "centro-oeste");
  assert.equal(Frete.zonaDoCep("80010-000"), "sul");
  assert.equal(Frete.zonaDoCep("90010-000"), "sul");
  assert.equal(Frete.zonaDoCep("abc"), null);
});

/* ------------------------------------------------------------- peso */
test("soma o peso do carrinho com 0,3 kg por peça", () => {
  assert.equal(Frete.pesoKg([{ qty: 2 }, { qty: 1 }]), 0.9);
  assert.equal(Frete.pesoKg([{ qty: 2, weightKg: 0.5 }]), 1);
  assert.equal(Frete.pesoKg([{ qty: 3, weightKg: 8 }]), 24);
  assert.equal(Frete.pesoKg([]), 0);
  assert.equal(Frete.pesoKg(undefined), 0);
});

/* --------------------------------------------------------- cotação */
test("Baixada Fluminense recebe Correios, Mercado Envios, Uber, 99 e retirada", () => {
  const { zona, options } = Frete.cotar("26275-280", {
    items: [{ qty: 2 }],
    subtotal: 100,
  });
  assert.equal(zona, "rj-baixada");
  const ids = options.map((o) => o.id);
  assert.ok(ids.includes("correios-pac"));
  assert.ok(ids.includes("correios-sedex"));
  assert.ok(ids.includes("mercado-envios"));
  assert.ok(ids.includes("uber-direct"));
  assert.ok(ids.includes("entregas-99"));
  assert.ok(ids.includes("retirada-loja"));
});

test("Uber e 99 só existem no Rio de Janeiro e região", () => {
  for (const cep of ["20550-000", "26275-280", "24220-280"]) {
    const ids = Frete.cotar(cep, { items: [{ qty: 1 }], subtotal: 100 })
      .options.map((o) => o.id);
    assert.ok(ids.includes("uber-direct"), `uber em ${cep}`);
    assert.ok(ids.includes("entregas-99"), `99 em ${cep}`);
  }
  for (const cep of ["25685-000", "01310-200", "80010-000", "69050-000"]) {
    const ids = Frete.cotar(cep, { items: [{ qty: 1 }], subtotal: 100 })
      .options.map((o) => o.id);
    assert.ok(!ids.includes("uber-direct"), `sem uber em ${cep}`);
    assert.ok(!ids.includes("entregas-99"), `sem 99 em ${cep}`);
  }
});

test("PEGA grava grátis (PAC) acima de R$ 299 e não altera os outros", () => {
  const { options } = Frete.cotar("26275-280", { items: [{ qty: 4 }], subtotal: 299 });
  const pac = options.find((o) => o.id === "correios-pac");
  const sedex = options.find((o) => o.id === "correios-sedex");
  assert.equal(pac.gratis, true);
  assert.equal(pac.preco, 0);
  assert.equal(sedex.gratis, false);
  assert.ok(sedex.preco > 0);

  const abaixo = Frete.cotar("26275-280", { items: [{ qty: 4 }], subtotal: 298.99 });
  assert.equal(abaixo.options.find((o) => o.id === "correios-pac").gratis, false);
});

test("peso acima do limite da transportadora remove a opção", () => {
  const ids = Frete.cotar("26275-280", { items: [{ qty: 3, weightKg: 8 }], subtotal: 100 })
    .options.map((o) => o.id);
  assert.ok(!ids.includes("uber-direct")); /* 24 kg > limite de 20 kg */
  assert.ok(!ids.includes("entregas-99"));
  assert.ok(ids.includes("mercado-envios")); /* 24 kg < limite de 25 kg */
  assert.ok(ids.includes("correios-pac")); /* limite de 30 kg */

  const extremo = Frete.cotar("26275-280", { items: [{ qty: 4, weightKg: 8 }], subtotal: 100 })
    .options.map((o) => o.id);
  assert.ok(!extremo.includes("mercado-envios")); /* 32 kg > 25 kg */
  assert.ok(!extremo.includes("correios-pac")); /* 32 kg > 30 kg */
  assert.ok(!extremo.includes("correios-sedex"));
});

test("quilo extra soma no preço nacional", () => {
  const base = Frete.cotar("01310-200", { items: [{ qty: 1 }], subtotal: 100 });
  const pesado = Frete.cotar("01310-200", { items: [{ qty: 4, weightKg: 0.5 }], subtotal: 100 });
  assert.equal(base.options.find((o) => o.id === "correios-pac").preco, 29.9);
  assert.equal(pesado.options.find((o) => o.id === "correios-pac").preco, 36.8); /* +1 kg × 6,90 */
  assert.equal(pesado.options.find((o) => o.id === "correios-sedex").preco, 54.8); /* +1 kg × 9,90 */
});

test("CEP inválido devolve lista vazia sem lançar erro", () => {
  const resultado = Frete.cotar("123", { items: [], subtotal: 0 });
  assert.deepEqual(resultado, { cep: "123", zona: null, options: [] });
});

test("config por página desliga transportadora e aplica adicional", () => {
  const { options } = Frete.cotar("20550-000", {
    items: [{ qty: 1 }],
    subtotal: 100,
    config: {
      carriers: {
        "uber-direct": { enabled: false },
        "correios-sedex": { adicional: 5 },
      },
    },
  });
  const ids = options.map((o) => o.id);
  assert.ok(!ids.includes("uber-direct"));
  assert.ok(ids.includes("entregas-99"));
  assert.equal(options.find((o) => o.id === "correios-sedex").preco, 34.9);
});

/* -------------------------------------------------------- apresentação */
test("opções vêm ordenadas: mesmo dia primeiro, depois preço", () => {
  const options = Frete.cotar("26275-280", { items: [{ qty: 2 }], subtotal: 100 }).options;
  const dias = options.map((o) => o.dias);
  assert.deepEqual(dias, [...dias].sort((a, b) => a - b));
  assert.equal(options[0].id, "retirada-loja");
});

test("etiqueta, preço e total com frete", () => {
  const op = { id: "correios-pac", transportadora: "Correios", servico: "PAC", preco: 19.9, gratis: false };
  assert.equal(Frete.etiqueta(op), "Correios — PAC");
  assert.equal(Frete.precoTexto(op), "R$ 19,90");
  assert.equal(Frete.precoTexto({ ...op, gratis: true, preco: 0 }), "Grátis");
  assert.equal(Frete.totalComFrete(259.8, op), 279.7);
  assert.equal(Frete.totalComFrete(259.8, null), 259.8);
});

test("linhas da mensagem de WhatsApp", () => {
  const op = {
    id: "correios-pac",
    transportadora: "Correios",
    servico: "PAC",
    preco: 19.9,
    prazoTexto: "2 a 3 dias úteis",
    gratis: false,
  };
  assert.deepEqual(Frete.mensagemFrete(op, "26275-280"), [
    "*Entrega:* Correios — PAC — 2 a 3 dias úteis",
    "*Frete:* R$ 19,90",
    "*CEP de entrega:* 26275-280",
  ]);

  const retirada = { id: "retirada-loja", preco: 0, gratis: true };
  assert.deepEqual(Frete.mensagemFrete(retirada, "26275-280"), [
    "*Entrega:* Retirar na loja (sem custo de frete)",
    "*CEP de entrega:* 26275-280",
  ]);

  assert.deepEqual(Frete.mensagemFrete(null, ""), []);
});

/* --------------------------------------------------- cotação ao vivo */
test("cotarAoVivo sem endpoint devolve null (modo estático)", async () => {
  const resultado = await Frete.cotarAoVivo("26275-280", { items: [], subtotal: 0 });
  assert.equal(resultado, null);
});

test("normaliza opções que vêm da API", () => {
  const opcoes = Frete.normalizarOpcoes([
    { id: "correios-sedex", preco: "27.9", prazoTexto: "1 dia útil", dias: 1, source: "api" },
    { id: "lixo", preco: -5 },
    { id: "", preco: 10 },
    null,
  ]);
  assert.equal(opcoes.length, 1);
  assert.equal(opcoes[0].transportadora, "Correios");
  assert.equal(opcoes[0].preco, 27.9);
  assert.equal(opcoes[0].gratis, false);
});
