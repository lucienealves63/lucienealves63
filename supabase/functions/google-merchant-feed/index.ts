import { corsHeaders, json } from "../_shared/cors.ts";
import { requiredEnv } from "../_shared/http.ts";
import { feedTokenMatches, requireAdmin, serviceClient, workerSecretMatches } from "../_shared/auth.ts";
import { buildFeedRow, toCsv, toGoogleXml, type CatalogItem, type FeedRow, type Policy } from "../_shared/feeds.ts";

/*
 * google-merchant-feed — feed de produtos para o Google Merchant Center.
 *
 * GET  /functions/v1/google-merchant-feed?token=...[&format=xml|csv]
 *      → URL de coleta primária que você cadastra no Merchant Center
 *        (Produtos → Feeds → Primário → Agendado). O token fica só aqui.
 * POST /functions/v1/google-merchant-feed  (sessão admin do painel)
 *      → envia os produtos na hora pela Content API v2.1 (push).
 *
 * Segredos (Supabase Secrets):
 *   GOOGLE_MERCHANT_ID                     — número da conta
 *   GOOGLE_MERCHANT_SERVICE_ACCOUNT_JSON   — conta de serviço com acesso
 *   GOOGLE_MERCHANT_FEED_TOKEN             — token da URL de coleta
 *
 * Fonte dos dados: channel_listings (o que o painel publicou). Se o canal
 * ainda não foi publicado, o feed é montado na hora a partir do catálogo e
 * da política gravada em sales_channels.config.policy — assim a URL já pode
 * ser cadastrada no Merchant Center antes do primeiro envio.
 */

const CHANNEL_ID = "google-merchant";

/* A listagem já traz preço e estoque calculados pelo banco; a política
   neutra evita aplicar markup duas vezes. */
const NEUTRAL_POLICY: Policy = {
  markup: 0,
  rounding: "none",
  stockBuffer: 0,
  maxPublished: 0,
  minPrice: 0,
  publishOnlyAvailable: false,
};

function listingToItem(listing: Record<string, any>): CatalogItem {
  const payload = (listing.payload || {}) as Record<string, any>;
  return {
    id: String(payload.id || listing.item_key),
    sku: String(payload.sku || listing.item_key),
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

async function feedRows(): Promise<{ rows: FeedRow[]; source: string; policy: Policy }> {
  const supabase = serviceClient();

  const { data: channel } = await supabase
    .from("sales_channels")
    .select("id, config")
    .eq("id", CHANNEL_ID)
    .maybeSingle();
  const policy = ((channel?.config as Record<string, any>)?.policy || {}) as Partial<Policy>;

  const { data: listings } = await supabase
    .from("channel_listings")
    .select("item_key, title, price, stock, link, image_link, payload, status")
    .eq("channel_id", CHANNEL_ID)
    .eq("status", "published")
    .order("item_key");

  if (listings && listings.length) {
    return {
      rows: listings.map((listing) => buildFeedRow(listingToItem(listing), CHANNEL_ID, NEUTRAL_POLICY)),
      source: "channel_listings",
      policy: policy as Policy,
    };
  }

  /* sem publicação ainda: monta do catálogo com a política gravada */
  const siteUrl = Deno.env.get("PUBLIC_SITE_URL") || "https://censura18.com.br";
  const { data: catalog, error } = await supabase.rpc("channel_catalog", { p_site_url: siteUrl });
  if (error) throw new Error(`Não foi possível ler o catálogo: ${error.message}`);
  const items = ((catalog || []) as Record<string, any>[]).map((row) => ({
    id: String(row.slug || row.item_key),
    sku: String(row.sku || row.item_key),
    title: String(row.title || ""),
    description: String(row.description || row.title || ""),
    brand: String(row.brand || "CENSURA 18"),
    category: String(row.category || ""),
    collection: String(row.collection || ""),
    price: Number(row.base_price || 0),
    stock: Number(row.stock || 0),
    colors: Array.isArray(row.colors) ? row.colors : [],
    sizes: Array.isArray(row.sizes) ? row.sizes : [],
    condition: "new",
    link: String(row.link || ""),
    /* channel_catalog() já devolve a URL absoluta (foto do produto ou a
       marca d'água da loja, mesma regra da prévia do painel) */
    image_link: String(row.image_link || `${siteUrl.replace(/\/$/, "")}/assets/img/logos/logo-quadro.png`),
    gtin: row.barcode ? String(row.barcode) : "",
  })) as CatalogItem[];

  return {
    rows: items.map((item) => buildFeedRow(item, CHANNEL_ID, policy)),
    source: "channel_catalog",
    policy: policy as Policy,
  };
}

function productPayload(row: FeedRow): Record<string, unknown> {
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

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = new URL(request.url);

  /* ---------------------------------------------------- GET: coleta do feed */
  if (request.method === "GET") {
    if (!feedTokenMatches(url)) {
      return json({ error: "Token de feed inválido. Configure GOOGLE_MERCHANT_FEED_TOKEN." }, 401);
    }
    try {
      const { rows, source } = await feedRows();
      const format = url.searchParams.get("format") === "csv" ? "csv" : "xml";
      const siteUrl = Deno.env.get("PUBLIC_SITE_URL") || "https://censura18.com.br";
      /* O corpo precisa seguir o formato pedido na URL (o Content-Type abaixo
         já prometia isso): xml é o que o Merchant Center coleta, csv serve
         para conferir a mesma lista numa planilha. */
      const body = format === "csv"
        ? toCsv(rows, CHANNEL_ID)
        : toGoogleXml(rows, {
            title: "Censura 18 — Google Merchant Center",
            link: siteUrl,
          });
      return new Response(body, {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": format === "xml"
            ? "application/xml; charset=utf-8"
            : "text/csv; charset=utf-8",
          "Cache-Control": "private, max-age=300",
          "X-C18-Items": String(rows.length),
          "X-C18-Source": source,
        },
      });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  }

  if (request.method !== "POST") return json({ error: "Método não permitido" }, 405);

  /* ------------------------------------------ POST: push imediato (painel) */
  const supabase = serviceClient();
  if (!workerSecretMatches(request)) {
    const check = await requireAdmin(request, supabase);
    if (!check.ok) return json({ error: check.message }, check.status);
  }

  try {
    const { rows, source, policy } = await feedRows();
    const limit = Math.min(rows.length, Number(url.searchParams.get("limit") || 200));
    const sent: string[] = [];
    const failed: { offerId: string; error: string }[] = [];

    /* O push usa a Content API; sem credencial configurada a função devolve
       o resumo do que seria enviado (útil para homologar o feed). */
    const hasCredentials = Boolean(Deno.env.get("GOOGLE_MERCHANT_SERVICE_ACCOUNT_JSON"))
      && Boolean(Deno.env.get("GOOGLE_MERCHANT_ID"));

    if (hasCredentials) {
      const { googleMerchantClient } = await import("../_shared/marketing.ts");
      for (const row of rows.slice(0, limit)) {
        try {
          await googleMerchantClient.upsertProduct(productPayload(row));
          sent.push(String(row.id));
        } catch (error) {
          failed.push({ offerId: String(row.id), error: error instanceof Error ? error.message : String(error) });
        }
      }
    }

    await supabase.from("sales_channels").update({
      last_sync_at: new Date().toISOString(),
      status: failed.length && !sent.length ? "error" : "connected",
      last_error: failed.length ? failed[0].error : null,
      metadata: { listings: sent.length || rows.length, errors: failed.length, queue: 0 },
    }).eq("id", CHANNEL_ID);

    return json({
      channel: CHANNEL_ID,
      source,
      policy,
      format: "xml",
      items: rows.length,
      pushed: sent.length,
      failed,
      mode: hasCredentials ? "content-api" : "sem credencial (feed validado, nada enviado)",
      feedUrl: `${requiredEnv("SUPABASE_URL").replace(/\/$/, "")}/functions/v1/google-merchant-feed?token=<GOOGLE_MERCHANT_FEED_TOKEN>`,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
