import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { requiredEnv } from "../_shared/http.ts";

const supabase = createClient(
  requiredEnv("SUPABASE_URL"),
  requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false } },
);

const approved = new Set(["APA", "APM"]);
const denied = new Set(["RPM", "SUS", "CAN", "FRD", "RPA", "RPP"]);
const review = new Set(["AMA", "NVO", "APG"]);

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Método não permitido" }, 405);

  if (request.headers.get("clearsale-apikey") !== requiredEnv("CLEARSALE_WEBHOOK_API_KEY")) {
    return json({ error: "Assinatura inválida" }, 401);
  }

  const payload = await request.json();
  const orderNumber = String(payload.ID || payload.Id || payload.id || "");
  const status = String(payload.Status || payload.STATUS || payload.status || "").toUpperCase();
  const score = Number(payload.Score || payload.score || 0);
  if (!orderNumber || !status) return json({ error: "ID e Status são obrigatórios" }, 400);

  const nextFraud = approved.has(status) ? "approved" : denied.has(status) ? "denied" : review.has(status) ? "review" : "error";
  const { data: current, error: findError } = await supabase
    .from("orders")
    .select("id, number, payment_status, fraud_status, stage, clearsale_score, version")
    .eq("number", orderNumber)
    .single();
  if (findError) return json({ error: findError.message }, 404);

  // Antifraude aprovado só libera separação depois da captura. Se a captura
  // ainda não ocorreu, o pedido volta para a etapa de pagamento.
  const paid = current.payment_status === "captured";
  const nextStage = approved.has(status) ? (paid ? "picking" : "payment") : denied.has(status) ? "cancelled" : "fraud";
  const duplicate = current.fraud_status === nextFraud && current.stage === nextStage && Number(current.clearsale_score || 0) === score;
  if (duplicate) return json({ received: true, duplicate: true, order: current.number, fraudStatus: nextFraud });

  const { data: order, error } = await supabase
    .from("orders")
    .update({ fraud_status: nextFraud, stage: nextStage, clearsale_score: score })
    .eq("id", current.id)
    .eq("version", current.version)
    .select("id, number, payment_status")
    .single();
  if (error) return json({ error: error.message }, 500);

  await supabase.from("order_events").insert({
    order_id: order.id,
    from_stage: current.stage,
    event_type: "clearsale.status",
    to_stage: nextStage,
    note: `ClearSale ${status}`,
    metadata: { status, score },
  });

  // Aprovação libera a próxima etapa. Recusa gera evento de cancelamento na
  // e.Rede quando houver uma transação autorizada; a operação exata será
  // habilitada após homologação do contrato de cancelamento/captura.
  return json({ received: true, order: order.number, fraudStatus: nextFraud });
});
