import { requestJson, requiredEnv } from "./http.ts";

/**
 * Adaptador do Alterdata Moda/Muven.
 * Os caminhos ficam parametrizados porque variam conforme produto, versão e
 * contrato habilitado pela Alterdata. Preencha somente após receber o manual
 * do ambiente de homologação usado pela Censura 18.
 */
function endpoint(name: string): string {
  const base = requiredEnv("ALTERDATA_BASE_URL").replace(/\/$/, "");
  const path = requiredEnv(name);
  return `${base}/${path.replace(/^\//, "")}`;
}

function headers(): HeadersInit {
  const authType = Deno.env.get("ALTERDATA_AUTH_TYPE") || "Bearer";
  return {
    Authorization: `${authType} ${requiredEnv("ALTERDATA_TOKEN")}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

export const alterdataClient = {
  pullCatalog(cursor?: string) {
    const url = new URL(endpoint("ALTERDATA_CATALOG_PATH"));
    if (cursor) url.searchParams.set("cursor", cursor);
    return requestJson<Record<string, unknown>>(url.toString(), {
      method: "GET",
      headers: headers(),
    });
  },

  pullInventory(cursor?: string) {
    const url = new URL(endpoint("ALTERDATA_INVENTORY_PATH"));
    if (cursor) url.searchParams.set("cursor", cursor);
    return requestJson<Record<string, unknown>>(url.toString(), {
      method: "GET",
      headers: headers(),
    });
  },

  pushInventory(balance: Record<string, unknown>) {
    return requestJson<Record<string, unknown>>(endpoint("ALTERDATA_INVENTORY_UPDATE_PATH"), {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(balance),
    });
  },

  pushOrder(order: Record<string, unknown>) {
    return requestJson<Record<string, unknown>>(endpoint("ALTERDATA_ORDERS_PATH"), {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(order),
    });
  },
};
