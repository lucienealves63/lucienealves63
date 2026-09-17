import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { requiredEnv } from "../_shared/http.ts";
import { redeClient } from "../_shared/rede.ts";
import { clearSaleClient } from "../_shared/clearsale.ts";
import { alterdataClient } from "../_shared/alterdata.ts";

const supabase = createClient(
  requiredEnv("SUPABASE_URL"),
  requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false } },
);

async function execute(job: Record<string, any>) {
  if (job.service === "rede" && job.operation === "transaction.create") {
    return redeClient.createTransaction(job.payload);
  }
  if (job.service === "rede" && job.operation === "transaction.get") {
    return redeClient.getTransaction(job.payload.tid);
  }
  if (job.service === "clearsale" && job.operation === "order.send") {
    return clearSaleClient.sendOrder(job.payload);
  }
  if (job.service === "clearsale" && job.operation === "order.get") {
    return clearSaleClient.getOrder(job.payload.orderId);
  }
  if (job.service === "clearsale" && job.operation === "order.update") {
    return clearSaleClient.updateOrder(job.payload.orderId, job.payload.status);
  }
  if (job.service === "alterdata" && job.operation === "order.push") {
    return alterdataClient.pushOrder(job.payload);
  }
  if (job.service === "alterdata" && job.operation === "catalog.pull") {
    return alterdataClient.pullCatalog(job.payload?.cursor);
  }
  if (job.service === "alterdata" && job.operation === "inventory.pull") {
    return alterdataClient.pullInventory(job.payload?.cursor);
  }
  if (job.service === "alterdata" && job.operation === "inventory.update") {
    return alterdataClient.pushInventory(job.payload);
  }
  throw new Error(`Operação não suportada: ${job.service}/${job.operation}`);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.headers.get("x-worker-secret") !== requiredEnv("INTEGRATION_WORKER_SECRET")) {
    return json({ error: "Não autorizado" }, 401);
  }

  const staleBefore = new Date(Date.now() - 15 * 60_000).toISOString();
  await supabase.from("integration_outbox").update({
    status: "failed",
    locked_at: null,
    next_attempt_at: new Date().toISOString(),
    last_error: "Processamento anterior expirou antes da confirmação",
  }).eq("status", "processing").lt("locked_at", staleBefore);

  const { data: jobs, error } = await supabase
    .from("integration_outbox")
    .select("*")
    .in("status", ["pending", "failed"])
    .lte("next_attempt_at", new Date().toISOString())
    .order("created_at")
    .limit(20);
  if (error) return json({ error: error.message }, 500);

  const { data: connections, error: connectionError } = await supabase
    .from("integration_connections")
    .select("id")
    .eq("enabled", true);
  if (connectionError) return json({ error: connectionError.message }, 500);
  const enabledServices = new Set((connections || []).map((item) => item.id));

  const results = [];
  for (const job of (jobs || []).filter((item) => enabledServices.has(item.service))) {
    const { data: claimed, error: claimError } = await supabase
      .from("integration_outbox")
      .update({
        status: "processing",
        locked_at: new Date().toISOString(),
        attempts: job.attempts + 1,
      })
      .eq("id", job.id)
      .in("status", ["pending", "failed"])
      .select("id")
      .maybeSingle();
    if (claimError) {
      results.push({ id: job.id, status: "claim_failed", error: claimError.message });
      continue;
    }
    if (!claimed) continue;

    try {
      const response = await execute(job);
      await supabase.from("integration_outbox").update({
        status: "done",
        response,
        completed_at: new Date().toISOString(),
        locked_at: null,
        last_error: null,
      }).eq("id", job.id).eq("status", "processing").eq("attempts", job.attempts + 1);
      results.push({ id: job.id, status: "done" });
    } catch (error) {
      const attempts = job.attempts + 1;
      const dead = attempts >= 8;
      const waitMinutes = Math.min(360, 2 ** attempts);
      await supabase.from("integration_outbox").update({
        status: dead ? "dead_letter" : "failed",
        last_error: error instanceof Error ? error.message : String(error),
        next_attempt_at: new Date(Date.now() + waitMinutes * 60_000).toISOString(),
        locked_at: null,
      }).eq("id", job.id).eq("status", "processing").eq("attempts", attempts);
      results.push({ id: job.id, status: dead ? "dead_letter" : "failed" });
    }
  }

  return json({ processed: results.length, results });
});
