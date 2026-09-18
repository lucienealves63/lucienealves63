/* ==========================================================================
   CENSURA 18 — cotar-frete (Edge Function)
   --------------------------------------------------------------------------
   POST /functions/v1/cotar-frete
   Body: { "cep": "25000000", "items": [{ "qty": 2, "weightKg": 0.3 }],
           "subtotal": 259.80 }

   Resposta: { "cep", "zona", "options": [ … ], "avisos": [ … ] }

   Sem nenhum segredo configurado responde com a tabela padrão da loja
   (estimativa). Com os segredos de cada transportadora, mistura as
   cotações reais (source: "api") com as estimativas (source: "estimativa").
   Veja docs/FRETE-ENTREGAS.md para a implantação de cada transportadora.
   ========================================================================== */
import { corsHeaders, json } from "../_shared/cors.ts";
import { cotarFrete } from "../_shared/carriers.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") {
    return json({ error: "Use POST com { cep, items, subtotal }" }, 405);
  }

  try {
    const payload = await request.json().catch(() => null);
    const cep = String((payload as any)?.cep ?? "");
    if (!/^\d{8}$/.test(cep)) {
      return json({ error: "Informe um CEP com 8 dígitos" }, 400);
    }

    const resultado = await cotarFrete({
      cep,
      items: Array.isArray((payload as any)?.items) ? (payload as any).items : [],
      subtotal: Number((payload as any)?.subtotal) || 0,
    });

    return json(resultado);
  } catch (erro) {
    console.error("cotar-frete:", erro);
    return json({ error: "Não foi possível cotar o frete agora" }, 500);
  }
});
