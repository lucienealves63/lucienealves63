import { corsHeaders, json } from "../_shared/cors.ts";
import { requireAdmin, serviceClient, workerSecretMatches } from "../_shared/auth.ts";
import {
  GOOGLE_ADS_DEFAULTS,
  googleAdsConversionRows,
  toGoogleAdsCsv,
  type GoogleAdsRow,
  type GoogleAdsSourceEvent,
} from "../_shared/feeds.ts";
import { googleAdsClient, type GoogleAdsClickConversion } from "../_shared/marketing.ts";

/*
 * google-ads-conversions — devolve ao Google Ads as vendas que o anúncio gerou.
 *
 * Como funciona: quem chega pelo anúncio traz ?gclid= (ou gbraid/wbraid no
 * iOS). O site guarda esse id na sessão (assets/js/analytics.js) e, quando o
 * pedido fecha no checkout (evento purchase) ou o cliente chama no WhatsApp,
 * o evento fica em analytics_events com o id do clique. Esta função lê esses
 * eventos e:
 *
 *   { test: true }
 *       → confere segredos + conta e lista as ações de conversão (mostra o
 *         id a cadastrar em conversion_action_id). Sessão admin.
 *   { flush: true, limit?: 200 }
 *       → upload pela API (uploadClickConversions) do que ainda não subiu;
 *         marca ads_uploaded_at / ads_upload_error em cada evento.
 *         Agendador (x-worker-secret) ou botão do painel.
 *   { export: true, days?: 30, pending?: true }
 *       → CSV no modelo "conversões de cliques" para upload manual no
 *         Google Ads (Objetivos → Conversões → Uploads). Não precisa de
 *         developer token — é o caminho quando a API ainda não foi liberada.
 *
 * Segredos: GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CLIENT_ID,
 *           GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_REFRESH_TOKEN
 *           (opcional GOOGLE_ADS_LOGIN_CUSTOMER_ID, GOOGLE_ADS_API_VERSION).
 * Identificadores públicos ficam em sales_channels (google-ads).config:
 *   customer_id, conversion_name, conversion_action_id,
 *   whatsapp_conversion_name, login_customer_id.
 *
 * Privacidade: sobe só o id do clique, a data, o valor e o número do pedido.
 * Nenhum dado pessoal do cliente sai daqui.
 */

const REQUIRED_SECRETS = [
  "GOOGLE_ADS_DEVELOPER_TOKEN",
  "GOOGLE_ADS_CLIENT_ID",
  "GOOGLE_ADS_CLIENT_SECRET",
  "GOOGLE_ADS_REFRESH_TOKEN",
];

const UPLOAD_BATCH = 200;
const MAX_CLICK_AGE_DAYS = 90; // o Google Ads não aceita conversões de cliques com mais de 90 dias

type ChannelConfig = {
  enabled: boolean;
  customer_id: string;
  conversion_name: string;
  conversion_action_id: string;
  whatsapp_conversion_name: string;
  login_customer_id: string;
};

function missingSecrets(): string[] {
  return REQUIRED_SECRETS.filter((name) => !Deno.env.get(name)?.trim());
}

async function channelConfig(): Promise<ChannelConfig> {
  const supabase = serviceClient();
  const { data } = await supabase
    .from("sales_channels")
    .select("enabled, config")
    .eq("id", "google-ads")
    .maybeSingle();
  const config = ((data as Record<string, any> | null)?.config || {}) as Record<string, unknown>;
  const text = (key: string) => String(config[key] ?? "").trim();
  return {
    enabled: Boolean((data as Record<string, any> | null)?.enabled),
    customer_id: text("customer_id").replace(/\D/g, ""),
    conversion_name: text("conversion_name") || GOOGLE_ADS_DEFAULTS.conversionName,
    conversion_action_id: text("conversion_action_id").replace(/\D/g, ""),
    whatsapp_conversion_name: text("whatsapp_conversion_name"),
    login_customer_id: text("login_customer_id").replace(/\D/g, ""),
  };
}

function kindsFor(config: ChannelConfig): string[] {
  return config.whatsapp_conversion_name ? ["purchase", "whatsapp"] : ["purchase"];
}

/* Eventos com id de clique: compra sempre; WhatsApp só com a ação cadastrada. */
async function loadEvents(config: ChannelConfig, options: { pending: boolean; days: number; limit: number }) {
  const supabase = serviceClient();
  const since = new Date(Date.now() - Math.min(MAX_CLICK_AGE_DAYS, Math.max(1, options.days)) * 86400000).toISOString();
  let query = supabase
    .from("analytics_events")
    .select("id, kind, occurred_at, value, category, utm")
    .in("kind", kindsFor(config))
    .gte("occurred_at", since)
    .or("utm->>gclid.not.is.null,utm->>gbraid.not.is.null,utm->>wbraid.not.is.null")
    .order("occurred_at")
    .limit(Math.max(1, Math.min(2000, options.limit)));
  if (options.pending) query = query.is("ads_uploaded_at", null);
  const { data, error } = await query;
  if (error) throw new Error(`Não foi possível ler as conversões: ${error.message}`);
  return ((data || []) as Record<string, any>[]).map((row) => ({
    id: row.id,
    kind: String(row.kind),
    occurred_at: String(row.occurred_at),
    value: row.value ?? 0,
    category: row.category ? String(row.category) : null,
    utm: (row.utm || {}) as Record<string, unknown>,
  })) as GoogleAdsSourceEvent[];
}

function rowsFor(events: GoogleAdsSourceEvent[], config: ChannelConfig): GoogleAdsRow[] {
  return googleAdsConversionRows(events, {
    conversionName: config.conversion_name,
    whatsappName: config.whatsapp_conversion_name,
  });
}

/* Ações de conversão por nome → id (quando o painel não informou o id). */
async function resolveActions(config: ChannelConfig): Promise<Record<string, string>> {
  const byKind: Record<string, string> = {};
  if (config.conversion_action_id) byKind.purchase = config.conversion_action_id;
  const needsLookup = !byKind.purchase || Boolean(config.whatsapp_conversion_name);
  if (!needsLookup) return byKind;

  const chunks = await googleAdsClient.conversionActions(config.customer_id, config.login_customer_id);
  const actions = (Array.isArray(chunks) ? chunks : [chunks])
    .flatMap((chunk) => ((chunk as Record<string, any>)?.results || []) as Record<string, any>[])
    .map((result) => result.conversionAction || {})
    .map((action) => ({ id: String(action.id || ""), name: String(action.name || "") }));
  const find = (name: string) => actions.find((action) => action.name.toLowerCase() === name.toLowerCase());

  if (!byKind.purchase) {
    const match = find(config.conversion_name);
    if (!match) throw new Error(`Ação de conversão "${config.conversion_name}" não existe na conta ${config.customer_id} — crie no Google Ads ou informe o id no painel.`);
    byKind.purchase = match.id;
  }
  if (config.whatsapp_conversion_name) {
    const match = find(config.whatsapp_conversion_name);
    if (match) byKind.whatsapp = match.id;
  }
  return byKind;
}

function toClickConversion(row: GoogleAdsRow, customerId: string, actionId: string): GoogleAdsClickConversion {
  const conversion: GoogleAdsClickConversion = {
    conversionAction: `customers/${customerId}/conversionActions/${actionId}`,
    conversionDateTime: row["Conversion Time"],
  };
  if (row["Google Click ID"]) conversion.gclid = row["Google Click ID"];
  else if (row.gbraid) conversion.gbraid = row.gbraid;
  else if (row.wbraid) conversion.wbraid = row.wbraid;
  if (row["Conversion Value"]) {
    conversion.conversionValue = Number(row["Conversion Value"]);
    conversion.currencyCode = row["Conversion Currency"] || "BRL";
  }
  if (row["Order ID"]) conversion.orderId = row["Order ID"];
  return conversion;
}

/* partialFailureError → { índice da conversão: mensagem } */
function partialFailures(response: Record<string, unknown>): Map<number, string> {
  const failures = new Map<number, string>();
  const partial = response?.partialFailureError as Record<string, any> | undefined;
  if (!partial) return failures;
  const details = (partial.details || []) as Record<string, any>[];
  details.forEach((detail) => {
    ((detail.errors || []) as Record<string, any>[]).forEach((item) => {
      const elements = (item.location?.fieldPathElements || []) as Record<string, any>[];
      const element = elements.find((entry) => entry.fieldName === "conversions" && entry.index !== undefined);
      const message = String(item.message || JSON.stringify(item.errorCode || {})).slice(0, 300);
      if (element) failures.set(Number(element.index), message);
      else failures.set(-1, message);
    });
  });
  if (!failures.size) failures.set(-1, String(partial.message || "Falha parcial no upload").slice(0, 300));
  return failures;
}

async function markEvents(ids: Array<number | string>, patch: Record<string, unknown>) {
  if (!ids.length) return;
  const supabase = serviceClient();
  await supabase.from("analytics_events").update(patch).in("id", ids);
}

async function flush(limit: number, force: boolean) {
  const config = await channelConfig();
  if (!config.enabled && !force) {
    return { read: 0, sent: 0, skipped: 0, errors: ["canal google-ads desabilitado no painel"] };
  }
  const missing = missingSecrets();
  if (missing.length) return { read: 0, sent: 0, skipped: 0, errors: [`Segredos faltando: ${missing.join(", ")}`] };
  if (!config.customer_id) return { read: 0, sent: 0, skipped: 0, errors: ["Cadastre o ID do cliente do Google Ads no painel"] };

  const events = await loadEvents(config, { pending: true, days: MAX_CLICK_AGE_DAYS, limit });
  const rows = rowsFor(events, config);
  const actions = await resolveActions(config);

  const uploadable = rows.filter((row) => actions[row.kind]);
  const skipped = rows.filter((row) => !actions[row.kind]);
  /* sem ação cadastrada (ex.: WhatsApp sem ação na conta) o evento fica
     marcado para não voltar a cada rodada */
  await markEvents(skipped.map((row) => row.event_id).filter((id) => id !== null) as Array<number | string>, {
    ads_uploaded_at: new Date().toISOString(),
    ads_upload_error: "sem ação de conversão cadastrada para este evento",
  });

  const errors: string[] = [];
  let sent = 0;
  for (let index = 0; index < uploadable.length; index += UPLOAD_BATCH) {
    const batch = uploadable.slice(index, index + UPLOAD_BATCH);
    const conversions = batch.map((row) => toClickConversion(row, config.customer_id, actions[row.kind]));
    try {
      const response = await googleAdsClient.uploadClickConversions(config.customer_id, conversions, {
        loginCustomerId: config.login_customer_id || undefined,
      });
      const failures = partialFailures(response);
      const general = failures.get(-1);
      const okIds: Array<number | string> = [];
      for (const [position, row] of batch.entries()) {
        const failure = failures.get(position) || general;
        if (failure) {
          errors.push(`#${row["Order ID"] || row["Google Click ID"]}: ${failure}`);
          if (row.event_id !== null) await markEvents([row.event_id], { ads_upload_error: failure });
        } else if (row.event_id !== null) {
          okIds.push(row.event_id);
        }
      }
      sent += okIds.length;
      await markEvents(okIds, { ads_uploaded_at: new Date().toISOString(), ads_upload_error: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(message);
      await markEvents(
        batch.map((row) => row.event_id).filter((id) => id !== null) as Array<number | string>,
        { ads_upload_error: message.slice(0, 300) },
      );
    }
  }

  return { read: rows.length, sent, skipped: skipped.length, errors: errors.slice(0, 10) };
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
    /* ------------------------------------------------------- CSV manual */
    if (payload?.export) {
      const config = await channelConfig();
      const days = Math.max(1, Math.min(MAX_CLICK_AGE_DAYS, Number(payload.days) || 30));
      const events = await loadEvents(config, { pending: payload.pending !== false, days, limit: 2000 });
      const rows = rowsFor(events, config);
      const stamp = new Date().toISOString().slice(0, 10);
      return json({
        rows: rows.filter((row) => row["Google Click ID"]).length,
        ios: rows.filter((row) => !row["Google Click ID"]).length,
        csv: toGoogleAdsCsv(rows),
        filename: `google-ads-conversoes-${stamp}.csv`,
        hint: "No Google Ads: Objetivos → Conversões → Uploads → enviar este arquivo. O nome da conversão precisa existir na conta.",
      });
    }

    /* ---------------------------------------------------- teste/conexão */
    if (payload?.test) {
      const config = await channelConfig();
      const missing = missingSecrets();
      const pending = await loadEvents(config, { pending: true, days: MAX_CLICK_AGE_DAYS, limit: 2000 });
      const base = {
        enabled: config.enabled,
        customer_id: config.customer_id,
        conversion_name: config.conversion_name,
        pending: rowsFor(pending, config).length,
      };
      if (missing.length) {
        return json({
          ...base,
          ok: false,
          missing,
          hint: "Sem os segredos a API não sobe conversões; use o CSV (Exportar conversões) para o upload manual.",
        });
      }
      if (!config.customer_id) {
        return json({ ...base, ok: false, hint: "Cadastre o ID do cliente do Google Ads (só números) em Configurar." });
      }
      const chunks = await googleAdsClient.conversionActions(config.customer_id, config.login_customer_id);
      const actions = (Array.isArray(chunks) ? chunks : [chunks])
        .flatMap((chunk) => ((chunk as Record<string, any>)?.results || []) as Record<string, any>[])
        .map((result) => result.conversionAction || {})
        .map((action) => ({
          id: String(action.id || ""),
          name: String(action.name || ""),
          type: String(action.type || ""),
        }));
      const purchaseAction = actions.find((action) => action.name.toLowerCase() === config.conversion_name.toLowerCase()
        || (config.conversion_action_id && action.id === config.conversion_action_id));
      return json({
        ...base,
        ok: Boolean(purchaseAction),
        actions,
        hint: purchaseAction
          ? `Conta conectada. Ação "${purchaseAction.name}" (id ${purchaseAction.id}) receberá as compras.`
          : `Conta conectada, mas a ação "${config.conversion_name}" não existe — crie-a no Google Ads (Objetivos → Conversões) ou informe o id.`,
      });
    }

    /* ------------------------------------------------------------ flush */
    if (payload?.flush) {
      const limit = Math.max(1, Math.min(2000, Number(payload.limit) || 200));
      return json(await flush(limit, Boolean(payload.force)));
    }

    return json({ error: "Envie {test:true}, {flush:true} ou {export:true}" }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
