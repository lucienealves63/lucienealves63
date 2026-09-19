/* ==========================================================================
   CENSURA 18 — canais de venda e marketing
   --------------------------------------------------------------------------
   Definições e regras usadas pelo painel (admin/ → Canais & Marketing) e
   pelas Edge Functions de sincronização. Aqui não existe segredo nenhum:
   cada canal declara quais Supabase Secrets precisa (o valor fica só no
   servidor) e quais identificadores públicos podem ser cadastrados no
   painel (merchant id, pixel id, seller id…).

   Canais prontos:
     • Google Merchant Center — feed de produtos (Shopping, anúncios)
     • Meta Ads              — catálogo + Conversions API (Pixel)
     • GA4                   — Measurement Protocol (audiência e conversões)
     • Google Ads            — conversões do site devolvidas ao anúncio
                               (gclid → upload de conversões / CSV)
     • Mercado Livre, Shopee, Amazon, Magazine Luiza e Americanas —
       os marketplaces mais usados no varejo de moda brasileiro

   A regra de preço é o coração do módulo: cada marketplace cobra comissão
   diferente, então o painel calcula o markup que mantém a margem da loja
   (fee → suggestedMarkup) e arredonda para o preço psicológico .90.
   ========================================================================== */
(function (global) {
  "use strict";

  const KINDS = { FEED: "feed", MARKETPLACE: "marketplace", MEASUREMENT: "measurement" };

  const KIND_LABELS = {
    feed: "Feed de produtos",
    marketplace: "Marketplace",
    measurement: "Medição",
  };

  const STATUS_LABELS = {
    pending: "Aguardando credenciais",
    connected: "Conectado",
    syncing: "Sincronizando",
    paused: "Pausado",
    error: "Com erro",
    off: "Desligado",
  };

  const LISTING_STATUS_LABELS = {
    draft: "Rascunho",
    published: "Publicado",
    out_of_stock: "Sem estoque",
    paused: "Pausado",
    error: "Com erro",
  };

  /* Política de preço/estoque padrão: sem markup, arredondamento .90,
     reserva de 1 unidade (evita vender a última peça em dois canais). */
  const DEFAULT_POLICY = {
    markup: 0,
    rounding: "psychological",
    stockBuffer: 1,
    maxPublished: 0,
    minPrice: 0,
    publishOnlyAvailable: true,
  };

  const CHANNELS = [
    {
      id: "google-merchant",
      name: "Google Merchant Center",
      initials: "GMC",
      kind: KINDS.FEED,
      role: "Feed de produtos para Google Shopping e anúncios",
      fee: 0,
      docs: "https://support.google.com/merchants/",
      secrets: [
        { name: "GOOGLE_MERCHANT_ID", label: "Merchant ID (número da conta)" },
        { name: "GOOGLE_MERCHANT_SERVICE_ACCOUNT_JSON", label: "Conta de serviço (JSON) com acesso à conta" },
      ],
      fields: [
        { key: "merchant_id", label: "Merchant ID", placeholder: "123456789", required: true },
        { key: "country", label: "País", placeholder: "BR", required: true },
        { key: "language", label: "Idioma", placeholder: "pt-BR" },
        { key: "currency", label: "Moeda", placeholder: "BRL" },
        { key: "feed_label", label: "Rótulo do feed", placeholder: "BR" },
        { key: "google_category", label: "Categoria Google padrão", placeholder: "Apparel & Accessories > Clothing" },
      ],
      operations: ["feed.push", "product.upsert", "product.delete", "account.status"],
      feedFormat: "xml",
      policy: { ...DEFAULT_POLICY },
    },
    {
      id: "meta-ads",
      name: "Meta Ads",
      initials: "META",
      kind: KINDS.FEED,
      role: "Catálogo no Commerce Manager + Conversions API (Pixel)",
      fee: 0,
      docs: "https://developers.facebook.com/docs/marketing-api/conversions-api",
      secrets: [
        { name: "META_PIXEL_ID", label: "ID do Pixel" },
        { name: "META_CAPI_ACCESS_TOKEN", label: "Token de acesso da Conversions API" },
        { name: "META_AD_ACCOUNT_ID", label: "Conta de anúncios (act_…)" },
        { name: "META_CATALOG_ID", label: "ID do catálogo no Commerce Manager" },
      ],
      fields: [
        { key: "pixel_id", label: "Pixel ID", placeholder: "123456789012345", required: true },
        { key: "ad_account_id", label: "Conta de anúncios", placeholder: "act_123456789012345" },
        { key: "catalog_id", label: "Catálogo", placeholder: "987654321098765" },
        { key: "test_event_code", label: "Código de evento de teste", placeholder: "TEST12345" },
        { key: "verified_domain", label: "Domínio verificado", placeholder: "censura18.com.br" },
      ],
      operations: ["catalog.push", "event.conversion", "catalog.status"],
      feedFormat: "csv",
      policy: { ...DEFAULT_POLICY },
    },
    {
      id: "ga4",
      name: "Google Analytics 4",
      initials: "GA4",
      kind: KINDS.MEASUREMENT,
      role: "Measurement Protocol: audiência e conversões do site",
      fee: 0,
      docs: "https://developers.google.com/analytics/devguides/collection/protocol/ga4",
      secrets: [
        { name: "GA4_MEASUREMENT_ID", label: "ID de medição (G-XXXX)" },
        { name: "GA4_API_SECRET", label: "API secret do Measurement Protocol" },
      ],
      fields: [
        { key: "measurement_id", label: "ID de medição", placeholder: "G-C18STORE01", required: true },
        { key: "reporting_view", label: "Propriedade (para relatórios)", placeholder: "123456789" },
      ],
      operations: ["event.push", "audience.pull"],
      feedFormat: "json",
      policy: { ...DEFAULT_POLICY },
    },
    {
      id: "google-ads",
      name: "Google Ads",
      initials: "GADS",
      kind: KINDS.MEASUREMENT,
      role: "Conversões do site de volta ao anúncio (gclid) — API ou CSV de upload",
      fee: 0,
      docs: "https://developers.google.com/google-ads/api/docs/conversions/upload-clicks",
      secrets: [
        { name: "GOOGLE_ADS_DEVELOPER_TOKEN", label: "Developer token da API (Centro de API do MCC)" },
        { name: "GOOGLE_ADS_CLIENT_ID", label: "OAuth client ID (Google Cloud)" },
        { name: "GOOGLE_ADS_CLIENT_SECRET", label: "OAuth client secret" },
        { name: "GOOGLE_ADS_REFRESH_TOKEN", label: "Refresh token da conta que anuncia" },
      ],
      fields: [
        { key: "customer_id", label: "ID do cliente (só números)", placeholder: "1234567890", required: true },
        { key: "conversion_name", label: "Nome da ação de conversão (compra)", placeholder: "Compra no site", required: true },
        { key: "conversion_action_id", label: "ID da ação de conversão (upload pela API)", placeholder: "987654321" },
        { key: "whatsapp_conversion_name", label: "Ação de conversão do WhatsApp (opcional)", placeholder: "Pedido pelo WhatsApp" },
        { key: "login_customer_id", label: "Conta de administrador (MCC)", placeholder: "0987654321" },
      ],
      operations: ["conversion.upload", "conversion.export", "conversion.status"],
      feedFormat: "csv",
      policy: { ...DEFAULT_POLICY },
    },
    {
      id: "mercadolivre",
      name: "Mercado Livre",
      initials: "ML",
      kind: KINDS.MARKETPLACE,
      role: "Anúncios, preço, estoque e pedidos (API oficial)",
      fee: 14,
      docs: "https://developers.mercadolivre.com.br/pt_br",
      secrets: [
        { name: "MERCADOLIVRE_CLIENT_ID", label: "App ID" },
        { name: "MERCADOLIVRE_CLIENT_SECRET", label: "Secret Key" },
        { name: "MERCADOLIVRE_REFRESH_TOKEN", label: "Refresh token do seller" },
      ],
      fields: [
        { key: "seller_id", label: "ID do vendedor", placeholder: "123456789", required: true },
        { key: "site_id", label: "Site", placeholder: "MLB", required: true },
        { key: "shipping_mode", label: "Envio", placeholder: "me2 (Mercado Envios)" },
      ],
      operations: ["catalog.push", "price.update", "stock.update", "order.pull", "order.push"],
      feedFormat: "json",
      policy: { ...DEFAULT_POLICY, markup: 16 },
    },
    {
      id: "shopee",
      name: "Shopee",
      initials: "SHP",
      kind: KINDS.MARKETPLACE,
      role: "Open Platform: produtos, preço, estoque e pedidos",
      fee: 14,
      docs: "https://open.shopee.com/documents",
      secrets: [
        { name: "SHOPEE_PARTNER_ID", label: "Partner ID" },
        { name: "SHOPEE_PARTNER_KEY", label: "Partner Key (assinatura HMAC)" },
      ],
      fields: [
        { key: "shop_id", label: "Shop ID", placeholder: "BR18C18", required: true },
        { key: "partner_id", label: "Partner ID", placeholder: "2000123456" },
        { key: "main_category_id", label: "Categoria principal", placeholder: "100629" },
      ],
      operations: ["catalog.push", "price.update", "stock.update", "order.pull"],
      feedFormat: "json",
      policy: { ...DEFAULT_POLICY, markup: 16 },
    },
    {
      id: "amazon",
      name: "Amazon",
      initials: "AMZ",
      kind: KINDS.MARKETPLACE,
      role: "Selling Partner API (SP-API): listings, preço e pedidos",
      fee: 15,
      docs: "https://developer-docs.amazon.com/sp-api/",
      secrets: [
        { name: "AMAZON_SP_API_REFRESH_TOKEN", label: "Refresh token (LWA)" },
        { name: "AMAZON_SP_API_CLIENT_ID", label: "Client ID da aplicação" },
        { name: "AMAZON_SP_API_CLIENT_SECRET", label: "Client secret da aplicação" },
        { name: "AMAZON_SP_API_AWS_ACCESS_KEY", label: "AWS access key (IAM)" },
        { name: "AMAZON_SP_API_AWS_SECRET_KEY", label: "AWS secret key (IAM)" },
      ],
      fields: [
        { key: "seller_id", label: "Seller ID", placeholder: "A1B2C3D4E5F6G7", required: true },
        { key: "marketplace_id", label: "Marketplace", placeholder: "A1AM78C64UM0Y8 (Brasil)", required: true },
        { key: "sku_prefix", label: "Prefixo de SKU", placeholder: "C18-" },
      ],
      operations: ["catalog.push", "price.update", "stock.update", "order.pull"],
      feedFormat: "tsv",
      policy: { ...DEFAULT_POLICY, markup: 18 },
    },
    {
      id: "magalu",
      name: "Magazine Luiza",
      initials: "MGLU",
      kind: KINDS.MARKETPLACE,
      role: "Parceiro Magalu: catálogo, preço, estoque e pedidos",
      fee: 12,
      docs: "https://developer.magazineluiza.com/",
      secrets: [
        { name: "MAGALU_API_TOKEN", label: "Token da API do Parceiro Magalu" },
        { name: "MAGALU_API_BASE_URL", label: "URL base (homologação/produção)" },
      ],
      fields: [
        { key: "seller_id", label: "Código do parceiro", placeholder: "censura18", required: true },
        { key: "category_tree", label: "Árvore de categorias", placeholder: "moda" },
      ],
      operations: ["catalog.push", "price.update", "stock.update", "order.pull"],
      feedFormat: "json",
      policy: { ...DEFAULT_POLICY, markup: 14 },
    },
    {
      id: "americanas",
      name: "Americanas Marketplace",
      initials: "AMER",
      kind: KINDS.MARKETPLACE,
      role: "API B2W/Americanas: produtos, preço, estoque e pedidos",
      fee: 16,
      docs: "https://developers.americanas.io/",
      secrets: [
        { name: "AMERICANAS_CLIENT_ID", label: "Client ID" },
        { name: "AMERICANAS_CLIENT_SECRET", label: "Client secret" },
        { name: "AMERICANAS_API_KEY", label: "Chave de API do seller" },
      ],
      fields: [
        { key: "seller_id", label: "ID do seller", placeholder: "1234", required: true },
        { key: "category_id", label: "Categoria padrão", placeholder: "moda-e-acessorios" },
      ],
      operations: ["catalog.push", "price.update", "stock.update", "order.pull"],
      feedFormat: "json",
      policy: { ...DEFAULT_POLICY, markup: 19 },
    },
  ];

  /* Eventos do site (assets/js/analytics.js) → Meta Conversions API, GA4 e
     Google Ads. É o mapa usado pelas Edge Functions marketing-events e
     google-ads-conversions e exibido no painel. "ads" é a ação de conversão
     do Google Ads (só as saídas que fecham venda voltam ao anúncio). */
  const CONVERSION_EVENTS = [
    { site: "page_view", meta: "PageView", ga4: "page_view", ads: "", label: "Página vista" },
    { site: "product_view", meta: "ViewContent", ga4: "view_item", ads: "", label: "Produto visualizado" },
    { site: "category_view", meta: "ViewCategory", ga4: "view_item_list", ads: "", label: "Categoria visualizada" },
    { site: "search", meta: "Search", ga4: "search", ads: "", label: "Busca no site" },
    { site: "add_to_cart", meta: "AddToCart", ga4: "add_to_cart", ads: "", label: "Adicionou ao carrinho" },
    { site: "checkout_intent", meta: "InitiateCheckout", ga4: "begin_checkout", ads: "", label: "Iniciou a finalização" },
    { site: "whatsapp", meta: "Contact", ga4: "generate_lead", ads: "whatsapp", label: "Chamou no WhatsApp" },
    { site: "purchase", meta: "Purchase", ga4: "purchase", ads: "purchase", label: "Fechou o pedido (Pix/cartão)" },
  ];

  /* ------------------------------------------------ Google Ads (conversões) */

  /* Colunas do modelo "Conversões de cliques" do Google Ads (Objetivos →
     Conversões → Uploads). O mesmo arquivo serve para o upload manual e
     para a API (uploadClickConversions). */
  const GOOGLE_ADS_COLUMNS = ["Google Click ID", "Conversion Name", "Conversion Time", "Conversion Value", "Conversion Currency", "Order ID"];
  const GOOGLE_ADS_DEFAULTS = { conversionName: "Compra no site", whatsappName: "", currency: "BRL", timeZone: "-03:00" };

  /* "2026-09-19 14:03:00-03:00" — horário de Brasília (sem horário de verão
     desde 2019, então o deslocamento é fixo). */
  function googleAdsTime(value, timeZone) {
    const at = typeof value === "number" ? value : Date.parse(String(value || ""));
    if (!Number.isFinite(at)) return "";
    const offset = /^[+-]\d{2}:\d{2}$/.test(String(timeZone || "")) ? String(timeZone) : GOOGLE_ADS_DEFAULTS.timeZone;
    const sign = offset.startsWith("-") ? -1 : 1;
    const minutes = sign * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6)));
    return `${new Date(at + minutes * 60000).toISOString().slice(0, 19).replace("T", " ")}${offset}`;
  }

  /* Eventos do site com id de clique → linhas de conversão. Entram a compra
     (purchase) e, quando a loja cadastra a ação, o WhatsApp. Sem gclid,
     gbraid ou wbraid o Google não tem a que anúncio atribuir — a linha
     não sai. */
  function googleAdsConversionRows(events, options) {
    const opts = Object.assign({}, GOOGLE_ADS_DEFAULTS, options || {});
    const names = { purchase: opts.conversionName || GOOGLE_ADS_DEFAULTS.conversionName, whatsapp: opts.whatsappName || "" };
    const rows = [];
    (events || []).forEach((event) => {
      const name = names[event && event.kind];
      if (!name) return;
      const utm = (event && event.utm) || {};
      const clickId = String(utm.gclid || event.gclid || "").trim();
      const gbraid = String(utm.gbraid || event.gbraid || "").trim();
      const wbraid = String(utm.wbraid || event.wbraid || "").trim();
      if (!clickId && !gbraid && !wbraid) return;
      const time = googleAdsTime(event.occurred_at, opts.timeZone);
      if (!time) return;
      const value = Math.round((Number(event.value) || 0) * 100) / 100;
      rows.push({
        "Google Click ID": clickId,
        "Conversion Name": name,
        "Conversion Time": time,
        "Conversion Value": value > 0 ? value.toFixed(2) : "",
        "Conversion Currency": value > 0 ? String(opts.currency || "BRL") : "",
        "Order ID": String(event.order_id || (event.kind === "purchase" ? event.category : "") || "").trim().slice(0, 64),
        gbraid,
        wbraid,
        kind: String(event.kind),
        event_id: event.id !== undefined ? event.id : null,
      });
    });
    return rows;
  }

  /* Arquivo CSV no formato aceito pelo Google Ads. Linhas sem gclid, mas
     com gbraid/wbraid (iOS), ficam de fora do CSV — só a API as aceita. */
  function toGoogleAdsCsv(rows) {
    const escape = (value) => {
      const text = String(value ?? "");
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const lines = [GOOGLE_ADS_COLUMNS.join(",")];
    (rows || []).filter((row) => row["Google Click ID"]).forEach((row) => {
      lines.push(GOOGLE_ADS_COLUMNS.map((column) => escape(row[column])).join(","));
    });
    return lines.join("\n");
  }

  /* ------------------------------------------------------------- consultas */

  function channelById(id) {
    return CHANNELS.find((channel) => channel.id === id) || null;
  }

  function marketplaces() {
    return CHANNELS.filter((channel) => channel.kind === KINDS.MARKETPLACE);
  }

  function adChannels() {
    return CHANNELS.filter((channel) => channel.kind !== KINDS.MARKETPLACE);
  }

  /* número informado (inclusive zero) × campo ausente */
  function hasValue(value) {
    return value !== "" && value !== null && value !== undefined && Number.isFinite(Number(value));
  }

  function normalizePolicy(policy) {
    const source = policy || {};
    return {
      markup: Number.isFinite(Number(source.markup)) ? Number(source.markup) : DEFAULT_POLICY.markup,
      rounding: ["psychological", "cent", "none"].includes(source.rounding) ? source.rounding : DEFAULT_POLICY.rounding,
      /* 0 é um valor válido ("publica o saldo inteiro"); só vazio/inválido
         volta para o padrão — antes o zero era engolido pelo || */
      stockBuffer: hasValue(source.stockBuffer)
        ? Math.max(0, Math.floor(Number(source.stockBuffer)))
        : DEFAULT_POLICY.stockBuffer,
      maxPublished: Math.max(0, Math.floor(Number(source.maxPublished) || 0)),
      minPrice: Math.max(0, Number(source.minPrice) || 0),
      publishOnlyAvailable: source.publishOnlyAvailable !== false,
    };
  }

  /* Comissão em % → markup em % que devolve o mesmo valor líquido.
     Ex.: comissão de 15% exige markup de ~17,6% para empatar. */
  function suggestedMarkup(feePercent) {
    const fee = Math.min(80, Math.max(0, Number(feePercent) || 0)) / 100;
    if (!fee) return 0;
    return Math.round((fee / (1 - fee)) * 1000) / 10;
  }

  function roundPrice(value, mode) {
    const price = Number(value) || 0;
    if (price <= 0) return 0;
    if (mode === "none") return Math.round(price * 100) / 100;
    if (mode === "cent") return Math.round(price * 100) / 100;
    /* preço psicológico: 149,86 → 149,90 · 150,20 → 149,90 */
    return Math.max(0.9, Math.round((Math.round(price) - 0.1) * 100) / 100);
  }

  function priceForChannel(price, channel, policy) {
    const rules = normalizePolicy(policy || (channel && channel.policy));
    const gross = (Number(price) || 0) * (1 + (Number(rules.markup) || 0) / 100);
    const rounded = roundPrice(gross, rules.rounding);
    return Math.max(rules.minPrice ? roundPrice(rules.minPrice, rules.rounding) : 0, rounded);
  }

  function stockForChannel(stock, channel, policy) {
    const rules = normalizePolicy(policy || (channel && channel.policy));
    let available = Math.floor(Number(stock) || 0) - rules.stockBuffer;
    if (available < 0) available = 0;
    if (rules.maxPublished > 0) available = Math.min(available, rules.maxPublished);
    return available;
  }

  function availability(stock) {
    return Number(stock) > 0 ? "in stock" : "out of stock";
  }

  function listingStatus(input) {
    const data = input || {};
    if (data.error) return "error";
    if (data.paused) return "paused";
    if (!Number(data.price) || Number(data.price) <= 0) return "draft";
    return Number(data.stock) > 0 ? "published" : "out_of_stock";
  }

  /* ------------------------------------------------------------ catálogo */

  function slugify(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
  }

  /* Agrupa as linhas de estoque (SKU por loja) em itens de catálogo: é o
     que os feeds publicam — um produto com variações, saldo somado e
     preço de varejo. Segue o mesmo raciocínio do site (referência +
     marca + coleção + categoria vindos da planilha Alterdata). */
  function catalogFromInventory(inventory, options) {
    const opts = options || {};
    const siteUrl = String(opts.siteUrl || "").replace(/\/$/, "");
    /* Estoque publicado: com storeId, só o saldo dessa loja conta (o estoque
       central "Ecommerce C18"); os itens continuam listados mesmo sem saldo
       nela. Sem storeId soma todas as lojas. */
    const storeId = String(opts.storeId || "").trim();
    const groups = new Map();

    (Array.isArray(inventory) ? inventory : []).forEach((row) => {
      const reference = String(row.reference || row.code || "").trim();
      const description = String(row.description || "").trim();
      if (!reference || !description) return;
      const key = `${reference}|${description}|${row.brand || ""}`;
      if (!groups.has(key)) {
        groups.set(key, {
          id: slugify(`${reference}-${description}`) || slugify(reference),
          sku: reference,
          title: description,
          description: [description, row.category, row.collection].filter(Boolean).join(" · "),
          brand: String(row.brand || "CENSURA 18"),
          category: String(row.category || ""),
          collection: String(row.collection || ""),
          price: Number(row.price) || 0,
          stock: 0,
          colors: [],
          sizes: [],
          skus: [],
          condition: "new",
        });
      }
      const item = groups.get(key);
      const quantity = Math.max(0, Number(row.quantity || 0) - Number(row.reserved || 0));
      const rowStore = String(row.storeId || row.store_id || "").trim();
      if (!storeId || rowStore === storeId) item.stock += quantity;
      item.price = item.price || Number(row.price) || 0;
      item.skus.push(String(row.code || reference));
      if (row.color && !item.colors.includes(row.color)) item.colors.push(row.color);
      if (row.size && !item.sizes.includes(row.size)) item.sizes.push(row.size);
    });

    return Array.from(groups.values()).map((item) => {
      const url = `${siteUrl || ""}/produto.html?ref=${encodeURIComponent(item.sku)}`;
      return {
        ...item,
        link: url,
        image_link: item.image_url || `${siteUrl || ""}/assets/img/logos/logo-quadro.png`,
        availability: availability(item.stock),
      };
    });
  }

  /* Formatos de preço exigidos por cada especificação. */
  function formatPrice(value, style) {
    const price = (Math.round((Number(value) || 0) * 100) / 100).toFixed(2);
    if (style === "google") return `${price} BRL`;
    if (style === "meta") return `${price} BRL`;
    if (style === "plain") return price;
    return price;
  }

  /* ------------------------------------------------------------- feeds */

  function feedColumns(channelId) {
    switch (channelId) {
      case "google-merchant":
        return ["id", "title", "description", "link", "image_link", "availability", "price", "brand",
          "condition", "item_group_id", "google_product_category", "identifier_exists",
          "custom_label_0", "custom_label_1", "custom_label_2"];
      case "meta-ads":
        return ["id", "title", "description", "availability", "condition", "price", "link",
          "image_link", "brand", "google_product_category", "item_group_id", "sale_price", "visibility"];
      case "ga4":
        return ["event_name", "client_id", "timestamp_micros", "items", "value", "currency"];
      case "google-ads":
        return GOOGLE_ADS_COLUMNS.slice();
      case "mercadolivre":
        return ["title", "category_id", "price", "currency_id", "available_quantity", "condition",
          "description", "picture_source", "attributes", "shipping"];
      case "shopee":
        return ["item_name", "item_sku", "original_price", "current_price", "stock", "condition",
          "category_id", "weight", "description", "image_id_list"];
      case "amazon":
        return ["sku", "product-id", "item-name", "brand", "price", "quantity", "product-description",
          "main-image-url", "condition-type", "update-delete"];
      case "magalu":
        return ["sku", "title", "price", "stock", "ean", "brand", "category", "image", "description"];
      case "americanas":
        return ["sku", "title", "price", "stock", "ean", "brand", "category", "image", "description"];
      default:
        return ["sku", "title", "price", "stock"];
    }
  }

  /* Monta a linha do feed de um canal a partir do item de catálogo e da
     política de preço/estoque escolhida no painel. */
  function buildFeedRow(item, channelId, policy) {
    const channel = channelById(channelId) || {};
    const rules = normalizePolicy(policy || channel.policy);
    const price = priceForChannel(item.price, channel, rules);
    const stock = stockForChannel(item.stock, channel, rules);
    const base = {
      id: item.id,
      sku: item.sku,
      title: String(item.title || "").slice(0, 150),
      description: String(item.description || item.title || "").slice(0, 500),
      link: item.link || "",
      image_link: item.image_link || "",
      brand: item.brand || "CENSURA 18",
      condition: item.condition || "new",
      category: item.category || "",
      collection: item.collection || "",
      price,
      stock,
      availability: availability(stock),
    };

    switch (channelId) {
      case "google-merchant":
        return {
          id: base.id,
          title: base.title,
          description: base.description,
          link: base.link,
          image_link: base.image_link,
          availability: base.availability,
          price: formatPrice(price, "google"),
          brand: base.brand,
          condition: base.condition,
          item_group_id: base.sku,
          google_product_category: "Apparel & Accessories > Clothing",
          identifier_exists: item.gtin || item.mpn ? "TRUE" : "FALSE",
          custom_label_0: base.collection,
          custom_label_1: base.category,
          custom_label_2: stock > 0 ? "disponivel" : "esgotado",
        };
      case "meta-ads":
        return {
          id: base.id,
          title: base.title,
          description: base.description,
          availability: base.availability === "in stock" ? "in stock" : "out of stock",
          condition: base.condition,
          price: formatPrice(price, "meta"),
          link: base.link,
          image_link: base.image_link,
          brand: base.brand,
          google_product_category: "Apparel & Accessories > Clothing",
          item_group_id: base.sku,
          sale_price: "",
          visibility: "published",
        };
      case "mercadolivre":
        return {
          title: base.title,
          category_id: "MLB1430",
          price: formatPrice(price, "plain"),
          currency_id: "BRL",
          available_quantity: stock,
          condition: "new",
          description: base.description,
          picture_source: base.image_link,
          attributes: JSON.stringify([
            { id: "BRAND", value_name: base.brand },
            { id: "MODEL", value_name: base.sku },
            { id: "COLOR", value_name: (item.colors || []).join(", ") },
            { id: "SIZE", value_name: (item.sizes || []).join(", ") },
          ]),
          shipping: JSON.stringify({ mode: "me2", free_shipping: price >= 299 }),
        };
      case "shopee":
        return {
          item_name: base.title.slice(0, 120),
          item_sku: base.sku,
          original_price: formatPrice(price * 1.15, "plain"),
          current_price: formatPrice(price, "plain"),
          stock,
          condition: "new",
          category_id: "100629",
          weight: "0.4",
          description: base.description,
          image_id_list: base.image_link,
        };
      case "amazon":
        return {
          sku: `${base.sku}`,
          "product-id": item.gtin || "",
          "item-name": base.title.slice(0, 200),
          brand: base.brand,
          price: formatPrice(price, "plain"),
          quantity: stock,
          "product-description": base.description,
          "main-image-url": base.image_link,
          "condition-type": "New",
          "update-delete": "Update",
        };
      case "magalu":
      case "americanas":
        return {
          sku: base.sku,
          title: base.title,
          price: formatPrice(price, "plain"),
          stock,
          ean: item.gtin || "",
          brand: base.brand,
          category: base.category,
          image: base.image_link,
          description: base.description,
        };
      default:
        return base;
    }
  }

  /* Pendências que impedem a publicação (o painel mostra e o servidor
     revalida antes de enviar). */
  function validateFeedRow(row, channelId) {
    const problems = [];
    const value = (key) => String(row[key] ?? "").trim();
    if (!value("title") && !value("item-name") && !value("item_name")) problems.push("Título vazio");
    const title = value("title") || value("item-name") || value("item_name");
    if (title.length > 150) problems.push("Título acima de 150 caracteres");
    /* só os feeds que publicam link (Google e Meta) exigem a página */
    if (["google-merchant", "meta-ads"].includes(channelId) && !value("link")) {
      problems.push("Sem link do produto");
    }
    const image = value("image_link") || value("picture_source") || value("image")
      || value("main-image-url") || value("image_id_list");
    if (!image) problems.push("Sem imagem");
    else if (!/^https?:\/\//i.test(image)) problems.push("Imagem precisa de URL pública (https)");
    const price = Number(String(value("price") || value("current_price") || "0").replace(" BRL", "").replace(",", "."));
    if (!price || price <= 0) problems.push("Preço inválido");
    if (["amazon", "magalu", "americanas"].includes(channelId) && !value("ean") && !value("product-id")) {
      problems.push("Sem EAN/GTIN (obrigatório neste marketplace)");
    }
    const stock = Number(value("stock") ?? value("available_quantity") ?? value("quantity") ?? 0);
    if (!(stock >= 0)) problems.push("Estoque inválido");
    return problems;
  }

  /* Exportações usadas pela prévia do painel e pelos testes. */
  function toDelimited(rows, channelId, delimiter) {
    const columns = feedColumns(channelId);
    const escape = (value) => {
      const text = String(value ?? "");
      return delimiter === "," && /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text.replace(/[\t\n]/g, " ");
    };
    const lines = [columns.join(delimiter)];
    (rows || []).forEach((row) => lines.push(columns.map((column) => escape(row[column])).join(delimiter)));
    return lines.join("\n");
  }

  function toCsv(rows, channelId) {
    return toDelimited(rows, channelId, ",");
  }

  function toTsv(rows, channelId) {
    return toDelimited(rows, channelId, "\t");
  }

  /* Feed XML do Google Merchant (RSS 2.0 / Content API) — mesmo formato
     gerado pela Edge Function google-merchant-feed. */
  function toGoogleXml(rows, options) {
    const opts = options || {};
    const escape = (value) => String(value ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
    const title = opts.title || "Censura 18 — feed de produtos";
    const link = opts.link || "https://censura18.com.br";
    const items = (rows || []).map((row) => `    <item>
      <g:id>${escape(row.id)}</g:id>
      <title>${escape(row.title)}</title>
      <description>${escape(row.description)}</description>
      <link>${escape(row.link)}</link>
      <g:image_link>${escape(row.image_link)}</g:image_link>
      <g:availability>${escape(row.availability)}</g:availability>
      <g:price>${escape(row.price)}</g:price>
      <g:brand>${escape(row.brand)}</g:brand>
      <g:condition>${escape(row.condition)}</g:condition>
      <g:item_group_id>${escape(row.item_group_id)}</g:item_group_id>
      <g:google_product_category>${escape(row.google_product_category)}</g:google_product_category>
      <g:identifier_exists>${escape(row.identifier_exists)}</g:identifier_exists>
      <g:custom_label_0>${escape(row.custom_label_0)}</g:custom_label_0>
      <g:custom_label_1>${escape(row.custom_label_1)}</g:custom_label_1>
      <g:custom_label_2>${escape(row.custom_label_2)}</g:custom_label_2>
    </item>`).join("\n");
    return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>${escape(title)}</title>
    <link>${escape(link)}</link>
    <description>Feed de produtos da Censura 18 para o Google Merchant Center</description>
${items}
  </channel>
</rss>
`;
  }

  global.C18Channels = {
    CHANNELS,
    CONVERSION_EVENTS,
    DEFAULT_POLICY,
    GOOGLE_ADS_COLUMNS,
    GOOGLE_ADS_DEFAULTS,
    KINDS,
    KIND_LABELS,
    LISTING_STATUS_LABELS,
    STATUS_LABELS,
    adChannels,
    availability,
    buildFeedRow,
    catalogFromInventory,
    channelById,
    feedColumns,
    formatPrice,
    googleAdsConversionRows,
    googleAdsTime,
    listingStatus,
    marketplaces,
    normalizePolicy,
    priceForChannel,
    roundPrice,
    slugify,
    stockForChannel,
    suggestedMarkup,
    toCsv,
    toGoogleAdsCsv,
    toGoogleXml,
    toTsv,
    validateFeedRow,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = global.C18Channels;
  }
})(typeof window !== "undefined" ? window : globalThis);
