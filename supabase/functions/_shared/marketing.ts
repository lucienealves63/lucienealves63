/* ==========================================================================
   CENSURA 18 — clientes dos canais de venda e marketing
   --------------------------------------------------------------------------
   Cada cliente fala a API oficial do provedor usando SOMENTE segredos do
   ambiente da Edge Function (Supabase Secrets). Nada de credencial no
   navegador, no banco ou nos logs.

   Canais:
     • Google Merchant Center — Content API v2.1 (OAuth2 com conta de serviço)
     • Meta Ads              — Conversions API (Pixel) + Commerce Manager
     • GA4                   — Measurement Protocol
     • Mercado Livre         — OAuth2 (refresh token) + Items API
     • Shopee                — Open Platform v2 (assinatura HMAC-SHA256)
     • Amazon                — SP-API (LWA + AWS SigV4)
     • Magazine Luiza        — API do Parceiro (token)
     • Americanas            — API B2W (client credentials)

   Onde o contrato depende de homologação (Magalu, Americanas, Alterdata),
   a URL base vem do ambiente — igual ao padrão de _shared/alterdata.ts.
   ========================================================================== */

import { requestJson, requiredEnv } from "./http.ts";

const encoder = new TextEncoder();

function base64Url(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlText(value: string): string {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(key: string, message: string, hash: "SHA-256" = "SHA-256"): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function sha256Hex(value: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

/* Normalização exigida pela Conversions API antes do hash. */
export function normalizeUserData(value: string, kind: "email" | "phone" = "email"): string {
  const text = String(value || "").trim().toLowerCase();
  if (kind === "phone") return text.replace(/[^0-9]/g, "");
  return text;
}

type CachedToken = { value: string; expiresAt: number };
const tokenCache = new Map<string, CachedToken>();

function cached(key: string): string | null {
  const entry = tokenCache.get(key);
  if (entry && entry.expiresAt > Date.now() + 60_000) return entry.value;
  return null;
}

function remember(key: string, value: string, expiresIn: number): string {
  tokenCache.set(key, { value, expiresAt: Date.now() + Math.max(60, expiresIn) * 1_000 });
  return value;
}

/* ---------------------------------------------------------------- Google */

type ServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

function serviceAccount(): ServiceAccount {
  const raw = requiredEnv("GOOGLE_MERCHANT_SERVICE_ACCOUNT_JSON");
  const parsed = JSON.parse(raw) as ServiceAccount;
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error("JSON da conta de serviço Google incompleto (client_email/private_key)");
  }
  return parsed;
}

/* Assina o JWT (RS256) com WebCrypto e troca por access token. */
export async function googleAccessToken(scope = "https://www.googleapis.com/auth/content"): Promise<string> {
  const cacheKey = `google:${scope}`;
  const hit = cached(cacheKey);
  if (hit) return hit;

  const account = serviceAccount();
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlText(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64UrlText(JSON.stringify({
    iss: account.client_email,
    scope,
    aud: account.token_uri || "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const signingInput = `${header}.${claims}`;

  const pem = account.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\\n/g, "")
    .replace(/\s+/g, "");
  const binary = atob(pem);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);

  const key = await crypto.subtle.importKey(
    "pkcs8",
    bytes.buffer as ArrayBuffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(signingInput));

  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: `${signingInput}.${base64Url(signature)}`,
  });
  const token = await requestJson<{ access_token: string; expires_in: number }>(
    account.token_uri || "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    },
  );
  return remember(cacheKey, token.access_token, token.expires_in || 3600);
}

export const googleMerchantClient = {
  /* Inserção/upsert de produto (Content API v2.1). */
  async upsertProduct(product: Record<string, unknown>) {
    const merchantId = requiredEnv("GOOGLE_MERCHANT_ID");
    const token = await googleAccessToken();
    return requestJson<Record<string, unknown>>(
      `https://shoppingcontent.googleapis.com/content/v2.1/${encodeURIComponent(merchantId)}/products`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(product),
      },
    );
  },

  async deleteProduct(offerId: string) {
    const merchantId = requiredEnv("GOOGLE_MERCHANT_ID");
    const token = await googleAccessToken();
    return requestJson<Record<string, unknown>>(
      `https://shoppingcontent.googleapis.com/content/v2.1/${encodeURIComponent(merchantId)}/products/${encodeURIComponent(offerId)}?feedLabel=BR&channel=online`,
      { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
    );
  },

  /* Status da conta: serve de "teste de conexão" no painel. */
  async accountStatus() {
    const merchantId = requiredEnv("GOOGLE_MERCHANT_ID");
    const token = await googleAccessToken();
    return requestJson<Record<string, unknown>>(
      `https://shoppingcontent.googleapis.com/content/v2.1/${encodeURIComponent(merchantId)}/productstatuses?feedLabel=BR`,
      { method: "GET", headers: { Authorization: `Bearer ${token}` } },
    );
  },
};

/* ------------------------------------------------------------------ Meta */

export const metaClient = {
  async sendEvents(events: Record<string, unknown>[], options?: { testEventCode?: string }) {
    const pixelId = requiredEnv("META_PIXEL_ID");
    const accessToken = requiredEnv("META_CAPI_ACCESS_TOKEN");
    const version = Deno.env.get("META_GRAPH_VERSION") || "v19.0";
    const payload: Record<string, unknown> = { data: events };
    const testCode = options?.testEventCode || Deno.env.get("META_TEST_EVENT_CODE");
    if (testCode) payload.test_event_code = testCode;
    return requestJson<Record<string, unknown>>(
      `https://graph.facebook.com/${version}/${encodeURIComponent(pixelId)}/events?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
  },

  /* Upsert em lote no catálogo (Graph API items_batch). O feed CSV na URL do
     Commerce Manager continua sendo o caminho mais simples; este existe para
     publicar na hora quando o painel pede a sincronização imediata. */
  async batchUpsertItems(items: Record<string, unknown>[]) {
    const catalogId = requiredEnv("META_CATALOG_ID");
    const accessToken = requiredEnv("META_CAPI_ACCESS_TOKEN");
    const version = Deno.env.get("META_GRAPH_VERSION") || "v19.0";
    return requestJson<Record<string, unknown>>(
      `https://graph.facebook.com/${version}/${encodeURIComponent(catalogId)}/items_batch?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item_type: "PRODUCT_ITEM",
          requests: items.map((data) => ({ method: "UPDATE", data })),
        }),
      },
    );
  },

  /* O catálogo também pode ser alimentado pelo feed (CSV na URL do Commerce
     Manager); aqui só consultamos o status para o painel mostrar a saúde. */
  async catalogStatus() {
    const catalogId = requiredEnv("META_CATALOG_ID");
    const accessToken = requiredEnv("META_CAPI_ACCESS_TOKEN");
    const version = Deno.env.get("META_GRAPH_VERSION") || "v19.0";
    return requestJson<Record<string, unknown>>(
      `https://graph.facebook.com/${version}/${encodeURIComponent(catalogId)}?fields=id,name,product_count,feed_count&access_token=${encodeURIComponent(accessToken)}`,
      { method: "GET" },
    );
  },
};

/* ------------------------------------------------------------------- GA4 */

export const ga4Client = {
  async collect(clientId: string, events: Record<string, unknown>[], userId?: string) {
    const measurementId = requiredEnv("GA4_MEASUREMENT_ID");
    const apiSecret = requiredEnv("GA4_API_SECRET");
    const body: Record<string, unknown> = {
      client_id: clientId,
      timestamp_micros: String(Date.now() * 1000),
      events,
    };
    if (userId) body.user_id = userId;
    return requestJson<Record<string, unknown> | null>(
      `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
  },
};

/* --------------------------------------------------------- Mercado Livre */

async function mercadoLivreToken(): Promise<string> {
  const hit = cached("mercadolivre");
  if (hit) return hit;
  const token = await requestJson<{ access_token: string; expires_in: number }>(
    "https://api.mercadolibre.com/oauth/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: requiredEnv("MERCADOLIVRE_CLIENT_ID"),
        client_secret: requiredEnv("MERCADOLIVRE_CLIENT_SECRET"),
        refresh_token: requiredEnv("MERCADOLIVRE_REFRESH_TOKEN"),
      }).toString(),
    },
  );
  return remember("mercadolivre", token.access_token, token.expires_in || 21600);
}

async function mercadoLivreRequest<T>(path: string, init: RequestInit): Promise<T> {
  const token = await mercadoLivreToken();
  return requestJson<T>(`https://api.mercadolibre.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers || {}),
    },
  });
}

export const mercadoLivreClient = {
  createItem(item: Record<string, unknown>) {
    return mercadoLivreRequest<Record<string, unknown>>("/items", {
      method: "POST",
      body: JSON.stringify(item),
    });
  },
  updatePrice(itemId: string, price: number) {
    return mercadoLivreRequest<Record<string, unknown>>(
      `/items/${encodeURIComponent(itemId)}?make_call=price`,
      { method: "PUT", body: JSON.stringify({ price }) },
    );
  },
  updateStock(itemId: string, quantity: number) {
    return mercadoLivreRequest<Record<string, unknown>>(
      `/items/${encodeURIComponent(itemId)}?make_call=available_quantity`,
      { method: "PUT", body: JSON.stringify({ available_quantity: quantity }) },
    );
  },
  /* Pedidos do marketplace entram como pedidos do painel (origin = canal). */
  searchOrders(sellerId: string, offset = 0) {
    return mercadoLivreRequest<Record<string, unknown>>(
      `/orders/search?seller=${encodeURIComponent(sellerId)}&sort=order.date_desc&offset=${offset}&limit=50`,
      { method: "GET" },
    );
  },
};

/* --------------------------------------------------------------- Shopee */

function shopeeBase(): string {
  return (Deno.env.get("SHOPEE_BASE_URL") || "https://partner.shopeemobile.com").replace(/\/$/, "");
}

/* A Open Platform assina: partner_id|path|timestamp (HMAC-SHA256, minúsculo). */
async function shopeeSignedUrl(path: string, query: Record<string, string | number> = {}): Promise<string> {
  const partnerId = requiredEnv("SHOPEE_PARTNER_ID");
  const partnerKey = requiredEnv("SHOPEE_PARTNER_KEY");
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = toHex(await hmac(partnerKey, `${partnerId}|${path}|${timestamp}`));
  const url = new URL(`${shopeeBase()}${path}`);
  url.searchParams.set("partner_id", partnerId);
  url.searchParams.set("timestamp", String(timestamp));
  url.searchParams.set("sign", signature);
  url.searchParams.set("shop_id", requiredEnv("SHOPEE_SHOP_ID"));
  Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  return url.toString();
}

export const shopeeClient = {
  async addItem(item: Record<string, unknown>) {
    const url = await shopeeSignedUrl("/api/v2/product/add_item");
    return requestJson<Record<string, unknown>>(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(item),
    });
  },
  async updatePrice(items: { item_id: number; model_list?: unknown[]; original_price?: number; current_price: number }[]) {
    const url = await shopeeSignedUrl("/api/v2/product/update_price");
    return requestJson<Record<string, unknown>>(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
  },
  async updateStock(items: { item_id: number; stock: number; model_list?: unknown[] }[]) {
    const url = await shopeeSignedUrl("/api/v2/product/update_stock");
    return requestJson<Record<string, unknown>>(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
  },
  async getOrders(timeFrom: number, timeTo: number) {
    const url = await shopeeSignedUrl("/api/v2/order/get_order_list", {
      time_range_field: "create_time",
      time_from: timeFrom,
      time_to: timeTo,
      page_size: 50,
    });
    return requestJson<Record<string, unknown>>(url, { method: "GET" });
  },
};

/* --------------------------------------------------------------- Amazon */

async function amazonAccessToken(): Promise<string> {
  const hit = cached("amazon");
  if (hit) return hit;
  const token = await requestJson<{ access_token: string; expires_in: number; refresh_token?: string }>(
    "https://api.amazon.com/auth/o2/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: requiredEnv("AMAZON_SP_API_REFRESH_TOKEN"),
        client_id: requiredEnv("AMAZON_SP_API_CLIENT_ID"),
        client_secret: requiredEnv("AMAZON_SP_API_CLIENT_SECRET"),
      }).toString(),
    },
  );
  return remember("amazon", token.access_token, token.expires_in || 3600);
}

/* AWS Signature V4 (SP-API exige assinatura IAM além do token LWA). */
async function signAwsRequest(
  method: string,
  url: string,
  body: string,
  service: string,
  region: string,
): Promise<HeadersInit> {
  const accessKey = requiredEnv("AMAZON_SP_API_AWS_ACCESS_KEY");
  const secretKey = requiredEnv("AMAZON_SP_API_AWS_SECRET_KEY");
  const target = new URL(url);
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = await sha256Hex(body);

  const headers: Record<string, string> = {
    host: target.host,
    "x-amz-date": amzDate,
    "x-amz-content-sha256": payloadHash,
  };
  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name]}\n`).join("");
  const canonicalRequest = [
    method,
    target.pathname,
    target.searchParams.toString(),
    canonicalHeaders,
    signedHeaderNames.join(";"),
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  let signingKey = await hmac(`AWS4${secretKey}`, dateStamp);
  signingKey = await hmac(new TextDecoder().decode(signingKey), region);
  signingKey = await hmac(new TextDecoder().decode(signingKey), service);
  signingKey = await hmac(new TextDecoder().decode(signingKey), "aws4_request");
  const signature = toHex(await hmac(new TextDecoder().decode(signingKey), stringToSign));

  return {
    host: target.host,
    "x-amz-date": amzDate,
    "x-amz-content-sha256": payloadHash,
    Authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaderNames.join(";")}, Signature=${signature}`,
  };
}

async function amazonRequest<T>(method: string, path: string, body: unknown = null): Promise<T> {
  const region = Deno.env.get("AMAZON_SP_API_REGION") || "us-east-1";
  const endpoint = (Deno.env.get("AMAZON_SP_API_ENDPOINT") || "https://sellingpartnerapi-na.amazon.com").replace(/\/$/, "");
  const url = `${endpoint}${path}`;
  const payload = body === null ? "" : JSON.stringify(body);
  const token = await amazonAccessToken();
  const signed = await signAwsRequest(method, url, payload, "execute-api", region);
  return requestJson<T>(url, {
    method,
    headers: {
      ...signed,
      "content-type": "application/json",
      "x-amz-access-token": token,
    },
    body: payload || undefined,
  });
}

export const amazonClient = {
  /* Listings API: um PUT por SKU com preço, estoque e atributos. */
  putListing(sellerId: string, sku: string, listing: Record<string, unknown>) {
    const marketplaceId = requiredEnv("AMAZON_MARKETPLACE_ID");
    return amazonRequest<Record<string, unknown>>(
      "PUT",
      `/listings/2021-08-01/items/${encodeURIComponent(sellerId)}/${encodeURIComponent(sku)}?marketplaceIds=${encodeURIComponent(marketplaceId)}`,
      listing,
    );
  },
  patchPrice(sellerId: string, sku: string, price: number, currency = "BRL") {
    const marketplaceId = requiredEnv("AMAZON_MARKETPLACE_ID");
    return amazonRequest<Record<string, unknown>>(
      "PATCH",
      `/listings/2021-08-01/items/${encodeURIComponent(sellerId)}/${encodeURIComponent(sku)}?marketplaceIds=${encodeURIComponent(marketplaceId)}`,
      [{ op: "replace", path: "/attributes/purchasable_offer", value: [{ currency, our_price: [{ value: price, unit: currency }] }] }],
    );
  },
  getOrders(createdAfter: string) {
    const marketplaceId = requiredEnv("AMAZON_MARKETPLACE_ID");
    return amazonRequest<Record<string, unknown>>(
      "GET",
      `/orders/v0/orders?MarketplaceIds=${encodeURIComponent(marketplaceId)}&CreatedAfter=${encodeURIComponent(createdAfter)}`,
    );
  },
};

/* ------------------------------------------------------- Magazine Luiza */

function magaluBase(): string {
  return requiredEnv("MAGALU_API_BASE_URL").replace(/\/$/, "");
}

export const magaluClient = {
  upsertProduct(product: Record<string, unknown>) {
    return requestJson<Record<string, unknown>>(`${magaluBase()}/products`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${requiredEnv("MAGALU_API_TOKEN")}`,
      },
      body: JSON.stringify(product),
    });
  },
  updateStock(sku: string, stock: number) {
    return requestJson<Record<string, unknown>>(
      `${magaluBase()}/products/${encodeURIComponent(sku)}/stock`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${requiredEnv("MAGALU_API_TOKEN")}`,
        },
        body: JSON.stringify({ quantity: stock }),
      },
    );
  },
  getOrders(offset = 0) {
    return requestJson<Record<string, unknown>>(`${magaluBase()}/orders?offset=${offset}&limit=50`, {
      method: "GET",
      headers: { Authorization: `Bearer ${requiredEnv("MAGALU_API_TOKEN")}`, Accept: "application/json" },
    });
  },
};

/* ------------------------------------------------------- Americanas/B2W */

async function americanasToken(): Promise<string> {
  const hit = cached("americanas");
  if (hit) return hit;
  const clientId = requiredEnv("AMERICANAS_CLIENT_ID");
  const clientSecret = requiredEnv("AMERICANAS_CLIENT_SECRET");
  const base = (Deno.env.get("AMERICANAS_API_BASE_URL") || "https://api-parceiros.americanas.io").replace(/\/$/, "");
  const token = await requestJson<{ access_token: string; expires_in?: number }>(`${base}/api/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: "grant_type=client_credentials",
  });
  return remember("americanas", token.access_token, token.expires_in || 3600);
}

async function americanasRequest<T>(path: string, init: RequestInit): Promise<T> {
  const base = (Deno.env.get("AMERICANAS_API_BASE_URL") || "https://api-parceiros.americanas.io").replace(/\/$/, "");
  const token = await americanasToken();
  return requestJson<T>(`${base}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(Deno.env.get("AMERICANAS_API_KEY") ? { "x-api-key": requiredEnv("AMERICANAS_API_KEY") } : {}),
      ...(init.headers || {}),
    },
  });
}

export const americanasClient = {
  upsertProduct(product: Record<string, unknown>) {
    return americanasRequest<Record<string, unknown>>("/api/v1/products", {
      method: "POST",
      body: JSON.stringify(product),
    });
  },
  updateStock(sku: string, stock: number) {
    return americanasRequest<Record<string, unknown>>(`/api/v1/products/${encodeURIComponent(sku)}/stock`, {
      method: "PUT",
      body: JSON.stringify({ quantity: stock }),
    });
  },
  getOrders(offset = 0) {
    return americanasRequest<Record<string, unknown>>(`/api/v1/orders?offset=${offset}&limit=50`, { method: "GET" });
  },
};
