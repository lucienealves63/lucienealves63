export class IntegrationError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
  }
}

export async function requestJson<T>(
  url: string,
  init: RequestInit,
  timeoutMs = 20_000,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text.slice(0, 2_000);
    }
    if (!response.ok) {
      throw new IntegrationError(
        `Integração respondeu HTTP ${response.status}`,
        response.status,
        body,
      );
    }
    return body as T;
  } finally {
    clearTimeout(timeout);
  }
}

export function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Segredo obrigatório não configurado: ${name}`);
  return value;
}
