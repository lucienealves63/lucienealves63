/* ==========================================================================
   CENSURA 18 — adaptadores de frete e entregas (servidor)
   --------------------------------------------------------------------------
   Cota frete com as transportadoras da loja. Cada provedor real só é
   chamado quando os segredos dele estão configurados no Supabase
   (`supabase secrets set …`); sem credenciais — ou se a API falhar —
   a cotação cai automaticamente na TABELA_PADRAO (estimativa por zona
   de CEP + peso). A resposta nunca fica sem opções.

   Provedores:

   · Correios (PAC/SEDEX)   API nova REST — Precisa de contrato
                            CORREIOS_USUARIO / CORREIOS_SENHA /
                            CORREIOS_CARTAO_POSTAGEM (+ CORREIOS_API_BASE
                            para apontar ao homolog: apihom.correios.com.br)
   · Mercado Envios         API do Mercado Livre com token de vendedor
                            MERCADO_ENVIOS_TOKEN (+ MERCADO_ENVIOS_USER_ID)
   · Uber Direct            OAuth client_credentials + delivery_quotes
                            UBER_DIRECT_CUSTOMER_ID / CLIENT_ID / SECRET
                            (+ UBER_DIRECT_PICKUP com o endereço de coleta)
   · 99 Entregas            adaptador do parceiro empresarial
                            ENTREGAS99_QUOTE_URL / ENTREGAS99_TOKEN
   ========================================================================== */
import { requestJson } from "./http.ts";

/* ------------------------------------------------------------- modelo */
export interface ItemCotacao {
  qty: number;
  weightKg?: number;
}

export interface OpcaoFrete {
  id: string;
  transportadora: string;
  servico: string;
  modal: string;
  escopo: string;
  preco: number;
  prazoTexto: string;
  dias: number;
  gratis: boolean;
  source: "api" | "estimativa";
}

const CARREIRAS: Record<
  string,
  { transportadora: string; servico: string; modal: string; escopo: string; extraKg: number; pesoLimite: number }
> = {
  "correios-pac": { transportadora: "Correios", servico: "PAC", modal: "economica", escopo: "nacional", extraKg: 6.9, pesoLimite: 30 },
  "correios-sedex": { transportadora: "Correios", servico: "SEDEX", modal: "expressa", escopo: "nacional", extraKg: 9.9, pesoLimite: 30 },
  "mercado-envios": { transportadora: "Mercado Envios", servico: "Envio padrão", modal: "economica", escopo: "nacional", extraKg: 7.9, pesoLimite: 25 },
  "uber-direct": { transportadora: "Uber", servico: "Uber Direct — mesmo dia", modal: "mesmo-dia", escopo: "local", extraKg: 0, pesoLimite: 20 },
  "entregas-99": { transportadora: "99 Entregas", servico: "Entrega expressa — mesmo dia", modal: "mesmo-dia", escopo: "local", extraKg: 0, pesoLimite: 20 },
  "retirada-loja": { transportadora: "Censura 18", servico: "Retirar na loja", modal: "retirada", escopo: "retirada", extraKg: 0, pesoLimite: 0 },
};

/* Zonas e tabela padrão — espelham assets/js/frete.js (mantenha em sync). */
function zonaDoCep(cep: string): string | null {
  const digits = String(cep).replace(/\D+/g, "");
  if (digits.length !== 8) return null;
  const n = Number(digits);
  if (n >= 20000000 && n <= 23799999) return "rj-capital";
  if (n >= 23800000 && n <= 23999999) return "rj-baixada";
  if (n >= 24000000 && n <= 24999999) return "rj-leste";
  if (
    (n >= 25000000 && n <= 25599999) ||
    (n >= 25900000 && n <= 25949999) ||
    (n >= 26000000 && n <= 26999999)
  ) {
    return "rj-baixada";
  }
  if (n >= 25600000 && n <= 28999999) return "rj-interior";
  const primeiro = Math.floor(n / 10000000);
  if (primeiro <= 3) return "sudeste";
  if (primeiro === 4 || primeiro === 5) return "nordeste";
  if (primeiro === 6) return "norte";
  if (primeiro === 7) return "centro-oeste";
  return "sul";
}

type Entrada = [number, string, number];

const TABELA_PADRAO: Record<string, Record<string, Entrada>> = {
  "rj-capital": {
    "correios-pac": [19.9, "2 a 3 dias úteis", 3],
    "correios-sedex": [29.9, "1 dia útil", 1],
    "mercado-envios": [24.9, "2 a 3 dias úteis", 2],
    "uber-direct": [24.9, "2 a 4 horas — hoje", 0],
    "entregas-99": [22.9, "2 a 4 horas — hoje", 0],
  },
  "rj-baixada": {
    "correios-pac": [19.9, "2 a 3 dias úteis", 3],
    "correios-sedex": [27.9, "1 dia útil", 1],
    "mercado-envios": [24.9, "2 a 4 dias úteis", 3],
    "uber-direct": [27.9, "2 a 5 horas — hoje", 0],
    "entregas-99": [24.9, "2 a 5 horas — hoje", 0],
  },
  "rj-leste": {
    "correios-pac": [21.9, "2 a 4 dias úteis", 3],
    "correios-sedex": [29.9, "1 a 2 dias úteis", 2],
    "mercado-envios": [26.9, "2 a 4 dias úteis", 3],
    "uber-direct": [29.9, "2 a 5 horas — hoje", 0],
    "entregas-99": [26.9, "2 a 5 horas — hoje", 0],
  },
  "rj-interior": {
    "correios-pac": [24.9, "3 a 5 dias úteis", 4],
    "correios-sedex": [34.9, "2 dias úteis", 2],
    "mercado-envios": [29.9, "3 a 5 dias úteis", 4],
  },
  sudeste: {
    "correios-pac": [29.9, "4 a 7 dias úteis", 6],
    "correios-sedex": [44.9, "2 a 3 dias úteis", 3],
    "mercado-envios": [34.9, "4 a 6 dias úteis", 5],
  },
  sul: {
    "correios-pac": [39.9, "7 a 11 dias úteis", 9],
    "correios-sedex": [64.9, "3 a 4 dias úteis", 4],
    "mercado-envios": [44.9, "6 a 9 dias úteis", 8],
  },
  "centro-oeste": {
    "correios-pac": [42.9, "8 a 12 dias úteis", 10],
    "correios-sedex": [69.9, "3 a 5 dias úteis", 4],
    "mercado-envios": [47.9, "7 a 10 dias úteis", 9],
  },
  nordeste: {
    "correios-pac": [44.9, "9 a 13 dias úteis", 11],
    "correios-sedex": [74.9, "4 a 6 dias úteis", 5],
    "mercado-envios": [49.9, "8 a 11 dias úteis", 10],
  },
  norte: {
    "correios-pac": [54.9, "12 a 16 dias úteis", 14],
    "correios-sedex": [89.9, "5 a 8 dias úteis", 6],
    "mercado-envios": [59.9, "10 a 14 dias úteis", 12],
  },
};

const FRETE_GRATIS_PADRAO = 299;
const PESO_POR_PECA = 0.3;

const round2 = (v: number) => Math.round(v * 100) / 100;

function pesoKg(items: ItemCotacao[]): number {
  const total = (items || []).reduce((soma, item) => {
    const qty = Math.max(0, Math.round(Number(item?.qty) || 0));
    const peso = Math.max(0, Number(item?.weightKg ?? PESO_POR_PECA));
    return soma + qty * peso;
  }, 0);
  return round2(total);
}

function opcaoPadrao(id: string, entrada: Entrada): OpcaoFrete {
  const carrier = CARREIRAS[id];
  return {
    id,
    transportadora: carrier.transportadora,
    servico: carrier.servico,
    modal: carrier.modal,
    escopo: carrier.escopo,
    preco: entrada[0],
    prazoTexto: entrada[1],
    dias: entrada[2],
    gratis: false,
    source: "estimativa",
  };
}

/* Cotação base (estimativa) — espelha assets/js/frete.js */
export function cotacaoPadrao(
  cep: string,
  items: ItemCotacao[],
  subtotal: number,
  freteGratisAPartir = FRETE_GRATIS_PADRAO,
): { cep: string; zona: string | null; options: OpcaoFrete[] } {
  const zona = zonaDoCep(cep);
  if (!zona) return { cep: String(cep), zona: null, options: [] };
  const peso = pesoKg(items);
  const options: OpcaoFrete[] = [];

  for (const [id, entrada] of Object.entries(TABELA_PADRAO[zona])) {
    const carrier = CARREIRAS[id];
    if (peso > carrier.pesoLimite) continue;
    const kgsExtras = Math.max(0, Math.ceil(peso - 1));
    let preco = entrada[0] + kgsExtras * carrier.extraKg;
    let gratis = false;
    if (id === "correios-pac" && subtotal >= freteGratisAPartir) {
      preco = 0;
      gratis = true;
    }
    options.push({ ...opcaoPadrao(id, entrada), preco: round2(preco), gratis });
  }

  options.push({
    id: "retirada-loja",
    ...{
      transportadora: CARREIRAS["retirada-loja"].transportadora,
      servico: CARREIRAS["retirada-loja"].servico,
      modal: "retirada",
      escopo: "retirada",
    },
    preco: 0,
    prazoTexto: "pronto para retirar hoje",
    dias: 0,
    gratis: true,
    source: "estimativa",
  } as OpcaoFrete);

  options.sort(
    (a, b) => a.dias - b.dias || a.preco - b.preco || a.transportadora.localeCompare(b.transportadora),
  );
  return { cep, zona, options };
}

/* Substitui a estimativa de um serviço por cotação real (source: "api"). */
function mesclarOpcoes(base: OpcaoFrete[], novas: OpcaoFrete[]): OpcaoFrete[] {
  const porId = new Map<string, OpcaoFrete>();
  base.forEach((op) => porId.set(op.id, op));
  novas.forEach((op) => porId.set(op.id, op));
  return [...porId.values()].sort(
    (a, b) => a.dias - b.dias || a.preco - b.preco || a.transportadora.localeCompare(b.transportadora),
  );
}

const opcional = (nome: string): string | null => {
  const valor = Deno.env.get(nome)?.trim();
  return valor ? valor : null;
};

/* ------------------------------------------------------- Correios (REST)
   API nova: /token/v1/autentica/cartaopostagem → Bearer JWT (expira ~1h).
   Preço: POST /preco/v1/nacional · Prazo: POST /prazo/v1/nacional.
   Produtos padrão: PAC 04510 / SEDEX 04014 (sem contrato). Com contrato
   defina CORREIOS_PRODUTO_PAC / CORREIOS_PRODUTO_SEDEX (ex.: 04669/04162). */
interface CorreiosTokenCache {
  token: string;
  expiraEm: number;
}
let correiosToken: CorreiosTokenCache | null = null;

async function correiosAuth(): Promise<string | null> {
  const usuario = opcional("CORREIOS_USUARIO");
  const senha = opcional("CORREIOS_SENHA");
  const cartao = opcional("CORREIOS_CARTAO_POSTAGEM");
  if (!usuario || !senha || !cartao) return null;

  if (correiosToken && correiosToken.expiraEm > Date.now() + 60_000) {
    return correiosToken.token;
  }
  const base = opcional("CORREIOS_API_BASE") || "https://api.correios.com.br";
  const auth = btoa(`${usuario}:${senha}`);
  const data = await requestJson<{ token: string; expires_in?: string | number }>(
    `${base}/token/v1/autentica/cartaopostagem`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
      body: JSON.stringify({ numero: cartao }),
    },
    10_000,
  );
  const token = String((data as any)?.token || "");
  if (!token) throw new Error("Correios não devolveu token");
  const segundos = Number((data as any)?.expires_in) || 3600;
  correiosToken = { token, expiraEm: Date.now() + segundos * 1000 };
  return token;
}

function dimensoesPadrao() {
  /* caixa padrão da loja (cm) e peso em gramas — ajuste se precisar */
  return { comprimento: 30, altura: 15, largura: 20, diametro: 0 };
}

async function correiosQuote(
  cepOrigem: string,
  cepDestino: string,
  peso: number,
): Promise<OpcaoFrete[] | null> {
  const token = await correiosAuth();
  if (!token) return null;
  const base = opcional("CORREIOS_API_BASE") || "https://api.correios.com.br";
  const produtos: Array<{ id: string; codigo: string }> = [];
  const pacCodigo = opcional("CORREIOS_PRODUTO_PAC") || "04510";
  const sedexCodigo = opcional("CORREIOS_PRODUTO_SEDEX") || "04014";
  produtos.push({ id: "correios-pac", codigo: pacCodigo });
  produtos.push({ id: "correios-sedex", codigo: sedexCodigo });

  const dim = dimensoesPadrao();
  const pesoGramas = String(Math.max(10, Math.round(peso * 1000)));
  const hoje = new Date().toISOString().slice(0, 10);

  const corpo = (codigo: string) => ({
    idLote: "c18-frete",
    parametrosProduto: [
      {
        coProduto: codigo,
        nuRequisicao: 1,
        cepOrigem,
        cepDestino,
        psObjeto: pesoGramas,
        tpObjeto: "2",
        nuComprimento: String(dim.comprimento),
        nuAltura: String(dim.altura),
        nuLargura: String(dim.largura),
        nuDiagonal: String(dim.diametro),
        tpServicoAdicional: ["019"], /* AV — aviso de recebimento opcional */
      },
    ],
  });

  const authHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  const [precos, prazos] = await Promise.all([
    requestJson<any[]>(`${base}/preco/v1/nacional`, { method: "POST", headers: authHeaders, body: JSON.stringify({
      idLote: "c18-frete",
      parametrosProduto: produtos.map((p) => corpo(p.codigo).parametrosProduto[0]),
    }) }, 12_000),
    requestJson<any[]>(`${base}/prazo/v1/nacional`, { method: "POST", headers: authHeaders, body: JSON.stringify({
      idLote: "c18-frete",
      parametrosPrazo: produtos.map((p) => ({
        coProduto: p.codigo,
        nuRequisicao: 1,
        cepOrigem,
        cepDestino,
        dataPostagem: hoje,
      })),
    }) }, 12_000),
  ]);

  const prazoPorCodigo = new Map<string, number>();
  (Array.isArray(prazos) ? prazos : []).forEach((item: any) => {
    if (item?.coProduto && Number.isFinite(Number(item?.prazoEntrega))) {
      prazoPorCodigo.set(String(item.coProduto), Number(item.prazoEntrega));
    }
  });

  const resultados: OpcaoFrete[] = [];
  (Array.isArray(precos) ? precos : []).forEach((item: any) => {
    const codigo = String(item?.coProduto || "");
    const produto = produtos.find((p) => p.codigo === codigo);
    const preco = Number(String(item?.pcFinal ?? "").replace(",", "."));
    if (!produto || !Number.isFinite(preco) || preco <= 0) return;
    const dias = prazoPorCodigo.get(codigo) ?? (produto.id === "correios-sedex" ? 2 : 5);
    resultados.push({
      id: produto.id,
      transportadora: CARREIRAS[produto.id].transportadora,
      servico: CARREIRAS[produto.id].servico,
      modal: CARREIRAS[produto.id].modal,
      escopo: "nacional",
      preco: round2(preco),
      prazoTexto: dias <= 1 ? "1 dia útil" : `${dias} dias úteis`,
      dias,
      gratis: false,
      source: "api",
    });
  });
  return resultados.length ? resultados : null;
}

/* ---------------------------------------------- Mercado Envios (Mercado Livre)
   Requer token de vendedor (MERCADO_ENVIOS_TOKEN). O endpoint público de
   simulação usa o user_id da conta: /users/{id}/shipping_quote não existe
   sem sessão; usamos o calculator com dimensões padrão da loja. */
async function mercadoEnviosQuote(
  cepDestino: string,
  peso: number,
  subtotal: number,
): Promise<OpcaoFrete[] | null> {
  const token = opcional("MERCADO_ENVIOS_TOKEN");
  if (!token) return null;
  const cepOrigem = opcional("ORIGEM_CEP") || "26275280";
  const dim = dimensoesPadrao();
  const dims = `${dim.comprimento}x${dim.altura}x${dim.largura},${Math.max(10, Math.round(peso * 1000))}`;
  const url =
    `https://api.mercadolibre.com/sites/MLB/shipping_options` +
    `?zip_code_origin=${cepOrigem}&zip_code=${cepDestino}` +
    `&dimensions=${encodeURIComponent(dims)}&item_price=${Math.round(subtotal * 100) / 100}`;
  const data = await requestJson<any>(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  }, 12_000);

  const opcoes: OpcaoFrete[] = (Array.isArray(data?.options) ? data.options : [])
    .map((opt: any) => {
      const preco = Number(opt?.cost || opt?.price);
      if (!Number.isFinite(preco) || preco < 0) return null;
      const eta = opt?.estimated_delivery?.date ? 
        Math.max(1, Math.ceil((new Date(opt.estimated_delivery.date).getTime() - Date.now()) / 86_400_000)) :
        (opt?.estimated_delivery?.time === "same_day" ? 0 : 3);
      return {
        id: "mercado-envios",
        transportadora: CARREIRAS["mercado-envios"].transportadora,
        servico: String(opt?.name || CARREIRAS["mercado-envios"].servico).slice(0, 64),
        modal: "economica",
        escopo: "nacional",
        preco: round2(preco),
        prazoTexto: eta <= 0 ? "2 a 4 horas — hoje" : eta === 1 ? "1 dia útil" : `${eta} dias úteis`,
        dias: eta,
        gratis: preco === 0,
        source: "api" as const,
      };
    })
    .filter(Boolean) as OpcaoFrete[];
  return opcoes.length ? opcoes : null;
}

/* --------------------------------------------------------- Uber Direct
   OAuth client_credentials → POST /v1/customers/{id}/delivery_quotes.
   Local apenas (Rio de Janeiro e Baixada): exige endereço de coleta em
   UBER_DIRECT_PICKUP (JSON com street_address/city/state/zip_code). */
async function uberToken(): Promise<string | null> {
  const clientId = opcional("UBER_DIRECT_CLIENT_ID");
  const clientSecret = opcional("UBER_DIRECT_CLIENT_SECRET");
  if (!clientId || !clientSecret) return null;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials",
    scope: "direct.delivery",
  });
  const data = await requestJson<{ access_token: string }>(
    "https://auth.uber.com/oauth/v2/token",
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body },
    10_000,
  );
  return data?.access_token || null;
}

async function uberDirectQuote(
  cepDestino: string,
  zona: string | null,
): Promise<OpcaoFrete[] | null> {
  if (!zona || !["rj-capital", "rj-baixada", "rj-leste"].includes(zona)) return null;
  const customerId = opcional("UBER_DIRECT_CUSTOMER_ID");
  const pickupRaw = opcional("UBER_DIRECT_PICKUP");
  if (!customerId || !pickupRaw) return null;

  const token = await uberToken();
  if (!token) return null;

  const pickup = JSON.parse(pickupRaw);
  const dropoff = {
    street_address: ["Entrega por CEP"],
    city: zona === "rj-capital" ? "Rio de Janeiro" : "Baixada Fluminense",
    state: "RJ",
    zip_code: cepDestino,
    country: "BR",
  };
  const data = await requestJson<any>(
    `https://api.uber.com/v1/customers/${customerId}/delivery_quotes`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        pickup_address: JSON.stringify(pickup),
        dropoff_address: JSON.stringify(dropoff),
      }),
    },
    12_000,
  );

  /* fee vem em centavos (ex.: 2490 = R$ 24,90); duration em minutos. */
  const quotes = Array.isArray(data) ? data : [data];
  const resultados = quotes
    .map((q: any) => {
      const preco = Number(q?.fee);
      if (!Number.isFinite(preco) || preco < 0) return null;
      const minutos = Math.max(20, Math.round(Number(q?.duration) || 180));
      return {
        id: "uber-direct",
        transportadora: CARREIRAS["uber-direct"].transportadora,
        servico: CARREIRAS["uber-direct"].servico,
        modal: "mesmo-dia",
        escopo: "local",
        preco: round2(preco / 100),
        prazoTexto: minutos <= 60 ? `até ${Math.ceil(minutos / 15) * 15} min — hoje` : `${Math.round(minutos / 60)} a ${Math.round(minutos / 60) + 1} horas — hoje`,
        dias: 0,
        gratis: preco === 0,
        source: "api" as const,
      };
    })
    .filter(Boolean) as OpcaoFrete[];
  return resultados.length ? resultados : null;
}

/* ------------------------------------------------------------ 99 Entregas
   Adaptador do parceiro empresarial: espera um endpoint que receba
   { cepOrigem, cepDestino, pesoKg } e devolva { options: [{preco, prazoTexto, dias}] }. */
async function entregas99Quote(
  cepDestino: string,
  zona: string | null,
  peso: number,
): Promise<OpcaoFrete[] | null> {
  if (!zona || !["rj-capital", "rj-baixada", "rj-leste"].includes(zona)) return null;
  const url = opcional("ENTREGAS99_QUOTE_URL");
  const token = opcional("ENTREGAS99_TOKEN");
  if (!url || !token) return null;

  const data = await requestJson<any>(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        cepOrigem: opcional("ORIGEM_CEP") || "26275280",
        cepDestino,
        pesoKg: peso,
      }),
    },
    12_000,
  );

  const resultados = (Array.isArray(data?.options) ? data.options : [])
    .map((opt: any) => {
      const preco = Number(opt?.preco ?? opt?.price);
      if (!Number.isFinite(preco) || preco < 0) return null;
      const dias = Math.max(0, Math.round(Number(opt?.dias ?? 0)));
      return {
        id: "entregas-99",
        transportadora: CARREIRAS["entregas-99"].transportadora,
        servico: String(opt?.servico || CARREIRAS["entregas-99"].servico).slice(0, 64),
        modal: "mesmo-dia",
        escopo: "local",
        preco: round2(preco),
        prazoTexto: String(opt?.prazoTexto || "2 a 5 horas — hoje").slice(0, 64),
        dias,
        gratis: preco === 0,
        source: "api" as const,
      };
    })
    .filter(Boolean) as OpcaoFrete[];
  return resultados.length ? resultados : null;
}

/* ------------------------------------------------------------- facade */
export async function cotarFrete(payload: {
  cep: string;
  items: ItemCotacao[];
  subtotal: number;
}): Promise<{ cep: string; zona: string | null; options: OpcaoFrete[]; avisos: string[] }> {
  const cep = String(payload?.cep || "").replace(/\D+/g, "").slice(0, 8);
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const subtotal = Number(payload?.subtotal) || 0;
  const peso = pesoKg(items);

  const base = cotacaoPadrao(cep, items, subtotal);
  if (!base.zona) return { ...base, avisos: [] };

  const avisos: string[] = [];
  const coleta: Array<Promise<{ nome: string; opcoes: OpcaoFrete[] | null; erro?: string }>> = [
    correiosQuote(cep, cep, peso)
      .then((opcoes) => ({ nome: "correios", opcoes }))
      .catch((erro) => ({ nome: "correios", opcoes: null, erro: String(erro?.message || erro) })),
    mercadoEnviosQuote(cep, peso, subtotal)
      .then((opcoes) => ({ nome: "mercado-envios", opcoes }))
      .catch((erro) => ({ nome: "mercado-envios", opcoes: null, erro: String(erro?.message || erro) })),
    uberDirectQuote(cep, base.zona)
      .then((opcoes) => ({ nome: "uber-direct", opcoes }))
      .catch((erro) => ({ nome: "uber-direct", opcoes: null, erro: String(erro?.message || erro) })),
    entregas99Quote(cep, base.zona, peso)
      .then((opcoes) => ({ nome: "entregas-99", opcoes }))
      .catch((erro) => ({ nome: "entregas-99", opcoes: null, erro: String(erro?.message || erro) })),
  ];

  const resultados = await Promise.all(coleta);
  let options = base.options;
  resultados.forEach((r) => {
    if (r.erro) avisos.push(`${r.nome}: ${r.erro}`);
    if (r.opcoes) options = mesclarOpcoes(options, r.opcoes);
  });

  return { cep, zona: base.zona, options, avisos };
}
