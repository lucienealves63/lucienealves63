const test = require("node:test");
const assert = require("node:assert/strict");
const importer = require("../admin/assets/importer.js");

const source = [
  {
    "Cód Produto": "0000000063",
    Descrição: "SHORT FOLHAS",
    Comprador: "CENSURA 18",
    Coleção: "VERÃO 08",
    Grupo: "SHORT",
    VAREJO: "R$ 15,00",
    "Qtd Estoque": "1",
    Cor: "UNICA",
    Tamanho: "P",
    "E-Commerce": "0",
  },
  {
    "Cód Produto": "0000000946",
    Descrição: "XADREZ BORDADA",
    Comprador: "CENSURA 18",
    Coleção: "VERÃO 09",
    Grupo: "MOCHILA",
    VAREJO: "R$ 49,90",
    "Qtd Estoque": 3,
    Cor: "PRETO",
    Tamanho: "UNIC",
    "E-Commerce": 1,
  },
];

test("mapeia os cabeçalhos do relatório Alterdata", () => {
  const result = importer.mapRows(source);
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows[0].brand, "CENSURA 18");
  assert.equal(result.rows[0].category, "SHORT");
  assert.equal(result.rows[0].reference, "0000000063");
  assert.equal(result.rows[0].price, 15);
  assert.equal(result.rows[1].ecommerce, true);
});

test("preserva zeros à esquerda quando a planilha entrega texto", () => {
  const { rows } = importer.mapRows(source);
  assert.equal(rows[0].code, "0000000063");
});

test("recompõe o código Alterdata de 10 dígitos quando o Excel entrega número", () => {
  const numericCode = [{ ...source[0], "Cód Produto": 63 }];
  const { rows } = importer.mapRows(numericCode);
  assert.equal(rows[0].code, "0000000063");
});

test("filtra por coleção usando checkboxes", () => {
  const { rows } = importer.mapRows(source);
  const filtered = importer.filterRows(rows, {
    mode: "collection",
    collections: ["VERÃO 09"],
  });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].description, "XADREZ BORDADA");
});

test("filtra referência por digitação parcial", () => {
  const { rows } = importer.mapRows(source);
  const filtered = importer.filterRows(rows, {
    mode: "reference",
    typedReference: "946",
  });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].code, "0000000946");
});

test("calcula resumo das linhas selecionadas", () => {
  const { rows } = importer.mapRows(source);
  const summary = importer.summarize(rows);
  assert.equal(summary.rows, 2);
  assert.equal(summary.collections, 2);
  assert.equal(summary.units, 4);
  assert.equal(summary.value, 164.7);
});

test("aceita Marca e Categoria como cabeçalhos alternativos", () => {
  const result = importer.mapRows([
    {
      SKU: "ABC-1",
      Produto: "CAMISETA",
      Marca: "MARCA TESTE",
      Colecao: "INVERNO 26",
      Categoria: "T SHIRT",
      Preco: "129,90",
      Estoque: "5",
    },
  ]);
  assert.equal(result.rows[0].brand, "MARCA TESTE");
  assert.equal(result.rows[0].category, "T SHIRT");
  assert.equal(result.rows[0].price, 129.9);
});

test("remove linhas inválidas da seleção e informa os erros", () => {
  const invalid = [
    { ...source[0], "Cód Produto": "", Descrição: "SEM CÓDIGO" },
    { ...source[1], "Qtd Estoque": -2 },
    source[0],
  ];
  const result = importer.mapRows(invalid);
  assert.equal(result.rows.length, 1);
  assert.match(result.errors.join(" "), /código vazio/i);
  assert.match(result.errors.join(" "), /estoque negativo/i);
});
