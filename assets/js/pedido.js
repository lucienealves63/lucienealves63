/* ==========================================================================
   CENSURA 18 — pedido do checkout (pura, testável)
   --------------------------------------------------------------------------
   Monta, valida e apresenta o pedido do checkout online (checkout.html):

     · resumo do carrinho + frete escolhido no carrinho
     · validação do payload antes de gravar (RPC criar_meu_pedido)
     · Pix copia-e-cola gerado no padrão EMV do Banco Central
       (BR Code estático com valor — a chave é a da loja em data.js)
     · mensagem do WhatsApp com o resumo do pedido

   O cartão NUNCA é digitado no site (PCI): o cliente paga por link seguro
   da e.Rede enviado pela loja (com 3-D Secure) enquanto o tokenizador
   contratado não estiver plugado. O worker e a fila já existem no Supabase.
   ========================================================================== */
(function (global) {
  "use strict";

  /* ------------------------------------------------------------ helpers */
  function arredondar(valor) {
    return Math.round(Number(valor) * 100) / 100;
  }

  function dinheiro(valor) {
    return `R$ ${arredondar(valor).toFixed(2).replace(".", ",")}`;
  }

  function pad(value, size) {
    return String(value).padStart(size, "0");
  }

  /* --------------------------------------------------------- resumo */
  /* cart: itens do localStorage (c18:carrinho); frete: opção escolhida
     (c18:checkout.frete) ou null. Cupom/desconto continuam sendo
     confirmados pela loja — o total mostra o que o cliente vai pagar. */
  function resumo(cart, frete) {
    const items = (Array.isArray(cart) ? cart : [])
      .map((item) => ({
        id: String(item?.id || "").slice(0, 40),
        name: String(item?.name || "").slice(0, 80),
        size: String(item?.size || "ÚNICO").slice(0, 12),
        color: String(item?.color || "ÚNICA").slice(0, 24),
        qty: Math.min(20, Math.max(1, Math.round(Number(item?.qty) || 1))),
        price: arredondar(Math.max(0, Number(item?.price) || 0)),
      }))
      .filter((item) => item.id && item.name);

    const subtotal = arredondar(items.reduce((soma, i) => soma + i.qty * i.price, 0));
    const freteValor = frete && !frete.gratis ? arredondar(Math.max(0, Number(frete.preco) || 0)) : 0;
    const total = arredondar(subtotal + freteValor);
    return {
      items,
      subtotal,
      frete: frete
        ? {
            id: String(frete.id || ""),
            transportadora: String(frete.transportadora || ""),
            servico: String(frete.servico || ""),
            preco: freteValor,
            prazoTexto: String(frete.prazoTexto || ""),
            gratis: Boolean(frete.gratis) || freteValor === 0,
          }
        : null,
      total,
      count: items.reduce((soma, i) => soma + i.qty, 0),
    };
  }

  /* ------------------------------------------------------- validação */
  const METODOS = new Set(["pix", "cartao"]);

  function validarPedido(payload) {
    const dados = {
      items: Array.isArray(payload?.items) ? payload.items : [],
      subtotal: arredondar(payload?.subtotal),
      frete: payload?.frete || null,
      total: arredondar(payload?.total),
      metodo: String(payload?.metodo || "").toLowerCase(),
      cliente: payload?.cliente || {},
    };
    const erros = {};

    if (!dados.items.length) erros.items = "Seu carrinho está vazio";
    if (dados.items.length > 30) erros.items = "Carrinho muito grande — finalize em dois pedidos";
    if (dados.subtotal <= 0) erros.subtotal = "Valor do carrinho inválido";
    if (dados.total <= 0) erros.total = "Valor total inválido";
    if (!METODOS.has(dados.metodo)) erros.metodo = "Escolha Pix ou cartão";

    const nome = String(dados.cliente.nome || "").trim();
    if (nome.length < 3 || !nome.includes(" ")) {
      erros.cliente = "Precisamos do seu nome completo";
    }
    const cep = String(dados.cliente.cep || "").replace(/\D+/g, "");
    const retirada = dados.frete && dados.frete.id === "retirada-loja";
    if (!retirada && cep.length !== 8) {
      erros.cep = "CEP de entrega obrigatório (8 números)";
    }

    return { ok: Object.keys(erros).length === 0, dados, erros };
  }

  /* --------------------------------------------- Pix copia-e-cola (EMV) */
  function crc16(texto) {
    /* CRC-16/CCITT-FALSE: poly 0x1021, init 0xFFFF — o padrão do Pix. */
    let crc = 0xffff;
    for (let i = 0; i < texto.length; i += 1) {
      crc ^= texto.charCodeAt(i) << 8;
      for (let bit = 0; bit < 8; bit += 1) {
        crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
      }
    }
    return crc.toString(16).toUpperCase().padStart(4, "0");
  }

  function tlv(id, valor) {
    return `${id}${pad(String(valor).length, 2)}${valor}`;
  }

  function semAcento(texto) {
    return String(texto || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  /* Gera o BR Code estático com valor (copia e cola). Campos:
     00 versão · 26 GUI+chave Pix · 52 MCC · 53 moeda 986 (BRL) ·
     54 valor · 58 país · 59 nome do recebedor · 60 cidade · 62 txid · 63 CRC. */
  function pixCopiaCola(config, valor, txid) {
    const chave = String(config?.pixChave || "").trim();
    const nome = semAcento(String(config?.pixNome || "LOJA")).toUpperCase().slice(0, 25);
    const cidade = semAcento(String(config?.pixCidade || "NOVA IGUACU")).toUpperCase().slice(0, 15);
    if (!chave) return "";

    const total = arredondar(valor);
    let payload =
      tlv("00", "01") +
      tlv("26", tlv("00", "br.gov.bcb.pix") + tlv("01", chave)) +
      tlv("52", "0000") +
      tlv("53", "986");
    if (total > 0) payload += tlv("54", total.toFixed(2));
    payload +=
      tlv("58", "BR") +
      tlv("59", nome) +
      tlv("60", cidade) +
      tlv("62", tlv("05", String(txid || "***").slice(0, 25) || "***"));
    payload += "6304";
    return payload + crc16(payload);
  }

  /* -------------------------------------------------------- WhatsApp */
  function mensagemPedido(pedido) {
    const linhas = [];
    linhas.push("Olá! Acabei de fechar um pedido no site 🖤");
    if (pedido.numero) linhas.push(`*Pedido:* ${pedido.numero}`);
    if (pedido.cliente?.nome) linhas.push(`*Cliente:* ${pedido.cliente.nome}`);
    if (pedido.cliente?.telefone) linhas.push(`*WhatsApp:* ${pedido.cliente.telefone}`);
    linhas.push("");
    linhas.push("*Itens:*");
    (pedido.items || []).forEach((item, idx) => {
      linhas.push(
        `${idx + 1}. ${item.qty}x ${item.name} — tam. ${item.size}, cor ${item.color} — ${dinheiro(item.qty * item.price)}`
      );
    });
    linhas.push("");
    linhas.push(`*Subtotal:* ${dinheiro(pedido.subtotal)}`);
    if (pedido.frete) {
      const label = [pedido.frete.transportadora, pedido.frete.servico].filter(Boolean).join(" — ");
      linhas.push(`*Entrega:* ${label}${pedido.frete.prazoTexto ? ` (${pedido.frete.prazoTexto})` : ""}`);
      linhas.push(`*Frete:* ${pedido.frete.gratis ? "Grátis" : dinheiro(pedido.frete.preco)}`);
    }
    if (pedido.metodo === "pix") linhas.push("*Pagamento:* Pix — já efetuado, comprovante anexado");
    if (pedido.metodo === "cartao") linhas.push("*Pagamento:* Cartão — aguardando link seguro da loja");
    linhas.push(`*Total:* ${dinheiro(pedido.total)}`);
    return linhas.join("\n");
  }

  global.C18Pedido = {
    arredondar,
    dinheiro,
    crc16,
    mensagemPedido,
    pixCopiaCola,
    resumo,
    validarPedido,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = global.C18Pedido;
  }
})(typeof window !== "undefined" ? window : globalThis);
