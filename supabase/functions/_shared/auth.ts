/* Autenticação das Edge Functions de crescimento.
   Três portas de entrada, todas sem segredo no navegador:
     • sessão do painel com papel admin (botões de teste/publicação);
     • x-worker-secret (agendador: pg_cron → pg_net → função);
     • token de feed na URL (coleta agendada do Google Merchant Center). */

import { createClient } from "npm:@supabase/supabase-js@2";
import { requiredEnv } from "./http.ts";

export type ServiceClient = ReturnType<typeof createClient>;

export function serviceClient(): ServiceClient {
  return createClient(
    requiredEnv("SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  );
}

export type AdminCheck =
  | { ok: true; userId: string; role: string }
  | { ok: false; status: number; message: string };

export async function requireAdmin(
  request: Request,
  client: ServiceClient,
  roles: string[] = ["admin"],
): Promise<AdminCheck> {
  const { user, error } = await client.auth.getUser(request);
  if (error || !user) return { ok: false, status: 401, message: "Sessão inválida ou expirada" };
  const { data: profile } = await client
    .from("profiles")
    .select("role, active")
    .eq("id", user.id)
    .single();
  if (!profile?.active) return { ok: false, status: 403, message: "Usuário inativo" };
  if (!roles.includes(String(profile.role))) {
    return { ok: false, status: 403, message: "Papel sem permissão para operar canais" };
  }
  return { ok: true, userId: user.id, role: String(profile.role) };
}

export function workerSecretMatches(request: Request): boolean {
  const secret = Deno.env.get("INTEGRATION_WORKER_SECRET")?.trim();
  if (!secret) return false;
  return request.headers.get("x-worker-secret") === secret;
}

/* O Google busca o feed por URL; o token vai no segredo da consulta. */
export function feedTokenMatches(url: URL): boolean {
  const token = Deno.env.get("GOOGLE_MERCHANT_FEED_TOKEN")?.trim();
  if (!token) return false;
  return url.searchParams.get("token") === token;
}
