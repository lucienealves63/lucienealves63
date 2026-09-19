const test = require("node:test");
const assert = require("node:assert/strict");
const { bootAdmin } = require("./helpers/admin-dom.js");

/* Executa o painel inteiro (admin/index.html + scripts) num DOM mínimo e
   navega pelas páginas novas: Audiência, Canais & Marketing e Banners.
   Pega erro de elemento nulo, de permissão e de desenho — o tipo de quebra
   que só aparece com o painel rodando de verdade. */

test("o painel carrega os scripts na ordem do index.html e abre na visão geral", () => {
  const panel = bootAdmin();
  assert.deepEqual(panel.loaded, [
    "assets/js/coupons.js",
    "assets/js/analytics.js",
    "admin/assets/config.js",
    "admin/assets/importer.js",
    "admin/assets/channels.js",
    "admin/assets/audience.js",
    "admin/assets/admin.js",
  ]);
  assert.ok(panel.sandbox.C18Channels.CHANNELS.length === 9);
  assert.ok(panel.sandbox.C18Audience.FUNNEL_STEPS.length === 6);
  assert.equal(panel.text("#page-title"), "Visão geral");
  assert.ok(panel.html("#metrics").length > 100, "cartões da visão geral");
  assert.ok(panel.text("#today-label").startsWith("HOJE, "));
});

test("a página de audiência desenha métricas, páginas, calor, origem e funil", () => {
  const panel = bootAdmin();
  panel.navigate("audience");

  assert.equal(panel.text("#page-title"), "Audiência");
  assert.ok(panel.html("#audience-metrics").includes("Sessões"));
  assert.ok(panel.html("#audience-metrics").includes("Páginas vistas"));
  assert.ok(panel.html("#audience-trend").includes("<svg"), "evolução diária em SVG");
  assert.ok(panel.html("#audience-pages").includes("<tr>"), "páginas mais visitadas");
  assert.ok(panel.html("#audience-sources").includes("source-row"), "origem do tráfego");
  assert.ok(panel.html("#audience-funnel").includes("funnel-step"), "funil de compra");
  assert.ok(panel.html("#audience-funnel").includes("Fechou o pedido"), "funil chega até a compra no checkout");
  assert.ok(panel.html("#audience-banners").includes("<tr>"), "banners mais clicados");
  assert.ok(panel.html("#audience-banners").includes("Drop de inverno"), "banner da base de exemplo");
  assert.ok(panel.html("#audience-devices").length > 50);
  assert.ok(panel.html("#audience-scroll").includes("%"));
  assert.ok(panel.html("#audience-heat-zones").includes("heat-zone"), "faixas de calor");
  assert.ok(panel.html("#audience-heat-grid").includes("heat-cell"), "grade de cliques");
  assert.ok(panel.html("#audience-heat-targets").includes("source-row"), "pontos quentes");
  assert.ok(panel.html("#audience-notice").includes("exemplo"), "avisa que a base é de exemplo");

  /* nenhuma seção pode vazar undefined/NaN nem executar script */
  ["#audience-metrics", "#audience-pages", "#audience-sources", "#audience-funnel", "#audience-heat-grid", "#audience-banners"]
    .forEach((selector) => {
      const content = panel.html(selector);
      assert.ok(!content.includes("undefined"), `${selector} com undefined`);
      assert.ok(!content.includes("NaN"), `${selector} com NaN`);
      assert.ok(!/<script/i.test(content), `${selector} com script`);
    });
});

test("a audiência responde ao período, à página do mapa de calor e à base de exemplo", async () => {
  const panel = bootAdmin();
  panel.navigate("audience");
  const before = panel.html("#audience-metrics");

  panel.change("#audience-range", "7");
  await panel.drainTimers();
  const sevenDays = panel.html("#audience-metrics");
  assert.notEqual(sevenDays, before, "trocar o período recalcula os cartões");

  panel.change("#audience-heat-path", "/produtos.html");
  await panel.drainTimers();
  const zones = panel.html("#audience-heat-zones");
  assert.ok(zones.includes("Grade de produtos") || zones.includes("Filtros"), "faixas do catálogo");
  assert.ok(panel.html("#audience-heat-grid").includes("heat-cell"));

  panel.clickElement("#audience-sample");
  await panel.drainTimers();
  assert.equal(panel.text("#audience-sample-label"), "Exemplo desligado");
  assert.ok(panel.html("#audience-notice").includes("Sem visitas medidas ainda")
    || panel.html("#audience-notice").includes("Somente tráfego real"),
    "o aviso muda com a simulação desligada");

  panel.clickElement("#audience-sample");
  await panel.drainTimers();
  assert.equal(panel.text("#audience-sample-label"), "Exemplo ligado");
});

test("a página de canais mostra mídia, marketplaces, feed, listagens e conversões", () => {
  const panel = bootAdmin();
  panel.navigate("channels");

  assert.equal(panel.text("#page-title"), "Canais & Marketing");
  const ads = panel.html("#channel-cards-ads");
  const markets = panel.html("#channel-cards-marketplaces");
  assert.ok(ads.includes("Google Merchant Center"));
  assert.ok(ads.includes("Meta Ads"));
  assert.ok(ads.includes("Google Analytics 4"));
  ["Mercado Livre", "Shopee", "Amazon", "Magazine Luiza", "Americanas"].forEach((name) => {
    assert.ok(markets.includes(name), `${name} precisa aparecer`);
  });
  assert.ok(markets.includes("markup sugerido"), "o painel mostra o markup que cobre a comissão");
  assert.ok(panel.html("#channel-cards-marketplaces").includes("16,3%"), "comissão de 14% → markup de 16,3%");

  assert.ok(panel.html("#feed-head").includes("<th"), "cabeçalho do feed");
  assert.ok(panel.html("#feed-body").includes("<tr>"), "linhas do feed");
  assert.ok(panel.html("#feed-summary").includes("Itens no catálogo"));
  assert.ok(panel.html("#channel-listings").includes("<tr>"), "listagens por canal");
  assert.ok(panel.html("#conversion-map").includes("ViewContent"), "eventos do site → Meta/GA4");
  assert.ok(panel.html("#conversion-map").includes("Purchase"), "a compra do checkout entra no mapa");
  assert.ok(panel.html("#conversion-map").includes("Compra no site"), "ação de conversão padrão do Google Ads");
  assert.ok(panel.html("#channels-notice").includes("Nenhum canal habilitado"));

  /* estoque central: o feed publica o saldo do Ecommerce C18 */
  assert.ok(panel.html("#channels-notice").includes("Estoque publicado: <strong>Ecommerce C18</strong>"), "aviso do estoque central");
  assert.ok(panel.html("#feed-summary").includes("Ecommerce C18"), "chip do estoque publicado");

  /* Google Ads: cartão de medição com CSV de conversões e teste de conexão */
  assert.ok(ads.includes("Google Ads"), "canal Google Ads");
  assert.ok(ads.includes("Vendas com id do anúncio"));
  assert.ok(ads.includes('data-channel-ads-csv="google-ads"'), "botão do CSV de conversões");
  assert.ok(ads.includes('data-channel-test="google-ads"'), "teste de conexão");
});

test("o CSV de conversões do Google Ads sai da base de exemplo com gclid", () => {
  const panel = bootAdmin();
  panel.navigate("channels");
  const downloads = [];
  const originalCreate = panel.sandbox.URL.createObjectURL;
  panel.sandbox.URL.createObjectURL = (blob) => { downloads.push(blob); return "blob:google-ads"; };
  try {
    panel.clickSelector("[data-channel-ads-csv]", { channelAdsCsv: "google-ads" });
  } finally {
    panel.sandbox.URL.createObjectURL = originalCreate;
  }
  assert.equal(downloads.length, 1, "um arquivo baixado");
  const csv = downloads[0].parts.join("");
  const lines = csv.split("\n");
  assert.equal(lines[0], "Google Click ID,Conversion Name,Conversion Time,Conversion Value,Conversion Currency,Order ID");
  assert.ok(lines.length > 1, "a base de exemplo tem compras vindas do Google Ads");
  assert.ok(lines[1].startsWith("demo-gclid-"), "o gclid da sessão vai na primeira coluna");
  assert.ok(lines[1].includes(",Compra no site,"), "nome padrão da ação de conversão");
  assert.ok(/-03:00,/.test(lines[1]), "horário de Brasília");
  assert.ok(!/undefined|NaN/.test(csv));
});

test("o estoque central é a loja virtual Ecommerce C18 e é o saldo dela que vai para os canais", () => {
  const panel = bootAdmin();

  /* etiqueta da página de estoque e campos de importação/movimento presos à loja */
  assert.ok(panel.html("#stock-hub-tag").includes("Estoque central: <b>Ecommerce C18</b>"), "etiqueta do estoque central");
  assert.ok(panel.html("#stock-hub-tag").includes("lojas físicas: ponto de retirada"));
  assert.ok(panel.html("#import-store").includes("Ecommerce C18 — estoque central"), "importação entra no Ecommerce C18");
  assert.ok(panel.html("#manual-store").includes("Ecommerce C18 — estoque central"), "movimento manual entra no Ecommerce C18");

  /* pedidos continuam com a loja de retirada escolhida pela cliente */
  assert.ok(panel.html("#orders-table").includes("NI Calçadão"), "retirada no Calçadão");
  assert.ok(!panel.html("#orders-table").includes("Ecommerce C18"), "a loja virtual não é ponto de retirada");

  panel.navigate("channels");
  panel.get("#feed-channel").value = "mercadolivre";
  panel.get("#feed-channel").fire("change");
  const body = panel.html("#feed-body");
  const rowOf = (code) => body.split("<tr>").find((row) => row.includes(code)) || "";
  /* REGATA SPORT C18 P (0000000080): 12 no Ecommerce C18 → publica 11 (1 de reserva da política) */
  const regata = rowOf("0000000080");
  assert.ok(regata.includes("REGATA SPORT C18"));
  assert.ok(regata.includes('title="11"'), "saldo publicado = saldo do estoque central menos a reserva");
});

test("o feed muda de colunas conforme o canal escolhido", () => {
  const panel = bootAdmin();
  panel.navigate("channels");

  const googleHead = panel.html("#feed-head");
  assert.ok(googleHead.includes("image_link") && googleHead.includes("google_product_category"));
  assert.ok(panel.html("#feed-summary").includes("XML"));

  panel.get("#feed-channel").value = "mercadolivre";
  panel.get("#feed-channel").fire("change");

  const mlHead = panel.html("#feed-head");
  assert.ok(mlHead.includes("available_quantity") && mlHead.includes("picture_source"));
  assert.ok(!mlHead.includes("google_product_category"), "cada canal tem as suas colunas");
  assert.ok(panel.html("#feed-body").includes("MLB1430"), "categoria padrão do Mercado Livre");
});

test("o modal do canal lista segredos e campos públicos sem expor valor", () => {
  const panel = bootAdmin();
  panel.navigate("channels");

  panel.clickSelector("[data-channel-config]", { channelConfig: "meta-ads" });
  const secrets = panel.html("#channel-modal-secrets");
  assert.ok(secrets.includes("META_PIXEL_ID"), "mostra quais segredos existem");
  assert.ok(!secrets.includes("token="), "e nunca o valor");
  assert.ok(panel.html("#channel-modal-operations").includes("op-chip"));

  const fields = panel.html("#channel-modal-config");
  assert.ok(fields.includes("Pixel ID"), "campos públicos do canal");
  assert.ok(!/secret|token/i.test(fields.replace(/Token de acesso/g, "")), "campo de segredo não vira input");
  /* a sugestão é texto, não HTML: mídia não remarca, marketplace remarca */
  assert.ok(panel.text("#channel-modal-suggestion").includes("Canal de mídia"),
    "canal de mídia mantém o preço do site");
  assert.ok(panel.text("#channel-foot-note").includes("Salvar não envia nada"));

  panel.clickSelector("[data-channel-config]", { channelConfig: "mercadolivre" });
  assert.ok(panel.text("#channel-modal-suggestion").includes("markup que mantém a margem"),
    "marketplace mostra o markup que cobre a comissão");
  assert.ok(panel.html("#channel-modal-config").includes("ID do vendedor"), "campos públicos do Mercado Livre");
});

test("publicar no modo demonstração simula e não envia nada", () => {
  const panel = bootAdmin();
  panel.navigate("channels");

  panel.clickSelector("[data-channel-publish]", { channelPublish: "mercadolivre" });
  const markets = panel.html("#channel-cards-marketplaces");
  assert.ok(markets.includes("Prévia gerada") || markets.includes("Simulado"), "o painel diz que foi simulação");
  assert.ok(panel.html("#channels-notice").length > 50);
});

test("banner de categoria: o campo aparece só na posição category-hero", () => {
  const panel = bootAdmin();
  panel.navigate("banners");

  assert.ok(panel.html("#banners-grid").length > 50);
  panel.clickSelector("#new-banner");

  const position = panel.get("#banner-position");
  position.value = "home-hero";
  panel.fireDocument("change", position);
  assert.equal(panel.get("#banner-category-field").hidden, true, "hero da home não pede categoria");

  position.value = "category-hero";
  panel.fireDocument("change", position);
  assert.equal(panel.get("#banner-category-field").hidden, false, "banner de categoria pede a categoria");
  assert.ok(panel.html("#banner-category-options").includes("<option"), "datalist com as categorias do catálogo");
});

test("o painel não mede a própria audiência (o /admin fica de fora)", () => {
  const panel = bootAdmin();
  panel.navigate("audience");
  panel.navigate("channels");
  panel.navigate("overview");

  /* a lista vem de outro realm (vm), então vale o tamanho, não o protótipo */
  const captured = panel.sandbox.C18Analytics.capturedEvents(panel.localStorage);
  assert.equal(captured.length, 0, "nenhum evento do próprio painel pode ser gravado");
  assert.equal(panel.localStorage.getItem("c18:demo-analytics"), null);
});
