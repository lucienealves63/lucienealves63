const test = require("node:test");
const assert = require("node:assert/strict");
const analytics = require("../assets/js/analytics.js");

/* ------------------------------------------------------------------ origem */

test("classifica a origem do tráfego (UTM tem prioridade sobre o referrer)", () => {
  assert.equal(analytics.classifySource({}).channel, "direct");
  assert.equal(
    analytics.classifySource({ referrer: "https://www.google.com.br/search?q=censura+18" }).channel,
    "organic",
  );
  assert.equal(analytics.classifySource({ referrer: "https://instagram.com/p/abc" }).channel, "social");
  assert.equal(analytics.classifySource({ referrer: "https://blogdemoda.com.br/post" }).channel, "referral");
  assert.equal(analytics.classifySource({ utm: { source: "meta", medium: "cpc" } }).channel, "paid");
  assert.equal(analytics.classifySource({ utm: { source: "newsletter", medium: "email" } }).channel, "email");
  assert.equal(analytics.classifySource({ utm: { source: "parceiro", medium: "afiliados" } }).channel, "referral");
  assert.equal(analytics.classifySource({ utm: { source: "loja-fisica", medium: "qr-code" } }).channel, "campaign");

  /* clique interno não conta como origem externa */
  const internal = analytics.classifySource({
    referrer: "https://censura18.com.br/produtos.html",
    origin: "https://censura18.com.br",
  });
  assert.equal(internal.channel, "direct");
});

test("reconhece clique de anúncio sem UTM (gclid, fbclid, ttclid)", () => {
  assert.deepEqual(analytics.utmFromSearch("?gclid=abc"), { source: "google", medium: "cpc" });
  assert.deepEqual(analytics.utmFromSearch("?fbclid=xyz"), { source: "facebook", medium: "cpc" });
  assert.deepEqual(analytics.utmFromSearch("?ttclid=123"), { source: "tiktok", medium: "cpc" });
  assert.deepEqual(
    analytics.utmFromSearch("?utm_source=instagram&utm_medium=social&utm_campaign=drop&utm_content=story&gclid=abc"),
    { source: "instagram", medium: "social", campaign: "drop", content: "story" },
  );
  assert.equal(analytics.classifySource({ utm: analytics.utmFromSearch("?fbclid=xyz") }).channel, "paid");
  assert.deepEqual(analytics.utmFromSearch(""), {});
});

test("normaliza caminhos (query, hash, index e o prefixo do GitHub Pages)", () => {
  assert.equal(analytics.normalizePath("/produtos.html?categoria=camisetas#grade"), "/produtos.html");
  assert.equal(analytics.normalizePath("https://censura18.com.br/index.html"), "/");
  assert.equal(analytics.normalizePath("/lucienealves63/produtos.html"), "/produtos.html");
  assert.equal(analytics.normalizePath("produto.html"), "/produto.html");
  assert.equal(analytics.normalizePath(""), "/");
  assert.equal(analytics.pageLabel("/produtos.html"), "Catálogo");
  assert.equal(analytics.pageLabel("/"), "Home");
});

test("identifica o dispositivo sem guardar o user-agent", () => {
  const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";
  assert.equal(analytics.deviceType({ userAgent: iphone }), "mobile");
  assert.equal(analytics.deviceType({ userAgent: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)" }), "tablet");
  assert.equal(analytics.deviceType({ userAgent: "", width: 1440 }), "desktop");
  assert.equal(analytics.deviceType({ userAgent: "", width: 390 }), "mobile");
  assert.equal(analytics.deviceType({ userAgent: "", width: 800 }), "tablet");
});

test("divide a página em faixas para a região de calor", () => {
  const zones = analytics.zonesFor("/produtos.html");
  assert.ok(Array.isArray(zones) && zones.length >= 3, "o catálogo precisa de faixas mapeadas");
  zones.forEach((zone) => {
    assert.equal(typeof zone.id, "string");
    assert.equal(typeof zone.label, "string");
    assert.ok(zone.from >= 0 && zone.to <= 1 && zone.to > zone.from);
  });
  assert.equal(analytics.zoneAt("/produtos.html", 0).id, zones[0].id);
  assert.equal(analytics.zoneAt("/produtos.html", 1).id, zones[zones.length - 1].id);
  /* página sem mapeamento usa as faixas genéricas */
  assert.ok(analytics.zonesFor("/pagina-nova.html").length >= 3);
});

/* ------------------------------------------------------------- mapa de calor */

test("monta a grade do mapa de calor (cols × rows, intensidade relativa)", () => {
  const events = [
    { kind: "click", path: "/produtos.html", x_ratio: 0.5, y_ratio: 0.5 },
    { kind: "click", path: "/produtos.html", x_ratio: 0.5, y_ratio: 0.5 },
    { kind: "click", path: "/produtos.html", x_ratio: 1, y_ratio: 1 },
    { kind: "click", path: "/", x_ratio: 0.1, y_ratio: 0.1 },
    { kind: "page_view", path: "/produtos.html" },
  ];
  const heat = analytics.buildHeat(events, { path: "/produtos.html", cols: 12, rows: 18 });

  assert.equal(heat.cells.length, 12 * 18);
  assert.equal(heat.max, 2);
  assert.equal(heat.path, "/produtos.html");

  const middle = heat.cells.find((cell) => cell.key === "6x9");
  assert.equal(middle.clicks, 2);
  assert.equal(middle.intensity, 1);

  const corner = heat.cells.find((cell) => cell.key === "11x17");
  assert.equal(corner.clicks, 1);
  assert.equal(corner.intensity, 0.5);

  /* só os cliques da página escolhida entram na grade */
  assert.equal(heat.cells.filter((cell) => cell.clicks > 0).length, 2);
});

/* ---------------------------------------------------------------- agregação */

function sampleEvents() {
  const now = Date.now();
  const at = (minutesAgo) => new Date(now - minutesAgo * 60_000).toISOString();
  return [
    /* sessão 1: duas páginas, rolagem, clique e conversão */
    { kind: "page_view", session_id: "s1", visitor_id: "v1", occurred_at: at(60), path: "/", channel: "organic", referrer_host: "google.com.br", device: "mobile", region: { city: "Nova Iguaçu", state: "RJ" } },
    { kind: "page_view", session_id: "s1", visitor_id: "v1", occurred_at: at(59), path: "/produtos.html", channel: "organic", device: "mobile", utm: { source: "instagram", medium: "social", campaign: "drop-semanal" } },
    { kind: "product_view", session_id: "s1", visitor_id: "v1", occurred_at: at(58), path: "/produtos.html", product_id: "CAM-001", value: 149.9 },
    { kind: "click", session_id: "s1", visitor_id: "v1", occurred_at: at(57), path: "/produtos.html", zone: "Filtros e ordenação", target: "select#ordenar", x_ratio: 0.2, y_ratio: 0.3 },
    { kind: "scroll", session_id: "s1", visitor_id: "v1", occurred_at: at(56), path: "/produtos.html", scroll_ratio: 0.8 },
    { kind: "engagement", session_id: "s1", visitor_id: "v1", occurred_at: at(55), path: "/produtos.html", value: 75 },
    { kind: "add_to_cart", session_id: "s1", visitor_id: "v1", occurred_at: at(54), path: "/produtos.html", value: 149.9 },
    /* sessão 2: entra e sai (rejeição) */
    { kind: "page_view", session_id: "s2", visitor_id: "v2", occurred_at: at(20), path: "/", channel: "direct", device: "desktop" },
    { kind: "engagement", session_id: "s2", visitor_id: "v2", occurred_at: at(19), path: "/", value: 4 },
  ];
}

test("agrega o relatório de audiência no formato que o painel desenha", () => {
  const report = analytics.aggregate(sampleEvents(), { days: 1 });

  assert.equal(report.totals.sessions, 2);
  assert.equal(report.totals.pageviews, 3);
  assert.equal(report.totals.visitors, 2);
  assert.equal(report.totals.conversions, 1);
  assert.equal(report.totals.conversionRate, 50);
  assert.equal(report.totals.bounceRate, 50);
  assert.equal(report.totals.avgScroll, 80);
  assert.equal(report.totals.pagesPerSession, 1.5);
  assert.equal(report.totals.avgSeconds, 40);

  /* páginas mais visitadas, com conversão atribuída à página */
  assert.equal(report.pages[0].path, "/");
  assert.equal(report.pages[0].views, 2);
  assert.equal(report.pages[0].label, "Home");
  const catalog = report.pages.find((page) => page.path === "/produtos.html");
  assert.equal(catalog.views, 1);
  assert.equal(catalog.conversions, 1);

  /* origem do tráfego e campanha UTM */
  const organic = report.sources.find((source) => source.channel === "organic");
  assert.equal(organic.sessions, 1);
  assert.equal(organic.conversions, 1);
  assert.equal(organic.label, "Busca orgânica");
  assert.equal(report.referrers[0].host, "google.com.br");
  assert.equal(report.campaigns[0].campaign, "drop-semanal");

  /* dispositivos, cidades, regiões de calor e rolagem */
  assert.equal(report.devices.length, 2);
  assert.equal(report.locations[0].name, "Nova Iguaçu · RJ");
  assert.equal(report.zones[0].label, "Filtros e ordenação");
  assert.equal(report.targets[0].target, "select#ordenar");
  assert.equal(report.scroll[0].milestones["75"], 100);
  assert.equal(report.scroll[0].milestones["100"], 0);
  assert.equal(report.heat.cells.length, 12 * 18);
  /* a evolução diária agrupa no fuso de São Paulo: perto da meia-noite os
     eventos de teste podem cair em dois dias, então vale a soma */
  assert.ok(report.trend.length >= 1 && report.trend.length <= 2);
  assert.equal(report.trend.reduce((sum, day) => sum + day.pageviews, 0), 3);
  assert.equal(report.trend.reduce((sum, day) => sum + day.sessions, 0), 2);
  assert.equal(report.trend.reduce((sum, day) => sum + day.conversions, 0), 1);
});

test("relatório vazio mantém a estrutura completa", () => {
  const empty = analytics.aggregate([], { days: 7 });
  assert.equal(empty.totals.sessions, 0);
  assert.deepEqual(empty.pages, []);
  assert.equal(empty.heat.cells.length, 0);
  assert.equal(analytics.emptyReport({ days: 7 }).days, 7);
  /* eventos fora do período não entram */
  const old = analytics.aggregate(
    [{ kind: "page_view", session_id: "s1", occurred_at: new Date(Date.now() - 90 * 86400000).toISOString(), path: "/" }],
    { days: 7 },
  );
  assert.equal(old.totals.sessions, 0);
});

test("eventos de negócio usam os tipos conhecidos", () => {
  ["page_view", "click", "scroll", "engagement", "product_view", "category_view", "add_to_cart", "search", "checkout_intent", "whatsapp", "banner_view", "banner_click", "purchase"]
    .forEach((kind) => assert.ok(analytics.EVENT_KINDS.includes(kind), `${kind} precisa ser um tipo válido`));
  assert.deepEqual(analytics.CONVERSION_KINDS, ["add_to_cart", "checkout_intent", "whatsapp", "purchase"]);
  assert.deepEqual(analytics.CLICK_ID_KEYS, ["gclid", "gbraid", "wbraid", "fbclid"]);
  assert.deepEqual(Object.keys(analytics.BANNER_POSITIONS), ["home-hero", "category-hero"]);
  /* sem navegador e sem consentimento, nada é gravado */
  assert.equal(analytics.track("evento_inventado"), false);
});

test("identificadores de clique do Google Ads e da Meta ficam guardados com a UTM", () => {
  const utm = analytics.utmFromSearch("?utm_source=google&utm_medium=cpc&gclid=Cj0KCQjw_abc-123&fbclid=IwAR2xyz&gbraid=x&outro=1");
  assert.equal(utm.source, "google");
  assert.equal(utm.medium, "cpc");
  assert.equal(utm.gclid, "Cj0KCQjw_abc-123");
  assert.equal(utm.fbclid, "IwAR2xyz");
  assert.equal(utm.gbraid, undefined, "identificador curto demais é descartado");
  assert.equal(utm.outro, undefined, "parâmetro desconhecido não entra");
  const rejected = analytics.utmFromSearch("?gclid=<script>alert(1)</script>");
  assert.equal(rejected.gclid, undefined);
  assert.equal(rejected.source, "google", "só o gclid já marca a origem como Google Ads");
  /* modo demo do relatório: a sessão vinda do anúncio guarda o gclid */
  const [event] = analytics.demoEvents({ days: 7, seed: 18 }).filter((item) => item.utm && item.utm.gclid);
  assert.ok(event, "a base de exemplo traz sessões com gclid");
});

test("banners mais clicados: exibições, cliques, CTR, sessões e conversões", () => {
  const at = new Date().toISOString();
  const base = { path: "/", occurred_at: at, channel: "direct", device: "mobile" };
  const drop = { banner_id: "banner-drop", banner_name: "Drop de inverno", zone: "home-hero" };
  const padrao = { banner_id: "banner-padrao", banner_name: "Padrão", zone: "home-hero" };
  const events = [
    { ...base, kind: "page_view", session_id: "s1" },
    { ...base, ...drop, kind: "banner_view", session_id: "s1", target: "Drop de inverno" },
    { ...base, ...drop, kind: "banner_click", session_id: "s1", target: "Ver coleção" },
    { ...base, ...drop, kind: "banner_click", session_id: "s1", target: "Ver coleção" },
    { ...base, kind: "add_to_cart", session_id: "s1", target: "Camiseta" },
    { ...base, kind: "page_view", session_id: "s2" },
    { ...base, ...drop, kind: "banner_view", session_id: "s2", target: "Drop de inverno" },
    { ...base, ...padrao, kind: "banner_view", session_id: "s2", target: "Padrão" },
    { ...base, ...padrao, kind: "banner_click", session_id: "s2", target: "Imagem" },
    { ...base, kind: "page_view", session_id: "s3", path: "/produtos.html" },
    { ...base, kind: "banner_view", session_id: "s3", path: "/produtos.html", banner_id: "banner-cat", banner_name: "Moletons", zone: "category-hero", target: "Moletons" },
  ];
  const report = analytics.aggregate(events, { days: 7 });
  assert.deepEqual(report.banners.map((banner) => banner.id), ["banner-drop", "banner-padrao", "banner-cat"]);
  const [first, second, third] = report.banners;
  assert.equal(first.name, "Drop de inverno");
  assert.equal(first.positionLabel, analytics.BANNER_POSITIONS["home-hero"]);
  assert.equal(first.views, 2);
  assert.equal(first.clicks, 2);
  assert.equal(first.sessions, 1, "sessões distintas que clicaram");
  assert.equal(first.ctr, 100, "cliques ÷ exibições");
  assert.equal(first.conversions, 1, "a sessão que clicou converteu");
  assert.equal(first.topTarget, "Ver coleção");
  assert.equal(second.clicks, 1);
  assert.equal(second.ctr, 100);
  assert.equal(second.conversions, 0);
  assert.equal(third.clicks, 0);
  assert.equal(third.ctr, 0);
  assert.equal(third.position, "category-hero");
  assert.equal(third.positionLabel, "Banner de categoria");
  /* cliques em banner não entram no total de conversões, compras entram */
  assert.equal(report.totals.conversions, 1);
  assert.deepEqual(analytics.aggregate([], { days: 7 }).banners, []);
});

test("compras do checkout entram como conversão e aparecem no relatório", () => {
  const at = new Date().toISOString();
  const events = [
    { kind: "page_view", session_id: "s1", occurred_at: at, path: "/checkout.html", channel: "paid_search", device: "desktop" },
    { kind: "purchase", session_id: "s1", occurred_at: at, path: "/checkout.html", target: "Pix", value: 189.9, channel: "paid_search", device: "desktop" },
  ];
  const report = analytics.aggregate(events, { days: 7 });
  assert.equal(report.totals.conversions, 1);
  assert.equal(report.pages[0].path, "/checkout.html");
  assert.equal(report.pages[0].label, analytics.pageLabel("/checkout.html"));
  assert.equal(report.pages[0].conversions, 1);
  assert.equal(analytics.pageLabel("/conta.html"), "Minha conta");
});

/* --------------------------------------------------------- base de exemplo */

test("base de exemplo é determinística e proporcional ao período", () => {
  const short = analytics.demoEvents({ days: 7, seed: 18 });
  const long = analytics.demoEvents({ days: 30, seed: 18 });
  const again = analytics.demoEvents({ days: 7, seed: 18 });

  assert.deepEqual(short.map((event) => event.session_id), again.map((event) => event.session_id));
  assert.ok(long.length > short.length * 2, "30 dias geram bem mais eventos que 7");

  const kinds = new Set(short.map((event) => event.kind));
  ["page_view", "click", "scroll", "engagement", "product_view", "add_to_cart"].forEach((kind) => {
    assert.ok(kinds.has(kind), `a base de exemplo precisa ter ${kind}`);
  });

  /* toda sessão começa com página vista e traz origem/dispositivo */
  const sessions = new Set(short.map((event) => event.session_id));
  assert.ok(sessions.size > 50);
  short.filter((event) => event.kind === "page_view").forEach((event) => {
    assert.ok(analytics.CHANNEL_LABELS[event.channel], `canal ${event.channel} precisa de rótulo`);
    assert.ok(analytics.DEVICE_LABELS[event.device], `dispositivo ${event.device} precisa de rótulo`);
    assert.ok(event.session_id && event.occurred_at && event.path);
  });

  /* cliques vêm com coordenadas para o mapa de calor */
  const clicks = short.filter((event) => event.kind === "click");
  assert.ok(clicks.length > 20);
  clicks.forEach((event) => {
    assert.ok(event.x_ratio >= 0 && event.x_ratio <= 1);
    assert.ok(event.y_ratio >= 0 && event.y_ratio <= 1);
  });

  /* o relatório da base de exemplo fecha o funil */
  const report = analytics.aggregate(long, { days: 30 });
  assert.ok(report.totals.sessions > 100);
  assert.ok(report.totals.bounceRate > 0 && report.totals.bounceRate < 100);
  assert.ok(report.pages.length >= 5);
});

test("eventos capturados no navegador são lidos do armazenamento local", () => {
  const saved = [{ kind: "page_view", session_id: "abc", occurred_at: new Date().toISOString(), path: "/" }];
  const store = {
    getItem: (key) => (key === analytics.STORAGE_KEY ? JSON.stringify(saved) : null),
    setItem: () => {},
  };
  assert.deepEqual(analytics.capturedEvents(store), saved);
  assert.deepEqual(analytics.capturedEvents({ getItem: () => "não é json" }), []);
  assert.deepEqual(analytics.capturedEvents(null), []);
});
