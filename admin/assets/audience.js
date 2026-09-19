/* ==========================================================================
   CENSURA 18 — painéis de audiência (admin/ → Audiência)
   --------------------------------------------------------------------------
   Recebe o relatório produzido por assets/js/analytics.js (aggregate no
   modo demonstração, RPC audience_report com o Supabase ligado) e devolve
   HTML pronto para os painéis:

     • métricas do período e evolução diária;
     • páginas mais visitadas;
     • região de calor do site (faixas da página + grade de cliques);
     • origem do tráfego (canal, campanha UTM, sites de referência);
     • dispositivos e cidades;
     • profundidade de rolagem e pontos quentes;
     • banners mais clicados (hero da home e banner de categoria);
     • funil da jornada até o pedido fechado (Pix/cartão) ou o WhatsApp.

   As funções retornam string (não tocam no DOM), então rodam nos testes
   com Node puro: node --test tests/audience.test.js
   ========================================================================== */
(function (global) {
  "use strict";

  const Analytics = global.C18Analytics || {};

  const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  }[char]));

  const number = (value) => new Intl.NumberFormat("pt-BR").format(Number(value || 0));

  const percent = (value) => `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(Number(value || 0))}%`;

  const money = (value) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0));

  function duration(seconds) {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    const minutes = Math.floor(total / 60);
    const rest = total % 60;
    if (!minutes) return `${rest}s`;
    return `${minutes}min ${String(rest).padStart(2, "0")}s`;
  }

  function shortDate(day) {
    const value = String(day || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const [, month, date] = value.split("-");
    return `${date}/${month}`;
  }

  function emptyMessage(text, colspan) {
    return `<tr><td colspan="${colspan || 4}" class="empty-options">${esc(text)}</td></tr>`;
  }

  /* ---------------------------------------------------------------- métricas */

  const AUDIENCE_METRICS = [
    { key: "sessions", icon: "users", label: "Sessões", format: number },
    { key: "pageviews", icon: "grid", label: "Páginas vistas", format: number },
    { key: "visitors", icon: "spark", label: "Visitantes", format: number },
    { key: "conversions", icon: "cart", label: "Conversões", format: number },
    { key: "pagesPerSession", icon: "file", label: "Páginas por sessão", format: (value) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2 }).format(Number(value || 0)) },
    { key: "avgSeconds", icon: "refresh", label: "Tempo médio no site", format: duration },
    { key: "bounceRate", icon: "alert", label: "Saíram sem interagir", format: percent, warning: true },
    { key: "avgScroll", icon: "arrow", label: "Rolagem média", format: (value) => `${Math.round(Number(value || 0))}%` },
  ];

  /* report.previous (opcional) traz os totais do período imediatamente
     anterior — é o que vira o "+12% vs. anterior" de cada cartão. */
  function metricCards(report) {
    const totals = (report && report.totals) || {};
    const before = report && report.previous ? (report.previous.totals || report.previous) : null;
    return AUDIENCE_METRICS.map((metric) => {
      const value = totals[metric.key];
      const trend = before && Number(before[metric.key]) > 0
        ? Math.round(((Number(value || 0) - Number(before[metric.key])) / Number(before[metric.key])) * 100)
        : null;
      const trendText = trend === null
        ? metric.warning ? "No período" : "No período"
        : `${trend > 0 ? "+" : ""}${trend}% vs. anterior`;
      const trendClass = trend === null ? (metric.warning ? " is-warning" : "") : trend < 0 ? (metric.warning ? "" : " is-warning") : (metric.warning ? " is-warning" : "");
      return `<article class="metric"><div class="metric__top"><span class="metric__icon"><svg><use href="#i-${metric.icon}"></use></svg></span><span class="metric__trend${trendClass}">${esc(trendText)}</span></div><strong>${metric.format(value)}</strong><span>${esc(metric.label)}</span></article>`;
    }).join("");
  }

  /* ------------------------------------------------------------- evolução */

  function trendChart(report) {
    const trend = (report && report.trend) || [];
    if (!trend.length) return `<p class="empty-options">Sem visitas no período.</p>`;
    const width = 720;
    const height = 150;
    const padding = { top: 12, right: 8, bottom: 22, left: 8 };
    const maxSessions = Math.max(1, ...trend.map((item) => Number(item.sessions || 0)));
    const maxViews = Math.max(1, ...trend.map((item) => Number(item.pageviews || 0)));
    const step = (width - padding.left - padding.right) / Math.max(1, trend.length - 1);
    const barWidth = Math.max(2, Math.min(14, step * 0.55));

    const bars = trend.map((item, index) => {
      const value = Number(item.sessions || 0);
      const barHeight = (value / maxSessions) * (height - padding.top - padding.bottom);
      const x = padding.left + index * step - barWidth / 2;
      const y = height - padding.bottom - barHeight;
      return `<rect class="trend__bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${Math.max(1, barHeight).toFixed(1)}" rx="1"><title>${esc(shortDate(item.date))}: ${number(value)} sessões · ${number(item.pageviews)} páginas · ${number(item.conversions)} conversões</title></rect>`;
    }).join("");

    const line = trend.map((item, index) => {
      const value = Number(item.pageviews || 0);
      const x = padding.left + index * step;
      const y = height - padding.bottom - (value / maxViews) * (height - padding.top - padding.bottom);
      return `${index ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(" ");

    const labels = [trend[0], trend[Math.floor(trend.length / 2)], trend[trend.length - 1]]
      .filter(Boolean)
      .map((item, index, list) => {
        const position = trend.indexOf(item);
        return `<text class="trend__label" x="${(padding.left + position * step).toFixed(1)}" y="${height - 6}" text-anchor="${index === 0 ? "start" : index === list.length - 1 ? "end" : "middle"}">${esc(shortDate(item.date))}</text>`;
      }).join("");

    return `<svg class="trend" viewBox="0 0 ${width} ${height}" role="img" aria-label="Evolução de sessões e páginas vistas">
      ${bars}
      <path class="trend__line" d="${line}"></path>
      ${labels}
    </svg>`;
  }

  /* -------------------------------------------------- páginas mais visitadas */

  function topPages(report, limit) {
    const pages = ((report && report.pages) || []).slice(0, Number(limit) || 12);
    if (!pages.length) return emptyMessage("Nenhuma página visitada no período.", 6);
    const max = Math.max(...pages.map((page) => Number(page.views || 0)), 1);
    return pages.map((page) => `<tr>
      <td><span class="movement-product"><strong>${esc(page.label)}</strong><small>${esc(page.path)}</small></span></td>
      <td><span class="page-bar"><i style="width:${Math.round((page.views / max) * 100)}%"></i></span></td>
      <td><strong>${number(page.views)}</strong></td>
      <td>${number(page.sessions)}</td>
      <td>${percent(page.share)}</td>
      <td>${page.conversions ? `<span class="status-badge is-success">${number(page.conversions)}</span>` : `<span class="status-badge is-neutral">0</span>`}</td>
    </tr>`).join("");
  }

  /* -------------------------------------------------------- origem do tráfego */

  function trafficSources(report) {
    const sources = (report && report.sources) || [];
    if (!sources.length) return `<p class="empty-options">Sem origem identificada no período.</p>`;
    return sources.map((source) => `<div class="source-row">
      <span class="source-row__name">${esc(source.label)}</span>
      <span class="source-row__bar"><i style="width:${Math.min(100, Math.round(Number(source.share || 0)))}%"></i></span>
      <span class="source-row__value">${number(source.sessions)}</span>
      <span class="source-row__share">${percent(source.share)}</span>
    </div>`).join("");
  }

  function campaignsTable(report) {
    const campaigns = (report && report.campaigns) || [];
    if (!campaigns.length) return emptyMessage("Nenhuma campanha com UTM no período.", 5);
    return campaigns.map((campaign) => `<tr>
      <td><span class="movement-product"><strong>${esc(campaign.campaign)}</strong><small>${esc(campaign.source)} · ${esc(campaign.medium)}</small></span></td>
      <td>${number(campaign.sessions)}</td>
      <td>${number(campaign.pageviews)}</td>
      <td>${number(campaign.conversions)}</td>
      <td>${campaign.sessions ? percent((campaign.conversions / campaign.sessions) * 100) : "0%"}</td>
    </tr>`).join("");
  }

  function referrersList(report) {
    const referrers = (report && report.referrers) || [];
    if (!referrers.length) return `<p class="empty-options">Nenhum site de referência no período.</p>`;
    return referrers.map((referrer) => `<div class="referrer-row"><span>${esc(referrer.host)}</span><b>${number(referrer.sessions)}</b></div>`).join("");
  }

  function devicesList(report) {
    const devices = (report && report.devices) || [];
    if (!devices.length) return `<p class="empty-options">Sem dispositivos no período.</p>`;
    return devices.map((device) => `<div class="source-row">
      <span class="source-row__name">${esc(device.label)}</span>
      <span class="source-row__bar"><i style="width:${Math.min(100, Math.round(Number(device.share || 0)))}%"></i></span>
      <span class="source-row__value">${number(device.sessions)}</span>
      <span class="source-row__share">${percent(device.share)}</span>
    </div>`).join("");
  }

  function locationsList(report) {
    const locations = (report && report.locations) || [];
    if (!locations.length) return `<p class="empty-options">Sem cidades identificadas no período.</p>`;
    return locations.map((location) => `<div class="referrer-row"><span>${esc(location.name)}</span><b>${number(location.sessions)}</b></div>`).join("");
  }

  /* ------------------------------------------------------- região de calor */

  /* Faixas verticais da página (cabeçalho, hero, grade, rodapé…) pintadas
     pela intensidade de cliques: é a leitura rápida de "onde o visitante
     clica" sem precisar de screenshot. */
  function heatZones(report, path) {
    const zonesFor = Analytics.zonesFor || (() => []);
    const zones = zonesFor(path);
    const clicks = ((report && report.zones) || []).filter((zone) => zone.path === path);
    const total = clicks.reduce((sum, zone) => sum + Number(zone.clicks || 0), 0);
    const byZone = Object.fromEntries(clicks.map((zone) => [zone.zone, zone]));
    if (!zones.length) return `<p class="empty-options">Sem regiões mapeadas para ${esc(path)}.</p>`;

    return `<div class="heat-zones" role="img" aria-label="Regiões de calor da página">
      ${zones.map((zone) => {
        const data = byZone[zone.id] || { clicks: 0, share: 0 };
        const intensity = total ? Number(data.clicks) / Math.max(1, ...clicks.map((item) => Number(item.clicks))) : 0;
        return `<div class="heat-zone" style="flex:${Math.max(0.06, zone.to - zone.from).toFixed(3)}">
          <span class="heat-zone__fill" style="opacity:${(0.08 + intensity * 0.92).toFixed(2)}"></span>
          <span class="heat-zone__label">${esc(zone.label)}</span>
          <span class="heat-zone__value">${number(data.clicks)} cliques${total ? ` · ${percent(data.share)}` : ""}</span>
        </div>`;
      }).join("")}
    </div>`;
  }

  /* Grade clássica de mapa de calor: cols × rows células sobre a página. */
  function heatGrid(report) {
    const heat = (report && report.heat) || { cols: 12, rows: 18, cells: [], max: 0 };
    if (!heat.cells || !heat.cells.length) return `<p class="empty-options">Sem cliques registrados nesta página.</p>`;
    const cells = heat.cells.map((cell) => {
      const level = Number(cell.intensity || 0);
      const className = level >= 0.66 ? " is-hot" : level >= 0.33 ? " is-warm" : level > 0 ? " is-soft" : "";
      const label = cell.clicks ? `${cell.clicks} ${cell.clicks === 1 ? "clique" : "cliques"}` : "sem cliques";
      return `<span class="heat-cell${className}" style="--heat:${level.toFixed(2)}" title="${label}"></span>`;
    }).join("");
    return `<div class="heat-grid" style="--heat-cols:${heat.cols};--heat-rows:${heat.rows}">${cells}</div>`;
  }

  function heatLegend() {
    return `<div class="heat-legend"><span>Frio</span><i></i><span>Quente</span><small>${esc("cliques por região da página")}</small></div>`;
  }

  function hotTargets(report, path, limit) {
    const targets = ((report && report.targets) || [])
      .filter((target) => !path || target.path === path)
      .slice(0, Number(limit) || 8);
    if (!targets.length) return `<p class="empty-options">Nenhum elemento clicado nesta página.</p>`;
    const max = Math.max(...targets.map((target) => Number(target.clicks || 0)), 1);
    return targets.map((target) => `<div class="source-row">
      <span class="source-row__name">${esc(target.target)}</span>
      <span class="source-row__bar"><i style="width:${Math.round((Number(target.clicks) / max) * 100)}%"></i></span>
      <span class="source-row__value">${number(target.clicks)}</span>
    </div>`).join("");
  }

  function scrollTable(report) {
    const rows = (report && report.scroll) || [];
    if (!rows.length) return emptyMessage("Sem rolagem registrada no período.", 6);
    return rows.map((row) => `<tr>
      <td><span class="movement-product"><strong>${esc(row.label)}</strong><small>${esc(row.path)}</small></span></td>
      <td>${number(row.sessions)}</td>
      <td>${Math.round(Number(row.average || 0))}%</td>
      <td>${Math.round(row.milestones["25"] || 0)}%</td>
      <td>${Math.round(row.milestones["50"] || 0)}%</td>
      <td>${Math.round(row.milestones["100"] || 0)}%</td>
    </tr>`).join("");
  }

  /* ------------------------------------------------------------ banners */

  /* Ranking dos banners: vistos, clicados, CTR e sessões que clicaram e
     converteram. report.banners vem do aggregate() (demo) ou da RPC
     audience_report (chave "banners"). */
  function bannersTable(report, limit) {
    const rows = ((report && report.banners) || []).slice(0, Number(limit) || 8);
    if (!rows.length) return emptyMessage("Nenhum banner visto no período — a home e o catálogo passam a contar assim que houver visitas.", 6);
    const max = Math.max(...rows.map((row) => Number(row.clicks || 0)), 1);
    const positionLabel = (row) => row.positionLabel
      || (Analytics.BANNER_POSITIONS && Analytics.BANNER_POSITIONS[row.position])
      || row.position || "";
    return rows.map((row, index) => `<tr>
      <td><span class="movement-product"><strong>${index + 1}. ${esc(row.name || row.id)}</strong><small>${esc(positionLabel(row))}${row.topTarget ? ` · mais clicado: ${esc(row.topTarget)}` : ""}</small></span></td>
      <td>${number(row.views)}</td>
      <td><span class="source-row"><span class="source-row__bar"><i style="width:${Math.round((Number(row.clicks || 0) / max) * 100)}%"></i></span><span class="source-row__value">${number(row.clicks)}</span></span></td>
      <td>${percent(row.ctr)}</td>
      <td>${number(row.sessions)}</td>
      <td>${number(row.conversions)}</td>
    </tr>`).join("");
  }

  /* -------------------------------------------------------------- funil */

  /* Jornada até a compra: o pedido fecha no checkout (Pix/cartão) ou, no
     fluxo tradicional da marca, na conversa do WhatsApp — por isso as duas
     saídas aparecem, uma após a outra, como últimas etapas. */
  const FUNNEL_STEPS = [
    { kind: "page_view", label: "Visitou o site" },
    { kind: "product_view", label: "Viu um produto" },
    { kind: "add_to_cart", label: "Adicionou ao carrinho" },
    { kind: "checkout_intent", label: "Iniciou a finalização" },
    { kind: "purchase", label: "Fechou o pedido (Pix/cartão)" },
    { kind: "whatsapp", label: "Falou no WhatsApp" },
  ];

  function funnel(events, options) {
    const opts = options || {};
    const list = Array.isArray(events) ? events : [];
    const from = opts.from ? new Date(opts.from) : null;
    const to = opts.to ? new Date(opts.to) : null;
    const counts = Object.fromEntries(FUNNEL_STEPS.map((step) => [step.kind, new Set()]));
    list.forEach((event) => {
      if (from || to) {
        const at = new Date(event.occurred_at || event.at);
        if (from && at < from) return;
        if (to && at > to) return;
      }
      if (counts[event.kind]) counts[event.kind].add(event.session_id || "sem-sessao");
    });
    const sessions = counts.page_view.size || 1;
    return FUNNEL_STEPS.map((step) => ({
      kind: step.kind,
      label: step.label,
      sessions: counts[step.kind].size,
      share: Math.round((counts[step.kind].size / sessions) * 100),
    }));
  }

  function funnelChart(steps) {
    const list = Array.isArray(steps) && steps.length ? steps : [];
    if (!list.length) return `<p class="empty-options">Sem dados de jornada no período.</p>`;
    return list.map((step, index) => `<div class="funnel-step">
      <span class="funnel-step__index">${index + 1}</span>
      <span class="funnel-step__label">${esc(step.label)}</span>
      <span class="funnel-step__bar"><i style="width:${Math.max(2, Math.min(100, step.share))}%"></i></span>
      <span class="funnel-step__value">${number(step.sessions)}</span>
      <span class="funnel-step__share">${percent(step.share)}</span>
    </div>`).join("");
  }

  global.C18Audience = {
    AUDIENCE_METRICS,
    FUNNEL_STEPS,
    bannersTable,
    campaignsTable,
    devicesList,
    duration,
    emptyMessage,
    esc,
    funnel,
    funnelChart,
    heatGrid,
    heatLegend,
    heatZones,
    hotTargets,
    locationsList,
    metricCards,
    money,
    number,
    percent,
    referrersList,
    scrollTable,
    shortDate,
    topPages,
    trafficSources,
    trendChart,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = global.C18Audience;
  }
})(typeof window !== "undefined" ? window : globalThis);
