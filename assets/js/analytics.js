/* ==========================================================================
   CENSURA 18 — audiência do site (medição própria, sem terceiros)
   --------------------------------------------------------------------------
   Módulo compartilhado entre a loja (páginas públicas) e o painel
   (admin/ → Audiência). Duas metades no mesmo arquivo:

   1) COLETA (navegador) — registra page views, cliques com posição
      (mapa de calor), profundidade de rolagem, tempo de leitura e os
      eventos de compra (ver produto, categoria, adicionar, finalizar).
      Só grava depois que o visitante aceita no banner de privacidade
      (assets/js/lgpd.js). Com "Só o essencial" nada é medido.

   2) AGREGAÇÃO (funções puras) — transforma a lista de eventos no
      relatório exibido no painel: páginas mais visitadas, origem do
      tráfego, regiões de calor, dispositivos e cidades. Por serem puras,
      rodam nos testes (node --test tests/analytics.test.js) e são a
      mesma referência de formato que a RPC audience_report devolve.

   Privacidade: nenhum dado pessoal é coletado. O visitante é um id
   aleatório de sessão (troca a cada 30 min de inatividade); não há IP,
   e-mail, cookie de terceiro nem envio para fora do domínio.

   Transporte:
     mode "supabase" → RPC track_site_events (chave anônima, sem leitura)
     mode "static"   → localStorage do próprio navegador (c18:demo-analytics),
                       que é o que o painel lê no modo demonstração.
   ========================================================================== */

/* --- Configuração pública (mesmo padrão de site-config.js / admin) -----
   Sem "mode" definido aqui a medição segue window.C18_SITE: quando o site
   é ligado ao Supabase, os eventos vão para a RPC track_site_events; antes
   disso ficam no localStorage do navegador (modo demonstração do painel).
   Para forçar um comportamento, defina:
     window.C18_ANALYTICS = { mode: "supabase" | "static",
                              supabaseUrl: "...", supabaseAnonKey: "..." };
   --------------------------------------------------------------------- */
if (typeof window !== "undefined") {
  window.C18_ANALYTICS = window.C18_ANALYTICS || {};
}

(function (global) {
  "use strict";

  const STORAGE_KEY = "c18:demo-analytics";
  const SESSION_KEY = "c18:analytics-session";
  const VISITOR_KEY = "c18:analytics-visitor";
  const MAX_STORED_EVENTS = 800;
  const MAX_BATCH = 20;
  const SESSION_IDLE_MS = 30 * 60 * 1000;
  const TIMEZONE = "America/Sao_Paulo";

  /* Tipos de evento aceitos. Qualquer outro é descartado na coleta e na
     RPC do servidor — a lista é o contrato entre site, painel e banco. */
  const EVENT_KINDS = [
    "page_view",
    "click",
    "scroll",
    "engagement",
    "product_view",
    "category_view",
    "add_to_cart",
    "search",
    "checkout_intent",
    "whatsapp",
    "banner_view",
  ];

  /* Eventos que contam como conversão para a loja (o pedido fecha no
     WhatsApp, então a conversa iniciada é o resultado do site). */
  const CONVERSION_KINDS = ["add_to_cart", "checkout_intent", "whatsapp"];

  const CHANNEL_LABELS = {
    direct: "Direto",
    organic: "Busca orgânica",
    social: "Redes sociais",
    email: "E-mail / newsletter",
    referral: "Sites parceiros",
    paid: "Tráfego pago",
    campaign: "Campanha (UTM)",
  };

  const DEVICE_LABELS = {
    desktop: "Computador",
    mobile: "Celular",
    tablet: "Tablet",
    other: "Outros",
  };

  /* Nome amigável de cada página do site (aparece no painel). */
  const PAGE_LABELS = {
    "/": "Home",
    "/index.html": "Home",
    "/produtos.html": "Catálogo",
    "/produto.html": "Página do produto",
    "/lojas.html": "Lojas",
    "/sobre.html": "A marca",
    "/contato.html": "Contato",
    "/cartao-presente.html": "Cartão presente",
    "/privacidade.html": "Privacidade",
    "/404.html": "Página 404",
  };

  /* Regiões verticais de cada página (fatias de 0 a 1 da altura do
     documento). O mapa de calor do painel desenha essas faixas: é a
     "região de calor do site" sem depender de screenshot externo. */
  const PAGE_ZONES = {
    "/": [
      { id: "header", label: "Cabeçalho e menu", from: 0, to: 0.08 },
      { id: "hero", label: "Hero / banner principal", from: 0.08, to: 0.42 },
      { id: "categorias", label: "Categorias em destaque", from: 0.42, to: 0.56 },
      { id: "destaques", label: "Produtos em destaque", from: 0.56, to: 0.84 },
      { id: "marca", label: "Números da marca e newsletter", from: 0.84, to: 0.94 },
      { id: "footer", label: "Rodapé", from: 0.94, to: 1 },
    ],
    "/produtos.html": [
      { id: "header", label: "Cabeçalho e menu", from: 0, to: 0.07 },
      { id: "titulo", label: "Título e banner da categoria", from: 0.07, to: 0.2 },
      { id: "filtros", label: "Filtros e ordenação", from: 0.2, to: 0.27 },
      { id: "grade", label: "Grade de produtos", from: 0.27, to: 0.9 },
      { id: "atendimento", label: "Fala com a gente", from: 0.9, to: 0.96 },
      { id: "footer", label: "Rodapé", from: 0.96, to: 1 },
    ],
    "/produto.html": [
      { id: "header", label: "Cabeçalho e menu", from: 0, to: 0.08 },
      { id: "galeria", label: "Galeria de fotos", from: 0.08, to: 0.45 },
      { id: "compra", label: "Tamanho, cor e carrinho", from: 0.45, to: 0.68 },
      { id: "detalhes", label: "Detalhes e medidas", from: 0.68, to: 0.88 },
      { id: "relacionados", label: "Produtos relacionados", from: 0.88, to: 0.96 },
      { id: "footer", label: "Rodapé", from: 0.96, to: 1 },
    ],
    "/lojas.html": [
      { id: "header", label: "Cabeçalho e menu", from: 0, to: 0.1 },
      { id: "lista", label: "Lista das 6 lojas", from: 0.1, to: 0.88 },
      { id: "footer", label: "Rodapé", from: 0.88, to: 1 },
    ],
    "/sobre.html": [
      { id: "header", label: "Cabeçalho e menu", from: 0, to: 0.1 },
      { id: "historia", label: "História e linha do tempo", from: 0.1, to: 0.88 },
      { id: "footer", label: "Rodapé", from: 0.88, to: 1 },
    ],
    "/contato.html": [
      { id: "header", label: "Cabeçalho e menu", from: 0, to: 0.1 },
      { id: "formulario", label: "Formulário e FAQ", from: 0.1, to: 0.88 },
      { id: "footer", label: "Rodapé", from: 0.88, to: 1 },
    ],
    "/cartao-presente.html": [
      { id: "header", label: "Cabeçalho e menu", from: 0, to: 0.1 },
      { id: "valores", label: "Valores e mensagem", from: 0.1, to: 0.88 },
      { id: "footer", label: "Rodapé", from: 0.88, to: 1 },
    ],
  };

  const FALLBACK_ZONES = [
    { id: "header", label: "Cabeçalho e menu", from: 0, to: 0.12 },
    { id: "conteudo", label: "Conteúdo", from: 0.12, to: 0.88 },
    { id: "footer", label: "Rodapé", from: 0.88, to: 1 },
  ];

  /* Domínios usados para classificar a origem quando não há UTM. */
  const SEARCH_HOSTS = [
    "google.", "bing.", "yahoo.", "duckduckgo.", "ecosia.", "baidu.",
    "yandex.", "ask.", "aol.", "search.",
  ];
  const SOCIAL_HOSTS = [
    "instagram.com", "facebook.com", "fb.me", "fb.com", "tiktok.com",
    "youtube.com", "youtu.be", "pinterest.", "linkedin.com", "x.com",
    "twitter.com", "t.co", "wa.me", "whatsapp.com", "threads.net",
    "kwai.com", "telegram.", "reddit.com",
  ];
  const PAID_MEDIA = /(cpc|ppc|cpm|cpa|paid|paidsearch|paid_social|display|remarketing|retarget|shopping|performance|ads)/i;
  const PAID_SOURCES = [
    "googleads", "google_ads", "google ads", "meta", "metaads", "meta_ads",
    "facebookads", "fb_ads", "instagramads", "tiktokads", "tiktok_ads",
    "bingads", "twitterads", "taboola", "outbrain", "criteo",
  ];

  const $ = (selector, root) => (root || global.document || { querySelector: () => null }).querySelector(selector);

  /* ------------------------------------------------------------ utilidades */

  /* Geração pseudoaleatória determinística: o painel usa o mesmo seed para
     a base de exemplo ser idêntica a cada abertura (e testável no node). */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function random() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* Formatador criado uma vez só: dateKey é chamado para cada evento do
     relatório e instanciar o Intl a cada chamada deixa o painel lento. */
  let dayFormatter = null;

  function dateKey(iso) {
    const date = iso instanceof Date ? iso : new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    try {
      if (!dayFormatter) {
        dayFormatter = new Intl.DateTimeFormat("en-CA", {
          year: "numeric", month: "2-digit", day: "2-digit", timeZone: TIMEZONE,
        });
      }
      const parts = Object.fromEntries(
        dayFormatter.formatToParts(date).map((part) => [part.type, part.value])
      );
      return `${parts.year}-${parts.month}-${parts.day}`;
    } catch (_) {
      return date.toISOString().slice(0, 10);
    }
  }

  function hostOf(referrer) {
    const value = String(referrer || "").trim();
    if (!value) return "";
    try {
      const url = new URL(value, "https://local");
      return url.hostname.replace(/^www\./i, "").toLowerCase();
    } catch (_) {
      return "";
    }
  }

  function normalizePath(value) {
    const raw = String(value || "").trim();
    if (!raw) return "/";
    let path = raw;
    try {
      if (/^https?:\/\//i.test(raw)) path = new URL(raw).pathname;
    } catch (_) {
      path = raw.split("?")[0];
    }
    path = path.split("?")[0].split("#")[0];
    if (!path.startsWith("/")) path = `/${path}`;
    /* GitHub Pages serve o site em /lucienealves63/... — o painel agrupa
       pelo caminho relativo à raiz do site. */
    const marker = "/lucienealves63";
    if (path.startsWith(marker)) path = path.slice(marker.length) || "/";
    if (path === "" || path === "/index.html") return "/";
    return path.replace(/\/+$/, "") || "/";
  }

  function pageLabel(path) {
    const clean = normalizePath(path);
    return PAGE_LABELS[clean] || clean.replace(/\.html$/, "").replace(/^\//, "") || "Página";
  }

  function zonesFor(path) {
    return PAGE_ZONES[normalizePath(path)] || FALLBACK_ZONES;
  }

  /* Em que faixa vertical da página está o ponto y (0 a 1). */
  function zoneAt(path, yRatio) {
    const y = Math.min(1, Math.max(0, Number(yRatio) || 0));
    const zones = zonesFor(path);
    return zones.find((zone) => y >= zone.from && y < zone.to) || zones[zones.length - 1];
  }

  function utmFromSearch(search) {
    const params = new URLSearchParams(String(search || "").replace(/^\?/, ""));
    const utm = {};
    ["source", "medium", "campaign", "content", "term"].forEach((key) => {
      const value = params.get(`utm_${key}`);
      if (value) utm[key] = String(value).slice(0, 120);
    });
    const gclid = params.get("gclid");
    if (gclid && !utm.source) { utm.source = "google"; utm.medium = "cpc"; }
    const fbclid = params.get("fbclid");
    if (fbclid && !utm.source) { utm.source = "facebook"; utm.medium = "cpc"; }
    const ttclid = params.get("ttclid");
    if (ttclid && !utm.source) { utm.source = "tiktok"; utm.medium = "cpc"; }
    return utm;
  }

  /* Classifica a origem do tráfego: campanha paga, orgânico, social,
     e-mail, parceiro ou direto. UTM tem prioridade sobre o referrer. */
  function classifySource(input) {
    const data = input || {};
    const utm = data.utm || {};
    const source = String(utm.source || "").trim().toLowerCase();
    const medium = String(utm.medium || "").trim().toLowerCase();
    const host = hostOf(data.referrer || data.referrerHost || "");
    const origin = typeof data.origin === "string" ? data.origin.toLowerCase() : "";

    if (origin && host && origin.includes(host)) {
      // clique interno: não é origem externa
    } else if (!source && !medium) {
      if (!host) return { channel: "direct", referrerHost: "" };
      if (SEARCH_HOSTS.some((needle) => host.includes(needle))) return { channel: "organic", referrerHost: host };
      if (SOCIAL_HOSTS.some((needle) => host.includes(needle))) return { channel: "social", referrerHost: host };
      return { channel: "referral", referrerHost: host };
    }

    if (PAID_MEDIA.test(medium) || PAID_SOURCES.includes(source)) return { channel: "paid", referrerHost: host };
    if (/(email|e-mail|newsletter|mail|mkt)/i.test(medium)) return { channel: "email", referrerHost: host };
    if (/(social|orgânico social)/i.test(medium) || SOCIAL_HOSTS.some((needle) => source.includes(needle.replace(".com", "")))) {
      return { channel: "social", referrerHost: host };
    }
    if (/(organic|orgânico|cpc-off)/i.test(medium)) return { channel: "organic", referrerHost: host };
    if (/(referral|parceria|afiliad)/i.test(medium)) return { channel: "referral", referrerHost: host };
    if (source || medium) return { channel: "campaign", referrerHost: host };
    return { channel: "direct", referrerHost: host };
  }

  function deviceType(input) {
    const data = input || {};
    const ua = String(data.userAgent || "").toLowerCase();
    const width = Number(data.width || 0);
    if (/ipad|tablet|playbook|silk/.test(ua) || (data.touch && width >= 600 && width <= 1100)) return "tablet";
    if (/mobi|iphone|ipod|android.*mobile|windows phone/.test(ua)) return "mobile";
    if (/android/.test(ua)) return "tablet";
    if (!ua && width) return width < 700 ? "mobile" : width < 1100 ? "tablet" : "desktop";
    return "desktop";
  }

  function clampRatio(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    return Math.round(Math.min(1, Math.max(0, number)) * 10000) / 10000;
  }

  /* Rótulo legível do elemento clicado — é o que aparece na lista de
     "pontos quentes" do mapa de calor. */
  function describeTarget(element) {
    if (!element || !element.tagName) return "";
    const tag = element.tagName.toLowerCase();
    const text = String(element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 48);
    const label = element.getAttribute && (element.getAttribute("aria-label") || element.getAttribute("title"));
    if (label) return String(label).slice(0, 60);
    if (element.closest && element.closest("[data-open-cart]")) return "Abrir carrinho";
    if (element.closest && element.closest("[data-toggle-search]")) return "Abrir busca";
    if (element.closest && element.closest("[data-open-nav]")) return "Abrir menu";
    if (element.closest && element.closest(".card")) return text ? `Produto: ${text}` : "Card de produto";
    if (element.closest && element.closest(".chip")) return text ? `Filtro: ${text}` : "Filtro de categoria";
    if (element.closest && element.closest(".cat-card, .category-card")) return text ? `Categoria: ${text}` : "Categoria";
    if (/^https?:\/\/wa\.me/i.test(element.getAttribute && element.getAttribute("href") || "")) return "WhatsApp";
    if (tag === "button") return text ? `Botão: ${text}` : "Botão";
    if (tag === "a") return text ? `Link: ${text}` : "Link";
    if (tag === "input" || tag === "select" || tag === "textarea") return `Campo: ${element.name || element.id || tag}`;
    if (tag === "img") return "Imagem";
    return text ? text : tag;
  }

  /* ------------------------------------------------------------- agregação */

  function emptyReport(options) {
    const opts = options || {};
    return {
      from: opts.from || null,
      to: opts.to || null,
      days: Number(opts.days || 0),
      totals: {
        sessions: 0, pageviews: 0, visitors: 0, pagesPerSession: 0,
        avgSeconds: 0, bounceRate: 0, avgScroll: 0, conversions: 0, conversionRate: 0,
      },
      trend: [], pages: [], sources: [], campaigns: [], referrers: [],
      devices: [], locations: [], zones: [], targets: [], scroll: [],
      heat: { path: opts.path || "/", cols: opts.cols || 12, rows: opts.rows || 18, max: 0, cells: [] },
    };
  }

  function buildHeat(events, options) {
    const opts = options || {};
    const cols = Number(opts.cols || 12);
    const rows = Number(opts.rows || 18);
    const path = normalizePath(opts.path || "/");
    const counts = new Map();
    let max = 0;

    events.forEach((event) => {
      if (event.kind !== "click") return;
      if (normalizePath(event.path) !== path) return;
      const x = clampRatio(event.x_ratio);
      const y = clampRatio(event.y_ratio);
      if (x === null || y === null) return;
      const col = Math.min(cols - 1, Math.floor(x * cols));
      const row = Math.min(rows - 1, Math.floor(y * rows));
      const key = `${col}x${row}`;
      const next = (counts.get(key) || 0) + 1;
      counts.set(key, next);
      if (next > max) max = next;
    });

    const cells = [];
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const clicks = counts.get(`${col}x${row}`) || 0;
        cells.push({
          key: `${col}x${row}`, col, row, clicks,
          intensity: max ? Math.round((clicks / max) * 100) / 100 : 0,
        });
      }
    }
    return { path, cols, rows, max, cells };
  }

  /* Relatório completo de audiência a partir de uma lista de eventos. */
  function aggregate(events, options) {
    const opts = options || {};
    const list = Array.isArray(events) ? events : [];
    const days = Number(opts.days || 30);
    const to = opts.to ? new Date(opts.to) : new Date();
    const from = opts.from ? new Date(opts.from) : new Date(to.getTime() - days * 86400000);
    const report = emptyReport({ from: from.toISOString(), to: to.toISOString(), days, path: opts.path, cols: opts.cols, rows: opts.rows });

    const inRange = list.filter((event) => {
      const at = new Date(event.occurred_at || event.at || Date.now());
      return !Number.isNaN(at.getTime()) && at >= from && at <= to;
    });
    if (!inRange.length) return report;

    const sessions = new Map();
    const pages = new Map();
    const sources = new Map();
    const campaigns = new Map();
    const referrers = new Map();
    const devices = new Map();
    const locations = new Map();
    const zones = new Map();
    const targets = new Map();
    const trend = new Map();
    const scrollByPath = new Map();

    const bump = (map, key, create) => {
      if (!map.has(key)) map.set(key, create());
      return map.get(key);
    };

    inRange.forEach((event) => {
      const at = new Date(event.occurred_at || event.at || Date.now());
      const day = dateKey(at);
      const path = normalizePath(event.path);
      const sessionId = String(event.session_id || "sem-sessao");
      const channel = String(event.channel || classifySource(event).channel || "direct");
      const device = String(event.device || "desktop");

      const session = bump(sessions, sessionId, () => ({
        id: sessionId, channel, device, path, day, pageviews: 0, conversions: 0,
        seconds: 0, scroll: 0, visitor: String(event.visitor_id || sessionId),
      }));
      session.pageviews += event.kind === "page_view" ? 1 : 0;
      session.conversions += CONVERSION_KINDS.includes(event.kind) ? 1 : 0;
      session.seconds += event.kind === "engagement" ? Number(event.value || 0) : 0;
      if (event.kind === "scroll") session.scroll = Math.max(session.scroll, Number(event.scroll_ratio || 0));

      const dayBucket = bump(trend, day, () => ({ date: day, sessions: 0, pageviews: 0, conversions: 0 }));
      dayBucket.pageviews += event.kind === "page_view" ? 1 : 0;
      dayBucket.conversions += CONVERSION_KINDS.includes(event.kind) ? 1 : 0;

      if (event.kind === "page_view") {
        const page = bump(pages, path, () => ({
          path, label: pageLabel(path), views: 0, sessions: new Set(), scroll: 0, scrollCount: 0, conversions: 0,
        }));
        page.views += 1;
        page.sessions.add(sessionId);
        const source = bump(sources, channel, () => ({
          channel, label: CHANNEL_LABELS[channel] || channel, sessions: new Set(), pageviews: 0, conversions: 0,
        }));
        source.pageviews += 1;
        source.sessions.add(sessionId);

        const utm = event.utm || {};
        if (utm.source || utm.campaign || utm.medium) {
          const key = `${utm.source || "-"}|${utm.medium || "-"}|${utm.campaign || "-"}`;
          const campaign = bump(campaigns, key, () => ({
            source: utm.source || "—", medium: utm.medium || "—", campaign: utm.campaign || "—",
            sessions: new Set(), pageviews: 0, conversions: 0,
          }));
          campaign.pageviews += 1;
          campaign.sessions.add(sessionId);
        }
        if (event.referrer_host) {
          const referrer = bump(referrers, event.referrer_host, () => ({ host: event.referrer_host, sessions: new Set(), pageviews: 0 }));
          referrer.pageviews += 1;
          referrer.sessions.add(sessionId);
        }
        const deviceBucket = bump(devices, device, () => ({ type: device, label: DEVICE_LABELS[device] || device, sessions: new Set() }));
        deviceBucket.sessions.add(sessionId);
        const region = event.region || {};
        const place = [region.city, region.state].filter(Boolean).join(" · ") || region.country || "";
        if (place) {
          const location = bump(locations, place, () => ({ name: place, sessions: new Set() }));
          location.sessions.add(sessionId);
        }
      }

      if (CONVERSION_KINDS.includes(event.kind)) {
        /* A conversão pertence à origem da SESSÃO (o visitante entra pelo
           anúncio, navega sem o parâmetro e compra em outra página). Sem
           isso a conversão some quando o evento não repete o canal. */
        const source = sources.get(session.channel) || sources.get(channel);
        if (source) source.conversions += 1;
        const page = pages.get(path) || pages.get(session.path);
        if (page) page.conversions += 1;
        const utm = event.utm || {};
        if (utm.source || utm.campaign || utm.medium) {
          const key = `${utm.source || "-"}|${utm.medium || "-"}|${utm.campaign || "-"}`;
          const campaign = campaigns.get(key);
          if (campaign) campaign.conversions += 1;
        }
      }

      if (event.kind === "click") {
        const zone = event.zone || zoneAt(path, event.y_ratio).id;
        const zoneInfo = zonesFor(path).find((item) => item.id === zone) || { id: zone, label: zone };
        const bucket = bump(zones, `${path}|${zone}`, () => ({
          path, zone, label: zoneInfo.label, clicks: 0, sessions: new Set(),
        }));
        bucket.clicks += 1;
        bucket.sessions.add(sessionId);
        if (event.target) {
          const target = bump(targets, `${path}|${event.target}`, () => ({ path, target: event.target, clicks: 0 }));
          target.clicks += 1;
        }
      }

      if (event.kind === "scroll" && event.scroll_ratio != null) {
        const bucket = bump(scrollByPath, path, () => ({ path, label: pageLabel(path), reached: [], sessions: new Set() }));
        bucket.reached.push(Number(event.scroll_ratio));
        bucket.sessions.add(sessionId);
      }
    });

    /* Sessões por dia: conta a primeira página vista do dia. */
    inRange
      .filter((event) => event.kind === "page_view")
      .forEach((event) => {
        const day = dateKey(new Date(event.occurred_at || event.at));
        const bucket = trend.get(day);
        if (bucket) {
          bucket._seen = bucket._seen || new Set();
          if (!bucket._seen.has(event.session_id)) {
            bucket._seen.add(event.session_id);
            bucket.sessions += 1;
          }
        }
      });

    const sessionList = Array.from(sessions.values());
    const pageviews = sessionList.reduce((sum, item) => sum + item.pageviews, 0);
    const seconds = sessionList.reduce((sum, item) => sum + item.seconds, 0);
    const bounced = sessionList.filter((item) => item.pageviews <= 1 && item.seconds < 10).length;
    const scrolled = sessionList.filter((item) => item.scroll > 0);
    const conversions = sessionList.reduce((sum, item) => sum + item.conversions, 0);
    const share = (value, total) => (total ? Math.round((value / total) * 1000) / 10 : 0);

    report.totals = {
      sessions: sessionList.length,
      pageviews,
      visitors: new Set(sessionList.map((item) => item.visitor)).size,
      pagesPerSession: sessionList.length ? Math.round((pageviews / sessionList.length) * 100) / 100 : 0,
      avgSeconds: sessionList.length ? Math.round(seconds / sessionList.length) : 0,
      bounceRate: share(bounced, sessionList.length),
      avgScroll: scrolled.length
        ? Math.round((scrolled.reduce((sum, item) => sum + item.scroll, 0) / scrolled.length) * 100)
        : 0,
      conversions,
      conversionRate: share(conversions, sessionList.length),
    };

    report.trend = Array.from(trend.values())
      .map((item) => ({ date: item.date, sessions: item.sessions, pageviews: item.pageviews, conversions: item.conversions }))
      .sort((a, b) => a.date.localeCompare(b.date));

    report.pages = Array.from(pages.values())
      .map((item) => ({
        path: item.path,
        label: item.label,
        views: item.views,
        sessions: item.sessions.size,
        share: share(item.views, pageviews),
        conversions: item.conversions,
      }))
      .sort((a, b) => b.views - a.views);

    report.sources = Array.from(sources.values())
      .map((item) => ({
        channel: item.channel,
        label: item.label,
        sessions: item.sessions.size,
        pageviews: item.pageviews,
        conversions: item.conversions,
        share: share(item.sessions.size, sessionList.length),
      }))
      .sort((a, b) => b.sessions - a.sessions);

    report.campaigns = Array.from(campaigns.values())
      .map((item) => ({
        source: item.source, medium: item.medium, campaign: item.campaign,
        sessions: item.sessions.size, pageviews: item.pageviews, conversions: item.conversions,
      }))
      .sort((a, b) => b.sessions - a.sessions)
      .slice(0, 20);

    report.referrers = Array.from(referrers.values())
      .map((item) => ({ host: item.host, sessions: item.sessions.size, pageviews: item.pageviews }))
      .sort((a, b) => b.sessions - a.sessions)
      .slice(0, 12);

    report.devices = Array.from(devices.values())
      .map((item) => ({ type: item.type, label: item.label, sessions: item.sessions.size, share: share(item.sessions.size, sessionList.length) }))
      .sort((a, b) => b.sessions - a.sessions);

    report.locations = Array.from(locations.values())
      .map((item) => ({ name: item.name, sessions: item.sessions.size, share: share(item.sessions.size, sessionList.length) }))
      .sort((a, b) => b.sessions - a.sessions)
      .slice(0, 12);

    const totalClicks = Array.from(zones.values()).reduce((sum, item) => sum + item.clicks, 0);
    report.zones = Array.from(zones.values())
      .map((item) => ({ path: item.path, zone: item.zone, label: item.label, clicks: item.clicks, share: share(item.clicks, totalClicks) }))
      .sort((a, b) => b.clicks - a.clicks);

    report.targets = Array.from(targets.values())
      .sort((a, b) => b.clicks - a.clicks)
      .slice(0, 12);

    report.scroll = Array.from(scrollByPath.values())
      .map((item) => {
        const reached = item.reached;
        const deep = (threshold) => Math.round((reached.filter((value) => value >= threshold).length / Math.max(1, reached.length)) * 100);
        return {
          path: item.path, label: item.label, sessions: item.sessions.size,
          average: Math.round((reached.reduce((sum, value) => sum + value, 0) / Math.max(1, reached.length)) * 100),
          milestones: { "25": deep(0.25), "50": deep(0.5), "75": deep(0.75), "100": deep(1) },
        };
      })
      .sort((a, b) => b.sessions - a.sessions);

    report.heat = buildHeat(inRange, { path: opts.path || report.pages[0]?.path || "/", cols: opts.cols, rows: opts.rows });
    return report;
  }

  /* ------------------------------------------------- base de exemplo (demo) */

  const SAMPLE_PAGES = [
    { path: "/", weight: 34 },
    { path: "/produtos.html", weight: 26 },
    { path: "/produto.html", weight: 18 },
    { path: "/lojas.html", weight: 9 },
    { path: "/cartao-presente.html", weight: 5 },
    { path: "/sobre.html", weight: 4 },
    { path: "/contato.html", weight: 3 },
    { path: "/privacidade.html", weight: 1 },
  ];

  const SAMPLE_SOURCES = [
    { channel: "social", weight: 31, referrerHost: "instagram.com", utm: { source: "instagram", medium: "social", campaign: "drop-semanal" } },
    { channel: "direct", weight: 22, referrerHost: "", utm: {} },
    { channel: "organic", weight: 15, referrerHost: "google.com.br", utm: {} },
    { channel: "paid", weight: 14, referrerHost: "", utm: { source: "meta", medium: "cpc", campaign: "c18-verao09-conversao" } },
    { channel: "paid", weight: 6, referrerHost: "", utm: { source: "googleads", medium: "cpc", campaign: "shopping-merchant" } },
    { channel: "social", weight: 5, referrerHost: "tiktok.com", utm: { source: "tiktok", medium: "social", campaign: "bastidores-loja" } },
    { channel: "referral", weight: 4, referrerHost: "wa.me", utm: {} },
    { channel: "email", weight: 3, referrerHost: "", utm: { source: "newsletter", medium: "email", campaign: "novidades-c18" } },
  ];

  const SAMPLE_CITIES = [
    { city: "Nova Iguaçu", state: "RJ", weight: 30 },
    { city: "Duque de Caxias", state: "RJ", weight: 18 },
    { city: "Nilópolis", state: "RJ", weight: 11 },
    { city: "Queimados", state: "RJ", weight: 9 },
    { city: "São João de Meriti", state: "RJ", weight: 8 },
    { city: "Belford Roxo", state: "RJ", weight: 7 },
    { city: "Mesquita", state: "RJ", weight: 5 },
    { city: "Rio de Janeiro", state: "RJ", weight: 7 },
    { city: "São Paulo", state: "SP", weight: 3 },
    { city: "Belo Horizonte", state: "MG", weight: 2 },
  ];

  const SAMPLE_PRODUCTS = [
    { id: "c18-tee-oversized", name: "Camiseta Oversized Censura 18", category: "camisetas", price: 129.9 },
    { id: "c18-moletom-hoodie", name: "Moletom Hoodie C18", category: "moletons", price: 249.9 },
    { id: "c18-bermuda-cargo", name: "Bermuda Cargo C18", category: "bermudas", price: 179.9 },
    { id: "c18-jaqueta-cortavento", name: "Jaqueta Corta-Vento", category: "jaquetas", price: 329.9 },
    { id: "c18-bone-estruturado", name: "Boné Estruturado C18", category: "acessorios", price: 89.9 },
  ];

  function pickWeighted(random, list) {
    const total = list.reduce((sum, item) => sum + (item.weight || 1), 0);
    let draw = random() * total;
    for (let index = 0; index < list.length; index += 1) {
      draw -= list[index].weight || 1;
      if (draw <= 0) return list[index];
    }
    return list[list.length - 1];
  }

  function iso(date) {
    return date.toISOString();
  }

  /* Base sintética e determinística para o painel ser navegável antes de
     existir tráfego real. Nunca é gravada no navegador: vive só na memória
     do painel e o próprio painel avisa que é simulação. */
  function demoEvents(options) {
    const opts = options || {};
    const days = Math.max(1, Number(opts.days || 30));
    const random = mulberry32(Number(opts.seed || 18));
    const events = [];
    const now = new Date();
    const start = new Date(now.getTime() - days * 86400000);

    for (let dayOffset = 0; dayOffset < days; dayOffset += 1) {
      const day = new Date(start.getTime() + dayOffset * 86400000);
      const weekday = day.getUTCDay();
      /* fim de semana e sexta vendem mais na Baixada */
      const seasonality = weekday === 0 || weekday === 6 ? 1.35 : weekday === 5 ? 1.15 : 1;
      const campaignBoost = dayOffset >= days - 7 ? 1.25 : 1;
      const sessionsToday = Math.round((18 + random() * 22) * seasonality * campaignBoost);

      for (let index = 0; index < sessionsToday; index += 1) {
        const source = pickWeighted(random, SAMPLE_SOURCES);
        const city = pickWeighted(random, SAMPLE_CITIES);
        const deviceRoll = random();
        const device = deviceRoll < 0.74 ? "mobile" : deviceRoll < 0.93 ? "desktop" : "tablet";
        const sessionId = `demo-${dayOffset}-${index}`;
        const visitorId = `demo-visitor-${Math.floor(random() * (sessionsToday * days * 0.6))}`;
        const hour = 8 + Math.floor(random() * 14);
        const minute = Math.floor(random() * 60);
        const sessionStart = new Date(day.getTime());
        sessionStart.setUTCHours(hour + 3, minute, Math.floor(random() * 60), 0);

        /* ~3 sessões em 10 entram e saem sem interagir (taxa de rejeição) */
        const bounced = random() < 0.28;
        const landing = pickWeighted(random, SAMPLE_PAGES);
        const pageCount = bounced ? 1 : landing.path === "/" ? 1 + Math.floor(random() * 4) : 1 + Math.floor(random() * 2);
        const visited = [landing.path];
        for (let step = 1; step < pageCount; step += 1) {
          const next = step === 1 && random() < 0.6
            ? "/produtos.html"
            : pickWeighted(random, SAMPLE_PAGES).path;
          visited.push(next);
        }

        /* O rastreador real guarda o UTM da entrada na sessão: todos os
           eventos seguem atribuídos à mesma origem. */
        const sessionUtm = source.utm;

        visited.forEach((path, step) => {
          const at = new Date(sessionStart.getTime() + step * (25000 + random() * 90000));
          const zones = zonesFor(path);
          events.push({
            kind: "page_view",
            session_id: sessionId,
            visitor_id: visitorId,
            occurred_at: iso(at),
            path,
            title: pageLabel(path),
            channel: source.channel,
            referrer_host: step === 0 ? source.referrerHost : "",
            utm: sessionUtm,
            device,
            region: { city: city.city, state: city.state, country: "BR" },
            landing: step === 0 ? path : "",
          });

          /* rolagem: a maioria para no meio, uma parte chega ao fim */
          const scrollRoll = bounced ? 0 : random();
          const scrollRatio = scrollRoll < 0.2 ? 0.2 : scrollRoll < 0.5 ? 0.5 : scrollRoll < 0.78 ? 0.75 : 1;
          events.push({
            kind: "scroll",
            session_id: sessionId,
            visitor_id: visitorId,
            occurred_at: iso(new Date(at.getTime() + 9000)),
            path, channel: source.channel, device,
            scroll_ratio: scrollRatio,
            utm: sessionUtm, region: { city: city.city, state: city.state },
          });

          events.push({
            kind: "engagement",
            session_id: sessionId,
            visitor_id: visitorId,
            occurred_at: iso(new Date(at.getTime() + 12000)),
            path, channel: source.channel, device,
            value: bounced ? Math.round(2 + random() * 6) : Math.round(12 + random() * (scrollRatio * 120)),
            utm: sessionUtm, region: { city: city.city, state: city.state },
          });

          /* cliques distribuídos pelas faixas da página */
          const clicks = bounced ? 0 : Math.floor(random() * (path === "/" ? 7 : 5));
          for (let click = 0; click < clicks; click += 1) {
            const zone = pickWeighted(random, zones.map((item, zoneIndex) => ({
              ...item,
              weight: zoneIndex === 0 ? 8 : path === "/" && item.id === "hero" ? 26 : item.id === "grade" || item.id === "destaques" ? 30 : item.id === "footer" ? 5 : 14,
            })));
            const y = zone.from + random() * (zone.to - zone.from);
            const x = 0.05 + random() * 0.9;
            const targetRoll = random();
            let target = zone.label;
            if (zone.id === "grade" || zone.id === "destaques") {
              const product = SAMPLE_PRODUCTS[Math.floor(random() * SAMPLE_PRODUCTS.length)];
              target = `Produto: ${product.name}`;
            } else if (zone.id === "categorias") {
              target = `Categoria: ${["camisetas", "moletons", "bermudas", "acessorios"][Math.floor(random() * 4)]}`;
            } else if (zone.id === "header") {
              target = targetRoll < 0.5 ? "Link do menu" : "Abrir carrinho";
            } else if (zone.id === "hero") {
              target = targetRoll < 0.7 ? "CTA: Ver o catálogo" : "CTA: Achar uma loja";
            }
            events.push({
              kind: "click",
              session_id: sessionId,
              visitor_id: visitorId,
              occurred_at: iso(new Date(at.getTime() + 4000 + click * 3500)),
              path, channel: source.channel, device,
              zone: zone.id, target,
              x_ratio: Math.round(x * 10000) / 10000,
              y_ratio: Math.round(y * 10000) / 10000,
              utm: sessionUtm, region: { city: city.city, state: city.state },
            });
          }

          /* jornada de compra nas páginas de catálogo e produto */
          if (!bounced && path === "/produto.html" && random() < 0.55) {
            const product = SAMPLE_PRODUCTS[Math.floor(random() * SAMPLE_PRODUCTS.length)];
            const base = new Date(at.getTime() + 15000);
            events.push({
              kind: "product_view", session_id: sessionId, visitor_id: visitorId,
              occurred_at: iso(base), path, channel: source.channel, device,
              product_id: product.id, category: product.category, value: product.price,
              utm: sessionUtm, region: { city: city.city, state: city.state },
            });
            if (random() < 0.5) {
              events.push({
                kind: "add_to_cart", session_id: sessionId, visitor_id: visitorId,
                occurred_at: iso(new Date(base.getTime() + 22000)), path, channel: source.channel, device,
                product_id: product.id, category: product.category, value: product.price,
                utm: sessionUtm, region: { city: city.city, state: city.state },
              });
              if (random() < 0.62) {
                events.push({
                  kind: random() < 0.7 ? "checkout_intent" : "whatsapp",
                  session_id: sessionId, visitor_id: visitorId,
                  occurred_at: iso(new Date(base.getTime() + 48000)), path, channel: source.channel, device,
                  value: product.price,
                  utm: sessionUtm, region: { city: city.city, state: city.state },
                });
              }
            }
          }
          if (!bounced && path === "/produtos.html" && random() < 0.3) {
            events.push({
              kind: "category_view", session_id: sessionId, visitor_id: visitorId,
              occurred_at: iso(new Date(at.getTime() + 8000)), path, channel: source.channel, device,
              category: ["camisetas", "moletons", "bermudas", "calcas", "jaquetas", "acessorios", "feminino"][Math.floor(random() * 7)],
              utm: sessionUtm, region: { city: city.city, state: city.state },
            });
          }
          if (!bounced && path === "/lojas.html" && random() < 0.22) {
            events.push({
              kind: "whatsapp", session_id: sessionId, visitor_id: visitorId,
              occurred_at: iso(new Date(at.getTime() + 30000)), path, channel: source.channel, device,
              target: "WhatsApp",
              utm: sessionUtm, region: { city: city.city, state: city.state },
            });
          }
        });
      }
    }

    return events.sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at)));
  }

  /* ------------------------------------------------------------ coleta web */

  const browser = typeof window !== "undefined" && typeof document !== "undefined";
  const tracker = {
    enabled: false,
    consent: "unknown",
    queue: [],
    session: null,
    context: {},
    timer: null,
  };

  function storage() {
    try {
      return global.localStorage || null;
    } catch (_) {
      return null;
    }
  }

  function randomId(prefix) {
    const bytes = new Uint8Array(8);
    if (global.crypto && global.crypto.getRandomValues) global.crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    return `${prefix}-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  }

  function consentStatus() {
    const lgpd = global.C18LGPD;
    if (!lgpd || typeof lgpd.getConsent !== "function") return "granted";
    const consent = lgpd.getConsent();
    return consent ? consent.status : "unknown";
  }

  function currentSession(force) {
    const store = storage();
    const now = Date.now();
    if (!store) return tracker.session || (tracker.session = { id: randomId("s"), visitor: randomId("v"), startedAt: now });
    let saved = null;
    try { saved = JSON.parse(store.getItem(SESSION_KEY) || "null"); } catch (_) { saved = null; }
    if (!force && saved && now - Number(saved.at || 0) < SESSION_IDLE_MS) {
      tracker.session = { id: saved.id, visitor: saved.visitor, startedAt: saved.startedAt || now };
      return tracker.session;
    }
    let visitor = null;
    try { visitor = store.getItem(VISITOR_KEY); } catch (_) { visitor = null; }
    if (!visitor) {
      visitor = randomId("v");
      try { store.setItem(VISITOR_KEY, visitor); } catch (_) { /* modo privado */ }
    }
    tracker.session = { id: randomId("s"), visitor, startedAt: now };
    try { store.setItem(SESSION_KEY, JSON.stringify({ ...tracker.session, at: now })); } catch (_) { /* modo privado */ }
    return tracker.session;
  }

  function supabaseClient() {
    const cfg = global.C18_ANALYTICS || {};
    const site = global.C18_SITE || {};
    /* se a página só preencheu C18_SITE (site-config.js), a medição usa a
       mesma URL e a mesma chave anônima — uma configuração só. */
    const url = cfg.supabaseUrl || site.supabaseUrl || "";
    const anonKey = cfg.supabaseAnonKey || site.supabaseAnonKey || "";
    if (tracker.client) return Promise.resolve(tracker.client);
    if (!url || !anonKey) return Promise.reject(new Error("Supabase não configurado"));
    const create = (lib) => lib.createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    if (global.supabase) { tracker.client = create(global.supabase); return Promise.resolve(tracker.client); }
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
      script.onload = () => (global.supabase ? (tracker.client = create(global.supabase), resolve(tracker.client)) : reject(new Error("Supabase não carregou")));
      script.onerror = () => reject(new Error("Falha ao carregar o cliente Supabase"));
      document.head.appendChild(script);
    });
  }

  /* Eventos medidos neste navegador (modo demonstração). O painel lê esta
     lista para mostrar a audiência real ao lado da base de exemplo. */
  function capturedEvents(store) {
    const ref = store || storage();
    if (!ref || typeof ref.getItem !== "function") return [];
    try {
      const saved = JSON.parse(ref.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(saved) ? saved : [];
    } catch (_) {
      return [];
    }
  }

  function persistDemo(events) {
    const store = storage();
    if (!store) return;
    try {
      const saved = JSON.parse(store.getItem(STORAGE_KEY) || "[]");
      const next = saved.concat(events).slice(-MAX_STORED_EVENTS);
      store.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (_) {
      /* storage cheio ou modo privado: a medição não fica gravada */
    }
  }

  /* "supabase" quando o site (ou a medição) está ligado ao projeto;
     caso contrário os eventos ficam no localStorage do navegador. */
  function transportMode() {
    const cfg = global.C18_ANALYTICS || {};
    const site = global.C18_SITE || {};
    if (cfg.mode === "supabase" || cfg.mode === "static") return cfg.mode;
    return site.mode === "supabase" ? "supabase" : "static";
  }

  async function flush() {
    if (!tracker.queue.length) return;
    const batch = tracker.queue.splice(0, MAX_BATCH);
    if (transportMode() === "supabase") {
      try {
        const client = await supabaseClient();
        await client.rpc("track_site_events", { p_events: batch });
      } catch (error) {
        /* falha de rede não pode atrapalhar a loja: descarta o lote */
        if (global.console) console.warn("Audiência: lote não enviado.", error && error.message);
      }
      return;
    }
    persistDemo(batch);
  }

  function scheduleFlush() {
    if (tracker.timer) return;
    tracker.timer = setTimeout(() => {
      tracker.timer = null;
      flush();
    }, 4000);
  }

  function record(event) {
    if (tracker.consent === "essential") return false;
    if (tracker.consent === "unknown") {
      /* ainda sem resposta no banner: segura na memória. Se o visitante
         aceitar, o lote é enviado; se escolher o essencial, é descartado. */
      if (tracker.queue.length < 200) tracker.queue.push(event);
      return false;
    }
    tracker.queue.push(event);
    if (tracker.queue.length >= MAX_BATCH) flush();
    else scheduleFlush();
    return true;
  }

  function baseEvent(kind, data) {
    const session = currentSession();
    const loc = global.location || {};
    const path = normalizePath(loc.pathname || "/");
    const payload = {
      kind,
      session_id: session.id,
      visitor_id: session.visitor,
      occurred_at: new Date().toISOString(),
      path,
      title: (document.title || "").slice(0, 160),
      device: tracker.context.device || "desktop",
      screen: tracker.context.screen || "",
      language: tracker.context.language || "",
      channel: tracker.context.channel || "direct",
      referrer_host: tracker.context.referrerHost || "",
      utm: tracker.context.utm || {},
      region: tracker.context.region || {},
    };
    return Object.assign(payload, data || {});
  }

  /* API pública para a loja registrar eventos de negócio (app.js). */
  function track(kind, data) {
    if (!EVENT_KINDS.includes(kind)) return false;
    return record(baseEvent(kind, data));
  }

  function measureContext() {
    const loc = global.location || {};
    const search = loc.search || "";
    const utm = utmFromSearch(search);
    const source = classifySource({
      referrer: document.referrer || "",
      origin: loc.origin || "",
      utm,
    });
    const width = global.innerWidth || (document.documentElement && document.documentElement.clientWidth) || 0;
    tracker.context = {
      utm,
      channel: source.channel,
      referrerHost: source.referrerHost,
      device: deviceType({ userAgent: navigator.userAgent || "", width, touch: "ontouchstart" in global }),
      screen: width ? `${width}x${global.innerHeight || 0}` : "",
      language: (navigator.language || "").slice(0, 10),
      region: {},
    };
    /* UTM fica gravado na sessão: o visitante entra pelo anúncio e navega
       sem o parâmetro — a origem precisa continuar a mesma. */
    try {
      const store = storage();
      const saved = store && JSON.parse(store.getItem(SESSION_KEY) || "null");
      if (saved && saved.utm && !Object.keys(utm).length) tracker.context.utm = saved.utm;
      if (saved && saved.channel && !utm.source) tracker.context.channel = saved.channel;
      if (store) {
        store.setItem(SESSION_KEY, JSON.stringify({
          ...(JSON.parse(store.getItem(SESSION_KEY) || "{}")),
          utm: tracker.context.utm,
          channel: tracker.context.channel,
        }));
      }
    } catch (_) { /* sem storage: vale só para esta página */ }
  }

  function documentHeight() {
    const body = document.body || {};
    const root = document.documentElement || {};
    return Math.max(
      body.scrollHeight || 0, root.scrollHeight || 0,
      body.offsetHeight || 0, root.offsetHeight || 0,
      global.innerHeight || 0
    );
  }

  function trackPageView() {
    record(baseEvent("page_view", { landing: normalizePath((global.location || {}).pathname || "/") }));
    /* tempo de leitura desta página, enviado ao sair ou a cada 15s */
    let seconds = 0;
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      seconds += 5;
      if (seconds % 15 === 0) record(baseEvent("engagement", { value: 15 }));
    };
    tracker.pageTimer = setInterval(tick, 5000);
    global.addEventListener("pagehide", () => {
      clearInterval(tracker.pageTimer);
      if (seconds % 15 !== 0 && seconds > 0) record(baseEvent("engagement", { value: seconds % 15 }));
      flush();
    });
  }

  function trackClicks() {
    let lastAt = 0;
    document.addEventListener("click", (event) => {
      const now = Date.now();
      if (now - lastAt < 250) return; // evita duplicidade de cliques rápidos
      lastAt = now;
      const element = event.target && event.target.closest ? event.target.closest("a,button,input,select,textarea,.card,.chip") || event.target : event.target;
      const x = Number(event.pageX || 0);
      const y = Number(event.pageY || 0);
      const height = documentHeight();
      const path = normalizePath((global.location || {}).pathname || "/");
      const yRatio = height ? y / height : 0;
      const zone = element && element.closest && element.closest("[data-analytics-zone]");
      const zoneId = zone ? zone.getAttribute("data-analytics-zone") : zoneAt(path, yRatio).id;
      const width = Math.max(1, (document.documentElement && document.documentElement.clientWidth) || global.innerWidth || 1);
      record(baseEvent("click", {
        zone: zoneId,
        target: describeTarget(element).slice(0, 90),
        x_ratio: clampRatio(x / width),
        y_ratio: clampRatio(yRatio),
      }));
    }, { capture: true, passive: true });
  }

  function trackScroll() {
    const milestones = [0.25, 0.5, 0.75, 1];
    const reached = new Set();
    let scheduled = false;
    const onScroll = () => {
      if (scheduled) return;
      scheduled = true;
      setTimeout(() => {
        scheduled = false;
        const height = documentHeight();
        const seen = (global.scrollY || global.pageYOffset || 0) + (global.innerHeight || 0);
        const ratio = height ? Math.min(1, seen / height) : 0;
        const milestone = milestones.filter((value) => ratio >= value).pop();
        if (milestone && !reached.has(milestone)) {
          reached.add(milestone);
          record(baseEvent("scroll", { scroll_ratio: milestone }));
        }
      }, 220);
    };
    global.addEventListener("scroll", onScroll, { passive: true });
  }

  function applyConsent(status) {
    tracker.consent = status;
    if (status === "granted") {
      tracker.enabled = true;
      currentSession();
      measureContext();
      flush();
    } else if (status === "essential") {
      tracker.enabled = false;
      tracker.queue = [];
      const store = storage();
      if (store) {
        try {
          store.removeItem(SESSION_KEY);
          store.removeItem(VISITOR_KEY);
        } catch (_) { /* nada a apagar */ }
      }
    }
  }

  function init() {
    if (!browser) return;
    /* O painel de operações usa este módulo só para agregar os números:
       ele não mede a si mesmo (senão a audiência viraria uso interno). */
    if (normalizePath((global.location || {}).pathname || "/").startsWith("/admin")) {
      tracker.consent = "essential";
      return;
    }
    tracker.consent = consentStatus();
    if (tracker.consent === "granted") {
      tracker.enabled = true;
      currentSession();
    } else {
      /* prepara o contexto mesmo sem consentimento para o evento não sair
         incompleto caso o visitante aceite durante a navegação */
      currentSession();
    }
    measureContext();
    trackPageView();
    trackClicks();
    trackScroll();
    document.addEventListener("c18:lgpd-change", (event) => {
      applyConsent((event.detail && event.detail.status) || consentStatus());
    });
  }

  global.C18Analytics = {
    STORAGE_KEY,
    SESSION_KEY,
    EVENT_KINDS,
    CONVERSION_KINDS,
    CHANNEL_LABELS,
    DEVICE_LABELS,
    PAGE_LABELS,
    PAGE_ZONES,
    FALLBACK_ZONES,
    aggregate,
    buildHeat,
    capturedEvents,
    classifySource,
    dateKey,
    demoEvents,
    describeTarget,
    deviceType,
    emptyReport,
    hostOf,
    init,
    mulberry32,
    normalizePath,
    pageLabel,
    track,
    utmFromSearch,
    zoneAt,
    zonesFor,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = global.C18Analytics;
  }

  if (browser) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
  }
})(typeof window !== "undefined" ? window : globalThis);
