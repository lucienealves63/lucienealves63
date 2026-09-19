(function () {
  "use strict";

  const CONFIG = window.C18_CONFIG || { mode: "demo", lowStockThreshold: 3 };
  const Importer = window.C18Importer;
  const Analytics = window.C18Analytics;
  const Audience = window.C18Audience;
  const Channels = window.C18Channels;
  const STORE_KEY = "c18-operations-demo-v2";
  const BANNER_DEMO_KEY = "c18:demo-banner";
  const CATEGORY_BANNER_DEMO_KEY = "c18:demo-category-banners";
  const PALETTE_DEMO_KEY = "c18:demo-palette";
  const COUPONS_DEMO_KEY = "c18:demo-coupons";
  const SITE_URL = "https://censura18.com.br";
  const DEFAULT_PALETTE = {
    primary: "#000000",
    primaryContrast: "#ffffff",
    darkBg: "#000000",
    darkText: "#ffffff",
    pageBg: "#ffffff",
    text: "#0b0b0b",
    muted: "#6d6d6d",
    line: "#dedede",
  };
  const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
  /* Números de estatística do hero (index.html → #hero-stat-N-value/-label).
     Os limites abaixo são os mesmos do site e da migration SQL. */
  const HERO_STAT_SLOTS = 4;
  const HERO_STAT_VALUE_MAX = 12;
  const HERO_STAT_LABEL_MAX = 40;
  const DEFAULT_HERO_STATS = [
    { value: "36", label: "anos de rua" },
    { value: "6", label: "lojas físicas" },
    { value: "25k", label: "seguidores" },
    { value: "1989", label: "a origem" },
  ];
  // variáveis usadas só na prévia da paleta (não afetam o tema do painel)
  const PALETTE_PREVIEW_VARS = {
    primary: "--pv-primary",
    primaryContrast: "--pv-primary-contrast",
    darkBg: "--pv-dark",
    darkText: "--pv-dark-text",
    pageBg: "--pv-page",
    text: "--pv-text",
    muted: "--pv-muted",
    line: "--pv-line",
  };

  const stores = [
    { id: "ni-calcadao", name: "Nova Iguaçu — Calçadão", short: "NI Calçadão" },
    { id: "ni-beco", name: "Nova Iguaçu — Beco", short: "NI Beco" },
    { id: "ni-top", name: "Nova Iguaçu — Top Shopping", short: "Top Shopping" },
    { id: "caxias", name: "Duque de Caxias — Centro", short: "Caxias" },
    { id: "nilopolis", name: "Nilópolis — Mirandela", short: "Nilópolis" },
    { id: "queimados", name: "Queimados — Centro", short: "Queimados" },
  ];

  const saoPauloParts = Object.fromEntries(new Intl.DateTimeFormat("en", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone: "America/Sao_Paulo",
  }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  const saoPauloDateKey = `${saoPauloParts.year}-${saoPauloParts.month}-${saoPauloParts.day}`;
  const demoDate = (time, daysAgo = 0) => {
    const base = new Date(`${saoPauloDateKey}T12:00:00Z`);
    base.setUTCDate(base.getUTCDate() - daysAgo);
    return `${base.toISOString().slice(0, 10)}T${time}:00-03:00`;
  };

  const statusInfo = {
    all: { label: "Todos" },
    payment: { label: "Pagamento" },
    fraud: { label: "Antifraude" },
    picking: { label: "Separação" },
    checking: { label: "Conferência" },
    ready: { label: "Pronto para envio" },
    shipped: { label: "Enviado" },
    delivered: { label: "Entregue" },
    cancelled: { label: "Cancelado" },
  };

  const seedInventory = [
    ["0000000063", "SHORT FOLHAS", "CENSURA 18", "VERÃO 08", "SHORT", 15, 1, "UNICA", "P", "ni-calcadao"],
    ["0000000946", "XADREZ BORDADA", "CENSURA 18", "VERÃO 09", "MOCHILA", 49.9, 3, "PRETO", "UNIC", "ni-calcadao"],
    ["0000000940", "CORDOBA 6 BOLSOS", "CENSURA 18", "VERÃO 08", "MOCHILA", 79, 8, "UNICA", "UNIC", "ni-top"],
    ["0000000412", "MILITAR COLOR", "CENSURA 18", "VERÃO 08", "BERMUDA PASSEIO", 29.9, 2, "CINZA", "38", "caxias"],
    ["0000000413", "MILITAR COLOR", "CENSURA 18", "VERÃO 08", "BERMUDA PASSEIO", 29.9, 6, "CINZA", "40", "caxias"],
    ["0000000080", "REGATA SPORT C18", "CENSURA 18", "VERÃO 08", "REGATA", 14.9, 12, "BRANCO", "P", "nilopolis"],
    ["0000000081", "REGATA SPORT C18", "CENSURA 18", "VERÃO 08", "REGATA", 14.9, 9, "BRANCO", "M", "nilopolis"],
    ["0000000082", "REGATA SPORT C18", "CENSURA 18", "VERÃO 08", "REGATA", 14.9, 0, "BRANCO", "G", "nilopolis"],
    ["0000000023", "BORDADO CAPETA", "CENSURA 18", "VERÃO 08", "BONE", 39.9, 4, "PRETO", "UNIC", "queimados"],
    ["0000000013", "REGATA STRAP", "CENSURA 18", "VERÃO 08", "REGATA", 5, 18, "UNICA", "P", "ni-beco"],
    ["0000000014", "REGATA STRAP", "CENSURA 18", "VERÃO 08", "REGATA", 5, 14, "UNICA", "M", "ni-beco"],
    ["0000000203", "CALÇA PASSEIO XADR", "CENSURA 18", "VERÃO 08", "CALCA", 15, 2, "XADREZ", "36", "ni-top"],
  ].map(([code, description, brand, collection, category, price, quantity, color, size, storeId]) => ({
    id: `${code}-${storeId}`,
    code,
    reference: code,
    description,
    brand,
    collection,
    category,
    price,
    quantity,
    reserved: 0,
    color,
    size,
    storeId,
    ecommerce: false,
    source: "ALTERDATA",
    updatedAt: new Date().toISOString(),
  }));

  const seedOrders = [
    {
      id: "C18-1048", customer: "Mariana Souza", date: demoDate("13:42"), origin: "Site", storeId: "ni-calcadao", total: 259.8,
      payment: "approved", fraud: "approved", status: "picking", sellerCode: "042", couponCode: "PRIMEIRAC18", discountAmount: 20,
      items: [
        { code: "0000000080", name: "Regata Sport C18", color: "Branco", size: "P", qty: 1, checked: false },
        { code: "0000000023", name: "Boné Bordado", color: "Preto", size: "Único", qty: 1, checked: false },
      ],
      events: [{ title: "Pedido liberado para separação", at: "Hoje, 13:45" }, { title: "Pagamento aprovado pela Rede", at: "Hoje, 13:44" }, { title: "ClearSale: aprovação automática", at: "Hoje, 13:44" }],
    },
    {
      id: "C18-1047", customer: "João Pedro Lima", date: demoDate("12:18"), origin: "Site", storeId: "caxias", total: 329.9,
      payment: "approved", fraud: "approved", status: "checking",
      items: [{ code: "0000000413", name: "Bermuda Militar Color", color: "Cinza", size: "40", qty: 1, checked: false }],
      events: [{ title: "Separação concluída por Ana", at: "Hoje, 13:10" }, { title: "Pedido liberado", at: "Hoje, 12:21" }],
    },
    {
      id: "C18-1046", customer: "Beatriz Carvalho", date: demoDate("11:05"), origin: "Instagram", storeId: "nilopolis", total: 149.9,
      payment: "approved", fraud: "approved", status: "ready",
      items: [{ code: "0000000081", name: "Regata Sport C18", color: "Branco", size: "M", qty: 2, checked: true }],
      events: [{ title: "Conferência concluída sem divergência", at: "Hoje, 12:08" }, { title: "Separação concluída", at: "Hoje, 11:48" }],
    },
    {
      id: "C18-1045", customer: "Carlos Henrique", date: demoDate("10:37"), origin: "Site", storeId: "ni-top", total: 419.8,
      payment: "authorized", fraud: "review", status: "fraud",
      items: [{ code: "0000000940", name: "Mochila Cordoba 6 Bolsos", color: "Única", size: "Único", qty: 1, checked: false }],
      events: [{ title: "ClearSale: análise manual", at: "Hoje, 10:39" }, { title: "Valor pré-autorizado pela Rede", at: "Hoje, 10:38" }],
    },
    {
      id: "C18-1044", customer: "Renata Silva", date: demoDate("17:11", 1), origin: "Site", storeId: "queimados", total: 119.9,
      payment: "captured", fraud: "approved", status: "shipped", carrier: "Correios", tracking: "QR123456789BR",
      items: [{ code: "0000000023", name: "Boné Bordado", color: "Preto", size: "Único", qty: 1, checked: true }],
      events: [{ title: "Postado nos Correios", at: "Ontem, 17:11" }, { title: "Conferência concluída", at: "Ontem, 15:30" }],
    },
  ];

  const seedMovements = [
    { id: 1, code: "0000000940", description: "CORDOBA 6 BOLSOS", type: "import", storeId: "ni-top", quantity: 8, at: "Hoje, 14:20", note: "Importação Alterdata" },
    { id: 2, code: "0000000413", description: "MILITAR COLOR", type: "exit", storeId: "caxias", quantity: -1, at: "Hoje, 13:10", note: "Reserva pedido C18-1047" },
    { id: 3, code: "0000000080", description: "REGATA SPORT C18", type: "exit", storeId: "ni-calcadao", quantity: -1, at: "Hoje, 13:45", note: "Reserva pedido C18-1048" },
    { id: 4, code: "0000000063", description: "SHORT FOLHAS", type: "entry", storeId: "ni-calcadao", quantity: 1, at: "Hoje, 09:32", note: "Recebimento NF 8841" },
  ];

  const seedReceipts = [
    { id: "REC-0921", invoice: "NF 8841", supplier: "C18 Confecções", storeId: "ni-calcadao", items: 42, checked: 42, status: "done", receivedAt: "Hoje, 09:32" },
    { id: "REC-0922", invoice: "NF 8847", supplier: "Distribuidora Street", storeId: "ni-top", items: 68, checked: 37, status: "checking", receivedAt: "Hoje, 11:18" },
    { id: "REC-0923", invoice: "NF 8850", supplier: "C18 Confecções", storeId: "caxias", items: 31, checked: 0, status: "pending", receivedAt: "Previsto 16:00" },
  ];

  const seedIntegrations = [
    { id: "alterdata", name: "Alterdata Moda", initials: "ALT", role: "ERP e estoque mestre", status: "pending", environment: "A configurar", lastSync: "Aguardando API", queue: 0 },
    { id: "rede", name: "e.Rede", initials: "REDE", role: "Pagamentos", status: "pending", environment: "Sandbox", lastSync: "Aguardando credenciais", queue: 0 },
    { id: "clearsale", name: "ClearSale", initials: "CS", role: "Antifraude", status: "pending", environment: "Sandbox", lastSync: "Aguardando credenciais", queue: 0 },
  ];

  const seedBanners = [
    {
      id: "banner-padrao",
      name: "Padrão Censura 18",
      position: "home-hero",
      image_path: "../assets/img/hero.jpg",
      title_top: "Streetwear",
      title_bottom: "desde 1989",
      body_text: "Há 36 anos vestindo a Baixada Fluminense. Pegada de rua, drops semanais e qualidade de quem sabe que a peça precisa aguentar o corre. Compre aqui e retire em uma das nossas 6 lojas físicas.",
      cta_label: "Ver o catálogo",
      cta_url: "produtos.html",
      cta_secondary_label: "Achar uma loja",
      cta_secondary_url: "lojas.html",
      stats: DEFAULT_HERO_STATS,
      source: "static",
      ai_prompt: "",
      active: true,
      priority: 100,
      starts_at: null,
      ends_at: null,
      updatedAt: new Date().toISOString(),
    },
  ];

  /* Cupons de demonstração: o PRIMEIRAC18 (R$ 20 na loja toda) é o mesmo
     cupom que aparece no pedido C18-1048 dos dados de exemplo. */
  const seedCoupons = [
    { id: "coupon-primeirac18", code: "PRIMEIRAC18", kind: "amount", value: 20, scope: "all", target: "", active: true, starts_at: null, ends_at: null, updatedAt: new Date().toISOString() },
    { id: "coupon-verao09", code: "VERAO09", kind: "percent", value: 15, scope: "collection", target: "VERÃO 09", active: false, starts_at: null, ends_at: null, updatedAt: new Date().toISOString() },
  ];

  /* Canais de venda e marketing. Nenhum vem habilitado: a conexão só vale
     depois que os segredos existem no servidor (Supabase Secrets). */
  function seedChannels() {
    if (!Channels) return [];
    return Channels.CHANNELS.map((channel) => ({
      id: channel.id,
      enabled: false,
      status: "pending",
      environment: "A configurar",
      config: {},
      policy: { ...(channel.policy || Channels.DEFAULT_POLICY) },
      lastSync: "Aguardando credenciais",
      listings: 0,
      errors: 0,
    }));
  }

  function freshState() {
    return {
      inventory: seedInventory,
      orders: seedOrders,
      movements: seedMovements,
      receipts: seedReceipts,
      integrations: seedIntegrations,
      importBatches: [],
      banners: seedBanners,
      coupons: seedCoupons,
      channels: seedChannels(),
      palette: null,
    };
  }

  function loadState() {
    if (CONFIG.mode !== "demo") return freshState();
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY));
      return saved && saved.inventory && saved.orders ? saved : freshState();
    } catch (_) {
      return freshState();
    }
  }

  let state = loadState();
  if (!Array.isArray(state.banners)) state.banners = seedBanners;
  if (!Array.isArray(state.coupons)) state.coupons = seedCoupons;
  if (!Array.isArray(state.channels)) state.channels = seedChannels();
  if (state.palette === undefined) state.palette = null;
  let currentPage = "overview";
  let currentOrderFilter = "all";
  let currentRole = CONFIG.mode === "demo" ? "admin" : "viewer";
  let currentProfile = { full_name: "Luciene Alves", role: currentRole };

  const roleLabels = {
    admin: "Administradora",
    inventory: "Estoque",
    checker: "Conferência",
    shipping: "Expedição",
    viewer: "Consulta",
  };

  const permissionRoles = {
    inventory: ["admin", "inventory"],
    pick: ["admin", "inventory"],
    check: ["admin", "checker"],
    shipping: ["admin", "shipping"],
    fraud: ["admin"],
    integrations: ["admin"],
    banners: ["admin"],
    coupons: ["admin"],
    /* audiência é leitura: administradora e perfil de consulta veem */
    audience: ["admin", "viewer"],
    channels: ["admin"],
  };

  function can(permission) {
    return (permissionRoles[permission] || ["admin"]).includes(currentRole);
  }

  function requirePermission(permission) {
    if (can(permission)) return true;
    toast("Seu perfil não tem permissão para executar esta ação.", "alert");
    return false;
  }

  let currentOrderId = null;
  let importedFile = null;
  let importedRows = [];
  let importErrors = [];
  let collectionOptions = [];
  let referenceOptions = [];
  let referenceIndex = new Map();
  let selectionMode = "collection";
  let bannerEditingId = null;
  let bannerImage = "";
  let bannerImageSource = "";
  const selectedCollections = new Set();
  const selectedReferences = new Set();

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
  const currency = (value) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0));
  const number = (value) => new Intl.NumberFormat("pt-BR").format(Number(value || 0));
  const storeById = (id) => stores.find((store) => store.id === id) || { name: "—", short: "—" };
  const available = (item) => Math.max(0, Number(item.quantity || 0) - Number(item.reserved || 0));

  function saveState() {
    if (CONFIG.mode !== "demo") return;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (_) {
      toast("O navegador atingiu o limite de armazenamento. Use menos linhas nesta demonstração.", "alert");
    }
  }

  function toast(message, icon = "check") {
    const item = document.createElement("div");
    item.className = "toast";
    item.innerHTML = `<span><svg><use href="#i-${icon}"></use></svg></span><p>${esc(message)}</p>`;
    $("#toast-region").appendChild(item);
    setTimeout(() => item.remove(), 4200);
  }

  function fillStoreSelects() {
    const options = stores.map((store) => `<option value="${store.id}">${esc(store.name)}</option>`).join("");
    ["#import-store", "#manual-store"].forEach((selector) => { $(selector).innerHTML = options; });
    $("#inventory-store").innerHTML = `<option value="all">Todas as lojas</option>${options}`;
  }

  function renderMetrics() {
    const units = state.inventory.reduce((total, item) => total + available(item), 0);
    const value = state.inventory.reduce((total, item) => total + available(item) * item.price, 0);
    const activeOrders = state.orders.filter((order) => !["delivered", "cancelled"].includes(order.status)).length;
    const needsAttention = state.inventory.filter((item) => available(item) <= CONFIG.lowStockThreshold).length;
    const metrics = [
      { icon: "box", value: number(units), label: "Unidades disponíveis", trend: `${state.inventory.length} SKUs` },
      { icon: "grid", value: currency(value), label: "Valor de varejo", trend: "Saldo atual" },
      { icon: "cart", value: activeOrders, label: "Pedidos em operação", trend: `${state.orders.filter((o) => o.status === "fraud").length} em análise`, warning: true },
      { icon: "alert", value: needsAttention, label: "Itens com estoque baixo", trend: "Revisar", warning: true },
    ];
    $("#metrics").innerHTML = metrics.map((item) => `<article class="metric"><div class="metric__top"><span class="metric__icon"><svg><use href="#i-${item.icon}"></use></svg></span><span class="metric__trend${item.warning ? " is-warning" : ""}">${esc(item.trend)}</span></div><strong>${item.value}</strong><span>${esc(item.label)}</span></article>`).join("");
    $("#nav-stock-alert").textContent = needsAttention;
    $("#nav-order-count").textContent = activeOrders;
  }

  function renderOrderFlow() {
    const flow = [
      ["Pagamento", ["payment", "fraud"]],
      ["Separação", ["picking"]],
      ["Conferência", ["checking"]],
      ["Expedição", ["ready"]],
      ["Enviado", ["shipped"]],
    ];
    $("#order-flow").innerHTML = flow.map(([label, statuses], index) => {
      const count = state.orders.filter((order) => statuses.includes(order.status)).length;
      return `<div class="flow-item"><strong>${index + 1}</strong><span>${label}</span><b>${count}</b></div>`;
    }).join("");
  }

  function renderLowStock() {
    const items = [...state.inventory].sort((a, b) => available(a) - available(b)).slice(0, 4);
    $("#low-stock-list").innerHTML = items.map((item) => `<div class="low-item"><span class="product-monogram">${esc(item.category.slice(0, 3))}</span><div><strong>${esc(item.description)}</strong><small>${esc(item.color)} · ${esc(item.size)} · ${esc(storeById(item.storeId).short)}</small></div><b>${available(item)}</b></div>`).join("");
  }

  function movementLabel(type) {
    return { entry: "Entrada", exit: "Saída", import: "Importação", adjustment: "Ajuste", set: "Contagem" }[type] || type;
  }

  function renderMovements() {
    $("#movement-table").innerHTML = state.movements.slice(0, 7).map((movement) => `<tr><td><span class="movement-product"><strong>${esc(movement.description)}</strong><small>${esc(movement.code)}</small></span></td><td><span class="movement-type is-${movement.type === "set" || movement.type === "adjustment" ? "import" : movement.type}">${esc(movementLabel(movement.type))}</span></td><td>${esc(storeById(movement.storeId).short)}</td><td class="${movement.quantity >= 0 ? "qty-positive" : "qty-negative"}">${movement.quantity >= 0 ? "+" : ""}${movement.quantity}</td><td>${esc(movement.at)}</td></tr>`).join("");
  }

  function renderIntegrationMini() {
    if (!can("integrations")) {
      $("#integration-mini").innerHTML = `<p class="empty-options">Status disponível para administradores.</p>`;
      return;
    }
    $("#integration-mini").innerHTML = state.integrations.map((item) => `<div class="integration-mini__item"><span class="integration-logo">${esc(item.initials)}</span><div><strong>${esc(item.name)}</strong><small>${esc(item.lastSync)}</small></div><i class="status-dot ${item.status === "pending" ? "is-warning" : item.status === "off" ? "is-off" : ""}"></i></div>`).join("");
  }

  function renderInventory() {
    const query = Importer.normalizeText($("#inventory-search")?.value || "");
    const store = $("#inventory-store")?.value || "all";
    const stock = $("#inventory-stock")?.value || "all";
    const filtered = state.inventory.filter((item) => {
      const haystack = Importer.normalizeText([item.code, item.reference, item.description, item.brand, item.category, item.collection, item.color, item.size].join(" "));
      if (query && !haystack.includes(query)) return false;
      if (store !== "all" && item.storeId !== store) return false;
      const balance = available(item);
      if (stock === "positive" && balance <= 0) return false;
      if (stock === "low" && (balance <= 0 || balance > CONFIG.lowStockThreshold)) return false;
      if (stock === "zero" && balance !== 0) return false;
      return true;
    });

    const summary = Importer.summarize(filtered.map((item) => ({ ...item, quantity: available(item) })));
    $("#inventory-summary").innerHTML = [
      ["SKUs", summary.rows], ["Unidades", number(summary.units)], ["Marcas", summary.brands], ["Categorias", summary.categories], ["Coleções", summary.collections], ["Valor", currency(summary.value)],
    ].map(([label, value]) => `<span class="summary-chip"><strong>${value}</strong> ${label}</span>`).join("");

    $("#inventory-table").innerHTML = filtered.slice(0, 100).map((item) => {
      const balance = available(item);
      const stockClass = balance === 0 ? " is-zero" : balance <= CONFIG.lowStockThreshold ? " is-low" : "";
      return `<tr><td><input type="checkbox" aria-label="Selecionar ${esc(item.code)}"></td><td><span class="code">${esc(item.code)}</span></td><td><span class="table-product"><strong>${esc(item.description)}</strong><small>${esc(item.source || "MANUAL")}</small></span></td><td>${esc(item.brand)}</td><td>${esc(item.category)}</td><td>${esc(item.collection)}</td><td>${esc(item.color)} / ${esc(item.size)}</td><td>${esc(storeById(item.storeId).short)}</td><td><span class="stock-value${stockClass}">${balance}</span></td><td>${currency(item.price)}</td><td>${can("inventory") ? `<button class="row-menu" data-adjust-code="${esc(item.code)}" data-adjust-store="${esc(item.storeId)}" aria-label="Ajustar item">•••</button>` : ""}</td></tr>`;
    }).join("") || `<tr><td colspan="11" class="empty-options">Nenhum item encontrado com esses filtros.</td></tr>`;
    $("#inventory-count").textContent = `${number(filtered.length)} de ${number(state.inventory.length)} registros`;
  }

  function badge(value, type) {
    return `<span class="status-badge is-${type}">${esc(value)}</span>`;
  }

  function paymentBadge(status) {
    return status === "approved" || status === "captured" ? badge(status === "captured" ? "Capturado" : "Aprovado", "success") : status === "authorized" ? badge("Pré-autorizado", "info") : badge("Pendente", "warning");
  }

  function fraudBadge(status) {
    return status === "approved" ? badge("Aprovado", "success") : status === "review" ? badge("Análise manual", "warning") : status === "denied" ? badge("Recusado", "danger") : badge("Pendente", "neutral");
  }

  function operationBadge(status) {
    const type = { fraud: "warning", picking: "info", checking: "warning", ready: "success", shipped: "info", delivered: "success", cancelled: "danger", payment: "neutral" }[status] || "neutral";
    return badge(statusInfo[status]?.label || status, type);
  }

  function renderOrderTabs() {
    $("#order-tabs").innerHTML = Object.entries(statusInfo).map(([status, info]) => {
      const count = status === "all" ? state.orders.length : state.orders.filter((order) => order.status === status).length;
      return `<button class="${currentOrderFilter === status ? "is-active" : ""}" data-order-filter="${status}">${esc(info.label)} <b>${count}</b></button>`;
    }).join("");
  }

  function renderOrders() {
    renderOrderTabs();
    const orders = currentOrderFilter === "all" ? state.orders : state.orders.filter((order) => order.status === currentOrderFilter);
    $("#orders-table").innerHTML = orders.map((order) => `<tr><td><span class="order-id">#${esc(order.id)}</span></td><td><span class="table-product"><strong>${esc(order.customer)}</strong><small>${order.items.length} ${order.items.length === 1 ? "item" : "itens"}</small></span></td><td>${new Date(order.date).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}<br><small>${new Date(order.date).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</small></td><td>${esc(order.origin)}</td><td>${esc(storeById(order.storeId).short)}</td><td><strong>${currency(order.total)}</strong></td><td>${paymentBadge(order.payment)}</td><td>${fraudBadge(order.fraud)}</td><td>${operationBadge(order.status)}</td><td><button class="open-order" data-order-id="${esc(order.id)}" aria-label="Abrir pedido"><svg><use href="#i-chevron"></use></svg></button></td></tr>`).join("") || `<tr><td colspan="10" class="empty-options">Nenhum pedido nesta etapa.</td></tr>`;
  }

  function renderReceipts() {
    const pending = state.receipts.filter((item) => item.status === "pending").length;
    const checking = state.receipts.filter((item) => item.status === "checking").length;
    const done = state.receipts.filter((item) => item.status === "done").length;
    $("#receipt-metrics").innerHTML = [
      ["receive", pending, "Aguardando chegada"], ["alert", checking, "Em conferência"], ["check", done, "Concluídos hoje"],
    ].map(([icon, value, label]) => `<article class="metric"><div class="metric__top"><span class="metric__icon"><svg><use href="#i-${icon}"></use></svg></span></div><strong>${value}</strong><span>${label}</span></article>`).join("");
    $("#receipt-grid").innerHTML = state.receipts.map((receipt) => {
      const progress = receipt.items ? Math.round(receipt.checked / receipt.items * 100) : 0;
      return `<article class="receipt-card"><div class="receipt-card__top"><span><strong>${esc(receipt.id)}</strong><small>${esc(receipt.invoice)}</small></span>${operationBadge(receipt.status === "done" ? "delivered" : receipt.status === "checking" ? "checking" : "payment")}</div><h3>${esc(receipt.supplier)}</h3><p>${esc(storeById(receipt.storeId).name)} · ${esc(receipt.receivedAt)}</p><div class="receipt-progress"><i style="width:${progress}%"></i></div><div class="receipt-card__foot"><span>${receipt.checked} de ${receipt.items} itens conferidos</span><button data-receipt-id="${esc(receipt.id)}">${receipt.status === "done" ? "Ver detalhes" : "Continuar →"}</button></div></article>`;
    }).join("");
  }

  function renderShipping() {
    const columns = [
      { id: "checking", title: "Em conferência" },
      { id: "ready", title: "Prontos para envio" },
      { id: "shipped", title: "Enviados" },
    ];
    $("#shipping-board").innerHTML = columns.map((column) => {
      const orders = state.orders.filter((order) => order.status === column.id);
      return `<section class="shipping-column"><header class="shipping-column__head"><span>${esc(column.title)}</span><b>${orders.length}</b></header>${orders.map((order) => `<article class="shipping-card"><div class="shipping-card__top"><strong>#${esc(order.id)}</strong>${operationBadge(order.status)}</div><h4>${esc(order.customer)}</h4><p>${order.items.length} ${order.items.length === 1 ? "item" : "itens"} · ${esc(storeById(order.storeId).short)}</p><div class="shipping-card__foot"><span>${order.tracking ? esc(order.tracking) : currency(order.total)}</span><button data-order-id="${esc(order.id)}">Abrir →</button></div></article>`).join("") || `<p class="empty-options">Nenhum pedido nesta coluna.</p>`}</section>`;
    }).join("");
  }

  function renderIntegrations() {
    $("#integration-cards").innerHTML = state.integrations.map((item) => `<article class="integration-card"><div class="integration-card__head"><span class="integration-logo">${esc(item.initials)}</span><div><strong>${esc(item.name)}</strong><small>${esc(item.role)}</small></div><i class="status-dot ${item.status === "pending" ? "is-warning" : item.status === "off" ? "is-off" : ""}"></i></div><div class="integration-card__status"><i class="status-dot ${item.status === "pending" ? "is-warning" : ""}"></i><span>${item.status === "pending" ? "Aguardando configuração segura" : "Conexão saudável"}</span></div><dl><dt>Ambiente</dt><dd>${esc(item.environment)}</dd><dt>Última sincronização</dt><dd>${esc(item.lastSync)}</dd><dt>Eventos na fila</dt><dd>${item.queue}</dd></dl><div class="integration-card__foot"><button data-config-integration="${item.id}">Configurar →</button><span>Segredos no servidor</span></div></article>`).join("");
    $("#integration-log").innerHTML = `<tr><td>Hoje, 14:20</td><td>Alterdata</td><td>Importação de saldo</td><td>LOTE-DEMO-01</td><td>${badge("Simulado", "neutral")}</td><td>1</td></tr><tr><td>Hoje, 13:44</td><td>ClearSale</td><td>Análise de pedido</td><td>C18-1048</td><td>${badge("Simulado", "neutral")}</td><td>1</td></tr><tr><td>Hoje, 13:44</td><td>e.Rede</td><td>Autorização</td><td>C18-1048</td><td>${badge("Simulado", "neutral")}</td><td>1</td></tr>`;
  }

  function renderRoleUI() {
    const fullName = currentProfile.full_name || "Usuário";
    const initials = fullName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "C18";
    const firstName = fullName.split(/\s+/)[0] || "equipe";
    $("#sidebar-user-name").textContent = fullName;
    $("#sidebar-user-role").textContent = roleLabels[currentRole] || "Equipe";
    $("#sidebar-avatar").textContent = initials;
    $("#top-avatar").textContent = initials;
    $("#welcome-name").textContent = firstName;
    $$('[data-permission="inventory"]').forEach((element) => { element.hidden = !can("inventory"); });
    $$('[data-permission="integrations"]').forEach((element) => { element.hidden = !can("integrations"); });
    $$('[data-permission="banners"]').forEach((element) => { element.hidden = !can("banners"); });
    $$('[data-permission="coupons"]').forEach((element) => { element.hidden = !can("coupons"); });
    $$('[data-permission="audience"]').forEach((element) => { element.hidden = !can("audience"); });
    $$('[data-permission="channels"]').forEach((element) => { element.hidden = !can("channels"); });
  }

  function renderAll() {
    renderRoleUI();
    renderMetrics();
    renderOrderFlow();
    renderLowStock();
    renderMovements();
    renderIntegrationMini();
    renderInventory();
    renderOrders();
    renderReceipts();
    renderShipping();
    renderIntegrations();
    renderBanners();
    renderCoupons();
    renderPalette();
    renderAudience();
    renderChannels();
  }

  /* ----------------------------------------------- clientes (cadastro web) */
  function renderCustomers(rows) {
    const tbody = $("#customers-table");
    if (!tbody) return;
    $("#customers-count").textContent = rows.length === 1
      ? "1 cliente encontrado"
      : `${rows.length} clientes`;
    tbody.innerHTML = rows.map((cliente) => `<tr>
      <td><span class="table-product"><strong>${esc(cliente.nome || "(sem nome)")}</strong><small>${esc(cliente.id?.slice(0, 8) || "")}</small></span></td>
      <td><span class="table-product"><strong>${esc(cliente.email || "—")}</strong><small>${esc(cliente.telefone || "")}</small></span></td>
      <td><span class="code">${esc(cliente.cep || "—")}</span></td>
      <td>${esc([cliente.cidade, cliente.uf].filter(Boolean).join("/") || "—")}</td>
      <td>${cliente.criado_em ? new Date(cliente.criado_em).toLocaleDateString("pt-BR") : "—"}</td>
    </tr>`).join("") || `<tr><td colspan="5" class="empty-options">Nenhum cliente encontrado${CONFIG.mode === "supabase" ? "" : " — conecte o Supabase para ver os cadastros reais"}.</td></tr>`;
  }

  function buscarCustomers() {
    buscarClientes($("#customer-search")?.value || "");
  }

  async function buscarClientes(termo) {
    if (CONFIG.mode !== "supabase" || !window.C18_SUPABASE) {
      renderCustomers([]);
      return;
    }
    const { data, error } = await window.C18_SUPABASE.rpc("buscar_clientes", { p_termo: termo || "" });
    if (error) {
      renderCustomers([]);
      toast(`Clientes: ${error.message}`, "alert");
      return;
    }
    renderCustomers(data || []);
  }

  function navigate(page) {
    currentPage = page;
    $$("[data-page]").forEach((item) => item.classList.toggle("is-active", item.dataset.page === page));
    $$(".side-nav__item[data-nav]").forEach((item) => item.classList.toggle("is-active", item.dataset.nav === page));
    const label = { overview: "Visão geral", inventory: "Estoque", orders: "Pedidos", receipts: "Recebimento", shipping: "Expedição", integrations: "Integrações", banners: "Banners & Paleta", coupons: "Cupons", customers: "Clientes", audience: "Audiência", channels: "Canais & Marketing" }[page];
    if (page === "audience") refreshAudience();
    if (page === "channels") renderChannels();
    $("#page-title").textContent = label || "Operações";
    if (page === "customers") buscarClientes($("#customer-search")?.value || "");
    $("#sidebar").classList.remove("is-open");
    $("#sidebar-overlay").classList.remove("is-open");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openModal(id) {
    const modal = $(id);
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }

  function closeModals() {
    $$(".modal.is-open").forEach((modal) => { modal.classList.remove("is-open"); modal.setAttribute("aria-hidden", "true"); });
    document.body.style.overflow = "";
  }

  function openManual(existing) {
    const form = $("#manual-form");
    form.reset();
    if (existing) {
      ["description", "code", "reference", "brand", "category", "collection", "store", "color", "size", "price"].forEach((name) => {
        const field = form.elements[name];
        if (field) field.value = name === "store" ? existing.storeId : existing[name] ?? "";
      });
      form.elements.movement.value = "set";
      form.elements.quantity.value = existing.quantity;
      form.elements.note.value = "Contagem ou correção manual";
    }
    openModal("#manual-modal");
  }

  function resetImport() {
    importedFile = null;
    importedRows = [];
    importErrors = [];
    collectionOptions = [];
    referenceOptions = [];
    referenceIndex = new Map();
    selectedCollections.clear();
    selectedReferences.clear();
    $("#excel-file").value = "";
    $("#dropzone").hidden = false;
    $("#file-loaded").hidden = true;
    $("#import-selection").hidden = true;
    $("#import-preview").hidden = true;
    $("#run-import").disabled = true;
    $("#import-foot-note").textContent = "Selecione um arquivo para continuar.";
    $$(".import-steps span").forEach((step, index) => step.classList.toggle("is-active", index === 0));
  }

  function parseCsv(text) {
    const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
    if (!lines.length) return [];
    const separator = lines[0].includes(";") ? ";" : ",";
    const parseLine = (line) => {
      const cells = []; let value = ""; let quoted = false;
      for (let i = 0; i < line.length; i += 1) {
        const char = line[i];
        if (char === '"' && line[i + 1] === '"') { value += '"'; i += 1; }
        else if (char === '"') quoted = !quoted;
        else if (char === separator && !quoted) { cells.push(value); value = ""; }
        else value += char;
      }
      cells.push(value); return cells;
    };
    const headers = parseLine(lines.shift()).map((header) => header.trim());
    return lines.map((line) => Object.fromEntries(parseLine(line).map((value, index) => [headers[index], value])));
  }

  async function readSpreadsheet(file) {
    if (file.name.toLowerCase().endsWith(".csv")) return parseCsv(await file.text());
    if (!window.XLSX) throw new Error("O leitor de Excel não carregou. Verifique a internet e tente novamente.");
    const workbook = window.XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return window.XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
  }

  async function handleFile(file) {
    if (!file) return;
    try {
      $("#import-foot-note").textContent = "Lendo e validando a planilha…";
      const rawRows = await readSpreadsheet(file);
      const result = Importer.mapRows(rawRows);
      const structuralError = result.errors.find((error) => error.startsWith("Coluna obrigatória"));
      if (structuralError) throw new Error(structuralError);
      if (!result.rows.length) throw new Error(result.errors[0] || "Nenhuma linha de produto válida foi encontrada.");
      importedFile = file;
      importedRows = result.rows;
      importErrors = result.errors;
      collectionOptions = Importer.uniqueOptions(importedRows, "collection");
      referenceOptions = Importer.uniqueOptions(importedRows, "reference");
      referenceIndex = new Map();
      importedRows.forEach((row) => {
        if (!referenceIndex.has(row.reference)) referenceIndex.set(row.reference, row);
      });
      $("#dropzone").hidden = true;
      $("#file-loaded").hidden = false;
      $("#loaded-name").textContent = file.name;
      $("#loaded-meta").textContent = `${number(importedRows.length)} linhas · ${collectionOptions.length} coleções`;
      $("#import-selection").hidden = false;
      $("#import-preview").hidden = false;
      $("#selection-total").textContent = `${number(importedRows.length)} linhas reconhecidas`;
      $$(".import-steps span").forEach((step, index) => step.classList.toggle("is-active", index <= 2));
      renderSelectionOptions();
      updateImportPreview();
      toast("Planilha lida com sucesso.");
    } catch (error) {
      resetImport();
      toast(error.message || "Não foi possível ler a planilha.", "alert");
    }
  }

  function optionTemplate(option, field, selected) {
    const row = field === "reference" ? referenceIndex.get(option.value) : null;
    return `<label class="check-option"><input type="checkbox" data-import-option="${field}" value="${esc(option.value)}" ${selected.has(option.value) ? "checked" : ""}><span><strong>${esc(option.value)}</strong>${row ? `<small>${esc(row.description)} · ${esc(row.collection)}</small>` : ""}</span><b>${number(option.count)}</b></label>`;
  }

  function renderSelectionOptions() {
    const collectionQuery = Importer.normalizeText($("#collection-search").value);
    const referenceQuery = Importer.normalizeText($("#reference-search").value);
    const collections = collectionOptions.filter((item) => !collectionQuery || Importer.normalizeText(item.value).includes(collectionQuery));
    const references = referenceOptions.filter((item) => {
      if (!referenceQuery) return true;
      const row = referenceIndex.get(item.value);
      return Importer.normalizeText(`${item.value} ${row?.code} ${row?.description}`).includes(referenceQuery);
    }).slice(0, 250);
    $("#collection-list").innerHTML = collections.map((item) => optionTemplate(item, "collection", selectedCollections)).join("") || `<p class="empty-options">Nenhuma coleção encontrada.</p>`;
    $("#reference-list").innerHTML = references.map((item) => optionTemplate(item, "reference", selectedReferences)).join("") || `<p class="empty-options">Nenhuma referência encontrada.</p>`;
  }

  function selectedImportRows() {
    if (selectionMode === "collection") {
      if (!selectedCollections.size) return [];
      return Importer.filterRows(importedRows, { mode: "collection", collections: [...selectedCollections] });
    }
    const typedReference = $("#reference-search").value.trim();
    if (!selectedReferences.size && !typedReference) return [];
    return Importer.filterRows(importedRows, { mode: "reference", references: [...selectedReferences], typedReference });
  }

  function updateImportPreview() {
    const selected = selectedImportRows();
    const summary = Importer.summarize(selected);
    $("#preview-cards").innerHTML = [
      [summary.rows, "Linhas"], [summary.references, "Referências"], [summary.collections, "Coleções"], [number(summary.units), "Unidades"], [currency(summary.value), "Valor de varejo"],
    ].map(([value, label]) => `<div class="preview-card"><strong>${value}</strong><span>${label}</span></div>`).join("");
    $("#preview-table").innerHTML = selected.slice(0, 80).map((row) => `<tr><td>${row.rowNumber}</td><td class="code">${esc(row.code)}</td><td>${esc(row.description)}</td><td>${esc(row.brand)}</td><td>${esc(row.collection)}</td><td>${esc(row.category)}</td><td>${esc(row.color)} / ${esc(row.size)}</td><td>${row.quantity}</td><td>${currency(row.price)}</td></tr>`).join("") || `<tr><td colspan="9" class="empty-options">Marque uma coleção ou localize uma referência para visualizar.</td></tr>`;
    const warning = $("#preview-warning");
    if (importErrors.length) {
      warning.hidden = false;
      $("span", warning).textContent = `${importErrors.length} alerta(s): ${importErrors.slice(0, 2).join(" ")}`;
    } else warning.hidden = true;
    $("#run-import").disabled = selected.length === 0 || !$("#import-store").value;
    $("#import-foot-note").textContent = selected.length ? `${number(selected.length)} linhas serão aplicadas ao estoque de ${storeById($("#import-store").value).short}.` : "Selecione ao menos uma coleção ou referência.";
  }

  async function runImport() {
    if (!requirePermission("inventory")) return;
    const rows = selectedImportRows();
    const storeId = $("#import-store").value;
    if (!rows.length || !storeId) return;

    if (CONFIG.mode === "supabase") {
      const button = $("#run-import");
      button.disabled = true;
      button.textContent = "Importando…";
      const payload = rows.map((row) => ({
        rowNumber: row.rowNumber,
        code: row.code,
        reference: row.reference,
        description: row.description,
        brand: row.brand,
        collection: row.collection,
        category: row.category,
        price: row.price,
        quantity: row.quantity,
        color: row.color,
        size: row.size,
        ecommerce: row.ecommerce,
      }));
      const { data, error } = await window.C18_SUPABASE.rpc("import_inventory_rows", {
        p_store_id: storeId,
        p_filename: importedFile?.name || "Planilha Excel",
        p_selection: {
          mode: selectionMode,
          collections: [...selectedCollections],
          references: [...selectedReferences],
          typedReference: $("#reference-search").value.trim(),
        },
        p_rows: payload,
      });
      button.textContent = "Importar selecionados";
      if (error) {
        button.disabled = false;
        toast(error.message || "A importação segura falhou.", "alert");
        return;
      }
      await loadSupabaseData();
      renderAll(); closeModals(); resetImport(); navigate("inventory");
      const errorCount = Array.isArray(data?.errors) ? data.errors.length : 0;
      toast(errorCount ? `Importação concluída com ${errorCount} alerta(s).` : `${number(rows.length)} linhas importadas com segurança.`, errorCount ? "alert" : "check");
      return;
    }

    const batchId = `IMP-${Date.now()}`;
    let created = 0; let updated = 0; let totalDelta = 0;
    rows.forEach((row) => {
      const existing = state.inventory.find((item) => item.code === row.code && item.storeId === storeId);
      if (existing) {
        const delta = row.quantity - existing.quantity;
        existing.reference = row.reference;
        existing.description = row.description;
        existing.brand = row.brand;
        existing.collection = row.collection;
        existing.category = row.category;
        existing.price = row.price;
        existing.quantity = row.quantity;
        existing.color = row.color;
        existing.size = row.size;
        existing.ecommerce = row.ecommerce;
        existing.source = "EXCEL";
        existing.updatedAt = new Date().toISOString();
        totalDelta += delta; updated += 1;
      } else {
        const inventoryRow = { ...row };
        delete inventoryRow.rowNumber;
        delete inventoryRow.source;
        state.inventory.push({ id: `${row.code}-${storeId}`, ...inventoryRow, storeId, reserved: 0, source: "EXCEL", updatedAt: new Date().toISOString() });
        totalDelta += row.quantity; created += 1;
      }
    });
    state.movements.unshift({ id: Date.now(), code: batchId, description: `${rows.length} linhas importadas`, type: "import", storeId, quantity: totalDelta, at: "Agora", note: importedFile?.name || "Planilha Excel" });
    state.importBatches.unshift({ id: batchId, filename: importedFile?.name, storeId, rows: rows.length, created, updated, createdAt: new Date().toISOString() });
    saveState(); renderAll(); closeModals(); resetImport(); navigate("inventory");
    toast(`${number(rows.length)} linhas importadas: ${created} novas e ${updated} atualizadas.`);
  }

  async function saveManual(event) {
    event.preventDefault();
    if (!requirePermission("inventory")) return;
    const form = new FormData(event.currentTarget);
    const code = String(form.get("code") || "").trim();
    const storeId = String(form.get("store") || "");
    const movement = String(form.get("movement") || "set");
    const entered = Number(form.get("quantity") || 0);
    let item = state.inventory.find((entry) => entry.code === code && entry.storeId === storeId);
    const before = item?.quantity || 0;
    let next = movement === "entry" ? before + Math.abs(entered) : movement === "exit" ? Math.max(0, before - Math.abs(entered)) : movement === "adjustment" ? Math.max(0, before + entered) : Math.max(0, entered);
    const row = {
      id: `${code}-${storeId}`,
      code,
      reference: String(form.get("reference") || code).trim() || code,
      description: String(form.get("description") || "").trim(),
      brand: String(form.get("brand") || "SEM MARCA").trim(),
      category: String(form.get("category") || "SEM CATEGORIA").trim(),
      collection: String(form.get("collection") || "SEM COLEÇÃO").trim(),
      price: Importer.parseMoney(form.get("price")),
      quantity: next,
      reserved: item?.reserved || 0,
      color: String(form.get("color") || "ÚNICA").trim(),
      size: String(form.get("size") || "ÚNICO").trim(),
      storeId,
      ecommerce: item?.ecommerce || false,
      source: "MANUAL",
      updatedAt: new Date().toISOString(),
    };

    if (CONFIG.mode === "supabase") {
      const submit = event.currentTarget.querySelector('[type="submit"]');
      submit.disabled = true;
      submit.textContent = "Salvando…";
      const { error } = await window.C18_SUPABASE.rpc("adjust_inventory_stock", {
        p_store_id: storeId,
        p_movement: movement,
        p_quantity: Math.trunc(entered),
        p_note: String(form.get("note") || "").trim(),
        p_row: {
          code: row.code, reference: row.reference, description: row.description,
          brand: row.brand, category: row.category, collection: row.collection,
          price: row.price, color: row.color, size: row.size,
          ecommerce: row.ecommerce,
        },
      });
      submit.disabled = false;
      submit.textContent = "Salvar movimento";
      if (error) { toast(error.message || "Não foi possível salvar o movimento.", "alert"); return; }
      await loadSupabaseData();
      renderAll(); closeModals(); navigate("inventory");
      toast("Movimento salvo e enviado à fila segura do Alterdata.");
      return;
    }

    if (item) Object.assign(item, row); else state.inventory.push(row);
    state.movements.unshift({ id: Date.now(), code, description: row.description, type: movement, storeId, quantity: next - before, at: "Agora", note: String(form.get("note") || "Ajuste manual") });
    saveState(); renderAll(); closeModals(); navigate("inventory"); toast("Movimento de estoque salvo e auditado.");
  }

  function openOrder(id) {
    const order = state.orders.find((item) => item.id === id);
    if (!order) return;
    currentOrderId = id;
    $("#drawer-title").textContent = `#${order.id}`;
    $("#order-detail").innerHTML = `<div class="order-summary"><div><span>Cliente</span><strong>${esc(order.customer)}</strong></div><div><span>Loja</span><strong>${esc(storeById(order.storeId).short)}</strong></div><div><span>Total</span><strong>${currency(order.total)}</strong></div>${order.sellerCode ? `<div><span>Vendedor</span><strong>${esc(order.sellerCode)}</strong></div>` : ""}${order.couponCode ? `<div><span>Cupom</span><strong>${esc(order.couponCode)}${order.discountAmount ? ` · -${currency(order.discountAmount)}` : ""}</strong></div>` : ""}<div><span>Pagamento</span><strong>${paymentBadge(order.payment)}</strong></div><div><span>Antifraude</span><strong>${fraudBadge(order.fraud)}</strong></div><div><span>Operação</span><strong>${operationBadge(order.status)}</strong></div></div><section class="order-section"><div class="order-section__head"><h3>Itens e conferência</h3><span>${order.items.filter((item) => item.checked).length}/${order.items.length} conferidos</span></div>${order.items.map((item, index) => `<label class="order-item"><span class="order-item-check"><input type="checkbox" data-check-item="${index}" ${item.checked ? "checked" : ""} ${order.status !== "checking" || !can("check") ? "disabled" : ""}></span><div><strong>${esc(item.name)}</strong><small>${esc(item.code)} · ${esc(item.color)} · ${esc(item.size)}</small></div><b>${item.qty}x</b></label>`).join("")}</section>${order.status === "ready" ? `<section class="order-section"><div class="order-section__head"><h3>Dados da expedição</h3></div><div class="shipping-form"><label class="form-field"><span>Transportadora</span><select id="drawer-carrier"><option>Correios — PAC</option><option>Correios — SEDEX</option><option>Mercado Envios</option><option>Uber Direct (mesmo dia)</option><option>99 Entregas (mesmo dia)</option><option>Retirada na loja</option><option>Transportadora própria</option></select></label><label class="form-field"><span>Código de rastreio</span><input id="drawer-tracking" placeholder="Ex.: QR123456789BR"></label></div></section>` : ""}<section class="order-section"><div class="order-section__head"><h3>Histórico</h3></div><ul class="timeline-mini">${order.events.map((event) => `<li><strong>${esc(event.title)}</strong><small>${esc(event.at)}</small></li>`).join("")}</ul></section>`;
    renderOrderActions(order);
    $("#order-drawer").classList.add("is-open");
    $("#order-drawer").setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }

  function renderOrderActions(order) {
    let action = "";
    if (order.status === "fraud" && can("fraud")) action = `<button class="btn btn--secondary" data-order-action="deny">Recusar</button><button class="btn btn--primary" data-order-action="approve-fraud">${CONFIG.mode === "demo" ? "Simular aprovação" : "Aprovar decisão"}</button>`;
    if (order.status === "picking" && can("pick")) action = `<button class="btn btn--primary" data-order-action="start-check">Enviar para conferência</button>`;
    if (order.status === "checking" && can("check")) action = `<button class="btn btn--primary" data-order-action="finish-check" ${order.items.every((item) => item.checked) ? "" : "disabled"}>Finalizar conferência</button>`;
    if (order.status === "ready" && can("shipping")) action = `<button class="btn btn--primary" data-order-action="ship">Confirmar expedição</button>`;
    if (order.status === "shipped" && can("shipping")) action = `<button class="btn btn--primary" data-order-action="deliver">Marcar como entregue</button>`;
    $("#order-actions").innerHTML = `<button class="btn btn--secondary" data-close-drawer>Fechar</button>${action}`;
  }

  function closeDrawer() {
    $("#order-drawer").classList.remove("is-open");
    $("#order-drawer").setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    currentOrderId = null;
  }

  async function orderAction(action) {
    const required = {
      "approve-fraud": "fraud", deny: "fraud", "start-check": "pick",
      "finish-check": "check", ship: "shipping", deliver: "shipping",
    }[action];
    if (required && !requirePermission(required)) return;
    const order = state.orders.find((item) => item.id === currentOrderId);
    if (!order) return;

    if (CONFIG.mode === "supabase") {
      const payload = action === "ship" ? {
        carrier: $("#drawer-carrier")?.value || "",
        tracking: $("#drawer-tracking")?.value.trim() || "",
      } : {};
      const { error } = await window.C18_SUPABASE.rpc("update_order_operation", {
        p_order_id: order.dbId,
        p_action: action,
        p_payload: payload,
      });
      if (error) { toast(error.message || "Não foi possível avançar o pedido.", "alert"); return; }
      const orderNumber = order.id;
      await loadSupabaseData();
      renderAll(); openOrder(orderNumber); toast("Etapa do pedido atualizada com auditoria.");
      return;
    }

    const pushEvent = (title) => order.events.unshift({ title, at: "Agora" });
    if (action === "approve-fraud") { order.fraud = "approved"; order.payment = "captured"; order.status = "picking"; pushEvent("ClearSale aprovada e pagamento capturado"); }
    if (action === "deny") { order.fraud = "denied"; order.status = "cancelled"; pushEvent("Pedido cancelado por risco"); }
    if (action === "start-check") { order.status = "checking"; pushEvent("Separação concluída; aguardando conferência"); }
    if (action === "finish-check" && order.items.every((item) => item.checked)) { order.status = "ready"; pushEvent("Conferência concluída sem divergência"); }
    if (action === "ship") { order.status = "shipped"; order.carrier = $("#drawer-carrier")?.value || "Correios"; order.tracking = $("#drawer-tracking")?.value.trim() || "Aguardando rastreio"; pushEvent(`Expedido via ${order.carrier}`); }
    if (action === "deliver") { order.status = "delivered"; pushEvent("Entrega confirmada"); }
    saveState(); renderAll(); openOrder(order.id); toast("Etapa do pedido atualizada.");
  }

  function showAuthGate(message = "") {
    document.body.classList.add("is-authenticating");
    $("#auth-gate").hidden = false;
    $("#auth-error").hidden = !message;
    $("#auth-error").textContent = message;
  }

  function hideAuthGate() {
    document.body.classList.remove("is-authenticating");
    $("#auth-gate").hidden = true;
    $("#auth-error").hidden = true;
  }

  async function fetchAllRows(table, columns, orderColumn) {
    const pageSize = 1000;
    const data = [];
    for (let from = 0; ; from += pageSize) {
      let query = window.C18_SUPABASE.from(table).select(columns).range(from, from + pageSize - 1);
      if (orderColumn) query = query.order(orderColumn);
      const result = await query;
      if (result.error) return result;
      data.push(...(result.data || []));
      if ((result.data || []).length < pageSize) return { data, error: null };
    }
  }

  async function loadSupabaseData() {
    const client = window.C18_SUPABASE;
    const [storeResult, inventoryResult, orderResult, receiptResult, integrationResult, movementResult, bannerResult, paletteResult, couponResult, channelResult] = await Promise.all([
      client.from("stores").select("id, code, name").eq("active", true).order("name"),
      fetchAllRows("inventory_catalog_view", "*", "product_name"),
      client.from("orders").select("*, order_items(*), order_events(*), shipments(*)").order("created_at", { ascending: false }).limit(500),
      client.from("receipts").select("*").order("created_at", { ascending: false }).limit(500),
      client.from("integration_connections").select("*").order("id"),
      client.from("inventory_movements").select("id, store_id, kind, quantity_delta, note, created_at, product_variants(sku, products(name))").order("created_at", { ascending: false }).limit(100),
      client.from("site_banners").select("*").order("priority", { ascending: true }).order("created_at", { ascending: false }).limit(200),
      client.from("site_palettes").select("*").order("created_at", { ascending: false }).limit(100),
      client.from("discount_coupons").select("*").order("created_at", { ascending: false }).limit(200),
      client.from("sales_channels").select("*").order("id"),
    ]);

    if (storeResult.error) throw storeResult.error;
    if (inventoryResult.error) throw inventoryResult.error;
    if (orderResult.error) throw orderResult.error;

    stores.splice(0, stores.length, ...(storeResult.data || []).map((store) => ({
      id: store.id,
      name: store.name,
      short: store.code || store.name,
    })));
    fillStoreSelects();

    state.inventory = (inventoryResult.data || []).map((item) => ({
      id: `${item.variant_id}-${item.store_id}`,
      variantId: item.variant_id,
      code: item.sku,
      reference: item.reference,
      description: item.product_name,
      brand: item.brand,
      collection: item.collection,
      category: item.category,
      price: Number(item.retail_price || 0),
      quantity: Number(item.on_hand || 0),
      reserved: Number(item.reserved || 0),
      color: item.color,
      size: item.size,
      storeId: item.store_id,
      ecommerce: Boolean(item.published),
      source: String(item.synced_from || "ALTERDATA").toUpperCase(),
      updatedAt: item.updated_at,
    }));

    state.orders = (orderResult.data || []).map((order) => {
      const shipment = Array.isArray(order.shipments) ? order.shipments[0] : order.shipments;
      return {
        id: order.number,
        dbId: order.id,
        customer: order.customer?.name || order.customer?.full_name || order.customer?.email || "Cliente",
        date: order.created_at,
        origin: order.source,
        storeId: order.store_id,
        total: Number(order.total || 0),
        discountAmount: Number(order.discount_amount || 0),
        sellerCode: order.seller_code || "",
        couponCode: order.coupon_code || "",
        payment: order.payment_status,
        fraud: order.fraud_status,
        status: order.stage,
        carrier: shipment?.carrier,
        tracking: shipment?.tracking_code,
        items: (order.order_items || []).map((item) => ({
          id: item.id,
          code: item.sku,
          name: item.name,
          color: item.color || "Única",
          size: item.size || "Único",
          qty: Number(item.quantity),
          checked: Number(item.checked_quantity) >= Number(item.quantity),
        })),
        events: (order.order_events || []).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).map((item) => ({
          title: item.note || item.event_type,
          at: new Date(item.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }),
        })),
      };
    });

    if (!receiptResult.error) {
      state.receipts = (receiptResult.data || []).map((receipt) => ({
        id: receipt.number,
        dbId: receipt.id,
        invoice: receipt.invoice_number || "Sem nota",
        supplier: receipt.supplier_name,
        storeId: receipt.store_id,
        items: Number(receipt.expected_items || 0),
        checked: Number(receipt.checked_items || 0),
        status: receipt.status === "completed" ? "done" : receipt.status,
        receivedAt: new Date(receipt.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }),
      }));
    }

    if (!movementResult.error) {
      state.movements = (movementResult.data || []).map((movement) => ({
        id: movement.id,
        code: movement.product_variants?.sku || "—",
        description: movement.product_variants?.products?.name || "Movimento de estoque",
        type: movement.kind === "count" ? "set" : movement.kind === "receipt" ? "entry" : movement.kind === "sale" ? "exit" : movement.kind,
        storeId: movement.store_id,
        quantity: Number(movement.quantity_delta || 0),
        at: new Date(movement.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }),
        note: movement.note,
      }));
    }

    if (!bannerResult.error) {
      state.banners = (bannerResult.data || []).map((banner) => ({
        id: banner.id,
        dbId: banner.id,
        position: banner.position,
        category: banner.category || "",
        name: banner.name,
        image_path: banner.image_path,
        storagePath: storagePathFromUrl(banner.image_path),
        title_top: banner.title_top || "",
        title_bottom: banner.title_bottom || "",
        body_text: banner.body_text || "",
        cta_label: banner.cta_label || "",
        cta_url: banner.cta_url || "",
        cta_secondary_label: banner.cta_secondary_label || "",
        cta_secondary_url: banner.cta_secondary_url || "",
        stats: Array.isArray(banner.stats) ? banner.stats : [],
        source: banner.source,
        ai_prompt: banner.ai_prompt || "",
        active: Boolean(banner.active),
        priority: Number(banner.priority || 100),
        starts_at: banner.starts_at,
        ends_at: banner.ends_at,
        updatedAt: banner.updated_at,
      }));
    }

    if (!paletteResult.error) {
      state.palette = (paletteResult.data || []).find((palette) => palette.active) || null;
    }

    if (!couponResult.error) {
      state.coupons = (couponResult.data || []).map((coupon) => ({
        id: coupon.id,
        dbId: coupon.id,
        code: coupon.code,
        kind: coupon.kind,
        value: Number(coupon.value),
        scope: coupon.scope,
        target: coupon.target || "",
        active: Boolean(coupon.active),
        starts_at: coupon.starts_at,
        ends_at: coupon.ends_at,
        updatedAt: coupon.updated_at,
      }));
    }

    if (!integrationResult.error) {
      const integrationMeta = {
        alterdata: ["Alterdata Moda", "ALT", "ERP e estoque mestre"],
        rede: ["e.Rede", "REDE", "Pagamentos"],
        clearsale: ["ClearSale", "CS", "Antifraude"],
      };
      state.integrations = (integrationResult.data || []).map((item) => {
        /* canais de venda/marketing também aparecem na fila de integração */
        const channel = Channels ? Channels.channelById(item.id) : null;
        return {
          id: item.id,
          name: integrationMeta[item.id]?.[0] || (channel && channel.name) || item.id,
          initials: integrationMeta[item.id]?.[1] || (channel && channel.initials) || item.id.slice(0, 3).toUpperCase(),
          role: integrationMeta[item.id]?.[2] || (channel && channel.role) || "Integração",
          status: item.status,
          environment: item.environment,
          lastSync: item.last_success_at ? new Date(item.last_success_at).toLocaleString("pt-BR") : "Aguardando sincronização",
          queue: Number(item.metadata?.queue || 0),
        };
      });
    }

    if (channelResult && !channelResult.error) {
      const definitions = Channels ? Channels.CHANNELS : [];
      state.channels = definitions.map((definition) => {
        const row = (channelResult.data || []).find((item) => item.id === definition.id);
        return {
          id: definition.id,
          enabled: Boolean(row && row.enabled),
          status: row ? row.status : "pending",
          environment: row ? row.environment : "A configurar",
          config: (row && row.config) || {},
          policy: Channels.normalizePolicy((row && row.config && row.config.policy) || definition.policy),
          lastSync: row && row.last_sync_at ? new Date(row.last_sync_at).toLocaleString("pt-BR") : "Aguardando credenciais",
          listings: Number(row && row.metadata && row.metadata.listings || 0),
          errors: Number(row && row.metadata && row.metadata.errors || 0),
        };
      });
      /* canais que existem no banco mas não na lista local (extensão futura) */
      (channelResult.data || []).forEach((row) => {
        if (!state.channels.some((channel) => channel.id === row.id)) {
          state.channels.push({
            id: row.id, enabled: Boolean(row.enabled), status: row.status,
            environment: row.environment, config: row.config || {},
            policy: Channels.normalizePolicy((row.config || {}).policy || {}),
            lastSync: row.last_sync_at ? new Date(row.last_sync_at).toLocaleString("pt-BR") : "Aguardando",
            listings: 0, errors: 0,
          });
        }
      });
    }
  }

  async function applyAuthSession(session) {
    if (!session?.user || !window.C18_SUPABASE) { showAuthGate(); return; }
    const { data: profile, error } = await window.C18_SUPABASE
      .from("profiles")
      .select("full_name, role, active")
      .eq("id", session.user.id)
      .single();

    if (error || !profile?.active) {
      await window.C18_SUPABASE.auth.signOut();
      showAuthGate("Acesso ainda não liberado. Peça ao administrador para ativar seu perfil.");
      return;
    }

    currentRole = profile.role || "viewer";
    currentProfile = {
      full_name: profile.full_name || session.user.email?.split("@")[0] || "Usuário",
      role: currentRole,
    };
    try {
      await loadSupabaseData();
    } catch (loadError) {
      console.error("Falha ao carregar operações", loadError);
      showAuthGate("Login confirmado, mas os dados operacionais não puderam ser carregados. Verifique a implantação do banco.");
      return;
    }
    $("#connection-dot").classList.remove("sync-dot--warning");
    $("#connection-label").textContent = "Sessão protegida";
    $("#connection-detail").textContent = "Autenticado com Supabase e políticas por função.";
    const notice = $(".demo-notice");
    if (notice) notice.hidden = true;
    renderAll();
    hideAuthGate();
  }

  async function authenticateEmployee(event) {
    event.preventDefault();
    if (!window.C18_SUPABASE) {
      showAuthGate("A conexão segura não está configurada. Contate o administrador.");
      return;
    }
    const submit = $("#login-submit");
    const values = new FormData(event.currentTarget);
    submit.disabled = true;
    submit.textContent = "Verificando…";
    $("#auth-error").hidden = true;
    const { data, error } = await window.C18_SUPABASE.auth.signInWithPassword({
      email: String(values.get("email") || "").trim(),
      password: String(values.get("password") || ""),
    });
    submit.disabled = false;
    submit.textContent = "Entrar com segurança";
    if (error || !data.session) {
      showAuthGate("Não foi possível entrar. Confira e-mail e senha ou fale com o administrador.");
      return;
    }
    await applyAuthSession(data.session);
  }

  async function signOutEmployee() {
    if (CONFIG.mode !== "supabase" || !window.C18_SUPABASE) {
      toast("No modo demonstração, o perfil ativo é Administradora.");
      return;
    }
    await window.C18_SUPABASE.auth.signOut();
    currentRole = "viewer";
    currentProfile = { full_name: "Usuário", role: "viewer" };
    closeModals(); closeDrawer(); showAuthGate();
  }

  async function initSupabaseAuth() {
    if (CONFIG.mode !== "supabase") return;
    showAuthGate();
    if (!CONFIG.supabaseUrl || !CONFIG.supabaseAnonKey || !window.supabase) {
      showAuthGate("A conexão segura não está configurada. Contate o administrador.");
      return;
    }
    window.C18_SUPABASE = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey);
    const { data, error } = await window.C18_SUPABASE.auth.getSession();
    if (error || !data.session) showAuthGate();
    else await applyAuthSession(data.session);
    window.C18_SUPABASE.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || !session) showAuthGate();
    });
  }


  /* ================================== Banners & Paleta ================= */
  function storagePathFromUrl(url) {
    const marker = "/storage/v1/object/public/banners/";
    if (typeof url !== "string") return "";
    if (url.includes(marker)) return url.split(marker)[1];
    if (!/^https?:\/\//i.test(url) && !url.startsWith("data:")) return url;
    return "";
  }

  function bannerDisplayImage(banner) {
    if (!banner || !banner.image_path) return "";
    const path = banner.image_path;
    if (/^https?:\/\//i.test(path) || path.startsWith("data:")) return path;
    if (CONFIG.mode === "supabase" && CONFIG.supabaseUrl) {
      return `${CONFIG.supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/banners/${path}`;
    }
    return path;
  }

  function renderBanners() {
    const grid = $("#banners-grid");
    if (!grid) return;
    if (!state.banners.length) {
      grid.innerHTML = '<p class="empty-options">Nenhum banner ainda. Clique em “Novo banner” para criar o primeiro.</p>';
      return;
    }
    const now = new Date();
    grid.innerHTML = state.banners.map((banner) => {
      const scheduled = !banner.active && banner.starts_at && new Date(banner.starts_at) > now;
      const status = banner.active ? badge("No ar", "success") : scheduled ? badge("Agendado", "info") : badge("Inativo", "neutral");
      const sourceLabel = { upload: "Upload", ai: "Gerado por IA", static: "Padrão da marca" }[banner.source] || banner.source;
      const positionLabel = banner.position === "home-hero"
        ? "Home — hero"
        : banner.position === "category-hero"
          ? `Categoria${banner.category ? `: ${banner.category}` : ""} (opcional)`
          : "Faixa promocional";
      const until = banner.ends_at ? ` · até ${new Date(banner.ends_at).toLocaleDateString("pt-BR")}` : "";
      const statsLine = heroStatsSummary(banner.stats);
      return `<article class="banner-card${banner.active ? " is-active" : ""}">
        <div class="banner-card__media">
          <img src="${esc(bannerDisplayImage(banner))}" alt="" loading="lazy" onerror="this.parentElement.classList.add('is-missing');this.remove()">
          ${banner.active ? '<span class="banner-card__live">NO AR</span>' : ""}
        </div>
        <div class="banner-card__body">
          <div class="banner-card__top"><strong>${esc(banner.name)}</strong>${status}</div>
          <p>${esc(sourceLabel)} · ${esc(positionLabel)}${until}</p>
          ${statsLine ? `<p class="banner-card__stats">${esc(statsLine)}</p>` : ""}
          <div class="banner-card__actions">
            <button class="btn ${banner.active ? "btn--secondary" : "btn--primary"}" data-banner-toggle="${esc(banner.id)}">${banner.active ? "Desativar" : "Ativar"}</button>
            <button class="btn btn--secondary" data-banner-edit="${esc(banner.id)}">Editar</button>
            <button class="icon-only" data-banner-delete="${esc(banner.id)}" aria-label="Excluir banner" title="Excluir"><svg><use href="#i-trash"/></svg></button>
          </div>
        </div>
      </article>`;
    }).join("");
  }

  function toDatetimeLocal(iso) {
    if (!iso) return "";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  // Lê os pares número/legenda do formulário; os vazios do fim são descartados
  // (no site, um campo em branco mantém o texto padrão da marca).
  function readHeroStats() {
    const fieldValue = (selector, maxLength) => {
      const field = $(selector);
      return field ? field.value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
    };
    const stats = Array.from({ length: HERO_STAT_SLOTS }, (_, index) => ({
      value: fieldValue(`#banner-stat-${index + 1}-value`, HERO_STAT_VALUE_MAX),
      label: fieldValue(`#banner-stat-${index + 1}-label`, HERO_STAT_LABEL_MAX),
    }));
    while (stats.length && !stats[stats.length - 1].value && !stats[stats.length - 1].label) stats.pop();
    return stats;
  }

  function fillHeroStats(stats) {
    const list = Array.isArray(stats) ? stats : [];
    for (let index = 0; index < HERO_STAT_SLOTS; index += 1) {
      const stat = list[index] && typeof list[index] === "object" ? list[index] : {};
      const valueField = $(`#banner-stat-${index + 1}-value`);
      const labelField = $(`#banner-stat-${index + 1}-label`);
      if (valueField) valueField.value = typeof stat.value === "string" ? stat.value : "";
      if (labelField) labelField.value = typeof stat.label === "string" ? stat.label : "";
    }
  }

  function heroStatsSummary(stats) {
    if (!Array.isArray(stats)) return "";
    return stats
      .slice(0, HERO_STAT_SLOTS)
      .map((stat) => (stat && typeof stat === "object" ? [stat.value, stat.label].filter(Boolean).join(" ") : ""))
      .filter(Boolean)
      .join(" · ");
  }

  function showBannerPreview(src) {
    const img = $("#banner-preview-img");
    const empty = $("#banner-preview-empty");
    if (!img || !empty) return;
    if (src) { img.src = src; img.hidden = false; empty.hidden = true; }
    else { img.hidden = true; img.removeAttribute("src"); empty.hidden = false; }
  }

  function setBannerSource(tab) {
    $$("[data-banner-source]").forEach((button) => button.classList.toggle("is-active", button.dataset.bannerSource === tab));
    $$(".banner-source-pane").forEach((pane) => {
      const active = pane.dataset.sourcePane === tab;
      pane.hidden = !active;
      pane.classList.toggle("is-active", active);
    });
  }

  function openBannerModal(id = null) {
    bannerEditingId = id;
    bannerImage = "";
    bannerImageSource = "";
    const form = $("#banner-form");
    form.reset();
    setBannerSource("upload");
    const banner = id ? state.banners.find((item) => item.id === id) : null;
    if (banner) {
      bannerImage = banner.image_path;
      bannerImageSource = banner.source;
      $("#banner-name").value = banner.name || "";
      $("#banner-position").value = banner.position || "home-hero";
      $("#banner-category").value = banner.category || "";
      $("#banner-title-top").value = banner.title_top || "";
      $("#banner-title-bottom").value = banner.title_bottom || "";
      $("#banner-body").value = banner.body_text || "";
      $("#banner-cta").value = banner.cta_label || "";
      $("#banner-cta-url").value = banner.cta_url || "";
      $("#banner-cta2").value = banner.cta_secondary_label || "";
      $("#banner-cta2-url").value = banner.cta_secondary_url || "";
      fillHeroStats(banner.stats);
      $("#banner-prompt").value = banner.ai_prompt || "";
      $("#banner-starts").value = toDatetimeLocal(banner.starts_at);
      $("#banner-ends").value = toDatetimeLocal(banner.ends_at);
      $("#banner-active-check").checked = Boolean(banner.active);
      $("#banner-modal-title").textContent = `Editar — ${banner.name}`;
      if (banner.source === "ai" && banner.ai_prompt) setBannerSource("ai");
    } else {
      $("#banner-modal-title").textContent = "Novo banner";
      $("#banner-active-check").checked = true;
      // Começa com os números que estão no ar para o banner novo não "perder" a faixa.
      fillHeroStats(DEFAULT_HERO_STATS);
    }
    updateBannerPositionFields();
    showBannerPreview(banner ? bannerDisplayImage(banner) : "");
    openModal("#banner-modal");
  }

  /* Banner de categoria é opcional: o campo só aparece quando a posição
     escolhida é "category-hero", e a lista sugere as categorias que
     existem no estoque (nomes do Alterdata) e as do site (data.js). */
  function bannerCategoryOptions() {
    const fromInventory = state.inventory.map((item) => String(item.category || "").trim()).filter(Boolean);
    const fromSite = (typeof CATEGORIES !== "undefined" && Array.isArray(CATEGORIES))
      ? CATEGORIES.map((category) => category.id).filter((id) => id !== "todos")
      : [];
    return Array.from(new Set(fromInventory.concat(fromSite))).sort();
  }

  function updateBannerPositionFields() {
    const position = ($("#banner-position") || {}).value || "home-hero";
    const field = $("#banner-category-field");
    const isCategory = position === "category-hero";
    if (field) field.hidden = !isCategory;
    const input = $("#banner-category");
    if (input) input.required = isCategory;
    const datalist = $("#banner-category-options");
    if (datalist) {
      datalist.innerHTML = bannerCategoryOptions().map((value) => `<option value="${esc(value)}"></option>`).join("");
    }
    const note = $("#banner-foot-note");
    if (note) {
      note.textContent = isCategory
        ? "O catálogo mostra esta arte só quando o visitante filtra a categoria (ou abre um produto dela). Sem banner ativo, a página fica como hoje."
        : "A imagem e os textos aparecem na home quando o banner é ativado.";
    }
  }

  function readImageFile(file, maxWidth = 1600) {
    return new Promise((resolve, reject) => {
      if (!file) return reject(new Error("Nenhum arquivo selecionado."));
      if (!/^image\/(png|jpeg|webp)$/i.test(file.type)) return reject(new Error("Use uma imagem PNG, JPG ou WebP."));
      if (file.size > 6 * 1024 * 1024) return reject(new Error("Imagem acima de 6 MB. Reduza a resolução e tente de novo."));
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        try {
          const scale = Math.min(1, maxWidth / image.width);
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(image.width * scale));
          canvas.height = Math.max(1, Math.round(image.height * scale));
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/jpeg", 0.82));
        } catch (error) {
          reject(new Error("Não foi possível processar a imagem."));
        } finally {
          URL.revokeObjectURL(url);
        }
      };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Não foi possível ler a imagem.")); };
      image.src = url;
    });
  }

  async function handleBannerFile(file) {
    if (!requirePermission("banners")) return;
    try {
      $("#banner-foot-note").textContent = "Processando a imagem…";
      bannerImage = await readImageFile(file);
      bannerImageSource = "upload";
      showBannerPreview(bannerImage);
      $("#banner-foot-note").textContent = "Imagem pronta. Preencha os textos e salve.";
      toast("Imagem carregada para o banner.");
    } catch (error) {
      toast(error.message || "Não foi possível ler a imagem.", "alert");
    }
  }

  function shadeHex(hex, percent) {
    const clean = String(hex).replace("#", "");
    const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean.slice(0, 6);
    const num = parseInt(full, 16);
    if (Number.isNaN(num)) return "#111111";
    const clamp = (value) => Math.min(255, Math.max(0, Math.round(value)));
    const amount = Math.round(2.55 * percent);
    const r = clamp((num >> 16) + amount);
    const g = clamp(((num >> 8) & 0xff) + amount);
    const b = clamp((num & 0xff) + amount);
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
  }

  function currentPaletteColors() {
    return { ...DEFAULT_PALETTE, ...((state.palette && state.palette.colors) || {}) };
  }

  // Simulação da IA no modo demonstração: composição escura com granulado,
  // palavras do prompt em destaque e selo da marca.
  function simulateAiImage(prompt, style) {
    const palette = currentPaletteColors();
    const canvas = document.createElement("canvas");
    canvas.width = 1680;
    canvas.height = 735;
    const ctx = canvas.getContext("2d");
    const base = HEX_COLOR.test(palette.darkBg) ? palette.darkBg : "#000000";
    const gradient = ctx.createLinearGradient(0, 0, 1680, 735);
    gradient.addColorStop(0, shadeHex(base, 14));
    gradient.addColorStop(0.55, base);
    gradient.addColorStop(1, shadeHex(base, -14));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 1680, 735);
    for (let i = 0; i < 9000; i += 1) {
      ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.04})`;
      ctx.fillRect(Math.random() * 1680, Math.random() * 735, 1.4, 1.4);
    }
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fillRect(0, 566, 1680, 4);
    ctx.fillRect(1180, 0, 6, 735);

    const words = prompt.split(/\s+/).filter(Boolean).slice(0, 8).join(" ").toUpperCase().split(" ");
    ctx.fillStyle = HEX_COLOR.test(palette.darkText) ? palette.darkText : "#ffffff";
    ctx.font = "700 92px 'Jost', Futura, Arial, sans-serif";
    const lines = [];
    let line = "";
    words.forEach((word) => {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > 1060 && line) { lines.push(line); line = word; } else { line = test; }
    });
    if (line) lines.push(line);
    lines.slice(0, 3).forEach((textLine, index) => ctx.fillText(textLine, 100, 268 + index * 108));

    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 2;
    ctx.strokeRect(100, 92, 158, 46);
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = "700 22px 'Jost', Futura, Arial, sans-serif";
    ctx.fillText("CENSURA 18", 112, 124);

    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.font = "500 18px 'Jost', Futura, Arial, sans-serif";
    const styleLabel = { "street-photography": "FOTO DE RUA", "graphic-art": "ARTE GRÁFICA", abstract: "ABSTRATO" }[style] || "IA";
    ctx.fillText(`${styleLabel} · SIMULAÇÃO DA DEMONSTRAÇÃO`, 100, 668);
    return canvas.toDataURL("image/jpeg", 0.85);
  }

  async function runBannerAiGenerate() {
    if (!requirePermission("banners")) return;
    const prompt = $("#banner-prompt").value.trim();
    if (!prompt) { toast("Descreva o banner no prompt para gerar a imagem.", "alert"); return; }
    const style = $("#banner-style").value;
    const aspect = $("#banner-aspect").value;
    const button = $("#banner-ai-generate");
    button.disabled = true;
    const original = button.innerHTML;
    button.innerHTML = '<svg><use href="#i-refresh"/></svg>Gerando…';

    if (CONFIG.mode === "supabase" && window.C18_SUPABASE) {
      try {
        const { data: sessionData } = await window.C18_SUPABASE.auth.getSession();
        const functionUrl = `${CONFIG.supabaseUrl.replace(/\/$/, "")}/functions/v1/gerar-banner`;
        const response = await fetch(functionUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: CONFIG.supabaseAnonKey,
            Authorization: `Bearer ${(sessionData && sessionData.session && sessionData.session.access_token) || ""}`,
          },
          body: JSON.stringify({ prompt, style, aspect }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.ok) throw new Error(payload.error || "Falha ao gerar a imagem com IA.");
        const { data } = window.C18_SUPABASE.storage.from("banners").getPublicUrl(payload.image_path);
        bannerImage = data.publicUrl;
        bannerImageSource = "ai";
        showBannerPreview(bannerImage);
        $("#banner-foot-note").textContent = "Imagem gerada pela IA e salva no servidor.";
        toast("Imagem gerada pela IA com sucesso.");
      } catch (error) {
        toast(error.message || "Não foi possível gerar a imagem.", "alert");
      }
    } else {
      await new Promise((resolve) => setTimeout(resolve, 1600));
      bannerImage = simulateAiImage(prompt, style);
      bannerImageSource = "ai";
      showBannerPreview(bannerImage);
      $("#banner-foot-note").textContent = "Imagem simulada pronta (modo demonstração).";
      toast("Imagem simulada gerada. Com o Supabase conectado, a IA real entra aqui.");
    }

    button.disabled = false;
    button.innerHTML = original;
  }

  async function saveBanner(event) {
    event.preventDefault();
    if (!requirePermission("banners")) return;
    const name = $("#banner-name").value.trim();
    if (!name) { toast("Dê um nome ao banner antes de salvar.", "alert"); return; }
    if (!bannerImage) { toast("Escolha uma imagem (upload ou IA) antes de salvar.", "alert"); return; }

    const startsRaw = $("#banner-starts").value;
    const endsRaw = $("#banner-ends").value;
    const position = $("#banner-position").value || "home-hero";
    const category = $("#banner-category").value.trim();
    if (position === "category-hero" && !category) {
      toast("Informe a categoria deste banner (ou escolha outra posição).", "alert");
      return;
    }
    const payload = {
      id: bannerEditingId || "",
      name,
      position,
      category: position === "category-hero" ? category : "",
      image_path: bannerImage,
      title_top: $("#banner-title-top").value.trim(),
      title_bottom: $("#banner-title-bottom").value.trim(),
      body_text: $("#banner-body").value.trim(),
      cta_label: $("#banner-cta").value.trim(),
      cta_url: $("#banner-cta-url").value.trim(),
      cta_secondary_label: $("#banner-cta2").value.trim(),
      cta_secondary_url: $("#banner-cta2-url").value.trim(),
      stats: readHeroStats(),
      source: bannerImageSource || "upload",
      ai_prompt: bannerImageSource === "ai" ? $("#banner-prompt").value.trim() : "",
      priority: 100,
      starts_at: startsRaw ? new Date(startsRaw).toISOString() : "",
      ends_at: endsRaw ? new Date(endsRaw).toISOString() : "",
      active: $("#banner-active-check").checked,
    };

    if (CONFIG.mode === "supabase" && window.C18_SUPABASE) {
      const button = $("#banner-save");
      button.disabled = true;
      const { error } = await window.C18_SUPABASE.rpc("save_site_banner", { p_payload: payload });
      button.disabled = false;
      if (error) { toast(error.message || "Não foi possível salvar o banner.", "alert"); return; }
      try { await loadSupabaseData(); } catch (_) {}
      renderBanners();
      closeModals();
      toast(payload.active ? (payload.position === "category-hero" ? "Banner da categoria no ar." : "Banner salvo e no ar na home.") : "Banner salvo como inativo.");
      return;
    }

    const record = { ...payload, id: payload.id || `banner-${Date.now()}`, updatedAt: new Date().toISOString() };
    const index = state.banners.findIndex((item) => item.id === record.id);
    if (index >= 0) state.banners[index] = record; else state.banners.push(record);
    if (record.active) {
      state.banners.forEach((item) => {
        if (item.id !== record.id && item.position === record.position && (item.category || "") === (record.category || "")) item.active = false;
      });
    }
    saveState();
    syncDemoBanner();
    renderBanners();
    closeModals();
    toast(record.active ? (record.position === "category-hero" ? `Banner da categoria ${record.category} no ar.` : "Banner salvo e no ar na home.") : "Banner salvo como inativo.");
  }

  async function toggleBannerActive(id) {
    if (!requirePermission("banners")) return;
    const banner = state.banners.find((item) => item.id === id);
    if (!banner) return;
    const nextActive = !banner.active;

    if (CONFIG.mode === "supabase" && window.C18_SUPABASE) {
      const { error } = await window.C18_SUPABASE.rpc("set_site_banner_active", { p_id: banner.dbId || id, p_active: nextActive });
      if (error) { toast(error.message || "Não foi possível alternar o banner.", "alert"); return; }
      try { await loadSupabaseData(); } catch (_) {}
      renderBanners();
    } else {
      banner.active = nextActive;
      if (nextActive) {
        state.banners.forEach((item) => {
          if (item.id !== id && item.position === banner.position && (item.category || "") === (banner.category || "")) item.active = false;
        });
      }
      saveState();
      syncDemoBanner();
      renderBanners();
    }
    toast(nextActive
      ? (banner.position === "category-hero" ? `Banner da categoria ${banner.category || ""} ativado.` : "Banner ativado. A home já mostra a nova arte.")
      : "Banner desativado. A página volta à arte padrão.");
  }

  async function deleteBanner(id) {
    if (!requirePermission("banners")) return;
    const banner = state.banners.find((item) => item.id === id);
    if (!banner) return;
    if (!window.confirm(`Excluir o banner "${banner.name}"?`)) return;

    if (CONFIG.mode === "supabase" && window.C18_SUPABASE) {
      if (banner.storagePath) {
        await window.C18_SUPABASE.storage.from("banners").remove([banner.storagePath]).catch(() => {});
      }
      const { error } = await window.C18_SUPABASE.rpc("delete_site_banner", { p_id: banner.dbId || id });
      if (error) { toast(error.message || "Não foi possível excluir o banner.", "alert"); return; }
      try { await loadSupabaseData(); } catch (_) {}
      renderBanners();
      toast("Banner excluído.");
      return;
    }

    state.banners = state.banners.filter((item) => item.id !== id);
    saveState();
    syncDemoBanner();
    renderBanners();
    toast("Banner excluído.");
  }

  // No modo demonstração, o site e o painel vivem no mesmo navegador: a
  // home (assets/js/site-config.js) lê essas chaves e aplica o que está no ar.
  function syncDemoBanner() {
    if (CONFIG.mode !== "demo") return;
    const now = new Date();
    const active = state.banners.find((item) =>
      item.position === "home-hero" && item.active && item.source !== "static" &&
      (!item.starts_at || new Date(item.starts_at) <= now) &&
      (!item.ends_at || new Date(item.ends_at) >= now)
    );
    /* banners de categoria ativos (opcionais) — lidos pelo catálogo */
    const categories = state.banners.filter((item) =>
      item.position === "category-hero" && item.active &&
      (!item.starts_at || new Date(item.starts_at) <= now) &&
      (!item.ends_at || new Date(item.ends_at) >= now)
    );
    try {
      if (active) localStorage.setItem(BANNER_DEMO_KEY, JSON.stringify(active));
      else localStorage.removeItem(BANNER_DEMO_KEY);
      if (categories.length) localStorage.setItem(CATEGORY_BANNER_DEMO_KEY, JSON.stringify(categories));
      else localStorage.removeItem(CATEGORY_BANNER_DEMO_KEY);
    } catch (_) {
      toast("Limite de armazenamento do navegador atingido. Use imagens menores no modo demo.", "alert");
    }
  }

  /* ======================================= Cupons de desconto ========= */
  let couponEditingId = null;

  function renderCoupons() {
    const grid = $("#coupons-grid");
    if (!grid) return;
    if (!state.coupons.length) {
      grid.innerHTML = '<p class="empty-options">Nenhum cupom ainda. Clique em “Novo cupom” para criar o primeiro.</p>';
      return;
    }
    const now = new Date();
    const tools = window.C18Coupons;
    grid.innerHTML = state.coupons.map((coupon) => {
      const activeNow = tools ? tools.isActive(coupon, now) : coupon.active;
      const scheduled = !activeNow && coupon.starts_at && new Date(coupon.starts_at) > now;
      const expired = !activeNow && coupon.ends_at && new Date(coupon.ends_at) < now;
      const status = activeNow ? badge("No ar", "success") : scheduled ? badge("Agendado", "info") : expired ? badge("Expirado", "neutral") : badge("Inativo", "neutral");
      const description = tools ? tools.describeCoupon(coupon) : "";
      const scopeLabel = (tools && tools.SCOPE_LABELS[coupon.scope]) || "Loja toda";
      const dates = [];
      if (coupon.starts_at) dates.push("de " + new Date(coupon.starts_at).toLocaleDateString("pt-BR"));
      if (coupon.ends_at) dates.push("até " + new Date(coupon.ends_at).toLocaleDateString("pt-BR"));
      return `<article class="coupon-card${activeNow ? " is-active" : ""}">
        <div class="coupon-card__top"><strong class="coupon-card__code">${esc(coupon.code)}</strong>${status}</div>
        <p class="coupon-card__desc">${esc(description || "Desconto")}</p>
        <p class="coupon-card__meta">Aplica a: ${esc(scopeLabel)}${coupon.target ? " · " + esc(coupon.target) : ""} · ${esc(dates.join(" ") || "sem prazo")}</p>
        <div class="coupon-card__actions">
          <button class="btn ${coupon.active ? "btn--secondary" : "btn--primary"}" data-coupon-toggle="${esc(coupon.id)}">${coupon.active ? "Desativar" : "Ativar"}</button>
          <button class="btn btn--secondary" data-coupon-edit="${esc(coupon.id)}">Editar</button>
          <button class="icon-only" data-coupon-delete="${esc(coupon.id)}" aria-label="Excluir cupom" title="Excluir"><svg><use href="#i-trash"/></svg></button>
        </div>
      </article>`;
    }).join("");
  }

  /* Mostra/esconde o campo de alvo e sugere, via datalist, os valores que
     existem no estoque (referência, categoria ou coleção). */
  function updateCouponScopeFields() {
    const scopeSelect = $("#coupon-scope");
    const scope = scopeSelect ? scopeSelect.value : "all";
    const field = $("#coupon-target-field");
    const needsTarget = scope === "reference" || scope === "category" || scope === "collection";
    if (field) field.hidden = !needsTarget;
    const label = field ? field.querySelector("span") : null;
    if (label) {
      const labels = { reference: "Referência", category: "Categoria", collection: "Coleção" };
      label.innerHTML = needsTarget ? labels[scope] + " alvo <b>*</b>" : "Alvo do desconto";
    }
    const datalist = $("#coupon-target-options");
    if (!datalist) return;
    const values = needsTarget
      ? Array.from(new Set(state.inventory
          .map((item) => String((scope === "reference" ? (item.reference || item.code) : item[scope]) || "").trim())
          .filter(Boolean))).sort()
      : [];
    datalist.innerHTML = values.map((value) => `<option value="${esc(value)}"></option>`).join("");
  }

  function openCouponModal(id = null) {
    couponEditingId = id;
    const form = $("#coupon-form");
    form.reset();
    const coupon = id ? state.coupons.find((item) => item.id === id) : null;
    if (coupon) {
      $("#coupon-code").value = coupon.code || "";
      $("#coupon-kind").value = coupon.kind === "amount" ? "amount" : "percent";
      $("#coupon-value").value = String(coupon.value ?? "").replace(".", ",");
      $("#coupon-scope").value = coupon.scope || "all";
      $("#coupon-target").value = coupon.target || "";
      $("#coupon-starts").value = toDatetimeLocal(coupon.starts_at);
      $("#coupon-ends").value = toDatetimeLocal(coupon.ends_at);
      $("#coupon-active-check").checked = Boolean(coupon.active);
      $("#coupon-modal-title").textContent = "Editar — " + coupon.code;
    } else {
      $("#coupon-modal-title").textContent = "Novo cupom";
      $("#coupon-active-check").checked = true;
    }
    updateCouponScopeFields();
    const footNote = $("#coupon-foot-note");
    if (footNote) footNote.textContent = "O desconto é confirmado pela loja no fechamento do pedido, como no site hoje.";
    openModal("#coupon-modal");
  }

  async function saveCoupon(event) {
    event.preventDefault();
    if (!requirePermission("coupons")) return;
    const tools = window.C18Coupons;
    if (!tools) { toast("Módulo de cupons indisponível.", "alert"); return; }
    const startsRaw = $("#coupon-starts").value;
    const endsRaw = $("#coupon-ends").value;
    const payload = {
      id: couponEditingId || "",
      code: $("#coupon-code").value,
      kind: $("#coupon-kind").value === "amount" ? "amount" : "percent",
      value: $("#coupon-value").value,
      scope: $("#coupon-scope").value,
      target: $("#coupon-target").value,
      starts_at: startsRaw ? new Date(startsRaw).toISOString() : "",
      ends_at: endsRaw ? new Date(endsRaw).toISOString() : "",
      active: $("#coupon-active-check").checked,
    };
    const result = tools.createCoupon(payload, { existing: state.coupons });
    const footNote = $("#coupon-foot-note");
    if (!result.ok) {
      if (footNote) footNote.textContent = result.errors.join(" ");
      toast(result.errors[0] || "Confira os dados do cupom.", "alert");
      return;
    }
    const coupon = result.coupon;

    if (CONFIG.mode === "supabase" && window.C18_SUPABASE) {
      const button = $("#coupon-save");
      button.disabled = true;
      const { error } = await window.C18_SUPABASE.rpc("save_discount_coupon", { p_payload: coupon });
      button.disabled = false;
      if (error) {
        if (footNote) footNote.textContent = error.message || "Não foi possível salvar o cupom.";
        toast(error.message || "Não foi possível salvar o cupom.", "alert");
        return;
      }
      try { await loadSupabaseData(); } catch (_) {}
      renderCoupons();
      closeModals();
      toast(coupon.active ? "Cupom salvo e ativo." : "Cupom salvo como inativo.");
      return;
    }

    const record = { ...coupon, id: coupon.id || "coupon-" + Date.now(), updatedAt: new Date().toISOString() };
    /* mesma semântica da RPC: salvar ativa quando marcado, mas nunca
       desativa — para desativar existe o botão próprio do cartão. */
    const previous = couponEditingId ? state.coupons.find((item) => item.id === couponEditingId) : null;
    if (previous && previous.active) record.active = true;
    const index = state.coupons.findIndex((item) => item.id === record.id);
    if (index >= 0) state.coupons[index] = record; else state.coupons.push(record);
    saveState();
    syncDemoCoupons();
    renderCoupons();
    closeModals();
    toast(record.active ? "Cupom salvo e ativo." : "Cupom salvo como inativo.");
  }

  async function toggleCouponActive(id) {
    if (!requirePermission("coupons")) return;
    const coupon = state.coupons.find((item) => item.id === id);
    if (!coupon) return;
    const nextActive = !coupon.active;

    if (CONFIG.mode === "supabase" && window.C18_SUPABASE) {
      const { error } = await window.C18_SUPABASE.rpc("set_discount_coupon_active", { p_id: coupon.dbId || id, p_active: nextActive });
      if (error) { toast(error.message || "Não foi possível alternar o cupom.", "alert"); return; }
      try { await loadSupabaseData(); } catch (_) {}
      renderCoupons();
    } else {
      coupon.active = nextActive;
      saveState();
      syncDemoCoupons();
      renderCoupons();
    }
    toast(nextActive ? "Cupom " + coupon.code + " ativado." : "Cupom " + coupon.code + " desativado.");
  }

  async function deleteCoupon(id) {
    if (!requirePermission("coupons")) return;
    const coupon = state.coupons.find((item) => item.id === id);
    if (!coupon) return;
    if (!window.confirm("Excluir o cupom \"" + coupon.code + "\"?")) return;

    if (CONFIG.mode === "supabase" && window.C18_SUPABASE) {
      const { error } = await window.C18_SUPABASE.rpc("delete_discount_coupon", { p_id: coupon.dbId || id });
      if (error) { toast(error.message || "Não foi possível excluir o cupom.", "alert"); return; }
      try { await loadSupabaseData(); } catch (_) {}
      renderCoupons();
      toast("Cupom excluído.");
      return;
    }

    state.coupons = state.coupons.filter((item) => item.id !== id);
    saveState();
    syncDemoCoupons();
    renderCoupons();
    toast("Cupom excluído.");
  }

  // No modo demonstração, o carrinho do site (assets/js/app.js) lê a lista
  // de cupons ativos desta chave para descrever o desconto ao cliente.
  function syncDemoCoupons() {
    if (CONFIG.mode !== "demo") return;
    const now = new Date();
    const list = state.coupons
      .filter((item) => item.active && (!item.starts_at || new Date(item.starts_at) <= now) && (!item.ends_at || new Date(item.ends_at) >= now))
      .map((item) => ({ code: item.code, kind: item.kind, value: item.value, scope: item.scope, target: item.target || "", active: true }));
    try {
      localStorage.setItem(COUPONS_DEMO_KEY, JSON.stringify(list));
    } catch (_) {
      /* storage cheio: o site segue sem descrição de cupom */
    }
  }

  function applyPalettePreview(colors) {
    const scope = $("#palette-preview");
    if (!scope) return;
    Object.entries(PALETTE_PREVIEW_VARS).forEach(([key, cssVar]) => {
      const value = colors && colors[key];
      if (typeof value === "string" && HEX_COLOR.test(value)) scope.style.setProperty(cssVar, value);
    });
  }

  function collectPaletteColors() {
    const colors = {};
    $$("[data-palette-key]").forEach((input) => { colors[input.dataset.paletteKey] = input.value; });
    return colors;
  }

  function renderPalette() {
    const colors = { ...DEFAULT_PALETTE, ...((state.palette && state.palette.colors) || {}) };
    $$("[data-palette-key]").forEach((input) => { input.value = colors[input.dataset.paletteKey] || "#000000"; });
    const nameInput = $("#palette-name");
    if (nameInput) nameInput.value = (state.palette && state.palette.name) || "";
    const tag = $("#palette-active-tag");
    if (tag) {
      if (state.palette) { tag.textContent = state.palette.name; tag.classList.add("is-custom"); }
      else { tag.textContent = "Padrão P&B"; tag.classList.remove("is-custom"); }
    }
    applyPalettePreview(colors);
  }

  function syncDemoPalette() {
    if (CONFIG.mode !== "demo") return;
    try {
      if (state.palette) localStorage.setItem(PALETTE_DEMO_KEY, JSON.stringify(state.palette));
      else localStorage.removeItem(PALETTE_DEMO_KEY);
    } catch (_) {}
  }

  async function savePalette(event) {
    event.preventDefault();
    if (!requirePermission("banners")) return;
    const name = $("#palette-name").value.trim();
    if (!name) { toast("Dê um nome à paleta antes de aplicar.", "alert"); return; }
    const colors = collectPaletteColors();
    for (const [key, value] of Object.entries(colors)) {
      if (!HEX_COLOR.test(value)) { toast(`Cor inválida em “${key}”.`, "alert"); return; }
    }

    if (CONFIG.mode === "supabase" && window.C18_SUPABASE) {
      const { error } = await window.C18_SUPABASE.rpc("save_site_palette", { p_name: name, p_colors: colors, p_activate: true });
      if (error) { toast(error.message || "Não foi possível aplicar a paleta.", "alert"); return; }
      const { data } = await window.C18_SUPABASE.from("site_palettes").select("*").eq("active", true).limit(1);
      state.palette = (data && data[0]) || null;
      renderPalette();
      toast(`Paleta "${name}" aplicada ao site.`);
      return;
    }

    state.palette = { name, colors, updatedAt: new Date().toISOString() };
    saveState();
    syncDemoPalette();
    renderPalette();
    toast(`Paleta "${name}" aplicada. Recarregue a home para ver o resultado.`);
  }

  async function resetPalette() {
    if (!requirePermission("banners")) return;
    if (CONFIG.mode === "supabase" && window.C18_SUPABASE) {
      const { error } = await window.C18_SUPABASE.rpc("save_site_palette", {
        p_name: "Padrão P&B",
        p_colors: DEFAULT_PALETTE,
        p_activate: true,
      });
      if (error) { toast(error.message || "Não foi possível restaurar a paleta padrão.", "alert"); return; }
      const { data } = await window.C18_SUPABASE.from("site_palettes").select("*").eq("active", true).limit(1);
      state.palette = (data && data[0]) || null;
    } else {
      state.palette = null;
      saveState();
      syncDemoPalette();
    }
    renderPalette();
    toast("Paleta padrão preto, branco e cinza restaurada.");
  }
  /* ============================== Audiência do site ====================
     Os números vêm de assets/js/analytics.js:
       • modo demonstração → eventos medidos neste navegador + base de
         exemplo (sintética e determinística, avisada na interface);
       • modo Supabase     → RPC audience_report (migration
         202609180004_analytics_audience.sql), agregada no banco.
     O formato do relatório é o mesmo nos dois casos.
     =================================================================== */
  const audience = {
    range: 30,
    sample: true,
    path: "/",
    report: null,
    events: [],
    sampleEvents: [],
    sampleKey: "",
  };

  function audienceEvents() {
    if (!Analytics) return [];
    const captured = Analytics.capturedEvents();
    if (CONFIG.mode !== "demo" || !audience.sample) return captured;
    /* a base de exemplo cobre o dobro do período para existir comparação
       com o período anterior (limitada a 60 dias para não pesar) */
    const key = `${audience.range}|${Math.min(audience.range * 2, 60)}`;
    if (audience.sampleKey !== key) {
      audience.sampleEvents = Analytics.demoEvents({ days: Math.min(audience.range * 2, 60) });
      audience.sampleKey = key;
    }
    return captured.concat(audience.sampleEvents);
  }

  /* Contagem por tipo de evento — usada nos painéis de canais sem rodar a
     agregação completa (que só faz sentido na página de audiência). */
  function audienceEventCounts() {
    if (audience.report && audience.report.counts) return audience.report.counts;
    if (CONFIG.mode === "supabase") return {};
    /* fora das páginas de audiência/canais não vale gerar a base de exemplo
       (o painel abre na visão geral e isso custaria milhares de eventos) */
    if (currentPage !== "audience" && currentPage !== "channels") return {};
    const counts = {};
    audienceEvents().forEach((event) => { counts[event.kind] = (counts[event.kind] || 0) + 1; });
    return counts;
  }

  function currentAudienceReport() {
    if (audience.report) return audience.report;
    if (!Analytics) return { totals: {}, pages: [], sources: [] };
    audience.events = audienceEvents();
    const to = new Date();
    const from = new Date(to.getTime() - audience.range * 86400000);
    const report = Analytics.aggregate(audience.events, { days: audience.range, path: audience.path });
    if (audience.sampleKey && audience.range * 2 <= 60) {
      const previous = Analytics.aggregate(audience.events, {
        from: new Date(from.getTime() - audience.range * 86400000).toISOString(),
        to: from.toISOString(),
        path: audience.path,
      });
      report.previous = previous.totals;
    }
    if (!report.funnel && Audience) report.funnel = Audience.funnel(audience.events, { from, to });
    audience.report = report;
    return report;
  }

  async function refreshAudience(options) {
    const opts = options || {};
    audience.report = null;
    if (!opts.silent) audience.events = [];
    if (CONFIG.mode === "supabase" && window.C18_SUPABASE) {
      try {
        const to = new Date();
        const from = new Date(to.getTime() - audience.range * 86400000);
        const { data, error } = await window.C18_SUPABASE.rpc("audience_report", {
          p_from: from.toISOString(),
          p_to: to.toISOString(),
          p_path: audience.path,
        });
        if (error) throw error;
        audience.report = data || null;
        if (audience.report) audience.events = [];
      } catch (error) {
        toast("Não foi possível ler a audiência: " + (error.message || "verifique a migration de analytics"), "alert");
      }
    }
    renderAudience();
  }

  function audienceNoticeText(report) {
    const captured = Analytics ? Analytics.capturedEvents().length : 0;
    if (CONFIG.mode === "supabase") {
      return `<strong>Audiência real.</strong> ${Audience.number(report.totals.sessions)} sessões lidas de <code>analytics_events</code> no período. Só entra evento de visitante que aceitou no aviso de privacidade — nenhum dado pessoal é guardado.`;
    }
    if (audience.sample) {
      return `<strong>Base de exemplo ligada.</strong> ${Audience.number(report.totals.sessions)} sessões simuladas (${audience.range * 2} dias gerados) + ${Audience.number(captured)} eventos reais medidos neste navegador. Desligue para ver somente o tráfego verdadeiro.`;
    }
    return captured
      ? `<strong>Somente tráfego real.</strong> ${Audience.number(captured)} eventos medidos neste navegador desde o aceite do aviso de privacidade.`
      : `<strong>Sem visitas medidas ainda.</strong> Visite o site (fora do painel) e aceite o aviso de privacidade — ou ligue a base de exemplo para explorar os painéis.`;
  }

  function heatPathOptions(report) {
    const pages = ((report && report.pages) || []).slice(0, 10).map((page) => page.path);
    if (!pages.includes(audience.path)) pages.unshift(audience.path);
    return pages;
  }

  function renderAudience() {
    if (!Audience || !Analytics) return;
    const container = $("#audience-metrics");
    if (!container) return;
    if (!can("audience")) {
      container.innerHTML = "";
      $("#audience-notice").innerHTML = `<p class="empty-options">A audiência fica disponível para administradores e para o perfil de consulta.</p>`;
      return;
    }

    /* o relatório só é calculado quando a página está aberta (a agregação
       de milhares de eventos não precisa rodar a cada mudança de estoque) */
    if (currentPage !== "audience") return;

    const report = currentAudienceReport();
    const totals = report.totals || {};

    $("#audience-notice").innerHTML = `<span><svg><use href="#i-users"/></svg></span><p>${audienceNoticeText(report)}</p>`;
    container.innerHTML = Audience.metricCards(report);
    $("#audience-trend").innerHTML = Audience.trendChart(report);
    $("#audience-sources").innerHTML = Audience.trafficSources(report);
    $("#audience-source-hint").textContent = `${Audience.number(totals.sessions)} sessões`;
    $("#audience-referrers").innerHTML = Audience.referrersList(report);
    $("#audience-pages").innerHTML = Audience.topPages(report, 12);
    $("#audience-pages-hint").textContent = `${Audience.number(totals.pageviews)} páginas vistas`;
    $("#audience-funnel").innerHTML = Audience.funnelChart(report.funnel || Audience.funnel(audience.events));
    $("#audience-campaigns").innerHTML = Audience.campaignsTable(report);
    $("#audience-devices").innerHTML = Audience.devicesList(report);
    $("#audience-locations").innerHTML = Audience.locationsList(report);
    $("#audience-scroll").innerHTML = Audience.scrollTable(report);

    const heatSelect = $("#audience-heat-path");
    if (heatSelect) {
      const paths = heatPathOptions(report);
      heatSelect.innerHTML = paths.map((path) => `<option value="${esc(path)}"${path === audience.path ? " selected" : ""}>${esc(Analytics.pageLabel(path))} — ${esc(path)}</option>`).join("");
    }
    $("#audience-heat-zones").innerHTML = Audience.heatZones(report, audience.path);
    $("#audience-heat-legend").innerHTML = Audience.heatLegend();
    $("#audience-heat-grid").innerHTML = Audience.heatGrid(report);
    $("#audience-heat-targets").innerHTML = Audience.hotTargets(report, audience.path, 8);
  }

  function toggleAudienceSample() {
    audience.sample = !audience.sample;
    audience.report = null;
    const label = $("#audience-sample-label");
    if (label) label.textContent = audience.sample ? "Exemplo ligado" : "Exemplo desligado";
    renderAudience();
    toast(audience.sample
      ? "Base de exemplo ligada: os números são simulados para explorar os painéis."
      : "Base de exemplo desligada: só aparecem as visitas reais medidas.");
  }

  function exportAudienceCsv() {
    if (!Audience) return;
    const report = currentAudienceReport();
    const lines = [["secao", "item", "detalhe", "sessoes_ou_views", "participacao_ou_conversoes"]];
    (report.pages || []).forEach((page) => lines.push(["pagina", page.label, page.path, page.views, `${page.share}%`]));
    (report.sources || []).forEach((source) => lines.push(["origem", source.label, source.channel, source.sessions, `${source.share}%`]));
    (report.campaigns || []).forEach((campaign) => lines.push(["campanha", campaign.campaign, `${campaign.source}/${campaign.medium}`, campaign.sessions, campaign.conversions]));
    (report.zones || []).forEach((zone) => lines.push(["regiao_de_calor", zone.label, `${zone.path}#${zone.zone}`, zone.clicks, `${zone.share}%`]));
    (report.devices || []).forEach((device) => lines.push(["dispositivo", device.label, device.type, device.sessions, `${device.share}%`]));
    (report.locations || []).forEach((location) => lines.push(["cidade", location.name, "", location.sessions, `${location.share}%`]));

    const csv = lines.map((row) => row.map((cell) => {
      const text = String(cell ?? "");
      return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    }).join(";")).join("\n");

    const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `audiencia-c18-${audience.range}d.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    toast("Relatório de audiência exportado em CSV.");
  }

  /* ============================ Canais & Marketing =====================
     Google Merchant Center, Meta Ads, GA4 e marketplaces. As definições,
     a política de preço e a montagem dos feeds estão em
     admin/assets/channels.js; os segredos ficam no servidor e a
     sincronização roda nas Edge Functions de supabase/functions/.
     =================================================================== */
  let channelEditingId = null;
  let feedChannelId = "google-merchant";
  let policyChannelId = "google-merchant";

  function channelState(id) {
    return state.channels.find((channel) => channel.id === id) || null;
  }

  function channelMeta(id) {
    return Channels ? Channels.channelById(id) : null;
  }

  function channelCatalog() {
    return Channels ? Channels.catalogFromInventory(state.inventory, { siteUrl: SITE_URL }) : [];
  }

  /* Linhas prontas para publicar: preço e estoque já passam pela política
     do canal, com as pendências apontadas pela validação do feed. */
  function channelRows(channelId) {
    const channel = channelMeta(channelId);
    if (!channel || !Channels || channel.kind === "measurement") return [];
    const record = channelState(channelId);
    const policy = (record && record.policy) || channel.policy || Channels.DEFAULT_POLICY;
    return channelCatalog().map((item) => {
      const row = Channels.buildFeedRow(item, channelId, policy);
      const problems = Channels.validateFeedRow(row, channelId);
      /* cada canal nomeia preço e estoque de um jeito no feed; o cálculo
         vale para todos e é o mesmo usado na montagem da linha */
      const rules = Channels.normalizePolicy(policy);
      const stock = Channels.stockForChannel(item.stock, channel, rules);
      const price = Channels.priceForChannel(item.price, channel, rules);
      const publish = !rules.publishOnlyAvailable || stock > 0;
      return {
        ...row,
        _item: item,
        _problems: problems,
        _stock: stock,
        _price: price,
        _publish: publish,
        _status: Channels.listingStatus({ stock: publish ? stock : 0, price, paused: !publish }),
      };
    });
  }

  function channelStatusLabel(status) {
    return (Channels && Channels.STATUS_LABELS[status]) || status || "pending";
  }

  function listingStatusLabel(status) {
    return (Channels && Channels.LISTING_STATUS_LABELS[status]) || status;
  }

  function renderChannelCards() {
    const adsBox = $("#channel-cards-ads");
    const marketBox = $("#channel-cards-marketplaces");
    if (!adsBox || !marketBox || !Channels) return;

    const card = (channel) => {
      const record = channelState(channel.id) || {};
      const status = record.status || "pending";
      const rows = channelRows(channel.id);
      const publishable = rows.filter((row) => row._status === "published").length;
      const issues = rows.filter((row) => row._problems.length).length;
      const dot = status === "connected" || status === "syncing" ? "" : status === "error" ? " is-off" : " is-warning";
      const fee = Number(channel.fee || 0);
      const counts = channel.id === "ga4" || channel.id === "meta-ads" ? audienceEventCounts() : null;
      const conversionCount = counts
        ? ["add_to_cart", "checkout_intent", "whatsapp"].reduce((sum, kind) => sum + (counts[kind] || 0), 0)
        : null;

      return `<article class="channel-card${record.enabled ? " is-on" : ""}">
        <div class="channel-card__head">
          <span class="integration-logo">${esc(channel.initials)}</span>
          <div><strong>${esc(channel.name)}</strong><small>${esc(channel.role)}</small></div>
          <i class="status-dot${dot}"></i>
        </div>
        <dl class="channel-card__facts">
          <dt>Status</dt><dd>${esc(channelStatusLabel(status))}</dd>
          ${channel.kind === "measurement"
            ? `<dt>Conversões no período</dt><dd>${Audience.number(conversionCount || 0)}</dd>`
            : `<dt>Itens prontos</dt><dd>${Audience.number(publishable)} de ${Audience.number(rows.length)}${issues ? ` · ${issues} com pendência` : ""}</dd>`}
          ${fee ? `<dt>Comissão do canal</dt><dd>${fee}% → markup sugerido ${Audience.number(Channels.suggestedMarkup(fee))}%</dd>` : `<dt>Formato do feed</dt><dd>${esc((channel.feedFormat || "json").toUpperCase())}</dd>`}
          <dt>Última sincronização</dt><dd>${esc(record.lastSync || "—")}</dd>
        </dl>
        <div class="channel-card__foot">
          <button class="btn btn--secondary" data-channel-config="${esc(channel.id)}">Configurar</button>
          ${channel.kind === "measurement"
            ? `<button class="btn btn--primary" data-channel-test="${esc(channel.id)}">Testar evento</button>`
            : `<button class="btn btn--primary" data-channel-publish="${esc(channel.id)}">Publicar catálogo</button>`}
        </div>
      </article>`;
    };

    adsBox.innerHTML = Channels.adChannels().map(card).join("");
    marketBox.innerHTML = Channels.marketplaces().map(card).join("");
  }

  function fillChannelSelects() {
    if (!Channels) return;
    const options = Channels.CHANNELS.map((channel) => `<option value="${esc(channel.id)}">${esc(channel.name)}</option>`).join("");
    const feedOptions = Channels.CHANNELS.filter((channel) => channel.kind !== "measurement")
      .map((channel) => `<option value="${esc(channel.id)}">${esc(channel.name)}</option>`).join("");
    const policySelect = $("#channel-policy-channel");
    const feedSelect = $("#feed-channel");
    if (policySelect) policySelect.innerHTML = options;
    if (feedSelect) feedSelect.innerHTML = feedOptions;
    if (!Channels.CHANNELS.some((channel) => channel.kind !== "measurement" && channel.id === policyChannelId)) {
      policyChannelId = Channels.CHANNELS[0].id;
    }
    if (policySelect) policySelect.value = policyChannelId;
    if (feedSelect) feedSelect.value = feedChannelId;
  }

  function renderChannelPolicy() {
    if (!Channels) return;
    const channel = channelMeta(policyChannelId) || Channels.CHANNELS[0];
    const record = channelState(channel.id) || {};
    const policy = Channels.normalizePolicy(record.policy || channel.policy);
    const markup = $("#channel-policy-markup");
    if (!markup) return;
    markup.value = String(policy.markup);
    $("#channel-policy-rounding").value = policy.rounding;
    $("#channel-policy-buffer").value = String(policy.stockBuffer);
    $("#channel-policy-min").value = String(policy.minPrice);
    $("#channel-policy-max").value = String(policy.maxPublished);
    $("#channel-policy-available").checked = policy.publishOnlyAvailable;
    const hint = $("#channel-policy-hint");
    if (hint) hint.textContent = channel.name;
    const suggestion = $("#channel-policy-suggestion");
    if (suggestion) {
      suggestion.textContent = Number(channel.fee)
        ? `Este canal cobra ~${channel.fee}% de comissão: com ${Audience.number(policy.markup)}% de markup o preço fica ${Audience.money(Channels.priceForChannel(100, channel, policy))} para cada R$ 100,00 de varejo (markup que empata: ${Audience.number(Channels.suggestedMarkup(channel.fee))}%).`
        : "Canal de mídia: normalmente publica o mesmo preço do site.";
    }
  }

  function feedFormatFor(channelId) {
    const channel = channelMeta(channelId);
    if (!channel) return { extension: "csv", mime: "text/csv", label: "Baixar CSV" };
    if (channelId === "google-merchant") return { extension: "xml", mime: "application/xml", label: "Baixar XML" };
    if (channelId === "amazon") return { extension: "txt", mime: "text/tab-separated-values", label: "Baixar TSV" };
    return { extension: "csv", mime: "text/csv", label: "Baixar CSV" };
  }

  function renderFeedPreview() {
    if (!Channels) return;
    const channel = channelMeta(feedChannelId) || Channels.CHANNELS[0];
    const rows = channelRows(channel.id);
    const columns = Channels.feedColumns(channel.id);
    const head = $("#feed-head");
    const body = $("#feed-body");
    if (!head || !body) return;

    head.innerHTML = `<tr>${columns.map((column) => `<th>${esc(column)}</th>`).join("")}<th>Pendências</th></tr>`;
    body.innerHTML = rows.map((row) => `<tr>
      ${columns.map((column) => `<td><span class="feed-cell" title="${esc(row[column])}">${esc(row[column])}</span></td>`).join("")}
      <td>${row._problems.length
        ? `<span class="status-badge is-warning" title="${esc(row._problems.join(" · "))}">${row._problems.length}</span>`
        : `<span class="status-badge is-success">ok</span>`}</td>
    </tr>`).join("") || Audience.emptyMessage("Nenhum item de catálogo para publicar.", columns.length + 1);

    const publishable = rows.filter((row) => row._publish).length;
    const withIssues = rows.filter((row) => row._problems.length).length;
    const value = rows.reduce((sum, row) => sum + row._price * Math.min(1, row._stock), 0);
    $("#feed-summary").innerHTML = [
      ["Itens no catálogo", Audience.number(rows.length)],
      ["Prontos para publicar", Audience.number(publishable)],
      ["Com pendência", Audience.number(withIssues)],
      ["Preço médio no canal", Audience.money(rows.length ? rows.reduce((sum, row) => sum + row._price, 0) / rows.length : 0)],
      ["Valor publicável", Audience.money(value)],
      ["Formato", String(channel.feedFormat || "json").toUpperCase()],
    ].map(([label, value2]) => `<span class="summary-chip"><strong>${value2}</strong> ${esc(label)}</span>`).join("");

    const download = $("#feed-download");
    if (download) {
      const format = feedFormatFor(channel.id);
      $("#feed-download-label").textContent = format.label;
      download.dataset.format = format.extension;
    }
  }

  function downloadFeed() {
    if (!Channels) return;
    const channel = channelMeta(feedChannelId) || Channels.CHANNELS[0];
    const rows = channelRows(channel.id);
    const format = feedFormatFor(channel.id);
    let content = "";
    if (channel.id === "google-merchant" && format.extension === "xml") {
      content = Channels.toGoogleXml(rows, { link: SITE_URL, title: "Censura 18 — Google Merchant Center" });
    } else if (format.extension === "txt") {
      content = Channels.toTsv(rows, channel.id);
    } else {
      content = Channels.toCsv(rows, channel.id);
    }
    const blob = new Blob([content], { type: `${format.mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `c18-${channel.id}-feed.${format.extension}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    toast(`Feed de ${channel.name} gerado (${Audience.number(rows.length)} itens).`);
  }

  function renderChannelListings() {
    const body = $("#channel-listings");
    if (!body || !Channels) return;
    const enabled = state.channels.filter((channel) => channel.enabled);
    const hint = $("#channel-listings-hint");
    const previewMode = !enabled.length;
    const list = previewMode ? [channelState(feedChannelId) || { id: feedChannelId }] : enabled;

    const rows = list.flatMap((record) => channelRows(record.id).map((row) => ({ ...row, _channel: record.id })));
    if (hint) {
      hint.textContent = previewMode
        ? "Prévia: nenhum canal habilitado ainda"
        : `${Audience.number(enabled.length)} canais habilitados`;
    }
    body.innerHTML = rows.map((row) => {
      const channel = channelMeta(row._channel) || { name: row._channel };
      const statusType = { published: "success", out_of_stock: "warning", paused: "neutral", draft: "neutral", error: "danger" }[row._status] || "neutral";
      return `<tr>
        <td><span class="movement-product"><strong>${esc(channel.name)}</strong><small>${esc((channel.kind === "marketplace" ? "Marketplace" : channel.kind === "feed" ? "Feed" : "Medição"))}</small></span></td>
        <td>${esc(row._item.title)}</td>
        <td><span class="code">${esc(row._item.sku)}</span></td>
        <td><strong>${Audience.money(row._price)}</strong>${row._item.price !== row._price ? `<br><small>site: ${Audience.money(row._item.price)}</small>` : ""}</td>
        <td>${Audience.number(row._stock)}${row._stock < row._item.stock ? `<br><small>saldo: ${Audience.number(row._item.stock)}</small>` : ""}</td>
        <td>${badge(listingStatusLabel(row._status), statusType)}${previewMode ? ` ${badge("Prévia", "neutral")}` : ""}</td>
        <td>${row._problems.length ? `<span class="status-badge is-warning" title="${esc(row._problems.join(" · "))}">${esc(row._problems[0])}</span>` : `<span class="status-badge is-success">Pronto</span>`}</td>
      </tr>`;
    }).join("") || Audience.emptyMessage("Nenhum item para publicar.", 7);
  }

  function renderConversionMap() {
    const body = $("#conversion-map");
    if (!body || !Channels) return;
    const counts = audienceEventCounts();
    const metaRecord = channelState("meta-ads") || {};
    const ga4Record = channelState("ga4") || {};
    const hint = $("#conversion-hint");
    if (hint) {
      hint.textContent = [metaRecord.enabled ? "Meta CAPI ativo" : "Meta CAPI aguardando segredos",
        ga4Record.enabled ? "GA4 ativo" : "GA4 aguardando segredos"].join(" · ");
    }
    body.innerHTML = Channels.CONVERSION_EVENTS.map((event) => {
      const count = counts[event.site] || 0;
      const sending = metaRecord.enabled || ga4Record.enabled;
      return `<tr>
        <td><span class="movement-product"><strong>${esc(event.label)}</strong><small>${esc(event.site)}</small></span></td>
        <td><code>${esc(event.meta)}</code></td>
        <td><code>${esc(event.ga4)}</code></td>
        <td>${Audience.number(count)}</td>
        <td>${badge(sending ? "Pronto para envio" : "Aguardando conexão", sending ? "success" : "neutral")}</td>
      </tr>`;
    }).join("");
  }

  function renderChannelsNotice() {
    const box = $("#channels-notice");
    if (!box || !Channels) return;
    const enabled = state.channels.filter((channel) => channel.enabled);
    const missingSecrets = enabled.length ? "" : " Cadastre os segredos no Supabase (o arquivo <code>.env.example</code> lista todos) e habilite o canal aqui.";
    box.innerHTML = `<span><svg><use href="#i-megaphone"/></svg></span><p>${enabled.length
      ? `<strong>${Audience.number(enabled.length)} canais habilitados.</strong> Preço e estoque saem do cadastro de estoque; a fila de integração (Edge Function <code>integration-worker</code>) envia, retenta e registra cada lote.`
      : `<strong>Nenhum canal habilitado ainda.</strong> As integrações estão prontas no código: Google Merchant Center, Meta Ads, GA4 e cinco marketplaces.${missingSecrets}`}</p>`;
  }

  function renderChannels() {
    if (!Channels) return;
    fillChannelSelects();
    renderChannelCards();
    renderChannelPolicy();
    renderFeedPreview();
    renderChannelListings();
    renderConversionMap();
    renderChannelsNotice();
  }

  function openChannelModal(id) {
    const channel = channelMeta(id);
    if (!channel) return;
    channelEditingId = id;
    const record = channelState(id) || {};
    const policy = Channels.normalizePolicy(record.policy || channel.policy);
    const config = record.config || {};

    $("#channel-modal-title").textContent = channel.name;
    $("#channel-modal-kicker").textContent = Channels.KIND_LABELS[channel.kind] || "Canal";
    $("#channel-modal-role").textContent = channel.role;
    $("#channel-modal-secrets").innerHTML = channel.secrets.map((secret) => `<li><code>${esc(secret.name)}</code><small>${esc(secret.label)}</small></li>`).join("");
    $("#channel-modal-operations").innerHTML = channel.operations.map((operation) => `<span class="op-chip">${esc(operation)}</span>`).join("");
    const docs = $("#channel-modal-docs");
    if (docs) docs.href = channel.docs || "#";
    $("#channel-modal-config").innerHTML = channel.fields.map((field) => `<label class="form-field"><span>${esc(field.label)}${field.required ? " <b>*</b>" : ""}</span><input data-channel-field="${esc(field.key)}" maxlength="160" value="${esc(config[field.key] || "")}" placeholder="${esc(field.placeholder || "")}"></label>`).join("");
    $("#channel-modal-markup").value = String(policy.markup);
    $("#channel-modal-rounding").value = policy.rounding;
    $("#channel-modal-buffer").value = String(policy.stockBuffer);
    $("#channel-modal-min").value = String(policy.minPrice);
    $("#channel-modal-enabled").checked = Boolean(record.enabled);
    $("#channel-modal-suggestion").textContent = Number(channel.fee)
      ? `Comissão média de ${channel.fee}% → markup que mantém a margem: ${Audience.number(Channels.suggestedMarkup(channel.fee))}%.`
      : "Canal de mídia: use o mesmo preço do site para não divergir do anúncio.";
    $("#channel-foot-note").textContent = record.enabled
      ? "Canal habilitado: a fila de integração processa as operações deste serviço."
      : "Salvar não envia nada: a publicação do catálogo é o passo seguinte.";
    openModal("#channel-modal");
  }

  function collectChannelPayload() {
    const channel = channelMeta(channelEditingId);
    if (!channel) return null;
    const config = {};
    $$("[data-channel-field]").forEach((input) => {
      const value = String(input.value || "").trim();
      if (value) config[input.dataset.channelField] = value;
    });
    const missing = channel.fields.filter((field) => field.required && !config[field.key]);
    return {
      id: channel.id,
      config,
      missing,
      enabled: $("#channel-modal-enabled").checked,
      policy: {
        markup: Number($("#channel-modal-markup").value || 0),
        rounding: $("#channel-modal-rounding").value,
        stockBuffer: Number($("#channel-modal-buffer").value || 0),
        minPrice: Number($("#channel-modal-min").value || 0),
        maxPublished: Number(($("#channel-policy-max") || {}).value || 0),
        publishOnlyAvailable: Boolean(($("#channel-policy-available") || {}).checked),
      },
    };
  }

  async function saveChannel(event) {
    event.preventDefault();
    if (!requirePermission("channels")) return;
    const payload = collectChannelPayload();
    if (!payload) return;
    const note = $("#channel-foot-note");

    if (payload.enabled && payload.missing.length) {
      const message = `Preencha ${payload.missing.map((field) => field.label).join(", ")} antes de habilitar o canal.`;
      if (note) note.textContent = message;
      toast(message, "alert");
      return;
    }

    if (CONFIG.mode === "supabase" && window.C18_SUPABASE) {
      const button = $("#channel-save");
      button.disabled = true;
      const { error } = await window.C18_SUPABASE.rpc("save_sales_channel", { p_payload: payload });
      button.disabled = false;
      if (error) {
        if (note) note.textContent = error.message || "Não foi possível salvar o canal.";
        toast(error.message || "Não foi possível salvar o canal.", "alert");
        return;
      }
      try { await loadSupabaseData(); } catch (_) {}
      renderChannels();
      closeModals();
      toast("Canal salvo. As credenciais continuam apenas no servidor.");
      return;
    }

    const record = channelState(payload.id) || { id: payload.id };
    record.config = payload.config;
    record.policy = payload.policy;
    record.enabled = payload.enabled;
    record.status = payload.enabled ? "connected" : "pending";
    record.environment = payload.enabled ? "Produção" : "A configurar";
    record.lastSync = payload.enabled ? "Pronto para publicar" : "Aguardando credenciais";
    const index = state.channels.findIndex((channel) => channel.id === payload.id);
    if (index >= 0) state.channels[index] = record; else state.channels.push(record);
    saveState();
    renderChannels();
    closeModals();
    toast(payload.enabled ? `${channelMeta(payload.id).name} habilitado.` : `${channelMeta(payload.id).name} salvo (desabilitado).`);
  }

  async function publishChannel(channelId) {
    if (!requirePermission("channels")) return;
    const channel = channelMeta(channelId);
    const record = channelState(channelId);
    if (!channel || !record) return;
    const rows = channelRows(channelId);
    const publishable = rows.filter((row) => row._publish);
    const issues = rows.filter((row) => row._problems.length);

    if (CONFIG.mode === "supabase" && window.C18_SUPABASE) {
      const { data, error } = await window.C18_SUPABASE.rpc("publish_catalog_to_channel", {
        p_channel_id: channelId,
        p_options: { site_url: SITE_URL, policy: record.policy },
      });
      if (error) { toast(error.message || "Não foi possível publicar o catálogo.", "alert"); return; }
      try { await loadSupabaseData(); } catch (_) {}
      renderChannels();
      toast(`Catálogo enviado para ${channel.name}: ${(data && data.published) || publishable.length} itens na fila.`);
      return;
    }

    record.listings = publishable.length;
    record.errors = issues.length;
    record.lastSync = record.enabled ? `Simulado agora (${publishable.length} itens)` : "Prévia gerada (canal desabilitado)";
    record.status = record.enabled ? "syncing" : "pending";
    saveState();
    renderChannels();
    toast(record.enabled
      ? `${channel.name}: ${publishable.length} itens prontos${issues.length ? `, ${issues.length} com pendência` : ""}. No modo demonstração nada é enviado.`
      : `Prévia de ${channel.name}: ${publishable.length} itens. Habilite o canal e cadastre os segredos para publicar.`, issues.length ? "alert" : "check");
  }

  async function publishEnabledChannels() {
    if (!requirePermission("channels")) return;
    const enabled = state.channels.filter((channel) => channel.enabled);
    if (!enabled.length) {
      const channel = channelMeta(feedChannelId);
      toast(`Nenhum canal habilitado — gerando a prévia de ${channel ? channel.name : feedChannelId}.`, "alert");
      await publishChannel(feedChannelId);
      return;
    }
    for (const record of enabled) {
      await publishChannel(record.id);
    }
  }

  /* Envia um evento de teste pela Edge Function marketing-events (Meta CAPI
     e GA4 Measurement Protocol) — só com o Supabase ligado e segredos ok. */
  async function testChannelEvent(channelId) {
    if (!requirePermission("channels")) return;
    const channel = channelMeta(channelId);
    if (!channel) return;
    if (CONFIG.mode !== "supabase" || !window.C18_SUPABASE) {
      toast(`No modo demonstração o evento de teste para ${channel.name} é simulado.`, "alert");
      return;
    }
    try {
      const { data, error } = await window.C18_SUPABASE.functions.invoke("marketing-events", {
        body: { test: true, channel: channelId, event: "PageView" },
      });
      if (error) throw error;
      toast(`${channel.name}: evento de teste enviado (${(data && data.sent) || 0} destino(s)).`);
    } catch (error) {
      toast(error.message || "Não foi possível enviar o evento de teste.", "alert");
    }
  }

  async function saveChannelPolicy(event) {
    event.preventDefault();
    if (!requirePermission("channels")) return;
    const record = channelState(policyChannelId);
    if (!record) return;
    record.policy = Channels.normalizePolicy({
      markup: Number($("#channel-policy-markup").value || 0),
      rounding: $("#channel-policy-rounding").value,
      stockBuffer: Number($("#channel-policy-buffer").value || 0),
      minPrice: Number($("#channel-policy-min").value || 0),
      maxPublished: Number($("#channel-policy-max").value || 0),
      publishOnlyAvailable: $("#channel-policy-available").checked,
    });

    if (CONFIG.mode === "supabase" && window.C18_SUPABASE) {
      const { error } = await window.C18_SUPABASE.rpc("save_sales_channel", {
        p_payload: { id: record.id, config: record.config || {}, enabled: record.enabled, policy: record.policy },
      });
      if (error) { toast(error.message || "Não foi possível aplicar a política.", "alert"); return; }
      try { await loadSupabaseData(); } catch (_) {}
    } else {
      saveState();
    }
    renderChannels();
    toast(`Política aplicada a ${channelMeta(record.id).name}: markup ${Audience.number(record.policy.markup)}%, reserva ${record.policy.stockBuffer} un.`);
  }

  function bindEvents() {
    document.addEventListener("click", (event) => {
      const nav = event.target.closest("[data-nav]");
      if (nav) { navigate(nav.dataset.nav); return; }
      if (event.target.closest("#new-banner")) { if (requirePermission("banners")) openBannerModal(); return; }
      const bannerTab = event.target.closest("[data-banner-source]");
      if (bannerTab) { setBannerSource(bannerTab.dataset.bannerSource); return; }
      const bannerToggle = event.target.closest("[data-banner-toggle]");
      if (bannerToggle) { toggleBannerActive(bannerToggle.dataset.bannerToggle); return; }
      const bannerEdit = event.target.closest("[data-banner-edit]");
      if (bannerEdit) { if (requirePermission("banners")) openBannerModal(bannerEdit.dataset.bannerEdit); return; }
      const bannerDelete = event.target.closest("[data-banner-delete]");
      if (bannerDelete) { deleteBanner(bannerDelete.dataset.bannerDelete); return; }
      if (event.target.closest("#new-coupon")) { if (requirePermission("coupons")) openCouponModal(); return; }
      if (event.target.closest("#customer-search-btn") || event.target.closest("#customers-refresh")) { buscarClientes($("#customer-search")?.value || ""); return; }
      const couponToggle = event.target.closest("[data-coupon-toggle]");
      if (couponToggle) { toggleCouponActive(couponToggle.dataset.couponToggle); return; }
      const couponEdit = event.target.closest("[data-coupon-edit]");
      if (couponEdit) { if (requirePermission("coupons")) openCouponModal(couponEdit.dataset.couponEdit); return; }
      const couponDelete = event.target.closest("[data-coupon-delete]");
      if (couponDelete) { deleteCoupon(couponDelete.dataset.couponDelete); return; }
      const channelConfig = event.target.closest("[data-channel-config]");
      if (channelConfig) { if (requirePermission("channels")) openChannelModal(channelConfig.dataset.channelConfig); return; }
      const channelPublish = event.target.closest("[data-channel-publish]");
      if (channelPublish) { publishChannel(channelPublish.dataset.channelPublish); return; }
      const channelTest = event.target.closest("[data-channel-test]");
      if (channelTest) { testChannelEvent(channelTest.dataset.channelTest); return; }
      if (event.target.closest('[data-action="import"]')) { if (requirePermission("inventory")) { resetImport(); openModal("#import-modal"); } return; }
      if (event.target.closest('[data-action="manual"]')) { if (requirePermission("inventory")) openManual(); return; }
      if (event.target.closest("[data-close-modal]")) { closeModals(); return; }
      if (event.target.closest("[data-close-drawer]")) { closeDrawer(); return; }
      const adjust = event.target.closest("[data-adjust-code]");
      if (adjust) { if (requirePermission("inventory")) openManual(state.inventory.find((item) => item.code === adjust.dataset.adjustCode && item.storeId === adjust.dataset.adjustStore)); return; }
      const orderLink = event.target.closest("[data-order-id]");
      if (orderLink) { openOrder(orderLink.dataset.orderId); return; }
      const orderFilter = event.target.closest("[data-order-filter]");
      if (orderFilter) { currentOrderFilter = orderFilter.dataset.orderFilter; renderOrders(); return; }
      const mode = event.target.closest("[data-selection-mode]");
      if (mode) {
        selectionMode = mode.dataset.selectionMode;
        $$("[data-selection-mode]").forEach((button) => button.classList.toggle("is-active", button === mode));
        $$("[data-selection-pane]").forEach((pane) => pane.classList.toggle("is-active", pane.dataset.selectionPane === selectionMode));
        updateImportPreview(); return;
      }
      const selectAll = event.target.closest("[data-select-all]");
      if (selectAll) {
        const field = selectAll.dataset.selectAll;
        $$(`[data-import-option="${field}"]`).forEach((input) => { input.checked = true; (field === "collection" ? selectedCollections : selectedReferences).add(input.value); });
        updateImportPreview(); return;
      }
      const clearAll = event.target.closest("[data-clear-all]");
      if (clearAll) {
        const field = clearAll.dataset.clearAll; (field === "collection" ? selectedCollections : selectedReferences).clear();
        $$(`[data-import-option="${field}"]`).forEach((input) => { input.checked = false; }); updateImportPreview(); return;
      }
      const orderButton = event.target.closest("[data-order-action]");
      if (orderButton) { orderAction(orderButton.dataset.orderAction); return; }
      const receiptButton = event.target.closest("[data-receipt-id]");
      if (receiptButton) {
        const receipt = state.receipts.find((item) => item.id === receiptButton.dataset.receiptId);
        if (receipt && receipt.status !== "done") {
          if (!requirePermission("inventory")) return;
          if (CONFIG.mode === "supabase") { toast("A conferência detalhada de recebimento requer os itens da nota cadastrados no ambiente de homologação.", "alert"); return; }
          receipt.checked = Math.min(receipt.items, receipt.checked + Math.max(1, Math.ceil(receipt.items / 4))); receipt.status = receipt.checked >= receipt.items ? "done" : "checking"; saveState(); renderReceipts(); toast(receipt.status === "done" ? "Recebimento concluído e saldo liberado." : "Conferência do recebimento atualizada.");
        } else toast("Recebimento conferido sem divergências.");
        return;
      }
      const integrationButton = event.target.closest("[data-config-integration]");
      if (integrationButton) { if (requirePermission("integrations")) toast("As credenciais serão cadastradas no servidor, nunca no navegador.", "alert"); return; }
      const prototypeButton = event.target.closest("[data-prototype]");
      if (prototypeButton) { toast(`${prototypeButton.dataset.prototype} entra na próxima etapa de homologação.`, "alert"); }
    });

    document.addEventListener("change", async (event) => {
      if (event.target.matches("[data-import-option]")) {
        const set = event.target.dataset.importOption === "collection" ? selectedCollections : selectedReferences;
        event.target.checked ? set.add(event.target.value) : set.delete(event.target.value); updateImportPreview();
      }
      if (event.target.matches("[data-check-item]")) {
        if (!requirePermission("check")) { event.target.checked = !event.target.checked; return; }
        const order = state.orders.find((item) => item.id === currentOrderId);
        const item = order?.items[Number(event.target.dataset.checkItem)];
        if (order && item && CONFIG.mode === "supabase") {
          event.target.disabled = true;
          const { error } = await window.C18_SUPABASE.rpc("check_order_item", {
            p_item_id: item.id,
            p_checked: event.target.checked,
          });
          if (error) { toast(error.message || "Não foi possível conferir o item.", "alert"); openOrder(order.id); return; }
          const orderNumber = order.id;
          await loadSupabaseData(); renderAll(); openOrder(orderNumber);
        } else if (order && item) {
          item.checked = event.target.checked; saveState(); openOrder(order.id);
        }
      }
      if (event.target.matches("#inventory-store, #inventory-stock")) renderInventory();
      if (event.target.matches("#import-store")) updateImportPreview();
      if (event.target.matches("#coupon-scope")) updateCouponScopeFields();
      if (event.target.matches("#banner-position")) updateBannerPositionFields();
    });

    $("#inventory-search").addEventListener("input", renderInventory);
    $("#collection-search").addEventListener("input", renderSelectionOptions);
    $("#reference-search").addEventListener("input", () => { renderSelectionOptions(); updateImportPreview(); });
    $("#excel-file").addEventListener("change", (event) => handleFile(event.target.files[0]));
    $("#remove-file").addEventListener("click", resetImport);
    $("#run-import").addEventListener("click", runImport);
    $("#manual-form").addEventListener("submit", saveManual);
    $("#login-form").addEventListener("submit", authenticateEmployee);
    $("#profile-menu").addEventListener("click", signOutEmployee);
    $("#top-avatar").addEventListener("click", signOutEmployee);
    $("#refresh-orders").addEventListener("click", () => { renderOrders(); toast("Fila de pedidos atualizada."); });
    $("#new-receipt").addEventListener("click", () => {
      if (!requirePermission("inventory")) return;
      if (CONFIG.mode === "supabase") { toast("Cadastre a nota e os itens pela API de recebimento antes de iniciar a conferência.", "alert"); return; }
      const id = `REC-${String(Date.now()).slice(-4)}`;
      state.receipts.unshift({ id, invoice: "Nota a informar", supplier: "Novo fornecedor", storeId: stores[0].id, items: 1, checked: 0, status: "pending", receivedAt: "Agora" });
      saveState(); renderReceipts(); toast("Recebimento criado. Abra o cartão para iniciar a conferência.");
    });
    $("#mobile-menu").addEventListener("click", () => { $("#sidebar").classList.add("is-open"); $("#sidebar-overlay").classList.add("is-open"); });
    $("#sidebar-overlay").addEventListener("click", () => { $("#sidebar").classList.remove("is-open"); $("#sidebar-overlay").classList.remove("is-open"); });
    $("[data-dismiss-notice]").addEventListener("click", (event) => event.target.closest(".demo-notice").remove());
    $("#global-search").addEventListener("keydown", (event) => {
      if (event.target.id === "customer-search" && event.key === "Enter") { event.preventDefault(); buscarCustomers(); return; }
      if (event.key === "Enter") { event.preventDefault(); navigate("inventory"); $("#inventory-search").value = event.target.value; renderInventory(); }
    });
    $("#banners-refresh").addEventListener("click", () => { renderBanners(); toast("Banners e paleta atualizados."); });
    $("#coupons-refresh").addEventListener("click", () => { renderCoupons(); toast("Cupons atualizados."); });
    $("#coupon-form").addEventListener("submit", saveCoupon);
    $("#coupon-code").addEventListener("input", (event) => { event.target.value = event.target.value.toUpperCase(); });
    $("#banner-file").addEventListener("change", (event) => { handleBannerFile(event.target.files[0]); event.target.value = ""; });
    const bannerDropzone = $("#banner-dropzone");
    ["dragenter", "dragover"].forEach((name) => bannerDropzone.addEventListener(name, (event) => { event.preventDefault(); bannerDropzone.classList.add("is-dragging"); }));
    ["dragleave", "drop"].forEach((name) => bannerDropzone.addEventListener(name, (event) => { event.preventDefault(); bannerDropzone.classList.remove("is-dragging"); }));
    bannerDropzone.addEventListener("drop", (event) => handleBannerFile(event.dataTransfer.files[0]));
    /* Audiência */
    $("#audience-range").addEventListener("change", (event) => {
      audience.range = Number(event.target.value) || 30;
      audience.sampleKey = "";
      refreshAudience();
    });
    $("#audience-heat-path").addEventListener("change", (event) => {
      audience.path = event.target.value || "/";
      audience.report = null;
      if (CONFIG.mode === "supabase") refreshAudience(); else renderAudience();
    });
    $("#audience-refresh").addEventListener("click", () => { refreshAudience(); toast("Audiência atualizada."); });
    $("#audience-sample").addEventListener("click", toggleAudienceSample);
    $("#audience-export").addEventListener("click", exportAudienceCsv);

    /* Canais & Marketing */
    $("#channels-refresh").addEventListener("click", () => { renderChannels(); toast("Canais e feed atualizados."); });
    $("#channels-publish").addEventListener("click", publishEnabledChannels);
    $("#channel-policy-channel").addEventListener("change", (event) => { policyChannelId = event.target.value; renderChannelPolicy(); });
    $("#channel-policy-form").addEventListener("submit", saveChannelPolicy);
    $("#channel-form").addEventListener("submit", saveChannel);
    $("#feed-channel").addEventListener("change", (event) => {
      feedChannelId = event.target.value;
      renderFeedPreview();
      renderChannelListings();
    });
    $("#feed-download").addEventListener("click", downloadFeed);

    $("#banner-ai-generate").addEventListener("click", runBannerAiGenerate);
    $("#banner-form").addEventListener("submit", saveBanner);
    $("#palette-form").addEventListener("submit", savePalette);
    $("#palette-reset").addEventListener("click", resetPalette);
    $$("[data-palette-key]").forEach((input) => input.addEventListener("input", () => applyPalettePreview(collectPaletteColors())));
    document.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); $("#global-search").focus(); }
      if (event.key === "Escape") { closeModals(); closeDrawer(); }
    });

    const dropzone = $("#dropzone");
    ["dragenter", "dragover"].forEach((name) => dropzone.addEventListener(name, (event) => { event.preventDefault(); dropzone.classList.add("is-dragging"); }));
    ["dragleave", "drop"].forEach((name) => dropzone.addEventListener(name, (event) => { event.preventDefault(); dropzone.classList.remove("is-dragging"); }));
    dropzone.addEventListener("drop", (event) => handleFile(event.dataTransfer.files[0]));
  }

  fillStoreSelects();
  $("#today-label").textContent = `HOJE, ${new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "long",
    timeZone: "America/Sao_Paulo",
  }).format(new Date()).toUpperCase()}`;
  bindEvents();
  if (CONFIG.mode === "demo") syncDemoCoupons();
  renderAll();
  navigate("overview");
  initSupabaseAuth();
})();
