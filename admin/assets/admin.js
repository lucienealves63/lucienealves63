(function () {
  "use strict";

  const CONFIG = window.C18_CONFIG || { mode: "demo", lowStockThreshold: 3 };
  const Importer = window.C18Importer;
  const STORE_KEY = "c18-operations-demo-v2";

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
      payment: "approved", fraud: "approved", status: "picking",
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

  function freshState() {
    return {
      inventory: seedInventory,
      orders: seedOrders,
      movements: seedMovements,
      receipts: seedReceipts,
      integrations: seedIntegrations,
      importBatches: [],
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
  }

  function navigate(page) {
    currentPage = page;
    $$("[data-page]").forEach((item) => item.classList.toggle("is-active", item.dataset.page === page));
    $$(".side-nav__item[data-nav]").forEach((item) => item.classList.toggle("is-active", item.dataset.nav === page));
    const label = { overview: "Visão geral", inventory: "Estoque", orders: "Pedidos", receipts: "Recebimento", shipping: "Expedição", integrations: "Integrações" }[page];
    $("#page-title").textContent = label || "Operações";
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
    $("#order-detail").innerHTML = `<div class="order-summary"><div><span>Cliente</span><strong>${esc(order.customer)}</strong></div><div><span>Loja</span><strong>${esc(storeById(order.storeId).short)}</strong></div><div><span>Total</span><strong>${currency(order.total)}</strong></div><div><span>Pagamento</span><strong>${paymentBadge(order.payment)}</strong></div><div><span>Antifraude</span><strong>${fraudBadge(order.fraud)}</strong></div><div><span>Operação</span><strong>${operationBadge(order.status)}</strong></div></div><section class="order-section"><div class="order-section__head"><h3>Itens e conferência</h3><span>${order.items.filter((item) => item.checked).length}/${order.items.length} conferidos</span></div>${order.items.map((item, index) => `<label class="order-item"><span class="order-item-check"><input type="checkbox" data-check-item="${index}" ${item.checked ? "checked" : ""} ${order.status !== "checking" || !can("check") ? "disabled" : ""}></span><div><strong>${esc(item.name)}</strong><small>${esc(item.code)} · ${esc(item.color)} · ${esc(item.size)}</small></div><b>${item.qty}x</b></label>`).join("")}</section>${order.status === "ready" ? `<section class="order-section"><div class="order-section__head"><h3>Dados da expedição</h3></div><div class="shipping-form"><label class="form-field"><span>Transportadora</span><select id="drawer-carrier"><option>Correios</option><option>Loggi</option><option>Retirada na loja</option><option>Transportadora</option></select></label><label class="form-field"><span>Código de rastreio</span><input id="drawer-tracking" placeholder="Ex.: QR123456789BR"></label></div></section>` : ""}<section class="order-section"><div class="order-section__head"><h3>Histórico</h3></div><ul class="timeline-mini">${order.events.map((event) => `<li><strong>${esc(event.title)}</strong><small>${esc(event.at)}</small></li>`).join("")}</ul></section>`;
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
    const [storeResult, inventoryResult, orderResult, receiptResult, integrationResult, movementResult] = await Promise.all([
      client.from("stores").select("id, code, name").eq("active", true).order("name"),
      fetchAllRows("inventory_catalog_view", "*", "product_name"),
      client.from("orders").select("*, order_items(*), order_events(*), shipments(*)").order("created_at", { ascending: false }).limit(500),
      client.from("receipts").select("*").order("created_at", { ascending: false }).limit(500),
      client.from("integration_connections").select("*").order("id"),
      client.from("inventory_movements").select("id, store_id, kind, quantity_delta, note, created_at, product_variants(sku, products(name))").order("created_at", { ascending: false }).limit(100),
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

    if (!integrationResult.error) {
      const integrationMeta = {
        alterdata: ["Alterdata Moda", "ALT", "ERP e estoque mestre"],
        rede: ["e.Rede", "REDE", "Pagamentos"],
        clearsale: ["ClearSale", "CS", "Antifraude"],
      };
      state.integrations = (integrationResult.data || []).map((item) => ({
        id: item.id,
        name: integrationMeta[item.id]?.[0] || item.id,
        initials: integrationMeta[item.id]?.[1] || item.id.slice(0, 3).toUpperCase(),
        role: integrationMeta[item.id]?.[2] || "Integração",
        status: item.status,
        environment: item.environment,
        lastSync: item.last_success_at ? new Date(item.last_success_at).toLocaleString("pt-BR") : "Aguardando sincronização",
        queue: Number(item.metadata?.queue || 0),
      }));
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

  function bindEvents() {
    document.addEventListener("click", (event) => {
      const nav = event.target.closest("[data-nav]");
      if (nav) { navigate(nav.dataset.nav); return; }
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
      if (event.key === "Enter") { event.preventDefault(); navigate("inventory"); $("#inventory-search").value = event.target.value; renderInventory(); }
    });
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
  renderAll();
  navigate("overview");
  initSupabaseAuth();
})();
