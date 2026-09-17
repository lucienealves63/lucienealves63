import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { requiredEnv } from "../_shared/http.ts";

/*
 * gerar-banner — geração de arte de banner por prompt de IA.
 *
 * Segredos (Supabase Secrets, nunca no navegador):
 *   BANNER_AI_PROVIDER  = "stability" (padrão) ou "openai"
 *   STABILITY_API_KEY   — quando o provedor for Stability
 *   OPENAI_API_KEY      — quando o provedor for OpenAI
 *   OPENAI_IMAGE_MODEL  — opcional, padrão "gpt-image-1"
 *
 * O navegador só envia o prompt; a chave da IA e a gravação no bucket
 * "banners" acontecem aqui, com service_role.
 */

const BANNERS_BUCKET = "banners";
const GENERATION_TIMEOUT_MS = 120_000;

type Aspect = "16:9" | "21:9" | "1:1";
type Style = "street-photography" | "graphic-art" | "abstract";

const STYLE_HINTS: Record<Style, string> = {
  "street-photography":
    "candid street photography, urban atmosphere, film grain, high contrast, no watermark",
  "graphic-art":
    "bold graphic poster, strong shapes, flat design, high contrast, no watermark",
  abstract:
    "abstract urban texture, heavy grain, minimal dark composition, no watermark",
};

const ASPECTS: Record<Aspect, { stability: string; openai: string }> = {
  "16:9": { stability: "16:9", openai: "1536x1024" },
  "21:9": { stability: "16:9", openai: "1536x1024" },
  "1:1": { stability: "1:1", openai: "1024x1024" },
};

function env(name: string): string {
  return Deno.env.get(name)?.trim() || "";
}

function withTimeout(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

async function generateWithStability(apiKey: string, prompt: string, aspect: Aspect): Promise<string> {
  const response = await fetch("https://api.stability.ai/v2beta/stable-image/generate/core", {
    method: "POST",
    signal: withTimeout(GENERATION_TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "image/*",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt,
      aspect_ratio: ASPECTS[aspect].stability,
      output_format: "jpeg",
      n: 1,
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Stability respondeu HTTP ${response.status} ${detail.slice(0, 200)}`.trim());
  }
  const body = (await response.json()) as Array<{ image?: string }>;
  const image = body[0]?.image;
  if (!image) throw new Error("A Stability não devolveu a imagem");
  return image;
}

async function generateWithOpenAI(apiKey: string, prompt: string, aspect: Aspect): Promise<string> {
  const model = env("OPENAI_IMAGE_MODEL") || "gpt-image-1";
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    signal: withTimeout(GENERATION_TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt,
      size: ASPECTS[aspect].openai,
      n: 1,
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`OpenAI respondeu HTTP ${response.status} ${detail.slice(0, 200)}`.trim());
  }
  const body = (await response.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
  const item = body.data?.[0];
  if (!item) throw new Error("A OpenAI não devolveu a imagem");
  if (item.b64_json) return item.b64_json;
  // Modelos que devolvem URL (ex.: dall-e-3)
  if (item.url) {
    const imageResponse = await fetch(item.url, { signal: withTimeout(GENERATION_TIMEOUT_MS) });
    if (!imageResponse.ok) throw new Error("Não foi possível baixar a imagem gerada");
    const bytes = new Uint8Array(await imageResponse.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  }
  throw new Error("Resposta da IA sem imagem");
}

function base64ToBlob(base64: string, contentType: string): Blob {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  return new Blob([bytes], { type: contentType });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Método não permitido" }, 405);

  const supabase = createClient(
    requiredEnv("SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  );

  // Só administradores do painel geram banners.
  const { user } = await supabase.auth.getUser(request);
  if (!user) return json({ error: "Sessão inválida ou expirada" }, 401);
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, active")
    .eq("id", user.id)
    .single();
  if (!profile?.active || profile.role !== "admin") {
    return json({ error: "Somente administradores podem gerar banners" }, 403);
  }

  let payload: { prompt?: unknown; style?: unknown; aspect?: unknown };
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Corpo da requisição inválido" }, 400);
  }

  const prompt = String(payload.prompt ?? "").trim();
  if (!prompt) return json({ error: "Descreva o banner no prompt para gerar a imagem." }, 400);
  if (prompt.length > 500) return json({ error: "Prompt muito longo (máximo 500 caracteres)" }, 400);

  const style: Style = STYLE_HINTS[payload.style as Style] ? (payload.style as Style) : "street-photography";
  const aspect: Aspect = ASPECTS[payload.aspect as Aspect] ? (payload.aspect as Aspect) : "16:9";
  const fullPrompt = `${prompt}. ${STYLE_HINTS[style]}. Leave clean negative space on the left side for title text.`;

  const provider = (env("BANNER_AI_PROVIDER") || "stability").toLowerCase();
  let base64: string;
  try {
    if (provider === "openai") {
      base64 = await generateWithOpenAI(requiredEnv("OPENAI_API_KEY"), fullPrompt, aspect);
    } else if (provider === "stability") {
      base64 = await generateWithStability(requiredEnv("STABILITY_API_KEY"), fullPrompt, aspect);
    } else {
      return json({ error: `Provedor de IA desconhecido: ${provider}` }, 500);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao chamar o provedor de IA";
    if (message.includes("Segredo obrigatório")) {
      return json({ error: "A IA ainda não foi configurada no servidor (segredos ausentes)" }, 503);
    }
    return json({ error: `Não foi possível gerar a imagem: ${message}` }, 502);
  }

  const path = `ia/${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}.jpg`;
  const { error: uploadError } = await supabase.storage
    .from(BANNERS_BUCKET)
    .upload(path, base64ToBlob(base64, "image/jpeg"), { contentType: "image/jpeg" });
  if (uploadError) {
    return json({ error: `Falha ao salvar a imagem gerada: ${uploadError.message}` }, 500);
  }

  return json({ ok: true, image_path: path, provider });
});
