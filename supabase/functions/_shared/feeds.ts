/* ==========================================================================
   CENSURA 18 — montagem de feeds no servidor
   --------------------------------------------------------------------------
   Porta TypeScript de admin/assets/channels.js: as MESMAS colunas, a mesma
   política de preço/estoque e as mesmas mensagens de pendência. O painel usa
   o arquivo JS para a prévia e o download; as Edge Functions usam este para
   publicar de verdade (o navegador nunca decide preço de marketplace).

   tests/channels.test.js executa os dois lados e compara coluna por coluna,
   preço por preço — se alguém mudar um, o teste aponta a divergência.

   Este módulo é puro (sem fetch, sem Supabase) de propósito: dá para importar
   no Deno e no Node.
   ========================================================================== */

export type Rounding = "psychological" | "cent" | "none";

export type Policy = {
  markup: number;
  rounding: Rounding;
  stockBuffer: number;
  maxPublished: number;
  minPrice: number;
  publishOnlyAvailable: boolean;
};

export type CatalogItem = {
  id: string;
  sku: string;
  title: string;
  description?: string;
  brand?: string;
  category?: string;
  collection?: string;
  price: number;
  stock: number;
  colors?: string[];
  sizes?: string[];
  condition?: string;
  link?: string;
  image_link?: string;
  gtin?: string;
  mpn?: string;
};

export type FeedRow = Record<string, string | number>;

export const DEFAULT_POLICY: Policy = {
  markup: 0,
  rounding: "psychological",
  stockBuffer: 1,
  maxPublished: 0,
  minPrice: 0,
  publishOnlyAvailable: true,
};

/* Comissão em % → markup em % que devolve o mesmo valor líquido. */
export function suggestedMarkup(feePercent: number): number {
  const fee = Math.min(80, Math.max(0, Number(feePercent) || 0)) / 100;
  if (!fee) return 0;
  return Math.round((fee / (1 - fee)) * 1000) / 10;
}

/* número informado (inclusive zero) × campo ausente */
function hasValue(value: unknown): boolean {
  return value !== "" && value !== null && value !== undefined && Number.isFinite(Number(value));
}

export function normalizePolicy(policy?: Partial<Policy> | null): Policy {
  const source = policy || ({} as Partial<Policy>);
  return {
    markup: Number.isFinite(Number(source.markup)) ? Number(source.markup) : DEFAULT_POLICY.markup,
    rounding: (["psychological", "cent", "none"] as string[]).includes(String(source.rounding))
      ? (source.rounding as Rounding)
      : DEFAULT_POLICY.rounding,
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

export function roundPrice(value: number, mode: Rounding): number {
  const price = Number(value) || 0;
  if (price <= 0) return 0;
  if (mode === "none") return Math.round(price * 100) / 100;
  if (mode === "cent") return Math.round(price * 100) / 100;
  /* preço psicológico: 149,86 → 149,90 · 150,20 → 149,90 */
  return Math.max(0.9, Math.round((Math.round(price) - 0.1) * 100) / 100);
}

export function priceForChannel(
  price: number,
  _channel?: { policy?: Partial<Policy> } | null,
  policy?: Partial<Policy> | null,
): number {
  const rules = normalizePolicy(policy || (_channel && _channel.policy));
  const gross = (Number(price) || 0) * (1 + (Number(rules.markup) || 0) / 100);
  const rounded = roundPrice(gross, rules.rounding);
  return Math.max(rules.minPrice ? roundPrice(rules.minPrice, rules.rounding) : 0, rounded);
}

export function stockForChannel(
  stock: number,
  _channel?: { policy?: Partial<Policy> } | null,
  policy?: Partial<Policy> | null,
): number {
  const rules = normalizePolicy(policy || (_channel && _channel.policy));
  let available = Math.floor(Number(stock) || 0) - rules.stockBuffer;
  if (available < 0) available = 0;
  if (rules.maxPublished > 0) available = Math.min(available, rules.maxPublished);
  return available;
}

export function availability(stock: number): "in stock" | "out of stock" {
  return Number(stock) > 0 ? "in stock" : "out of stock";
}

export function listingStatus(input: {
  price?: number;
  stock?: number;
  paused?: boolean;
  error?: boolean;
}): "error" | "paused" | "draft" | "published" | "out_of_stock" {
  const data = input || {};
  if (data.error) return "error";
  if (data.paused) return "paused";
  if (!Number(data.price) || Number(data.price) <= 0) return "draft";
  return Number(data.stock) > 0 ? "published" : "out_of_stock";
}

export function slugify(value: string): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/* Agrupa linhas de estoque (SKU por loja) em itens de catálogo. */
export function catalogFromInventory(
  inventory: Record<string, unknown>[],
  options?: { siteUrl?: string; storeId?: string },
): (CatalogItem & { link: string; image_link: string; availability: string })[] {
  const opts = options || {};
  const siteUrl = String(opts.siteUrl || "").replace(/\/$/, "");
  /* Estoque publicado: com storeId, só o saldo dessa loja conta (o estoque
     central "Ecommerce C18"); os itens continuam listados mesmo sem saldo
     nela. Sem storeId soma todas as lojas. */
  const storeId = String(opts.storeId || "").trim();
  const groups = new Map<string, CatalogItem & { skus: string[] }>();

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
    const item = groups.get(key)!;
    const quantity = Math.max(0, Number(row.quantity || 0) - Number(row.reserved || 0));
    const rowStore = String(row.storeId || row.store_id || "").trim();
    if (!storeId || rowStore === storeId) item.stock += quantity;
    item.price = item.price || Number(row.price) || 0;
    item.skus!.push(String(row.code || reference));
    const color = row.color ? String(row.color) : "";
    const size = row.size ? String(row.size) : "";
    if (color && !item.colors!.includes(color)) item.colors!.push(color);
    if (size && !item.sizes!.includes(size)) item.sizes!.push(size);
  });

  return Array.from(groups.values()).map((item) => ({
    ...item,
    link: `${siteUrl || ""}/produto.html?ref=${encodeURIComponent(item.sku)}`,
    image_link: `${siteUrl || ""}/assets/img/logos/logo-quadro.png`,
    availability: availability(item.stock),
  }));
}

/* Formatos de preço exigidos por cada especificação. */
export function formatPrice(value: number, style?: string): string {
  const price = (Math.round((Number(value) || 0) * 100) / 100).toFixed(2);
  if (style === "google") return `${price} BRL`;
  if (style === "meta") return `${price} BRL`;
  return price;
}

export function feedColumns(channelId: string): string[] {
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

export const GOOGLE_CATEGORY = "Apparel & Accessories > Clothing";
export const ML_CATEGORY_ID = "MLB1430";
export const SHOPEE_CATEGORY_ID = "100629";
export const SHOPEE_WEIGHT_KG = "0.4";
export const FREE_SHIPPING_FROM = 299;

/* Monta a linha do feed de um canal a partir do item e da política. */
export function buildFeedRow(
  item: CatalogItem,
  channelId: string,
  policy?: Partial<Policy> | null,
  channel?: { policy?: Partial<Policy> } | null,
): FeedRow {
  const rules = normalizePolicy(policy || (channel && channel.policy));
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
        google_product_category: GOOGLE_CATEGORY,
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
        google_product_category: GOOGLE_CATEGORY,
        item_group_id: base.sku,
        sale_price: "",
        visibility: "published",
      };
    case "mercadolivre":
      return {
        title: base.title,
        category_id: ML_CATEGORY_ID,
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
        shipping: JSON.stringify({ mode: "me2", free_shipping: price >= FREE_SHIPPING_FROM }),
      };
    case "shopee":
      return {
        item_name: base.title.slice(0, 120),
        item_sku: base.sku,
        original_price: formatPrice(price * 1.15, "plain"),
        current_price: formatPrice(price, "plain"),
        stock,
        condition: "new",
        category_id: SHOPEE_CATEGORY_ID,
        weight: SHOPEE_WEIGHT_KG,
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
      return { ...base };
  }
}

/* Pendências que impedem a publicação (as mesmas mensagens do painel). */
export function validateFeedRow(row: FeedRow, channelId: string): string[] {
  const problems: string[] = [];
  const value = (key: string) => String(row[key] ?? "").trim();
  if (!value("title") && !value("item-name") && !value("item_name")) problems.push("Título vazio");
  const title = value("title") || value("item-name") || value("item_name");
  if (title.length > 150) problems.push("Título acima de 150 caracteres");
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
  const stockValue = row.stock ?? row.available_quantity ?? row.quantity ?? 0;
  const stock = Number(stockValue);
  if (!(stock >= 0)) problems.push("Estoque inválido");
  return problems;
}

export function toDelimited(rows: FeedRow[], channelId: string, delimiter: string): string {
  const columns = feedColumns(channelId);
  const escape = (value: unknown) => {
    const text = String(value ?? "");
    return delimiter === "," && /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text.replace(/[\t\n]/g, " ");
  };
  const lines = [columns.join(delimiter)];
  (rows || []).forEach((row) => lines.push(columns.map((column) => escape(row[column])).join(delimiter)));
  return lines.join("\n");
}

export function toCsv(rows: FeedRow[], channelId: string): string {
  return toDelimited(rows, channelId, ",");
}

export function toTsv(rows: FeedRow[], channelId: string): string {
  return toDelimited(rows, channelId, "\t");
}

/* Feed XML do Google Merchant (RSS 2.0) — é o que a função
   google-merchant-feed publica na URL de coleta primária. */
export function toGoogleXml(rows: FeedRow[], options?: { title?: string; link?: string }): string {
  const opts = options || {};
  const escape = (value: unknown) => String(value ?? "")
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

/* Formato declarado por canal (igual a CHANNELS[].feedFormat do painel). */
export function feedFormat(channelId: string): "xml" | "csv" | "tsv" | "json" {
  switch (channelId) {
    case "google-merchant":
      return "xml";
    case "meta-ads":
    case "google-ads":
      return "csv";
    case "amazon":
      return "tsv";
    default:
      return "json";
  }
}

export function renderFeed(rows: FeedRow[], channelId: string, options?: { title?: string; link?: string }): string {
  const format = feedFormat(channelId);
  if (format === "xml") return toGoogleXml(rows, options);
  if (format === "tsv") return toTsv(rows, channelId);
  if (format === "json") return JSON.stringify(rows, null, 2);
  return toCsv(rows, channelId);
}

/* Eventos do site (assets/js/analytics.js) → Meta CAPI e GA4.
   Mesmo mapa exibido no painel (Channels.CONVERSION_EVENTS). */
export const CONVERSION_EVENTS = [
  { site: "page_view", meta: "PageView", ga4: "page_view", ads: "", label: "Página vista" },
  { site: "product_view", meta: "ViewContent", ga4: "view_item", ads: "", label: "Produto visualizado" },
  { site: "category_view", meta: "ViewCategory", ga4: "view_item_list", ads: "", label: "Categoria visualizada" },
  { site: "search", meta: "Search", ga4: "search", ads: "", label: "Busca no site" },
  { site: "add_to_cart", meta: "AddToCart", ga4: "add_to_cart", ads: "", label: "Adicionou ao carrinho" },
  { site: "checkout_intent", meta: "InitiateCheckout", ga4: "begin_checkout", ads: "", label: "Iniciou a finalização" },
  { site: "whatsapp", meta: "Contact", ga4: "generate_lead", ads: "whatsapp", label: "Chamou no WhatsApp" },
  { site: "purchase", meta: "Purchase", ga4: "purchase", ads: "purchase", label: "Fechou o pedido (Pix/cartão)" },
];

export function conversionEvent(siteKind: string) {
  return CONVERSION_EVENTS.find((event) => event.site === siteKind) || CONVERSION_EVENTS[0];
}

/* ---------------------------------------------------- Google Ads (conversões) */

/* Porta de Channels.googleAdsConversionRows / toGoogleAdsCsv: as conversões
   do site (compra e, se cadastrada, WhatsApp) voltam ao Google Ads pelo id
   do clique guardado na sessão (gclid/gbraid/wbraid). */
export const GOOGLE_ADS_COLUMNS = ["Google Click ID", "Conversion Name", "Conversion Time", "Conversion Value", "Conversion Currency", "Order ID"];
export const GOOGLE_ADS_DEFAULTS = { conversionName: "Compra no site", whatsappName: "", currency: "BRL", timeZone: "-03:00" };

export type GoogleAdsOptions = Partial<typeof GOOGLE_ADS_DEFAULTS>;

export type GoogleAdsSourceEvent = {
  id?: number | string | null;
  kind: string;
  occurred_at: string | number;
  value?: number | string | null;
  category?: string | null;
  order_id?: string | null;
  utm?: Record<string, unknown> | null;
  gclid?: string | null;
  gbraid?: string | null;
  wbraid?: string | null;
};

export type GoogleAdsRow = {
  "Google Click ID": string;
  "Conversion Name": string;
  "Conversion Time": string;
  "Conversion Value": string;
  "Conversion Currency": string;
  "Order ID": string;
  gbraid: string;
  wbraid: string;
  kind: string;
  event_id: number | string | null;
};

/* "2026-09-19 14:03:00-03:00" — horário de Brasília (deslocamento fixo). */
export function googleAdsTime(value: string | number, timeZone?: string): string {
  const at = typeof value === "number" ? value : Date.parse(String(value || ""));
  if (!Number.isFinite(at)) return "";
  const offset = /^[+-]\d{2}:\d{2}$/.test(String(timeZone || "")) ? String(timeZone) : GOOGLE_ADS_DEFAULTS.timeZone;
  const sign = offset.startsWith("-") ? -1 : 1;
  const minutes = sign * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6)));
  return `${new Date(at + minutes * 60000).toISOString().slice(0, 19).replace("T", " ")}${offset}`;
}

export function googleAdsConversionRows(events: GoogleAdsSourceEvent[], options?: GoogleAdsOptions | null): GoogleAdsRow[] {
  const opts = Object.assign({}, GOOGLE_ADS_DEFAULTS, options || {});
  const names: Record<string, string> = {
    purchase: opts.conversionName || GOOGLE_ADS_DEFAULTS.conversionName,
    whatsapp: opts.whatsappName || "",
  };
  const rows: GoogleAdsRow[] = [];
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
      event_id: event.id !== undefined ? (event.id as number | string | null) : null,
    });
  });
  return rows;
}

export function toGoogleAdsCsv(rows: GoogleAdsRow[]): string {
  const escape = (value: unknown) => {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [GOOGLE_ADS_COLUMNS.join(",")];
  (rows || []).filter((row) => row["Google Click ID"]).forEach((row) => {
    lines.push(GOOGLE_ADS_COLUMNS.map((column) => escape((row as Record<string, unknown>)[column])).join(","));
  });
  return lines.join("\n");
}
