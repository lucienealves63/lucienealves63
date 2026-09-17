export const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("PUBLIC_APP_ORIGIN") || "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-worker-secret, clearsale-apikey",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
};

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}
