const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

const adminJs = read("admin/assets/admin.js");
const sql = read("supabase/migrations/202609170001_operations.sql");
const frete = read("assets/js/frete.js");
const lojas = read("lojas.html");

test("painel define uma única loja de estoque central: a virtual Ecommerce C18", () => {
  assert.match(adminJs, /const STOCK_STORE_ID = "ecommerce-c18";/);
  assert.match(adminJs, /\{ id: "ecommerce-c18", name: "Ecommerce C18", short: "Ecommerce C18", kind: "ecommerce" \}/);
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

test("a migration do Ecommerce C18 passa a marca de estoque para a loja virtual e leva o saldo junto", () => {
  const central = read("supabase/migrations/202609210002_estoque_central_ecommerce.sql");
  assert.match(central, /check \(kind in \('physical', 'ecommerce'\)\)/);
  assert.match(central, /values \('ECOMMERCE-C18', 'Ecommerce C18', 'ecommerce', true\)/);
  /* mesma ordem do set_stock_store(): desmarca a anterior, depois marca a nova */
  const off = central.indexOf("update public.stores set fulfills_stock = false where fulfills_stock and id <> v_new;");
  const on = central.indexOf("update public.stores set fulfills_stock = true where id = v_new;");
  assert.ok(off > -1 && on > off, "desmarcar antes de marcar (índice stores_one_stock_location)");
  /* o saldo que já estava na loja anterior vai para o Ecommerce C18, com movimento nas duas pontas */
  assert.match(central, /'transfer_out'/);
  assert.match(central, /'transfer_in'/);
  assert.match(central, /on conflict \(store_id, variant_id\) do update/);
  assert.match(central, /delete from public\.inventory_balances where store_id = v_old;/);
  /* nada da versão antiga (is_central / central_store_id) sobrou */
  assert.ok(!/is_central|central_store_id/.test(central), "usa fulfills_stock/stock_store_id() do estoque único");
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
