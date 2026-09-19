const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

const adminJs = read("admin/assets/admin.js");
const sql = read("supabase/migrations/202609170001_operations.sql");
const frete = read("assets/js/frete.js");
const lojas = read("lojas.html");

test("painel define uma única loja de estoque central", () => {
  assert.match(adminJs, /const STOCK_STORE_ID = "ni-calcadao";/);
});

test("sementes do painel concentram saldo e movimentos na loja de estoque", () => {
  // Bloco semeado: estoque, movimentos e recebimentos (pedidos ficam fora —
  // a loja do pedido é o ponto de retirada escolhido pelo cliente).
  const start = adminJs.indexOf("const seedInventory");
  const end = adminJs.indexOf("const seedIntegrations");
  const seed = adminJs.slice(start, end);
  const semPedidos = seed
    .slice(seed.indexOf("const seedMovements"));
  assert.match(seed, /STOCK_STORE_ID/);
  assert.ok(
    !/"ni-top"|"caxias"|"nilopolis"|"queimados"|"ni-beco"/.test(semPedidos),
    "movimento/recebimento semeado em loja que não é a do estoque central"
  );
});

test("importação e movimento manual ficam presos à loja de estoque central", () => {
  assert.match(adminJs, /estoque central<\/option>/);
  assert.ok(
    !adminJs.includes("#inventory-store"),
    "o filtro por loja saiu da tela de estoque (existe uma só)"
  );
});

test("SQL marca uma única loja com estoque e permite trocar pelo RPC", () => {
  assert.match(sql, /fulfills_stock boolean not null default false/);
  assert.match(sql, /create unique index stores_one_stock_location/);
  assert.match(sql, /update public\.stores set fulfills_stock = \(code = 'NI-CALCADAO'\);/);
  assert.match(sql, /function public\.stock_store_id\(\)/);
  assert.match(sql, /function public\.set_stock_store\(p_code text\)/);
});

test("RPCs de importação e ajuste ignoram a loja recebida e usam a central", () => {
  const uses = sql.match(/p_store_id := public\.stock_store_id\(\);/g) || [];
  assert.equal(
    uses.length,
    2,
    "import_inventory_rows e adjust_inventory_stock devem forçar a loja central"
  );
});

test("site mantém as 6 lojas como pontos de retirada", () => {
  assert.match(frete, /"retirada-loja"/);
  assert.match(lojas, /ponto de retirada/);
});
