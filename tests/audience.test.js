const test = require("node:test");
const assert = require("node:assert/strict");

/* ordem do painel: analytics.js carrega antes de audience.js */
const Analytics = require("../assets/js/analytics.js");
const Audience = require("../admin/assets/audience.js");

const report = () => Analytics.aggregate(Analytics.demoEvents({ days: 7, seed: 18 }), { days: 7 });

/* ---------------------------------------------------------------- formatação */

test("formata números, dinheiro, datas e duração em português", () => {
  assert.equal(Audience.number(1234567), "1.234.567");
  assert.equal(Audience.number(16.3), "16,3");
  assert.equal(Audience.number(), "0");
  assert.equal(Audience.percent(12.34), "12,3%");
  /* o separador do Intl é espaço não quebrável (U+00A0) */
  assert.equal(Audience.money(1234.5), "R$\u00a01.234,50");
  assert.ok(Audience.money(0).startsWith("R$"));
  assert.equal(Audience.duration(62), "1min 02s");
  assert.equal(Audience.duration(45), "45s");
  assert.equal(Audience.duration(0), "0s");
  assert.equal(Audience.shortDate("2026-09-18"), "18/09");
  assert.equal(Audience.shortDate(""), "");
});

test("escapa o HTML que vem dos dados", () => {
  assert.equal(Audience.esc("<script>alert(1)</script>"), "&lt;script&gt;alert(1)&lt;/script&gt;");
  assert.equal(Audience.esc(`"aspa" & 'apóstrofo'`), "&quot;aspa&quot; &amp; &#39;apóstrofo&#39;");
  assert.equal(Audience.esc(null), "");
  assert.ok(Audience.emptyMessage("Sem dados", 6).includes('colspan="6"'));
});

/* ------------------------------------------------------------------ métricas */

test("cartões de métricas com comparativo do período anterior", () => {
  const html = Audience.metricCards({
    totals: { sessions: 100, pageviews: 250, visitors: 80, conversions: 10, pagesPerSession: 2.5, avgSeconds: 90, bounceRate: 40, avgScroll: 62 },
    previous: { totals: { sessions: 80, pageviews: 250, visitors: 80, conversions: 20, pagesPerSession: 3.1, avgSeconds: 90, bounceRate: 30, avgScroll: 62 } },
  });

  assert.equal((html.match(/<article class="metric">/g) || []).length, Audience.AUDIENCE_METRICS.length);
  assert.ok(html.includes("+25% vs. anterior"), "sessões cresceram");
  assert.ok(html.includes("-50% vs. anterior"), "conversões caíram");
  assert.ok(html.includes("1min 30s"));
  assert.ok(html.includes("2,50"));
  assert.ok(html.includes("R$") === false, "métrica não é dinheiro");
  assert.ok(html.includes("Saíram sem interagir"));

  const noPrevious = Audience.metricCards({ totals: { sessions: 5 } });
  assert.ok(noPrevious.includes("No período"), "sem período anterior não inventa variação");
});

test("evolução diária desenha barras e linha de páginas vistas", () => {
  const data = report();
  const html = Audience.trendChart(data);
  assert.ok(html.includes('<svg class="trend"'));
  assert.equal((html.match(/class="trend__bar"/g) || []).length, data.trend.length);
  assert.ok(html.includes('<path class="trend__line" d="M'));
  assert.ok(html.includes("sessões"), "cada barra tem título legível");
  assert.equal(Audience.trendChart({ trend: [] }), '<p class="empty-options">Sem visitas no período.</p>');
});

/* -------------------------------------------------------------- páginas/origem */

test("páginas mais visitadas com barra proporcional e conversões", () => {
  const html = Audience.topPages({
    pages: [
      { path: "/", label: "Home", views: 200, sessions: 150, share: 55.6, conversions: 4 },
      { path: "/produtos.html", label: "Catálogo", views: 160, sessions: 120, share: 44.4, conversions: 0 },
    ],
  });
  assert.equal((html.match(/<tr>/g) || []).length, 2);
  assert.ok(html.includes('style="width:100%"'), "a página líder ocupa a barra toda");
  assert.ok(html.includes('style="width:80%"'), "a segunda é proporcional");
  assert.ok(html.includes("55,6%"));
  assert.ok(html.includes("<small>/produtos.html</small>"));
  assert.ok(Audience.topPages({ pages: [] }).includes("Nenhuma página visitada"));
  assert.ok(Audience.topPages({ pages: [{ path: "/", label: "Home", views: 10, sessions: 8, share: 100, conversions: 0 }] }).includes("is-neutral"));
});

test("origem do tráfego, campanhas UTM, referências, dispositivos e cidades", () => {
  const data = report();

  const sources = Audience.trafficSources(data);
  assert.equal((sources.match(/class="source-row"/g) || []).length, data.sources.length);
  assert.ok(sources.includes("Busca orgânica") || sources.includes("Redes sociais"));
  const shareSum = data.sources.reduce((sum, source) => sum + Number(source.share), 0);
  assert.ok(Math.abs(shareSum - 100) < 1.5, `as origens somam ~100% (${shareSum})`);

  const campaigns = Audience.campaignsTable(data);
  assert.equal((campaigns.match(/<tr>/g) || []).length, data.campaigns.length);
  assert.ok(campaigns.includes("drop-semanal") || campaigns.includes("shopping-merchant"));

  assert.ok(Audience.referrersList(data).includes("referrer-row"));
  assert.equal((Audience.devicesList(data).match(/class="source-row"/g) || []).length, data.devices.length);
  assert.ok(Audience.locationsList(data).includes("Nova Iguaçu"));

  assert.ok(Audience.trafficSources({ sources: [] }).includes("Sem origem identificada"));
  assert.ok(Audience.campaignsTable({ campaigns: [] }).includes("Nenhuma campanha com UTM"));
  assert.ok(Audience.referrersList({ referrers: [] }).includes("Nenhum site de referência"));
  assert.ok(Audience.devicesList({ devices: [] }).includes("Sem dispositivos"));
  assert.ok(Audience.locationsList({ locations: [] }).includes("Sem cidades identificadas"));
});

/* ------------------------------------------------------------ região de calor */

test("regiões de calor pintam as faixas da página escolhida", () => {
  const data = report();
  const path = "/produtos.html";
  const html = Audience.heatZones(data, path);

  const zones = Analytics.zonesFor(path);
  assert.equal((html.match(/class="heat-zone"/g) || []).length, zones.length);
  assert.ok(html.includes('aria-label="Regiões de calor da página"'));
  zones.forEach((zone) => assert.ok(html.includes(zone.label), `faixa ${zone.label} aparece`));

  const clicks = data.zones.filter((zone) => zone.path === path);
  assert.ok(clicks.length, "a base de exemplo clica no catálogo");
  const hottest = clicks[0];
  assert.ok(html.includes(`${Audience.number(hottest.clicks)} cliques`));
  /* a faixa mais clicada fica com opacidade máxima */
  const opacity = html.match(/opacity:([0-9.]+)/g).map((value) => Number(value.split(":")[1]));
  assert.equal(Math.max(...opacity).toFixed(2), "1.00");
  assert.ok(Math.min(...opacity) > 0, "nenhuma faixa some do desenho");
});

test("grade do mapa de calor tem cols × rows células e níveis de intensidade", () => {
  const heat = { cols: 12, rows: 18, max: 10, cells: [] };
  for (let row = 0; row < heat.rows; row += 1) {
    for (let col = 0; col < heat.cols; col += 1) {
      const clicks = row === 0 && col === 0 ? 10 : row === 1 && col === 1 ? 4 : row === 2 && col === 2 ? 1 : 0;
      heat.cells.push({ key: `${col}x${row}`, col, row, clicks, intensity: clicks / 10 });
    }
  }
  const html = Audience.heatGrid({ heat });
  assert.equal((html.match(/class="heat-cell/g) || []).length, 216);
  assert.ok(html.includes("--heat-cols:12"));
  assert.ok(html.includes("is-hot"), "clique concentrado fica vermelho");
  assert.ok(html.includes("is-warm"));
  assert.ok(html.includes("is-soft"));
  assert.ok(html.includes('title="10 cliques"'));
  assert.ok(html.includes('title="1 clique"'), "singular quando é um clique só");
  assert.ok(html.includes('title="sem cliques"'));
  assert.ok(Audience.heatGrid({ heat: { cols: 12, rows: 18, cells: [] } }).includes("Sem cliques registrados"));
  assert.ok(Audience.heatLegend().includes("Frio") && Audience.heatLegend().includes("Quente"));
});

test("pontos quentes listam os elementos mais clicados da página", () => {
  const html = Audience.hotTargets({
    targets: [
      { path: "/", target: "Botão Ver produtos", clicks: 40 },
      { path: "/", target: "Menu Categorias", clicks: 20 },
      { path: "/produtos.html", target: "Filtro Tamanho", clicks: 30 },
    ],
  }, "/", 2);
  assert.equal((html.match(/class="source-row"/g) || []).length, 2, "filtra pela página e respeita o limite");
  assert.ok(html.includes("Botão Ver produtos"));
  assert.ok(!html.includes("Filtro Tamanho"));
  assert.ok(html.includes('style="width:50%"'), "barra relativa ao mais clicado");
  assert.ok(Audience.hotTargets({ targets: [] }, "/").includes("Nenhum elemento clicado"));
});

/* ---------------------------------------------------------- rolagem e funil */

test("profundidade de rolagem por página", () => {
  const html = Audience.scrollTable({
    scroll: [{ path: "/", label: "Home", sessions: 120, average: 68, milestones: { "25": 90, "50": 70, "75": 40, "100": 12 } }],
  });
  assert.ok(html.includes("68%"));
  assert.ok(html.includes("90%"));
  assert.ok(html.includes("12%"));
  assert.ok(html.includes("<small>/</small>"));
  assert.ok(Audience.scrollTable({ scroll: [] }).includes("Sem rolagem registrada"));
});

test("funil da jornada conta sessões por etapa", () => {
  const at = new Date().toISOString();
  const events = [
    { kind: "page_view", session_id: "s1", occurred_at: at },
    { kind: "page_view", session_id: "s2", occurred_at: at },
    { kind: "product_view", session_id: "s1", occurred_at: at },
    { kind: "add_to_cart", session_id: "s1", occurred_at: at },
    { kind: "checkout_intent", session_id: "s1", occurred_at: at },
    { kind: "whatsapp", session_id: "s2", occurred_at: at },
    { kind: "click", session_id: "s2", occurred_at: at },
  ];
  const steps = Audience.funnel(events);
  assert.deepEqual(steps.map((step) => step.kind), Audience.FUNNEL_STEPS.map((step) => step.kind));
  assert.deepEqual(steps.map((step) => step.sessions), [2, 1, 1, 1, 1]);
  assert.deepEqual(steps.map((step) => step.share), [100, 50, 50, 50, 50]);
  assert.equal(steps[0].label, "Visitou o site");
  assert.equal(steps[4].label, "Falou no WhatsApp");

  /* período fora da janela não conta */
  const filtered = Audience.funnel(events, { from: new Date(Date.now() + 60_000).toISOString() });
  assert.deepEqual(filtered.map((step) => step.sessions), [0, 0, 0, 0, 0]);

  const html = Audience.funnelChart(steps);
  assert.equal((html.match(/class="funnel-step"/g) || []).length, 5);
  assert.ok(html.includes('style="width:100%"'));
  assert.ok(html.includes('style="width:50%"'));
  assert.ok(Audience.funnelChart([]).includes("Sem dados de jornada"));
});

/* ------------------------------------------------------------ ponta a ponta */

test("todas as seções do painel renderizam com a base de exemplo", () => {
  const data = report();
  data.funnel = Audience.funnel(Analytics.demoEvents({ days: 7, seed: 18 }), { from: data.from, to: data.to });

  const sections = {
    métricas: Audience.metricCards(data),
    evolução: Audience.trendChart(data),
    páginas: Audience.topPages(data),
    origens: Audience.trafficSources(data),
    campanhas: Audience.campaignsTable(data),
    referências: Audience.referrersList(data),
    dispositivos: Audience.devicesList(data),
    cidades: Audience.locationsList(data),
    faixas: Audience.heatZones(data, "/produtos.html"),
    grade: Audience.heatGrid(data),
    pontos: Audience.hotTargets(data, "/produtos.html"),
    rolagem: Audience.scrollTable(data),
    funil: Audience.funnelChart(data.funnel),
  };

  Object.entries(sections).forEach(([name, html]) => {
    assert.ok(typeof html === "string" && html.length > 40, `${name} precisa desenhar algo`);
    assert.ok(!html.includes("undefined"), `${name} não pode mostrar undefined`);
    assert.ok(!html.includes("NaN"), `${name} não pode mostrar NaN`);
    assert.ok(!/<script/i.test(html), `${name} não pode executar script`);
  });

  assert.ok(data.totals.sessions > 100);
  assert.ok(data.pages.length >= 5);
  assert.equal(data.heat.cells.length, 12 * 18);
  assert.ok(sections.faixas.includes("Grade de produtos") || sections.faixas.includes("Filtros"));
});
