import { corsHeaders, json } from "../_shared/cors.ts";
import { requireAdmin, serviceClient, workerSecretMatches } from "../_shared/auth.ts";
import { conversionEvent } from "../_shared/feeds.ts";
import { ga4Client, metaClient, sha256Hex } from "../_shared/marketing.ts";

/*
 * marketing-events — Meta Conversions API + GA4 Measurement Protocol.
 *
 * Por que no servidor: a CAPI existe para recuperar conversões que o
 * navegador perde (bloqueio de cookie, iOS, recarga no checkout). O evento
 * sai daqui com o MESMO event_id do Pixel do navegador, então a Meta deduplica.
 *
 * Chamadas:
 *   { test: true, channel?: "meta-ads"|"ga4", event?: "PageView" }
 *       → botão "evento de teste" do painel (sessão admin)
 *   { flush: true, limit?: 500 }
 *       → encaminha eventos de analytics_events ainda não enviados
 *         (agendador: pg_cron → pg_net com x-worker-secret)
 *   { events: [ … ] }
 *       → lote explícito (servidor a servidor, x-worker-secret)
 *
 * Segredos: META_PIXEL_ID, META_CAPI_ACCESS_TOKEN, META_TEST_EVENT_CODE,
 *           GA4_MEASUREMENT_ID, GA4_API_SECRET.
 *
 * Privacidade: nenhum dado pessoal é enviado. O visitante vira um
 * external_id = SHA-256 do id de sessão aleatório do site; não há e-mail,
 * telefone, IP ou user-agent (o site só mede após aceite no aviso de
 * privacidade — assets/js/lgpd.js).
 */

const SITE_URL = (Deno.env.get("PUBLIC_SITE_URL") || "https://censura18.com.br").replace(/\/$/, "");
const META_BATCH = 50;
const GA4_SESSION_BATCH = 25;

type SiteEvent = {
  kind: string;
  session_id: string;
  occurred_at: string | number;
  path?: string;
  product_id?: string | null;
  category?: string | null;
  value?: number | string | null;
  meta?: Record<string, any>;
};

function eventId(event: SiteEvent): string {
  const at = typeof event.occurred_at === "number"
    ? String(event.occurred_at)
    : String(event.occurred_at || "");
  return `${event.kind}:${event.session_id}:${at}`;
}

function eventTime(event: SiteEvent): number {
  const at = typeof event.occurred_at === "number"
    ? event.occurred_at
    : Date.parse(String(event.occurred_at || ""));
  const seconds = Math.floor((Number.isFinite(at) ? at : Date.now()) / 1000);
  return seconds;
}

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < list.length; index += size) out.push(list.slice(index, index + size));
  return out;
}

async function enabledDestinations(): Promise<{ meta: boolean; ga4: boolean }> {
  const supabase = serviceClient();
  const { data } = await supabase
    .from("sales_channels")
    .select("id, enabled")
    .in("id", ["meta-ads", "ga4"]);
  const enabled = new Set((data || []).filter((row) => row.enabled).map((row) => row.id));
  return { meta: enabled.has("meta-ads"), ga4: enabled.has("ga4") };
}

/* ------------------------------------------------------------- Meta CAPI */

async function buildMetaEvent(event: SiteEvent): Promise<Record<string, unknown>> {
  const mapping = conversionEvent(event.kind);
  const value = Number(event.value || 0);
  const customData: Record<string, unknown> = { currency: "BRL" };
  if (value > 0) customData.value = Math.round(value * 100) / 100;
  if (event.product_id) {
    customData.content_ids = [String(event.product_id)];
    customData.content_type = "product";
  }
  if (event.category) customData.content_category = String(event.category);
  const query = event.meta?.query || event.meta?.term;
  if (query) customData.search_string = String(query);

  return {
    event_name: mapping.meta,
    event_time: eventTime(event),
    event_id: eventId(event),
    action_source: "website",
    event_source_url: `${SITE_URL}${event.path || "/"}`,
    /* só o hash da sessão: deduplica com o Pixel sem identificar pessoa */
    user_data: { external_id: [await sha256Hex(String(event.session_id))] },
    custom_data: customData,
  };
}

async function sendMeta(events: SiteEvent[]): Promise<{ sent: number; errors: string[] }> {
  if (!events.length) return { sent: 0, errors: [] };
  if (!Deno.env.get("META_PIXEL_ID") || !Deno.env.get("META_CAPI_ACCESS_TOKEN")) {
    return { sent: 0, errors: ["META_PIXEL_ID/META_CAPI_ACCESS_TOKEN não configurados"] };
  }
  const built = await Promise.all(events.map((event) => buildMetaEvent(event)));
  const errors: string[] = [];
  let sent = 0;
  for (const batch of chunk(built, META_BATCH)) {
    try {
      const response = await metaClient.sendEvents(batch) as Record<string, any>;
      sent += Number(response?.events_received ?? batch.length);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { sent, errors };
}

/* -------------------------------------------------------------------- GA4 */

function buildGa4Event(event: SiteEvent): Record<string, unknown> {
  const mapping = conversionEvent(event.kind);
  const value = Number(event.value || 0);
  const params: Record<string, unknown> = { currency: "BRL" };
  if (value > 0) params.value = Math.round(value * 100) / 100;
  if (event.product_id) {
    params.items = [{ item_id: String(event.product_id), item_name: String(event.meta?.title || event.product_id) }];
  }
  if (event.category) params.item_list_name = String(event.category);
  const query = event.meta?.query || event.meta?.term;
  if (query) params.search_term = String(query);
  params.page_location = `${SITE_URL}${event.path || "/"}`;
  return { name: mapping.ga4, params };
}

async function sendGa4(events: SiteEvent[]): Promise<{ sent: number; errors: string[] }> {
  if (!events.length) return { sent: 0, errors: [] };
  if (!Deno.env.get("GA4_MEASUREMENT_ID") || !Deno.env.get("GA4_API_SECRET")) {
    return { sent: 0, errors: ["GA4_MEASUREMENT_ID/GA4_API_SECRET não configurados"] };
  }
  /* o Measurement Protocol aceita vários eventos por client_id */
  const bySession = new Map<string, Record<string, unknown>[]>();
  events.forEach((event) => {
    const list = bySession.get(event.session_id) || [];
    list.push(buildGa4Event(event));
    bySession.set(event.session_id, list);
  });

  const errors: string[] = [];
  let sent = 0;
  const sessions = Array.from(bySession.entries()).slice(0, GA4_SESSION_BATCH);
  for (const [sessionId, sessionEvents] of sessions) {
    try {
      await ga4Client.collect(sessionId, sessionEvents);
      sent += sessionEvents.length;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { sent, errors };
}

/* ------------------------------------------------------------------ flush */

const FORWARDABLE_KINDS = [
  "page_view", "product_view", "category_view", "search",
  "add_to_cart", "checkout_intent", "whatsapp",
];

async function flush(limit: number) {
  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("analytics_events")
    .select("id, kind, session_id, occurred_at, path, product_id, category, value")
    .is("forwarded_at", null)
    .in("kind", FORWARDABLE_KINDS)
    .order("occurred_at")
    .limit(limit);
  if (error) throw new Error(`Não foi possível ler os eventos: ${error.message}`);

  const events = ((data || []) as Record<string, any>[]).map((row) => ({
    kind: String(row.kind),
    session_id: String(row.session_id),
    occurred_at: String(row.occurred_at),
    path: row.path ? String(row.path) : "/",
    product_id: row.product_id ? String(row.product_id) : null,
    category: row.category ? String(row.category) : null,
    value: row.value ?? 0,
    meta: {},
  })) as SiteEvent[];

  const destinations = await enabledDestinations();
  const meta = destinations.meta ? await sendMeta(events) : { sent: 0, errors: [] };
  const ga4 = destinations.ga4 ? await sendGa4(events) : { sent: 0, errors: [] };

  const failed = [...meta.errors, ...ga4.errors];
  if (events.length) {
    const ids = (data || []).map((row) => row.id).filter(Boolean);
    await supabase.from("analytics_events").update(
      failed.length && !meta.sent && !ga4.sent
        ? { forward_error: failed[0].slice(0, 300) }
        : { forwarded_at: new Date().toISOString(), forward_error: null },
    ).in("id", ids);
  }

  return {
    read: events.length,
    destinations,
    meta: meta.sent,
    ga4: ga4.sent,
    sent: meta.sent + ga4.sent,
    errors: failed.slice(0, 5),
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

  let payload: Record<string, any>;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Corpo da requisição inválido" }, 400);
  }

  try {
    /* ------------------------------------------------------- evento de teste */
    if (payload?.test) {
      const channel = String(payload.channel || "");
      const eventName = String(payload.event || "PageView");
      const testEvent: SiteEvent = {
        kind: "page_view",
        session_id: `teste-${Date.now()}`,
        occurred_at: Date.now(),
        path: "/admin/",
        value: 0,
        meta: {},
      };
      const destinations = await enabledDestinations();
      const wantMeta = !channel || channel === "meta-ads";
      const wantGa4 = !channel || channel === "ga4";

      const metaResult = wantMeta
        ? await sendMeta([{ ...testEvent, kind: "page_view" }])
        : { sent: 0, errors: destinations.meta ? [] : ["canal meta-ads desabilitado"] };
      const ga4Result = wantGa4
        ? await sendGa4([{ ...testEvent, kind: "page_view" }])
        : { sent: 0, errors: destinations.ga4 ? [] : ["canal ga4 desabilitado"] };

      return json({
        sent: metaResult.sent + ga4Result.sent,
        channel: channel || "todos",
        event: eventName,
        meta: metaResult,
        ga4: ga4Result,
        hint: wantMeta && !metaResult.sent
          ? "Cadastre META_PIXEL_ID e META_CAPI_ACCESS_TOKEN (e META_TEST_EVENT_CODE para ver no Test Events do Meta)."
          : undefined,
      });
    }

    /* ------------------------------------------------------------- flush */
    if (payload?.flush) {
      const limit = Math.max(1, Math.min(2000, Number(payload.limit) || 500));
      return json(await flush(limit));
    }

    /* --------------------------------------------------- lote explícito */
    if (Array.isArray(payload?.events)) {
      if (!fromWorker) return json({ error: "Lote explícito exige x-worker-secret" }, 403);
      const events = (payload.events as any[]).slice(0, 500).map((event) => ({
        kind: String(event?.kind || "page_view"),
        session_id: String(event?.session_id || ""),
        occurred_at: event?.occurred_at ?? Date.now(),
        path: event?.path ? String(event.path) : "/",
        product_id: event?.product_id ? String(event.product_id) : null,
        category: event?.category ? String(event.category) : null,
        value: event?.value ?? 0,
        meta: (event?.meta || {}) as Record<string, any>,
      })).filter((event) => event.session_id);

      const meta = await sendMeta(events);
      const ga4 = await sendGa4(events);
      return json({
        read: events.length,
        sent: meta.sent + ga4.sent,
        meta: meta.sent,
        ga4: ga4.sent,
        errors: [...meta.errors, ...ga4.errors].slice(0, 5),
      });
    }

    return json({ error: "Envie {test:true}, {flush:true} ou {events:[…]}" }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
