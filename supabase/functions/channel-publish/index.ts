import { corsHeaders, json } from "../_shared/cors.ts";
import { requireAdmin, serviceClient, workerSecretMatches } from "../_shared/auth.ts";
import { buildFeedRow, type CatalogItem, type FeedRow, type Policy } from "../_shared/feeds.ts";
import {
  amazonClient,
  americanasClient,
  googleMerchantClient,
  magaluClient,
  mercadoLivreClient,
  metaClient,
  shopeeClient,
} from "../_shared/marketing.ts";

/*
 * channel-publish — envia o catálogo publicado aos canais habilitados.
 *
 * Fluxo: painel (RPC publish_catalog_to_channel) calcula preço/estoque no
 * banco e grava em channel_listings + integration_outbox; esta função
 * consome a fila e chama a API de cada provedor com os segredos do ambiente.
 *
 * Chamadas:
 *   POST sem corpo            → processa a fila (agendador, x-worker-secret)
 *   POST { channel: "shopee" }→ publica um canal agora (sessão admin)
 *   POST { dryRun: true }     → só valida e conta, não chama provedor
 *
 * Política de repetição: mesma do integration-worker (backoff exponencial,
 * dead_letter após 8 tentativas) para um canal fora do ar não travar os outros.
 */

const SITE_URL = (Deno.env.get("PUBLIC_SITE_URL") || "https://censura18.com.br").replace(/\/$/, "");
const PAGE_LIMIT = 200;

/* preço/estoque já vêm calculados do banco — política neutra aqui */
const NEUTRAL_POLICY: Policy = {
  markup: 0,
  rounding: "none",
  stockBuffer: 0,
  maxPublished: 0,
  minPrice: 0,
  publishOnlyAvailable: false,
};

/* Segredos exigidos por canal (os mesmos listados no painel). */
const REQUIRED_SECRETS: Record<string, string[]> = {
  "google-merchant": ["GOOGLE_MERCHANT_ID", "GOOGLE_MERCHANT_SERVICE_ACCOUNT_JSON"],
  "meta-ads": ["META_PIXEL_ID", "META_CAPI_ACCESS_TOKEN", "META_CATALOG_ID"],
  mercadolivre: ["MERCADOLIVRE_CLIENT_ID", "MERCADOLIVRE_CLIENT_SECRET", "MERCADOLIVRE_REFRESH_TOKEN"],
  shopee: ["SHOPEE_PARTNER_ID", "SHOPEE_PARTNER_KEY", "SHOPEE_SHOP_ID"],
  amazon: [
    "AMAZON_SP_API_REFRESH_TOKEN", "AMAZON_SP_API_CLIENT_ID", "AMAZON_SP_API_CLIENT_SECRET",
    "AMAZON_SP_API_AWS_ACCESS_KEY", "AMAZON_SP_API_AWS_SECRET_KEY", "AMAZON_MARKETPLACE_ID",
  ],
  magalu: ["MAGALU_API_TOKEN", "MAGALU_API_BASE_URL"],
  americanas: ["AMERICANAS_CLIENT_ID", "AMERICANAS_CLIENT_SECRET"],
};

function missingSecrets(channelId: string): string[] {
  return (REQUIRED_SECRETS[channelId] || []).filter((name) => !Deno.env.get(name)?.trim());
}

type Listing = {
  id: string;
  item_key: string;
  sku: string | null;
  title: string;
  price: number;
  stock: number;
  link: string | null;
  image_link: string | null;
  payload: Record<string, any>;
};

function listingToItem(listing: Listing): CatalogItem {
  const payload = listing.payload || {};
  return {
    id: String(payload.id || listing.item_key),
    sku: String(payload.sku || listing.sku || listing.item_key),
    title: String(payload.title || listing.title || ""),
    description: String(payload.description || payload.title || ""),
    brand: String(payload.brand || "CENSURA 18"),
    category: String(payload.category || ""),
    collection: String(payload.collection || ""),
    price: Number(listing.price ?? payload.price ?? 0),
    stock: Number(listing.stock ?? payload.stock ?? 0),
    colors: Array.isArray(payload.colors) ? payload.colors : [],
    sizes: Array.isArray(payload.sizes) ? payload.sizes : [],
    condition: String(payload.condition || "new"),
    link: String(listing.link || payload.link || ""),
    image_link: String(listing.image_link || payload.image_link || ""),
    gtin: payload.ean ? String(payload.ean) : "",
  };
}

/* ------------------------------------------------ mapeadores por canal */

function googleProduct(row: FeedRow): Record<string, unknown> {
  return {
    channel: "online",
    contentLanguage: "pt-BR",
    targetCountry: Deno.env.get("GOOGLE_MERCHANT_COUNTRY") || "BR",
    feedLabel: Deno.env.get("GOOGLE_MERCHANT_FEED_LABEL") || "BR",
    offerId: String(row.id),
    title: String(row.title),
    description: String(row.description),
    link: String(row.link),
    imageLink: String(row.image_link),
    availability: String(row.availability),
    price: String(row.price),
    brand: String(row.brand),
    condition: String(row.condition),
    itemGroupId: String(row.item_group_id),
    googleProductCategory: String(row.google_product_category),
    identifierExists: String(row.identifier_exists) === "TRUE",
    customLabel0: String(row.custom_label_0),
    customLabel1: String(row.custom_label_1),
    customLabel2: String(row.custom_label_2),
  };
}

function metaProduct(row: FeedRow): Record<string, unknown> {
  return {
    retailer_id: String(row.id),
    name: String(row.title),
    description: String(row.description),
    availability: String(row.availability),
    condition: String(row.condition),
    price: Number(String(row.price).replace(" BRL", "")),
    brand: String(row.brand),
    link: String(row.link),
    image_link: String(row.image_link),
    google_product_category: String(row.google_product_category),
    item_group_id: String(row.item_group_id),
    visibility: "published",
  };
}

function mercadoLivreItem(row: FeedRow): Record<string, unknown> {
  const attributes = JSON.parse(String(row.attributes || "[]")) as { id: string; value_name: string }[];
  const shipping = JSON.parse(String(row.shipping || "{}")) as Record<string, unknown>;
  return {
    title: String(row.title),
    category_id: String(row.category_id),
    price: Number(row.price),
    currency_id: String(row.currency_id || "BRL"),
    available_quantity: Number(row.available_quantity),
    buying_mode: "buy_it_now",
    listing_type_id: "gold_special",
    condition: String(row.condition || "new"),
    description: { plain_text: String(row.description) },
    pictures: [{ source: String(row.picture_source) }],
    attributes: attributes.filter((attribute) => attribute.value_name),
    shipping,
  };
}

function shopeeItem(row: FeedRow): Record<string, unknown> {
  return {
    item_name: String(row.item_name),
    item_sku: String(row.item_sku),
    original_price: Number(row.original_price),
    current_price: Number(row.current_price),
    stock: Number(row.stock),
    condition: String(row.condition || "NEW"),
    category_id: Number(row.category_id),
    item_weight: Number(row.weight),
    description: String(row.description),
    image: { image_url_list: [String(row.image_id_list)] },
  };
}

function amazonListing(row: FeedRow): Record<string, unknown> {
  return {
    productType: "PRODUCT",
    attributes: {
      item_name: [{ value: String(row["item-name"]), language_tag: "pt_BR", marketplace_id: Deno.env.get("AMAZON_MARKETPLACE_ID") }],
      brand: [{ value: String(row.brand), language_tag: "pt_BR", marketplace_id: Deno.env.get("AMAZON_MARKETPLACE_ID") }],
      product_description: [{ value: String(row["product-description"]), language_tag: "pt_BR", marketplace_id: Deno.env.get("AMAZON_MARKETPLACE_ID") }],
      main_product_image_locator: [{
        media_location: String(row["main-image-url"]),
        marketplace_id: Deno.env.get("AMAZON_MARKETPLACE_ID"),
      }],
      condition_type: [{ value: String(row["condition-type"]), marketplace_id: Deno.env.get("AMAZON_MARKETPLACE_ID") }],
      externally_assigned_product_identifier: String(row["product-id"])
        ? [{ type: "ean", value: String(row["product-id"]), marketplace_id: Deno.env.get("AMAZON_MARKETPLACE_ID") }]
        : undefined,
      purchasable_offer: [{
        currency: "BRL",
        our_price: [{ value: Number(row.price), unit: "BRL" }],
        maximum_order_quantity: Number(row.quantity),
        marketplace_id: Deno.env.get("AMAZON_MARKETPLACE_ID"),
      }],
      fulfillment_availability: [{
        fulfillment_channel_code: "DEFAULT",
        quantity: Number(row.quantity),
      }],
    },
  };
}

/* ------------------------------------------------------- envio por canal */

type PushResult = { externalId?: string; error?: string };

async function pushListing(
  channelId: string,
  row: FeedRow,
  listing: Listing,
  config: Record<string, any>,
): Promise<PushResult> {
  switch (channelId) {
    case "google-merchant": {
      const response = await googleMerchantClient.upsertProduct(googleProduct(row)) as Record<string, any>;
      return { externalId: String(response?.offerId || row.id) };
    }
    case "meta-ads": {
      const response = await metaClient.batchUpsertItems([metaProduct(row)]) as Record<string, any>;
      const handles = (response?.handles || []) as string[];
      return { externalId: handles[0] || String(row.id) };
    }
    case "mercadolivre": {
      if (listing.sku && config.external_ids?.[listing.item_key]) {
        const itemId = String(config.external_ids[listing.item_key]);
        await mercadoLivreClient.updatePrice(itemId, Number(row.price));
        await mercadoLivreClient.updateStock(itemId, Number(row.available_quantity));
        return { externalId: itemId };
      }
      const response = await mercadoLivreClient.createItem(mercadoLivreItem(row)) as Record<string, any>;
      return { externalId: String(response?.id || "") };
    }
    case "shopee": {
      const response = await shopeeClient.addItem(shopeeItem(row)) as Record<string, any>;
      const itemId = response?.response?.item_id ?? response?.item_id;
      return { externalId: itemId ? String(itemId) : "" };
    }
    case "amazon": {
      const sellerId = String(config.seller_id || Deno.env.get("AMAZON_SP_API_SELLER_ID") || "");
      if (!sellerId) throw new Error("Cadastre o Seller ID da Amazon no painel");
      const sku = `${String(config.sku_prefix || "")}${String(row.sku)}`;
      await amazonClient.putListing(sellerId, sku, amazonListing(row));
      return { externalId: sku };
    }
    case "magalu": {
      const response = await magaluClient.upsertProduct({
        ...row,
        seller: String(config.seller_id || ""),
      }) as Record<string, any>;
      return { externalId: String(response?.id || row.sku) };
    }
    case "americanas": {
      const response = await americanasClient.upsertProduct({
        ...row,
        seller_id: String(config.seller_id || ""),
      }) as Record<string, any>;
      return { externalId: String(response?.id || row.sku) };
    }
    default:
      throw new Error(`Canal sem adaptador de publicação: ${channelId}`);
  }
}

async function publishChannel(channelId: string, options: { dryRun?: boolean; limit?: number }) {
  const supabase = serviceClient();
  const { data: channel, error: channelError } = await supabase
    .from("sales_channels")
    .select("id, name, kind, enabled, config, metadata, feed_format")
    .eq("id", channelId)
    .maybeSingle();
  if (channelError) throw new Error(channelError.message);
  if (!channel) throw new Error(`Canal ${channelId} não cadastrado`);
  if (!channel.enabled) throw new Error(`Canal ${channel.name} desabilitado`);
  if (channel.kind === "measurement") throw new Error(`${channel.name} é canal de medição: use marketing-events`);

  const missing = missingSecrets(channelId);
  if (missing.length && !options.dryRun) {
    await supabase.from("sales_channels").update({
      status: "error",
      last_error: `Segredos ausentes: ${missing.join(", ")}`,
      last_sync_at: new Date().toISOString(),
    }).eq("id", channelId);
    throw new Error(`Segredos ausentes no ambiente: ${missing.join(", ")}`);
  }

  const { data: listings, error: listingError } = await supabase
    .from("channel_listings")
    .select("id, item_key, sku, title, price, stock, link, image_link, payload, status")
    .eq("channel_id", channelId)
    .eq("status", "published")
    .order("item_key")
    .limit(Math.min(PAGE_LIMIT, Number(options.limit) || PAGE_LIMIT));
  if (listingError) throw new Error(listingError.message);

  const config = (channel.config || {}) as Record<string, any>;
  const rows = (listings || []) as Listing[];
  const pushed: string[] = [];
  const failed: { item: string; error: string }[] = [];

  /* O Commerce Manager aceita lote (items_batch): uma chamada por página. */
  if (channelId === "meta-ads" && !options.dryRun && rows.length) {
    const products = rows.map((listing) =>
      metaProduct(buildFeedRow(listingToItem(listing), channelId, NEUTRAL_POLICY)));
    try {
      const response = await metaClient.batchUpsertItems(products) as Record<string, any>;
      const handles = (response?.handles || []) as string[];
      for (let index = 0; index < rows.length; index += 1) {
        pushed.push(rows[index].item_key);
        await supabase.from("channel_listings").update({
          external_id: handles[index] || null,
          published_at: new Date().toISOString(),
          status: "published",
        }).eq("id", rows[index].id);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const listing of rows) {
        failed.push({ item: listing.item_key, error: message });
        await supabase.from("channel_listings").update({ status: "error" }).eq("id", listing.id);
      }
    }
    return finishPublish(supabase, channel, config, rows, pushed, failed, options, SITE_URL);
  }
  if (channelId === "meta-ads" && options.dryRun) {
    rows.forEach((listing) => pushed.push(listing.item_key));
    return finishPublish(supabase, channel, config, rows, pushed, failed, options, SITE_URL);
  }

  for (const listing of rows) {
    const row = buildFeedRow(listingToItem(listing), channelId, NEUTRAL_POLICY);
    if (options.dryRun) { pushed.push(listing.item_key); continue; }
    try {
      const result = await pushListing(channelId, row, listing, config);
      await supabase.from("channel_listings").update({
        external_id: result.externalId || null,
        published_at: new Date().toISOString(),
        status: "published",
      }).eq("id", listing.id);
      pushed.push(listing.item_key);
      if (result.externalId) {
        config.external_ids = { ...(config.external_ids || {}), [listing.item_key]: result.externalId };
      }
    } catch (error) {
      failed.push({ item: listing.item_key, error: error instanceof Error ? error.message : String(error) });
      await supabase.from("channel_listings").update({ status: "error" }).eq("id", listing.id);
    }
  }

  return finishPublish(supabase, channel, config, rows, pushed, failed, options, SITE_URL);
}

/* Grava o resultado no canal e devolve o resumo (usado por todos os caminhos). */
async function finishPublish(
  supabase: ReturnType<typeof serviceClient>,
  channel: Record<string, any>,
  config: Record<string, any>,
  rows: Listing[],
  pushed: string[],
  failed: { item: string; error: string }[],
  options: { dryRun?: boolean },
  siteUrl: string,
) {
  const channelId = String(channel.id);
  if (!options.dryRun && config.external_ids) {
    await supabase.from("sales_channels").update({ config }).eq("id", channelId);
  }
  if (!options.dryRun) {
    await supabase.from("sales_channels").update({
      status: failed.length && !pushed.length ? "error" : pushed.length ? "connected" : channel.status,
      last_sync_at: new Date().toISOString(),
      last_error: failed.length ? failed[0].error.slice(0, 300) : null,
      metadata: {
        ...(channel.metadata || {}),
        listings: rows.length,
        published: pushed.length,
        errors: failed.length,
        queue: 0,
        lastPush: { at: new Date().toISOString(), pushed: pushed.length, failed: failed.length },
      },
    }).eq("id", channelId);
  }
  return {
    channel: channelId,
    name: channel.name,
    format: channel.feed_format,
    items: rows.length,
    pushed: pushed.length,
    failed,
    mode: options.dryRun ? "simulado" : "enviado",
    siteUrl,
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Método não permitido" }, 405);

  const supabase = serviceClient();
  const fromWorker = workerSecretMatches(request);
  if (!fromWorker) {
    const check = await requireAdmin(request, supabase);
    if (!check.ok) return json({ error: check.message }, check.status);
  }

  let payload: Record<string, any> = {};
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }

  try {
    /* ------------------------------------------- publicação direta (painel) */
    if (payload?.channel) {
      const result = await publishChannel(String(payload.channel), {
        dryRun: Boolean(payload.dryRun),
        limit: Number(payload.limit) || PAGE_LIMIT,
      });
      return json({ processed: 1, results: [result] });
    }

    /* ------------------------------------------------- fila da integração */
    const { data: jobs, error } = await supabase
      .from("integration_outbox")
      .select("*")
      .eq("service", "channels")
      .in("status", ["pending", "failed"])
      .lte("next_attempt_at", new Date().toISOString())
      .order("created_at")
      .limit(10);
    if (error) return json({ error: error.message }, 500);

    const results: Record<string, unknown>[] = [];
    for (const job of jobs || []) {
      const { data: claimed } = await supabase
        .from("integration_outbox")
        .update({ status: "processing", locked_at: new Date().toISOString(), attempts: job.attempts + 1 })
        .eq("id", job.id)
        .in("status", ["pending", "failed"])
        .select("id")
        .maybeSingle();
      if (!claimed) continue;

      try {
        const result = await publishChannel(String(job.aggregate_id), { dryRun: Boolean(payload.dryRun) });
        await supabase.from("integration_outbox").update({
          status: "done",
          response: result,
          completed_at: new Date().toISOString(),
          locked_at: null,
          last_error: null,
        }).eq("id", job.id).eq("status", "processing");
        results.push({ id: job.id, channel: job.aggregate_id, status: "done", result });
      } catch (channelError) {
        const attempts = job.attempts + 1;
        const dead = attempts >= 8;
        const waitMinutes = Math.min(360, 2 ** attempts);
        const message = channelError instanceof Error ? channelError.message : String(channelError);
        await supabase.from("integration_outbox").update({
          status: dead ? "dead_letter" : "failed",
          last_error: message.slice(0, 500),
          next_attempt_at: new Date(Date.now() + waitMinutes * 60_000).toISOString(),
          locked_at: null,
        }).eq("id", job.id).eq("status", "processing");
        results.push({ id: job.id, channel: job.aggregate_id, status: dead ? "dead_letter" : "failed", error: message });
      }
    }

    return json({ processed: results.length, results });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
