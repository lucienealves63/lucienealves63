import { requestJson, requiredEnv } from "./http.ts";

type AuthResponse = {
  Token: { Value: string; ExpirationDate: string };
};

type CachedToken = { value: string; expiresAt: number };
let cachedToken: CachedToken | null = null;

function baseUrl(): string {
  return Deno.env.get("CLEARSALE_ENV") === "production"
    ? "https://global-api.clear.sale"
    : "https://sandbox-global-api.clear.sale";
}

function apiKey(): string {
  return requiredEnv("CLEARSALE_API_KEY");
}

async function loginToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const result = await requestJson<AuthResponse>(`${baseUrl()}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", analysisLocation: "BRA" },
    body: JSON.stringify({
      Login: {
        ApiKey: apiKey(),
        ClientId: requiredEnv("CLEARSALE_CLIENT_ID"),
        ClientSecret: requiredEnv("CLEARSALE_CLIENT_SECRET"),
      },
    }),
  });
  cachedToken = {
    value: result.Token.Value,
    expiresAt: new Date(result.Token.ExpirationDate).getTime(),
  };
  return cachedToken.value;
}

async function authorizedBody(extra: Record<string, unknown>) {
  return {
    ApiKey: apiKey(),
    LoginToken: await loginToken(),
    AnalysisLocation: "BRA",
    ...extra,
  };
}

export const clearSaleClient = {
  async sendOrder(order: Record<string, unknown>) {
    return requestJson<Record<string, unknown>>(`${baseUrl()}/api/order/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", analysisLocation: "BRA" },
      body: JSON.stringify(await authorizedBody({ Orders: [order] })),
    });
  },

  async getOrder(orderId: string) {
    return requestJson<Record<string, unknown>>(`${baseUrl()}/api/order/get`, {
      method: "POST",
      headers: { "Content-Type": "application/json", analysisLocation: "BRA" },
      body: JSON.stringify(await authorizedBody({ Orders: [orderId] })),
    });
  },

  async updateOrder(orderId: string, status: string) {
    return requestJson<Record<string, unknown>>(`${baseUrl()}/api/order/updatestatus`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", analysisLocation: "BRA" },
      body: JSON.stringify(await authorizedBody({ ID: orderId, Status: status })),
    });
  },
};
