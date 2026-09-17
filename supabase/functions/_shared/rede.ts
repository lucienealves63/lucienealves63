import { requestJson, requiredEnv } from "./http.ts";

type OAuthToken = { access_token: string; token_type: string; expires_in: number };
type CachedToken = { value: string; expiresAt: number };

let cachedToken: CachedToken | null = null;

const endpoints = {
  sandbox: {
    token: "https://rl7-sandbox-api.useredecloud.com.br/oauth2/token",
    transactions: "https://sandbox-erede.useredecloud.com.br/v1/transactions",
  },
  production: {
    token: "https://api.userede.com.br/redelabs/oauth2/token",
    transactions: "https://api.userede.com.br/erede/v1/transactions",
  },
};

function environment(): keyof typeof endpoints {
  return Deno.env.get("REDE_ENV") === "production" ? "production" : "sandbox";
}

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;

  const clientId = requiredEnv("REDE_CLIENT_ID");
  const clientSecret = requiredEnv("REDE_CLIENT_SECRET");
  const basic = btoa(`${clientId}:${clientSecret}`);
  const token = await requestJson<OAuthToken>(endpoints[environment()].token, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  cachedToken = {
    value: token.access_token,
    expiresAt: Date.now() + Math.max(60, token.expires_in) * 1_000,
  };
  return cachedToken.value;
}

async function redeRequest<T>(path: string, init: RequestInit): Promise<T> {
  const token = await accessToken();
  return requestJson<T>(`${endpoints[environment()].transactions}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers || {}),
    },
  });
}

function luhn(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (double) { digit *= 2; if (digit > 9) digit -= 9; }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

function containsSensitiveCardData(value: unknown, key = ""): boolean {
  if (/(card.?number|numero.?cartao|security.?code|cvv|cvc|card.?pan|^pan$)/i.test(key)) return true;
  if (typeof value === "string" && luhn(value)) return true;
  if (Array.isArray(value)) return value.some((item) => containsSensitiveCardData(item));
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .some(([childKey, child]) => containsSensitiveCardData(child, childKey));
  }
  return false;
}

/**
 * Payload conforme o contrato homologado da e.Rede. Dados completos de cartão
 * jamais devem ser persistidos na outbox, nos logs ou no banco da aplicação.
 * O checkout deverá enviar credencial/token transitório e dados 3DS.
 */
export const redeClient = {
  createTransaction(payload: Record<string, unknown>) {
    if (containsSensitiveCardData(payload)) {
      throw new Error("A outbox não aceita número de cartão ou CVV. Use tokenização/credencial transitória.");
    }
    return redeRequest<Record<string, unknown>>("", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  getTransaction(tid: string) {
    return redeRequest<Record<string, unknown>>(`/${encodeURIComponent(tid)}`, {
      method: "GET",
    });
  },
};
