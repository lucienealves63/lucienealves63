/* ==========================================================================
   CENSURA 18 — motor de frete e entregas
   --------------------------------------------------------------------------
   Calcula frete pelo CEP com as transportadoras da loja:

     · Correios            (PAC e SEDEX — nacional)
     · Mercado Envios      (nacional)
     · Uber Direct         (mesmo dia — Rio de Janeiro e Baixada)
     · 99 Entregas         (mesmo dia — Rio de Janeiro e Baixada)
     · Retirar na loja     (grátis, nas 6 lojas físicas)

   Sem credenciais configuradas, o motor usa a TABELA_PADRAO (estimativa
   por zona de CEP + peso). Quando a Edge Function `cotar-frete` está
   publicada no Supabase (window.C18_SITE.mode === "supabase"), o site
   tenta a cotação ao vivo primeiro e usa a tabela como plano B — a loja
   nunca deixa de responder por falta de uma API externa.

   Override de configuração pela página (opcional):
     window.C18_FRETE = {
       freteGratisAPartir: 299,            // PAC grátis acima deste valor
       endpoint: "https://…/cotar-frete",  // força outro endpoint
       carriers: {
         "uber-direct": { enabled: false } // desliga uma transportadora
         "correios-sedex": { adicional: 5 } // sobretaxa por serviço
       },
     };

   Mesmo padrão do checkout.js: exposto como window.C18Frete e também
   como module.exports para os testes em Node.
   ========================================================================== */
(function (global) {
  "use strict";

  /* --------------------------------------------------------------- CEP */
  function normalizeCep(value) {
    return String(value ?? "")
      .replace(/\D+/g, "")
      .slice(0, 8);
  }

  function formatCep(value) {
    const digits = normalizeCep(value);
    if (digits.length <= 5) return digits;
    return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  }

  function isCepValida(value) {
    const digits = normalizeCep(value);
    return digits.length === 8 && digits !== "00000000";
  }

  function cepNumero(value) {
    const digits = normalizeCep(value);
    return digits.length === 8 ? Number(digits) : NaN;
  }

  /* -------------------------------------------------------------- zonas
     Zonas por faixa de CEP (estimativa operacional da loja, não oficial):
       rj-capital  20000–23799           Rio de Janeiro (capital)
       rj-baixada  23800–23999           Itaguaí, Seropédica (oeste metropolitano)
                   25000–25599           Duque de Caxias, São João de Meriti
                   25900–25949           Magé
                   26000–26999           Nova Iguaçu, Belford Roxo, Nilópolis,
                                         Mesquita, Queimados, Japeri, Paracambi
       rj-leste    24000–24999           Niterói, São Gonçalo, Itaboraí, Maricá
       rj-interior 25600–25899 e 25950–28999  Petrópolis, Teresópolis, Angra,
                                          Região dos Lagos, Norte e Sul Fluminense
     Demais regiões pelo 1º dígito do CEP (padrão dos Correios). */
  const ZONAS = {
    "rj-capital": { nome: "Rio de Janeiro (capital)" },
    "rj-baixada": { nome: "Baixada Fluminense" },
    "rj-leste": { nome: "Niterói, São Gonçalo e região" },
    "rj-interior": { nome: "Interior do Rio de Janeiro" },
    sudeste: { nome: "Sudeste" },
    sul: { nome: "Região Sul" },
    "centro-oeste": { nome: "Centro-Oeste" },
    nordeste: { nome: "Região Nordeste" },
    norte: { nome: "Região Norte" },
  };

  function zonaDoCep(value) {
    const n = cepNumero(value);
    if (!Number.isFinite(n)) return null;
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
    if (primeiro === 0 || primeiro === 1 || primeiro === 2 || primeiro === 3) return "sudeste";
    if (primeiro === 4 || primeiro === 5) return "nordeste";
    if (primeiro === 6) return "norte";
    if (primeiro === 7) return "centro-oeste";
    return "sul"; /* 8 e 9 */
  }

  /* -------------------------------------------------------- transportadoras */
  const CARREIRAS = {
    "correios-pac": {
      transportadora: "Correios",
      servico: "PAC",
      modal: "economica",
      escopo: "nacional",
      extraKg: 6.9,
      pesoLimite: 30,
    },
    "correios-sedex": {
      transportadora: "Correios",
      servico: "SEDEX",
      modal: "expressa",
      escopo: "nacional",
      extraKg: 9.9,
      pesoLimite: 30,
    },
    "mercado-envios": {
      transportadora: "Mercado Envios",
      servico: "Envio padrão",
      modal: "economica",
      escopo: "nacional",
      extraKg: 7.9,
      pesoLimite: 25,
    },
    "uber-direct": {
      transportadora: "Uber",
      servico: "Uber Direct — mesmo dia",
      modal: "mesmo-dia",
      escopo: "local",
      extraKg: 0,
      pesoLimite: 20,
    },
    "entregas-99": {
      transportadora: "99 Entregas",
      servico: "Entrega expressa — mesmo dia",
      modal: "mesmo-dia",
      escopo: "local",
      extraKg: 0,
      pesoLimite: 20,
    },
    "retirada-loja": {
      transportadora: "Censura 18",
      servico: "Retirar na loja",
      modal: "retirada",
      escopo: "retirada",
    },
  };

  /* Tabela padrão (estimativa): zona → serviço → [preço base, prazo, dias].
     `dias` é só para ordenar as opções no carrinho (0 = mesmo dia). */
  const TABELA_PADRAO = {
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

  const FRETE_GRATIS_PADRAO = 299; /* PAC grátis — igual ao site inteiro */
  const PESO_POR_PECA = 0.3; /* kg — peça de roupa embalada */

  function configDe(config) {
    const override = global.C18_FRETE || {};
    return {
      freteGratisAPartir: Math.max(
        0,
        Number(config?.freteGratisAPartir ?? override.freteGratisAPartir ?? FRETE_GRATIS_PADRAO)
      ),
      carriers: { ...(override.carriers || {}), ...(config?.carriers || {}) },
    };
  }

  /* Peso somando as peças do carrinho (weightKg opcional por produto). */
  function pesoKg(items) {
    const total = (Array.isArray(items) ? items : []).reduce((soma, item) => {
      const qty = Math.max(0, Math.round(Number(item?.qty) || 0));
      const peso = Math.max(0, Number(item?.weightKg ?? item?.pesoKg ?? PESO_POR_PECA));
      return soma + qty * peso;
    }, 0);
    return Math.round(total * 100) / 100;
  }

  function arredondar(valor) {
    return Math.round(Number(valor) * 100) / 100;
  }

  function formatarPreco(valor) {
    return `R$ ${arredondar(valor).toFixed(2).replace(".", ",")}`;
  }

  function etiqueta(opcao) {
    const carrier = CARREIRAS[opcao?.id] || null;
    const nome = String(opcao?.transportadora || carrier?.transportadora || "Entrega");
    const servico = String(opcao?.servico || carrier?.servico || "").trim();
    return servico && servico !== nome ? `${nome} — ${servico}` : nome;
  }

  function precoTexto(opcao) {
    if (!opcao) return "";
    return opcao.gratis || Number(opcao.preco) === 0 ? "Grátis" : formatarPreco(opcao.preco);
  }

  function totalComFrete(subtotal, opcao) {
    const subCents = Math.round(Number(subtotal) * 100);
    const freteCents = opcao ? Math.round(Number(opcao.preco || 0) * 100) : 0;
    return (subCents + (Number.isFinite(freteCents) ? freteCents : 0)) / 100;
  }

  function compararOpcoes(a, b) {
    return (
      (Number(a?.dias) || 0) - (Number(b?.dias) || 0) ||
      (Number(a?.preco) || 0) - (Number(b?.preco) || 0) ||
      String(a?.transportadora || "").localeCompare(String(b?.transportadora || ""))
    );
  }

  function opcaoRetirada() {
    return {
      id: "retirada-loja",
      transportadora: CARREIRAS["retirada-loja"].transportadora,
      servico: CARREIRAS["retirada-loja"].servico,
      modal: "retirada",
      escopo: "retirada",
      preco: 0,
      prazoTexto: "pronto para retirar hoje",
      dias: 0,
      gratis: true,
      source: "estimativa",
    };
  }

  /* Cotação sincrona com a TABELA_PADRAO — sempre disponível. */
  function cotar(cep, opts = {}) {
    const zona = zonaDoCep(cep);
    if (!isCepValida(cep) || !zona) {
      return { cep: formatCep(cep), zona: null, options: [] };
    }
    const cfg = configDe(opts.config);
    const peso = pesoKg(opts.items);
    const subtotal = Number(opts.subtotal) || 0;
    const options = [];

    for (const [id, entrada] of Object.entries(TABELA_PADRAO[zona] || {})) {
      const carrier = CARREIRAS[id];
      const conf = cfg.carriers[id] || {};
      if (conf.enabled === false) continue;
      if (peso > (carrier.pesoLimite ?? Infinity)) continue;

      const kgsExtras = Math.max(0, Math.ceil(peso - 1));
      const extraKg = Number.isFinite(Number(conf.extraKg))
        ? Number(conf.extraKg)
        : carrier.extraKg || 0;
      let preco = entrada[0] + kgsExtras * extraKg;
      if (Number(conf.adicional) > 0) preco += Number(conf.adicional);

      let gratis = false;
      if (id === "correios-pac" && subtotal >= cfg.freteGratisAPartir) {
        preco = 0;
        gratis = true;
      }

      options.push({
        id,
        transportadora: carrier.transportadora,
        servico: carrier.servico,
        modal: carrier.modal,
        escopo: carrier.escopo,
        preco: arredondar(preco),
        prazoTexto: entrada[1],
        dias: entrada[2],
        gratis,
        source: "estimativa",
      });
    }

    if ((cfg.carriers["retirada-loja"] || {}).enabled !== false) {
      options.push(opcaoRetirada());
    }

    options.sort(compararOpcoes);
    return { cep: formatCep(cep), zona, options };
  }

  /* --------------------------------------------------- cotação ao vivo
     Tenta a Edge Function `cotar-frete` no Supabase. Se não estiver
     configurada (modo estático) ou falhar, devolve null — o chamador
     mantém a estimativa da tabela. Nunca lança. */
  async function cotarAoVivo(cep, payload = {}) {
    const cfg = global.C18_FRETE || {};
    const site = global.C18_SITE || {};
    let url = typeof cfg.endpoint === "string" && cfg.endpoint ? cfg.endpoint : "";
    if (!url && site.mode === "supabase" && site.supabaseUrl) {
      url = `${String(site.supabaseUrl).replace(/\/+$/, "")}/functions/v1/cotar-frete`;
    }
    if (!url || typeof fetch !== "function") return null;

    try {
      const headers = { "Content-Type": "application/json" };
      if (site.supabaseAnonKey) {
        headers.apikey = site.supabaseAnonKey;
        headers.Authorization = `Bearer ${site.supabaseAnonKey}`;
      }
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          cep: normalizeCep(cep),
          items: Array.isArray(payload.items) ? payload.items : [],
          subtotal: Number(payload.subtotal) || 0,
        }),
      });
      if (!response.ok) return null;
      const data = await response.json();
      const options = normalizarOpcoes(data?.options);
      if (!options.length) return null;
      return {
        cep: formatCep(data?.cep || cep),
        zona: data?.zona || zonaDoCep(cep),
        options: options.sort(compararOpcoes),
      };
    } catch (_) {
      return null; /* site segue com a tabela padrão */
    }
  }

  /* Sanitiza opções que vêm da função: nada de preço negativo ou HTML. */
  function normalizarOpcoes(opcoes) {
    if (!Array.isArray(opcoes)) return [];
    return opcoes
      .map((op) => {
        const id = String(op?.id || "").trim();
        const preco = Number(op?.preco);
        if (!id || !Number.isFinite(preco) || preco < 0) return null;
        const carrier = CARREIRAS[id] || {};
        const dias = Math.max(0, Math.round(Number(op?.dias) || 0));
        return {
          id,
          transportadora: String(op?.transportadora || carrier.transportadora || id).slice(0, 48),
          servico: String(op?.servico || carrier.servico || "").slice(0, 64),
          modal: String(op?.modal || carrier.modal || "nacional"),
          escopo: String(op?.escopo || carrier.escopo || "nacional"),
          preco: arredondar(preco),
          prazoTexto: String(op?.prazoTexto || `${dias} dia(s) útil(is)`).slice(0, 64),
          dias,
          gratis: Boolean(op?.gratis) || preco === 0,
          source: op?.source === "estimativa" ? "estimativa" : "api",
        };
      })
      .filter(Boolean);
  }

  /* Linhas para a mensagem de WhatsApp — mesmo padrão do checkout.js. */
  function mensagemFrete(opcao, cep) {
    if (!opcao) return [];
    const linhas = [];
    if (opcao.id === "retirada-loja") {
      linhas.push("*Entrega:* Retirar na loja (sem custo de frete)");
    } else {
      linhas.push(`*Entrega:* ${etiqueta(opcao)} — ${opcao.prazoTexto}`);
      linhas.push(`*Frete:* ${precoTexto(opcao)}`);
    }
    const cepTexto = formatCep(cep);
    if (cepTexto) linhas.push(`*CEP de entrega:* ${cepTexto}`);
    return linhas;
  }

  global.C18Frete = {
    CARREIRAS,
    TABELA_PADRAO,
    ZONAS,
    FRETE_GRATIS_PADRAO,
    cepNumero,
    compararOpcoes,
    configDe,
    cotar,
    cotarAoVivo,
    etiqueta,
    formatCep,
    formatarPreco,
    isCepValida,
    mensagemFrete,
    normalizeCep,
    normalizarOpcoes,
    pesoKg,
    precoTexto,
    totalComFrete,
    zonaDoCep,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = global.C18Frete;
  }
})(typeof window !== "undefined" ? window : globalThis);
