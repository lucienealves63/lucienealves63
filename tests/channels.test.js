const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Channels = require("../admin/assets/channels.js");

/* O servidor monta o feed em TypeScript (supabase/functions/_shared/feeds.ts).
   Os dois lados precisam ser idênticos: o painel mostra a prévia, a Edge
   Function publica. Node 22 remove os tipos do .ts na hora de importar. */
const FEEDS_TS = "../supabase/functions/_shared/feeds.ts";

const CHANNEL_IDS = [
  "google-merchant", "meta-ads", "mercadolivre", "shopee",
  "amazon", "magalu", "americanas",
];

const INVENTORY = [
  { reference: "CAM-001", code: "SKU-1", description: "Camiseta Oversized Preta", brand: "CENSURA 18", category: "CAMISETA", collection: "VERÃO", price: 149.9, quantity: 5, reserved: 1, color: "PRETO", size: "M" },
  { reference: "CAM-001", code: "SKU-2", description: "Camiseta Oversized Preta", brand: "CENSURA 18", category: "CAMISETA", collection: "VERÃO", price: 149.9, quantity: 3, reserved: 3, color: "PRETO", size: "G" },
  { reference: "BONE-9", code: "SKU-3", description: "Boné Estruturado", brand: "", category: "", collection: "", price: 0, quantity: 0, reserved: 0 },
];

const SITE_URL = "https://censura18.com.br";

/* ------------------------------------------------------------------ política */

test("política padrão: sem markup, preço psicológico e 1 unidade de reserva", () => {
  assert.deepEqual(Channels.DEFAULT_POLICY, {
    markup: 0,
    rounding: "psychological",
    stockBuffer: 1,
    maxPublished: 0,
    minPrice: 0,
    publishOnlyAvailable: true,
  });
  assert.deepEqual(Channels.normalizePolicy(), Channels.DEFAULT_POLICY);
  assert.deepEqual(Channels.normalizePolicy({ markup: "abc", rounding: "estranho", stockBuffer: -4 }), {
    markup: 0, rounding: "psychological", stockBuffer: 0, maxPublished: 0, minPrice: 0, publishOnlyAvailable: true,
  });
  /* reserva zero é uma escolha válida (publica o saldo inteiro) */
  assert.equal(Channels.normalizePolicy({ stockBuffer: 0 }).stockBuffer, 0);
  assert.equal(Channels.normalizePolicy({ stockBuffer: "" }).stockBuffer, 1, "campo vazio volta ao padrão");
  assert.equal(Channels.normalizePolicy({ stockBuffer: 3 }).stockBuffer, 3);
});

test("arredonda para o preço psicológico ,90", () => {
  assert.equal(Channels.roundPrice(149.86, "psychological"), 149.9);
  assert.equal(Channels.roundPrice(150.2, "psychological"), 149.9);
  assert.equal(Channels.roundPrice(150.2, "cent"), 150.2);
  assert.equal(Channels.roundPrice(0, "psychological"), 0);
  assert.equal(Channels.roundPrice(0.4, "psychological"), 0.9, "nunca publica abaixo de R$ 0,90");
});

test("markup de canal e reserva de estoque", () => {
  const channel = Channels.channelById("mercadolivre");
  assert.equal(channel.fee, 14);
  assert.equal(Channels.suggestedMarkup(14), 16.3, "comissão de 14% exige ~16,3% de markup");
  assert.equal(Channels.suggestedMarkup(0), 0);

  const rules = Channels.normalizePolicy({ markup: 16, stockBuffer: 1 });
  assert.equal(Channels.priceForChannel(149.9, channel, rules), 173.9, "149,90 + 16% = 173,88 → 173,90");
  assert.equal(Channels.stockForChannel(4, channel, rules), 3);
  assert.equal(Channels.stockForChannel(0, channel, rules), 0, "estoque nunca fica negativo");

  const capped = Channels.normalizePolicy({ markup: 0, stockBuffer: 0, maxPublished: 2 });
  assert.equal(Channels.stockForChannel(50, channel, capped), 2, "maxPublished limita o anúncio");

  const floor = Channels.normalizePolicy({ markup: 0, minPrice: 99.9 });
  assert.equal(Channels.priceForChannel(10, channel, floor), 99.9, "minPrice segura o preço mínimo");
});

/* ------------------------------------------------------------------ catálogo */

test("agrupa SKU por loja em item de catálogo (saldo disponível somado)", () => {
  const catalog = Channels.catalogFromInventory(INVENTORY, { siteUrl: SITE_URL });
  assert.equal(catalog.length, 2);

  const camiseta = catalog.find((item) => item.sku === "CAM-001");
  assert.equal(camiseta.stock, 4, "5 em estoque − 1 reservado + 3 − 3 reservado");
  assert.equal(camiseta.title, "Camiseta Oversized Preta");
  assert.equal(camiseta.description, "Camiseta Oversized Preta · CAMISETA · VERÃO");
  assert.deepEqual(camiseta.colors, ["PRETO"]);
  assert.deepEqual(camiseta.sizes, ["M", "G"]);
  assert.equal(camiseta.id, "cam-001-camiseta-oversized-preta");
  assert.equal(camiseta.link, `${SITE_URL}/produto.html?ref=CAM-001`);
  assert.equal(camiseta.availability, "in stock");

  const bone = catalog.find((item) => item.sku === "BONE-9");
  assert.equal(bone.brand, "CENSURA 18", "marca padrão quando a planilha vem vazia");
  assert.equal(bone.availability, "out of stock");

  /* linhas sem referência ou sem descrição não viram anúncio */
  assert.equal(Channels.catalogFromInventory([{ code: "X" }, { reference: "Y", description: "" }]).length, 0);
});

/* --------------------------------------------------------------------- feeds */

test("cada canal tem as colunas da sua especificação", () => {
  assert.deepEqual(Channels.feedColumns("google-merchant"), [
    "id", "title", "description", "link", "image_link", "availability", "price", "brand",
    "condition", "item_group_id", "google_product_category", "identifier_exists",
    "custom_label_0", "custom_label_1", "custom_label_2",
  ]);
  assert.deepEqual(Channels.feedColumns("mercadolivre"), [
    "title", "category_id", "price", "currency_id", "available_quantity", "condition",
    "description", "picture_source", "attributes", "shipping",
  ]);
  assert.deepEqual(Channels.feedColumns("amazon"), [
    "sku", "product-id", "item-name", "brand", "price", "quantity", "product-description",
    "main-image-url", "condition-type", "update-delete",
  ]);
  assert.deepEqual(Channels.feedColumns("magalu"), Channels.feedColumns("americanas"));
  assert.deepEqual(Channels.feedColumns("canal-novo"), ["sku", "title", "price", "stock"]);
});

test("monta a linha do Google Merchant com preço no formato exigido", () => {
  const [item] = Channels.catalogFromInventory(INVENTORY, { siteUrl: SITE_URL });
  const row = Channels.buildFeedRow(item, "google-merchant", { markup: 8 });
  assert.equal(row.price, "161.90 BRL");
  assert.equal(row.availability, "in stock");
  assert.equal(row.identifier_exists, "FALSE", "sem GTIN o Google limita o alcance");
  assert.equal(row.google_product_category, "Apparel & Accessories > Clothing");
  assert.equal(row.custom_label_0, "VERÃO");
  assert.equal(row.custom_label_1, "CAMISETA");
  assert.equal(row.custom_label_2, "disponivel");
  assert.deepEqual(Channels.validateFeedRow(row, "google-merchant"), []);
});

test("Mercado Livre: frete grátis acima de R$ 299 e atributos em JSON", () => {
  const [item] = Channels.catalogFromInventory(INVENTORY, { siteUrl: SITE_URL });
  const row = Channels.buildFeedRow(item, "mercadolivre", { markup: 0, stockBuffer: 0 });
  assert.equal(row.currency_id, "BRL");
  assert.equal(row.available_quantity, 4);
  assert.deepEqual(JSON.parse(row.shipping), { mode: "me2", free_shipping: false });

  const caro = Channels.buildFeedRow({ ...item, price: 320 }, "mercadolivre", { markup: 0, stockBuffer: 0 });
  assert.deepEqual(JSON.parse(caro.shipping), { mode: "me2", free_shipping: true });

  const attributes = JSON.parse(row.attributes);
  assert.deepEqual(attributes.map((attribute) => attribute.id), ["BRAND", "MODEL", "COLOR", "SIZE"]);
  assert.equal(attributes[2].value_name, "PRETO");
});

test("Shopee mostra preço 'de' maior que o preço atual", () => {
  const [item] = Channels.catalogFromInventory(INVENTORY, { siteUrl: SITE_URL });
  const row = Channels.buildFeedRow(item, "shopee", { markup: 0, stockBuffer: 0 });
  assert.equal(row.current_price, "149.90");
  assert.ok(Number(row.original_price) > Number(row.current_price));
  assert.equal(row.category_id, "100629");
});

test("Amazon, Magalu e Americanas exigem EAN/GTIN", () => {
  const [item] = Channels.catalogFromInventory(INVENTORY, { siteUrl: SITE_URL });
  ["amazon", "magalu", "americanas"].forEach((channelId) => {
    const row = Channels.buildFeedRow(item, channelId, { markup: 0, stockBuffer: 0 });
    assert.deepEqual(Channels.validateFeedRow(row, channelId), [
      "Sem EAN/GTIN (obrigatório neste marketplace)",
    ]);
    const withGtin = Channels.buildFeedRow({ ...item, gtin: "7891234567890" }, channelId, { markup: 0, stockBuffer: 0 });
    assert.deepEqual(Channels.validateFeedRow(withGtin, channelId), []);
  });
});

test("aponta as pendências que impedem a publicação", () => {
  const broken = Channels.buildFeedRow(
    { id: "x", sku: "X", title: "", price: 0, stock: 0, link: "", image_link: "" },
    "google-merchant",
    { markup: 0, stockBuffer: 0 },
  );
  const problems = Channels.validateFeedRow(broken, "google-merchant");
  assert.ok(problems.includes("Título vazio"));
  assert.ok(problems.includes("Preço inválido"));
  assert.ok(problems.includes("Sem link do produto"));
  assert.ok(problems.includes("Sem imagem"));

  const relativeImage = Channels.buildFeedRow(
    { id: "y", sku: "Y", title: "Boné", price: 89.9, stock: 2, link: "https://censura18.com.br/produto.html?ref=Y", image_link: "assets/img/produtos/bone.jpg" },
    "meta-ads",
    { markup: 0, stockBuffer: 0 },
  );
  assert.deepEqual(Channels.validateFeedRow(relativeImage, "meta-ads"), [
    "Imagem precisa de URL pública (https)",
  ]);

  /* o painel trunca o título em 150; a validação pega linha vinda de fora */
  const longTitle = { title: "T".repeat(180), price: "10.00 BRL", link: "https://censura18.com.br/p", image_link: "https://censura18.com.br/i.jpg" };
  assert.ok(Channels.validateFeedRow(longTitle, "meta-ads").includes("Título acima de 150 caracteres"));
  assert.equal(
    Channels.buildFeedRow({ id: "z", sku: "Z", title: "T".repeat(180), price: 10, stock: 1 }, "meta-ads").title.length,
    150,
    "o feed nunca passa de 150 caracteres de título",
  );
});

test("status da listagem: rascunho, publicado, sem estoque, pausado", () => {
  assert.equal(Channels.listingStatus({ price: 0, stock: 3 }), "draft");
  assert.equal(Channels.listingStatus({ price: 10, stock: 3 }), "published");
  assert.equal(Channels.listingStatus({ price: 10, stock: 0 }), "out_of_stock");
  assert.equal(Channels.listingStatus({ price: 10, stock: 3, paused: true }), "paused");
  assert.equal(Channels.listingStatus({ price: 10, stock: 3, error: true }), "error");
  ["draft", "published", "out_of_stock", "paused", "error"].forEach((status) => {
    assert.ok(Channels.LISTING_STATUS_LABELS[status], `${status} precisa de rótulo em português`);
  });
});

test("exporta nos formatos CSV, TSV e XML do Google", () => {
  const catalog = Channels.catalogFromInventory(INVENTORY, { siteUrl: SITE_URL });
  const rows = catalog.map((item) => Channels.buildFeedRow(item, "google-merchant", { markup: 8 }));

  const csv = Channels.toCsv(rows, "google-merchant");
  const lines = csv.split("\n");
  assert.equal(lines.length, 3, "cabeçalho + 2 itens");
  assert.equal(lines[0], Channels.feedColumns("google-merchant").join(","));
  assert.equal(lines[1].split(",").length, Channels.feedColumns("google-merchant").length);

  const tsv = Channels.toTsv(catalog.map((item) => Channels.buildFeedRow(item, "amazon", {})), "amazon");
  assert.equal(tsv.split("\n")[0].split("\t")[0], "sku");
  assert.ok(!tsv.includes(","), "TSV não usa vírgula como separador");

  const xml = Channels.toGoogleXml(rows, { link: SITE_URL, title: "Censura 18 — Google Merchant Center" });
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.ok(xml.includes('xmlns:g="http://base.google.com/ns/1.0"'));
  assert.equal((xml.match(/<item>/g) || []).length, 2);
  assert.ok(xml.includes("<g:price>161.90 BRL</g:price>"));

  /* título com caracteres especiais não quebra o XML */
  const tricky = Channels.toGoogleXml([{ ...rows[0], title: "Camiseta <oversized> & \"nova\"" }]);
  assert.ok(tricky.includes("Camiseta &lt;oversized&gt; &amp; &quot;nova&quot;"));
  assert.ok(!tricky.includes("<oversized>"));
});

test("canais prontos: mídia, medição e os marketplaces mais usados", () => {
  const ids = Channels.CHANNELS.map((channel) => channel.id);
  ["google-merchant", "meta-ads", "ga4", "mercadolivre", "shopee", "amazon", "magalu", "americanas"]
    .forEach((id) => assert.ok(ids.includes(id), `${id} precisa estar pronto`));

  assert.deepEqual(Channels.marketplaces().map((channel) => channel.id), [
    "mercadolivre", "shopee", "amazon", "magalu", "americanas",
  ]);
  assert.ok(Channels.adChannels().some((channel) => channel.id === "google-merchant"));
  assert.equal(Channels.channelById("ga4").kind, "measurement");

  /* cada canal declara segredos (servidor) e campos públicos (painel) */
  Channels.CHANNELS.forEach((channel) => {
    assert.ok(channel.secrets.length >= 1, `${channel.id} precisa declarar segredos`);
    assert.ok(channel.operations.length >= 1, `${channel.id} precisa declarar operações`);
    assert.ok(channel.docs.startsWith("https://"), `${channel.id} precisa de documentação`);
    channel.secrets.forEach((secret) => {
      assert.match(secret.name, /^[A-Z0-9_]+$/, `${secret.name} precisa ser variável de ambiente`);
      assert.ok(secret.label.length > 3);
    });
    channel.fields.forEach((field) => {
      assert.ok(field.key && field.label);
      assert.ok(!/token|secret|password|key/i.test(field.key), `${field.key}: segredo não vira campo do painel`);
    });
  });
});

test("mapa de conversões liga o evento do site à Meta e ao GA4", () => {
  assert.deepEqual(Channels.CONVERSION_EVENTS.map((event) => event.site), [
    "page_view", "product_view", "category_view", "search", "add_to_cart", "checkout_intent", "whatsapp",
  ]);
  const cart = Channels.CONVERSION_EVENTS.find((event) => event.site === "add_to_cart");
  assert.equal(cart.meta, "AddToCart");
  assert.equal(cart.ga4, "add_to_cart");
  Channels.CONVERSION_EVENTS.forEach((event) => {
    assert.ok(event.label, `${event.site} precisa de rótulo`);
    assert.ok(event.meta && event.ga4);
  });
});

/* ------------------------------------------------ painel (JS) × servidor (TS) */

test("o feed do servidor é idêntico à prévia do painel", async () => {
  const TS = await import(FEEDS_TS);

  CHANNEL_IDS.concat(["canal-novo"]).forEach((id) => {
    assert.deepEqual(TS.feedColumns(id), Channels.feedColumns(id), `colunas de ${id}`);
  });
  Channels.CHANNELS.forEach((channel) => {
    assert.equal(TS.feedFormat(channel.id), channel.feedFormat, `formato de ${channel.id}`);
  });
  assert.deepEqual(TS.DEFAULT_POLICY, Channels.DEFAULT_POLICY);
  assert.deepEqual(TS.CONVERSION_EVENTS, Channels.CONVERSION_EVENTS);

  const catalogJs = Channels.catalogFromInventory(INVENTORY, { siteUrl: SITE_URL });
  const catalogTs = TS.catalogFromInventory(INVENTORY, { siteUrl: SITE_URL });
  assert.deepEqual(catalogTs, catalogJs, "catálogo a partir do estoque");

  const policies = [
    undefined, {}, { markup: 16 }, { markup: 18.5, rounding: "cent" },
    { markup: 0, rounding: "none", stockBuffer: 0, maxPublished: 2 },
    { minPrice: 99.9, markup: 5 }, { publishOnlyAvailable: false, markup: -10 },
  ];
  policies.forEach((policy, index) => {
    assert.deepEqual(TS.normalizePolicy(policy), Channels.normalizePolicy(policy), `política ${index}`);
    CHANNEL_IDS.forEach((id) => {
      const channel = Channels.channelById(id);
      catalogJs.forEach((item, itemIndex) => {
        const rowJs = Channels.buildFeedRow(item, id, policy);
        const rowTs = TS.buildFeedRow(item, id, policy, channel);
        assert.deepEqual(rowTs, rowJs, `linha ${id}#${itemIndex} política ${index}`);
        assert.deepEqual(TS.validateFeedRow(rowTs, id), Channels.validateFeedRow(rowJs, id));
      });
    });
  });

  [0, 0.5, 49.9, 99.95, 149.86, 150.2, 299, 1234.567].forEach((value) => {
    ["psychological", "cent", "none"].forEach((mode) => {
      assert.equal(TS.roundPrice(value, mode), Channels.roundPrice(value, mode), `roundPrice(${value}, ${mode})`);
    });
  });
  [0, 5, 12, 14, 15, 16, 19, 25, 80].forEach((fee) => {
    assert.equal(TS.suggestedMarkup(fee), Channels.suggestedMarkup(fee), `suggestedMarkup(${fee})`);
  });
  ["Camiseta Oversized", "BONE-9", "Açaí / Pará", ""].forEach((value) => {
    assert.equal(TS.slugify(value), Channels.slugify(value), `slugify(${value})`);
  });

  const rowsJs = catalogJs.map((item) => Channels.buildFeedRow(item, "google-merchant", { markup: 8 }));
  const rowsTs = catalogTs.map((item) => TS.buildFeedRow(item, "google-merchant", { markup: 8 }));
  assert.equal(TS.toGoogleXml(rowsTs, { link: SITE_URL }), Channels.toGoogleXml(rowsJs, { link: SITE_URL }));
  assert.equal(TS.toCsv(rowsTs, "google-merchant"), Channels.toCsv(rowsJs, "google-merchant"));
  assert.equal(
    TS.renderFeed(rowsTs, "google-merchant", { link: SITE_URL }),
    Channels.toGoogleXml(rowsJs, { link: SITE_URL }),
    "renderFeed escolhe XML para o Google",
  );
  assert.equal(
    TS.renderFeed(rowsTs.map((row) => TS.buildFeedRow(row, "amazon", {})), "amazon"),
    TS.toTsv(rowsTs.map((row) => TS.buildFeedRow(row, "amazon", {})), "amazon"),
  );
});

test("o seed do banco tem os mesmos canais do painel", () => {
  const migration = fs.readFileSync(
    path.join(__dirname, "..", "supabase", "migrations", "202609180005_sales_channels.sql"),
    "utf8",
  );
  const seeded = new Map();
  const pattern = /\('([a-z0-9-]+)', '([^']+)', '(feed|marketplace|measurement)', false, 'pending'[\s\S]*?'markup', (\d+)\)[\s\S]*?'(xml|csv|tsv|json)'\)/g;
  let match = pattern.exec(migration);
  while (match) {
    seeded.set(match[1], { name: match[2], kind: match[3], markup: Number(match[4]), feedFormat: match[5] });
    match = pattern.exec(migration);
  }

  assert.equal(seeded.size, Channels.CHANNELS.length, "todos os canais do painel precisam nascer no banco");
  Channels.CHANNELS.forEach((channel) => {
    const row = seeded.get(channel.id);
    assert.ok(row, `${channel.id} falta no seed`);
    assert.equal(row.name, channel.name);
    assert.equal(row.kind, channel.kind);
    assert.equal(row.feedFormat, channel.feedFormat);
    assert.equal(row.markup, (channel.policy || Channels.DEFAULT_POLICY).markup, `markup padrão de ${channel.id}`);
  });

  /* habilitar sem os campos públicos obrigatórios precisa ser recusado */
  const required = /when '([a-z0-9-]+)' then array\[([^\]]*)\]/g;
  const requiredFields = new Map();
  let rule = required.exec(migration);
  while (rule) {
    requiredFields.set(rule[1], (rule[2].match(/'[^']+'/g) || []).map((value) => value.replace(/'/g, "")));
    rule = required.exec(migration);
  }
  Channels.CHANNELS.forEach((channel) => {
    const expected = channel.fields.filter((field) => field.required).map((field) => field.key);
    assert.deepEqual(requiredFields.get(channel.id) || [], expected, `campos obrigatórios de ${channel.id}`);
  });
});
