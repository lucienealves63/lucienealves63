/* ==========================================================================
   CENSURA 18 — lógica da loja
   --------------------------------------------------------------------------
   Depende de assets/js/data.js (PRODUCTS, STORES, CATEGORIES, BRAND).
   Não usa nenhuma biblioteca externa.
   ========================================================================== */
(function () {
  "use strict";

  /* ---------------------------------------------------------------- util */
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  const BRL = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

  const money = (n) => BRL.format(n);

  const offPercent = (price, from) =>
    from && from > price ? Math.round(((from - price) / from) * 100) : 0;

  const escapeHTML = (str) =>
    String(str).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c]
    );

  const getProduct = (id) => PRODUCTS.find((p) => p.id === id);

  const categoryLabel = (id) => {
    const c = CATEGORIES.find((x) => x.id === id);
    return c ? c.label : id;
  };

  /* Placeholder para quando a foto ainda não existe ---------------------- */
  const PLACEHOLDER = (label) =>
    "data:image/svg+xml;charset=utf-8," +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000" viewBox="0 0 800 1000">
        <defs>
          <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#f1f1f1"/>
            <stop offset="100%" stop-color="#d9d9d9"/>
          </linearGradient>
        </defs>
        <rect width="800" height="1000" fill="url(#g)"/>
        <rect x="24" y="24" width="752" height="952" fill="none" stroke="#c2c2c2" stroke-width="2"/>
        <text x="400" y="470" text-anchor="middle" font-family="Impact, Haettenschweiler, 'Arial Narrow Bold', sans-serif" font-size="120" fill="#9a9a9a" letter-spacing="6">C18</text>
        <text x="400" y="540" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="26" fill="#8a8a8a" letter-spacing="4">CENSURA 18</text>
        <text x="400" y="600" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="22" fill="#a8a8a8" letter-spacing="2">${escapeHTML(
          (label || "").toUpperCase()
        )}</text>
      </svg>`
    );

  /* --------------------------------------------------------- carrinho */
  const CART_KEY = "c18:carrinho";
  const CHECKOUT_KEY = "c18:checkout";
  const CheckoutTools = window.C18Checkout || {
    normalizeSellerCode: (value) => String(value || "").trim().toUpperCase().slice(0, 24),
    normalizeCouponCode: (value) => String(value || "").trim().toUpperCase().slice(0, 32),
    normalizeGiftCardCode: (value) => String(value || "").trim().toUpperCase().slice(0, 16),
    checkoutMessageLines: () => [],
  };

  const Checkout = {
    sellerCode: "",
    couponCode: "",
    couponDescription: "",
    giftCardCode: "",
    storeId: "",
    cep: "",
    frete: null, /* opção escolhida: { id, transportadora, servico, preco, prazoTexto, dias, gratis } */

    load() {
      try {
        const saved = JSON.parse(localStorage.getItem(CHECKOUT_KEY) || "{}");
        this.sellerCode = CheckoutTools.normalizeSellerCode(saved.sellerCode);
        this.couponCode = CheckoutTools.normalizeCouponCode(saved.couponCode);
        this.giftCardCode = CheckoutTools.normalizeGiftCardCode(saved.giftCardCode);
        this.storeId = String(saved.storeId || "");
        this.cep = Frete.normalizeCep(saved.cep);
        this.frete = Frete.normalizarOpcoes([saved.frete])[0] || null;
      } catch (_) {
        this.sellerCode = "";
        this.couponCode = "";
        this.giftCardCode = "";
        this.storeId = "";
        this.cep = "";
        this.frete = null;
      }
    },

    save() {
      try {
        /* LGPD: com "Só o essencial", preferências do checkout não são
           gravadas (e as antigas já foram apagadas pelo banner). */
        if (
          window.C18LGPD &&
          typeof window.C18LGPD.canPersistPreferences === "function" &&
          !window.C18LGPD.canPersistPreferences()
        ) {
          localStorage.removeItem(CHECKOUT_KEY);
          return;
        }
        localStorage.setItem(CHECKOUT_KEY, JSON.stringify({
          sellerCode: this.sellerCode,
          couponCode: this.couponCode,
          giftCardCode: this.giftCardCode,
          storeId: this.storeId,
        }));
      } catch (_) {
        /* O checkout continua funcionando sem persistência local. */
      }
    },

    updateFromDrawer() {
      const seller = $("#seller-code");
      const coupon = $("#coupon-code");
      const giftCard = $("#gift-card-code");
      const store = $("#store-select");
      const cep = $("#frete-cep");
      if (seller) this.sellerCode = CheckoutTools.normalizeSellerCode(seller.value);
      if (coupon) this.couponCode = CheckoutTools.normalizeCouponCode(coupon.value);
      if (giftCard) this.giftCardCode = CheckoutTools.normalizeGiftCardCode(giftCard.value);
      if (store) this.storeId = String(store.value || "");
      if (cep) this.cep = Frete.normalizeCep(cep.value);
      this.save();
    },

    clear() {
      this.sellerCode = "";
      this.couponCode = "";
      this.couponDescription = "";
      this.giftCardCode = "";
      this.cep = "";
      this.frete = null;
      Frete.state.quotes = null;
      this.save();
    },
  };

  /* ------------------------------------------- cupons do painel */
  /* No modo demonstração o painel (admin/) grava os cupons ativos em
     c18:demo-coupons e o carrinho os descreve ao cliente. Com o Supabase
     ligado (window.C18_SITE), a consulta usa a RPC check_discount_coupon
     com a chave anônima — o navegador nunca recebe a lista inteira. */
  const COUPONS_DEMO_KEY = "c18:demo-coupons";

  function loadCouponCatalog() {
    try {
      const list = JSON.parse(localStorage.getItem(COUPONS_DEMO_KEY) || "[]");
      return Array.isArray(list) ? list : [];
    } catch (_) {
      return [];
    }
  }

  function couponDescription(code) {
    if (!window.C18Coupons || !code) return "";
    const found = window.C18Coupons.findCoupon(code, loadCouponCatalog());
    return found ? window.C18Coupons.describeCoupon(found) : "";
  }

  async function lookupCouponDescription(code) {
    if (!code) return "";
    const site = window.C18_SITE || {};
    if (site.mode === "supabase" && site.supabaseUrl && site.supabaseAnonKey) {
      try {
        const response = await fetch(
          `${site.supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/check_discount_coupon`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              apikey: site.supabaseAnonKey,
              Authorization: `Bearer ${site.supabaseAnonKey}`,
            },
            body: JSON.stringify({ p_code: code }),
          }
        );
        if (response.ok) {
          const data = await response.json();
          if (data && data.found && window.C18Coupons) {
            return window.C18Coupons.describeCoupon(data);
          }
        }
      } catch (_) {
        /* offline: o cupom segue identificado, sem descrição */
      }
      return "";
    }
    return couponDescription(code);
  }

  function couponDescriptionForMessage() {
    return Checkout.couponDescription || couponDescription(Checkout.couponCode);
  }

  /* Bloco de opções de frete dentro do rodapé do carrinho. */
  function renderFreteResultado() {
    if (!global.C18Frete) return "";
    const { quotes, loading } = Frete.state;
    const cepValido = C18Frete.isCepValida(Checkout.cep);

    if (!cepValido) {
      return `<p class="checkout-help">Calcule o frete pelo CEP — PAC, SEDEX, Mercado Envios,
        Uber e 99 no mesmo dia (Rio e Baixada) ou retire em uma das 6 lojas.</p>`;
    }
    if (loading && !quotes) {
      return `<p class="checkout-help">Calculando frete para ${escapeHTML(
        C18Frete.formatCep(Checkout.cep)
      )}…</p>`;
    }
    if (!quotes || !quotes.length) {
      return `<p class="checkout-help">Não achamos opções para este CEP. Confirme com a loja no WhatsApp.</p>`;
    }

    const selecionado = Checkout.frete ? Checkout.frete.id : "";
    return `
      <div class="frete-options" role="radiogroup" aria-label="Opções de entrega para ${escapeHTML(
        C18Frete.formatCep(Checkout.cep)
      )}">
        ${quotes
          .map(
            (op) => `
        <label class="frete-option${op.id === selecionado ? " is-selected" : ""}">
          <input type="radio" name="frete-opcao" value="${escapeHTML(op.id)}" ${
              op.id === selecionado ? "checked" : ""
            }>
          <span class="frete-option__label">
            <strong>${escapeHTML(Frete.etiqueta(op))}</strong>
            <small>${escapeHTML(op.prazoTexto)} · ${
              op.source === "api" ? "cotação da transportadora" : "estimativa"
            }</small>
          </span>
          <b class="frete-option__preco${op.gratis ? " is-gratis" : ""}">${escapeHTML(
              Frete.precoTexto(op)
            )}</b>
        </label>`
          )
          .join("")}
      </div>
      <p class="checkout-help">Valores para ${escapeHTML(
        C18Frete.formatCep(Checkout.cep)
      )} — a loja confirma tudo pelo WhatsApp.</p>`;
  }

  const Cart = {
    items: [],

    load() {
      try {
        const raw = localStorage.getItem(CART_KEY);
        this.items = raw ? JSON.parse(raw) : [];
      } catch (e) {
        this.items = [];
      }
      return this.items;
    },

    save() {
      try {
        localStorage.setItem(CART_KEY, JSON.stringify(this.items));
      } catch (e) {
        /* modo privado / storage cheio — o carrinho segue só na memória */
      }
    },

    key(item) {
      return `${item.id}|${item.size}|${item.color}`;
    },

    add(item) {
      const k = this.key(item);
      const found = this.items.find((i) => this.key(i) === k);
      if (found) found.qty += item.qty;
      else this.items.push(Object.assign({}, item));
      this.save();
      this.render();
    },

    setQty(key, qty) {
      const it = this.items.find((i) => this.key(i) === key);
      if (!it) return;
      if (qty <= 0) this.remove(key);
      else {
        it.qty = qty;
        this.save();
        this.render();
      }
    },

    remove(key) {
      this.items = this.items.filter((i) => this.key(i) !== key);
      this.save();
      this.render();
      Toast.show("Item removido do carrinho");
    },

    clear() {
      this.items = [];
      Checkout.clear();
      this.save();
      this.render();
    },

    count() {
      return this.items.reduce((s, i) => s + i.qty, 0);
    },

    subtotal() {
      return this.items.reduce((s, i) => s + i.price * i.qty, 0);
    },

    /* Atualiza contadores em todos os lugares */
    render() {
      const n = this.count();
      $$("[data-cart-count]").forEach((el) => {
        el.textContent = n;
        el.classList.toggle("is-visible", n > 0);
      });
      this.renderDrawer();
    },

    renderDrawer() {
      const body = $("#cart-body");
      if (!body) return;

      if (!this.items.length) {
        body.innerHTML = `
          <div class="drawer__empty">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4">
              <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/>
              <path d="M3 6h18M16 10a4 4 0 0 1-8 0"/>
            </svg>
            <p>Seu carrinho está vazio.</p>
            <a class="btn btn--ghost" href="produtos.html" data-close-cart>Ver o catálogo</a>
          </div>`;
      } else {
        body.innerHTML = this.items
          .map((i) => {
            const k = this.key(i);
            return `
            <div class="cart-item">
              <div class="cart-item__media">
                <img src="${escapeHTML(i.image)}" alt="${escapeHTML(i.name)}"
                     onerror="this.src='${PLACEHOLDER(i.name)}'">
              </div>
              <div>
                <a class="cart-item__name" href="produto.html?id=${encodeURIComponent(
                  i.id
                )}" data-close-cart>${escapeHTML(i.name)}</a>
                <div class="cart-item__meta">Tam: ${escapeHTML(
                  i.size
                )} · Cor: ${escapeHTML(i.color)}</div>
                <div class="cart-item__row">
                  <span class="cart-item__qty">
                    <button data-qty="-1" data-key="${escapeHTML(
                      k
                    )}" aria-label="Diminuir quantidade">−</button>
                    <span>${i.qty}</span>
                    <button data-qty="1" data-key="${escapeHTML(
                      k
                    )}" aria-label="Aumentar quantidade">+</button>
                  </span>
                  <span class="cart-item__price">${money(i.price * i.qty)}</span>
                </div>
                <button class="cart-item__remove" data-remove="${escapeHTML(
                  k
                )}">Remover</button>
              </div>
            </div>`;
          })
          .join("");
      }

      const foot = $("#cart-foot");
      if (foot) {
        const sub = this.subtotal();
        const freteSel = global.C18Frete ? Frete.selecionada() : null;
        const total = global.C18Frete ? C18Frete.totalComFrete(sub, freteSel) : sub;
        const plan = CheckoutTools.installmentPlan
          ? CheckoutTools.installmentPlan(total)
          : null;
        const freteResumo = !global.C18Frete
          ? "calculado na conversa"
          : Frete.state.loading
          ? "calculando…"
          : freteSel
          ? C18Frete.precoTexto(freteSel)
          : Frete.state.quotes
          ? "escolha uma opção"
          : "calcule pelo CEP";
        const couponDesc = Checkout.couponCode
          ? Checkout.couponDescription || couponDescription(Checkout.couponCode)
          : "";
        foot.innerHTML = this.items.length
          ? `
            <div class="drawer__line"><span>Subtotal</span><span>${money(
              sub
            )}</span></div>
            <div class="drawer__line"><span>Frete</span><span>${escapeHTML(
              freteResumo
            )}</span></div>
            <div class="drawer__total"><span>${
              freteSel ? "Total com frete" : "Total estimado"
            }</span><span>${money(total)}</span></div>
            ${plan
              ? `<div class="drawer__line"><span>Parcelamento</span><span>${
                  plan.count >= 2
                    ? `até ${plan.count}x de ${money(plan.each)} sem juros`
                    : "à vista no Pix ou cartão"
                }</span></div>`
              : ""}
            <p class="drawer__note">O frete selecionado e o desconto são confirmados
            diretamente com a loja pelo WhatsApp. Frete grátis (PAC) em compras
            acima de ${money(
              C18Frete.FRETE_GRATIS_PADRAO
            )}. Cartão em até 6x sem juros — parcela mínima de R$ 49,00.</p>
            <div class="checkout-fields" aria-label="Informações do checkout">
              <label class="checkout-field" for="seller-code">
                <span>Código do vendedor <small>opcional</small></span>
                <input id="seller-code" type="text" inputmode="text" maxlength="24"
                       autocomplete="off" placeholder="Ex.: 042"
                       value="${escapeHTML(Checkout.sellerCode)}">
              </label>
              <div class="checkout-field">
                <label for="coupon-code">Cupom de desconto <small>opcional</small></label>
                <div class="coupon-control">
                  <input id="coupon-code" type="text" inputmode="text" maxlength="32"
                         autocomplete="off" placeholder="Digite seu cupom"
                         value="${escapeHTML(Checkout.couponCode)}">
                  <button type="button" id="coupon-add">${Checkout.couponCode ? "Atualizar" : "Adicionar"}</button>
                </div>
                ${Checkout.couponCode
                  ? `<p class="coupon-feedback"><strong>${escapeHTML(
                      Checkout.couponCode
                    )}</strong>${couponDesc ? ` — ${escapeHTML(couponDesc)}` : ""} será validado pela loja.<button type="button" data-remove-coupon>Remover</button></p>`
                  : `<p class="checkout-help">O desconto será confirmado antes do pagamento.</p>`}
              </div>
              <div class="checkout-field">
                <label for="gift-card-code">Cartão presente <small>opcional</small></label>
                <div class="coupon-control">
                  <input id="gift-card-code" type="text" inputmode="text" maxlength="16"
                         autocomplete="off" placeholder="Ex.: C18-A1B2-C3D4"
                         value="${escapeHTML(Checkout.giftCardCode)}">
                  <button type="button" id="gift-card-add">${Checkout.giftCardCode ? "Atualizar" : "Aplicar"}</button>
                </div>
                ${Checkout.giftCardCode
                  ? `<p class="coupon-feedback"><strong>${escapeHTML(Checkout.giftCardCode)}</strong> terá o saldo validado pela loja.<button type="button" data-remove-gift-card>Remover</button></p>`
                  : `<p class="checkout-help">Tem um cartão presente? Informe o código (C18-XXXX-XXXX).</p>`}
              </div>
              <div class="checkout-field" aria-label="Frete e entrega">
                <label for="frete-cep">Frete e entrega <small>Correios · Mercado Envios · Uber · 99 · retirar na loja</small></label>
                <div class="coupon-control">
                  <input id="frete-cep" type="text" inputmode="numeric" maxlength="9"
                         autocomplete="postal-code" placeholder="00000-000"
                         value="${escapeHTML(C18Frete.formatCep(Checkout.cep))}">
                  <button type="button" id="frete-calc">Calcular</button>
                </div>
                ${renderFreteResultado()}
              </div>
            </div>
            <div class="drawer__store">
              <label for="store-select">Retirar / falar com</label>
              <select id="store-select">
                ${STORES.map(
                  (s) =>
                    `<option value="${s.id}" ${Checkout.storeId === s.id ? "selected" : ""}>${escapeHTML(
                      s.city
                    )} — ${escapeHTML(s.district)}</option>`
                ).join("")}
              </select>
            </div>
            <button class="btn btn--block" id="checkout-whats">
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M17.47 14.38c-.3-.15-1.75-.86-2.02-.96-.27-.1-.47-.15-.67.15-.2.3-.78.96-.95 1.16-.18.2-.35.22-.65.07-.3-.15-1.25-.46-2.38-1.47-.88-.79-1.47-1.76-1.64-2.06-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.18.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.61-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.51.07-.78.37-.27.3-1.02 1-1.02 2.43s1.05 2.82 1.19 3.02c.15.2 2.06 3.15 5 4.41.7.3 1.24.48 1.67.62.7.22 1.34.19 1.84.12.56-.08 1.75-.72 2-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35Z"/>
                <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.3-1.39a9.9 9.9 0 0 0 4.74 1.2h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 18.15h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.16 8.16 0 0 1-1.25-4.38c0-4.54 3.7-8.23 8.24-8.23 2.2 0 4.27.86 5.83 2.41a8.18 8.18 0 0 1 2.41 5.83c0 4.54-3.7 8.23-8.24 8.23Z"/>
              </svg>
              Finalizar no WhatsApp
            </button>
            <a class="btn btn--block" id="checkout-online" href="checkout.html" style="margin-top:8px">
              Pagar online — Pix ou cartão em até 6x
            </a>
            <button class="btn btn--ghost btn--block" id="cart-clear" style="margin-top:8px">
              Esvaziar carrinho
            </button>`
          : "";
      }
    },
  };

  /* --------------------------------------------------------- frete/entregas
     Coordena a cotação (tabela padrão na hora + refinamento ao vivo pela
     Edge Function) e guarda o resultado enquanto o carrinho está aberto. */
  const Frete = {
    state: { quotes: null, loading: false },

    normalizeCep: (value) => (global.C18Frete ? C18Frete.normalizeCep(value) : ""),
    normalizarOpcoes: (value) => (global.C18Frete ? C18Frete.normalizarOpcoes(value) : []),

    payload() {
      return { items: Cart.items, subtotal: Cart.subtotal() };
    },

    /* Cota na hora com a tabela padrão; se houver endpoint configurado,
       atualiza em segundo plano com a cotação ao vivo das transportadoras. */
    async recalcular() {
      const cep = Frete.normalizeCep(Checkout.cep);
      if (!C18Frete || !C18Frete.isCepValida(cep)) {
        this.state = { quotes: null, loading: false };
        return;
      }
      this.state.loading = true;
      this.state.quotes = C18Frete.cotar(cep, this.payload()).options;
      Cart.renderDrawer();

      const aoVivo = await C18Frete.cotarAoVivo(cep, this.payload());
      this.state.loading = false;
      if (aoVivo && Frete.normalizeCep(aoVivo.cep) === cep) {
        this.state.quotes = aoVivo.options;
      }
      Cart.renderDrawer();
    },

    selecionar(id) {
      const opcao = (this.state.quotes || []).find((op) => op.id === id);
      if (!opcao) return;
      Checkout.frete = {
        id: opcao.id,
        transportadora: opcao.transportadora,
        servico: opcao.servico,
        preco: opcao.preco,
        prazoTexto: opcao.prazoTexto,
        dias: opcao.dias,
        gratis: opcao.gratis,
      };
      Checkout.save();
      Cart.renderDrawer();
      Toast.show(`Entrega: ${C18Frete.etiqueta(opcao)} — ${C18Frete.precoTexto(opcao)}`);
    },

    /* Opção escolhida com preço atualizado pelo carrinho atual. */
    selecionada() {
      if (!Checkout.frete) return null;
      const atual = (this.state.quotes || []).find((op) => op.id === Checkout.frete.id);
      return atual || Checkout.frete;
    },

    etiqueta: (opcao) => C18Frete.etiqueta(opcao),
    precoTexto: (opcao) => C18Frete.precoTexto(opcao),
  };

  /* ------------------------------------------------------------ toast */
  const Toast = {
    el: null,
    timer: null,
    show(msg) {
      if (!this.el) {
        this.el = document.createElement("div");
        this.el.className = "toast";
        this.el.setAttribute("role", "status");
        document.body.appendChild(this.el);
      }
      this.el.textContent = msg;
      requestAnimationFrame(() => this.el.classList.add("is-visible"));
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.el.classList.remove("is-visible");
      }, 2600);
    },
  };

  /* ------------------------------------------------- gaveta do carrinho */
  const drawer = () => $("#cart-drawer");
  const overlay = () => $("#overlay");

  function openCart() {
    drawer()?.classList.add("is-open");
    overlay()?.classList.add("is-open");
    document.body.classList.add("is-locked");
    drawer()?.setAttribute("aria-hidden", "false");
    $(".drawer__close")?.focus();
  }

  function closeAll() {
    drawer()?.classList.remove("is-open");
    overlay()?.classList.remove("is-open");
    $("#mobile-nav")?.classList.remove("is-open");
    document.body.classList.remove("is-locked");
    drawer()?.setAttribute("aria-hidden", "true");
    $("#mobile-nav")?.setAttribute("aria-hidden", "true");
  }

  /* --------------------------------------------- mensagem de WhatsApp */
  function buildWhatsMessage(store) {
    const lines = [];
    lines.push("Olá! Vim pelo site e quero fechar um pedido 🖤");
    lines.push(
      store ? `*Loja:* Censura 18 — ${store.city} (${store.district})` : ""
    );
    lines.push("");
    lines.push("*Itens:*");
    Cart.items.forEach((i, idx) => {
      lines.push(
        `${idx + 1}. ${i.qty}x ${i.name} — tam. ${i.size}, cor ${i.color} — ${money(
          i.price * i.qty
        )}`
      );
    });
    lines.push("");
    lines.push(`*Total dos itens:* ${money(Cart.subtotal())}`);
    const freteSel = Frete.selecionada();
    const totalComFrete = C18Frete.totalComFrete(Cart.subtotal(), freteSel);
    if (freteSel) {
      lines.push(...C18Frete.mensagemFrete(freteSel, Checkout.cep));
      lines.push(`*Total com frete:* ${money(totalComFrete)}`);
    }
    const plan = CheckoutTools.installmentPlan
      ? CheckoutTools.installmentPlan(totalComFrete)
      : null;
    if (plan) {
      lines.push(
        `*Parcelamento:* ${
          plan.count >= 2
            ? `até ${plan.count}x de ${money(plan.each)} sem juros`
            : "à vista no Pix ou cartão"
        } — parcela mínima de R$ 49,00`
      );
    }
    lines.push("");
    lines.push(...CheckoutTools.checkoutMessageLines({
      ...Checkout,
      couponDescription: couponDescriptionForMessage(),
    }));
    if (
      typeof window.C18Cliente === "object" &&
      typeof window.C18Cliente.linhasWhatsApp === "function"
    ) {
      lines.push(...window.C18Cliente.linhasWhatsApp());
    }
    if (Checkout.couponCode) lines.push("*Observação:* total sujeito à validação do cupom pela loja.");
    lines.push("");
    lines.push(
      freteSel
        ? "Podem confirmar disponibilidade em estoque e o desconto?"
        : "Podem confirmar disponibilidade em estoque, desconto e frete?"
    );
    lines.push("");
    const cepTexto = C18Frete.formatCep(Checkout.cep);
    lines.push(cepTexto ? `CEP para entrega: ${cepTexto}` : "CEP para entrega: ______");
    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  /* ------------------------------------------------- dados estruturados */
  /* Injeta JSON-LD no <head> para o Google entender produto, loja e marca. */
  function injectJSONLD(id, data) {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement("script");
      el.type = "application/ld+json";
      el.id = id;
      document.head.appendChild(el);
    }
    el.textContent = JSON.stringify(data);
  }

  /* ------------------------------------------------------- acordeões */
  function bindAccordion(btn) {
    if (btn.dataset.accBound) return;
    btn.dataset.accBound = "1";
    const acc = btn.closest(".acc");
    btn.setAttribute("aria-expanded", String(acc.classList.contains("is-open")));
    btn.addEventListener("click", () => {
      const open = acc.classList.toggle("is-open");
      btn.setAttribute("aria-expanded", String(open));
    });
  }

  /* ------------------------------------------------------- componentes */
  function cardHTML(p) {
    const off = offPercent(p.price, p.priceFrom);
    return `
    <article class="card">
      <div class="card__media">
        <a href="produto.html?id=${encodeURIComponent(p.id)}" aria-label="${escapeHTML(
      p.name
    )}">
          <img class="card__img" src="${escapeHTML(p.image)}"
               alt="${escapeHTML(p.name)}" loading="lazy"
               onerror="this.onerror=null;this.src='${PLACEHOLDER(p.name)}'">
          ${
            p.images && p.images[1]
              ? `<img class="card__img card__img--alt" src="${escapeHTML(
                  p.images[1]
                )}" alt="" aria-hidden="true" loading="lazy"
                     onerror="this.remove()">`
              : ""
          }
        </a>
        ${
          p.badge || off
            ? `<div class="card__badges">
                 ${p.badge ? `<span class="badge">${escapeHTML(p.badge)}</span>` : ""}
                 ${off ? `<span class="badge badge--sale">-${off}%</span>` : ""}
               </div>`
            : ""
        }
        <div class="card__quick">
          <button class="btn btn--block" data-quick-add="${escapeHTML(p.id)}">
            Adicionar rápido
          </button>
        </div>
      </div>
      <div class="card__body">
        <span class="card__cat">${escapeHTML(categoryLabel(p.category))}</span>
        <a class="card__name" href="produto.html?id=${encodeURIComponent(
          p.id
        )}">${escapeHTML(p.name)}</a>
        <div class="card__price">
          <span class="now">${money(p.price)}</span>
          ${p.priceFrom ? `<span class="was">${money(p.priceFrom)}</span>` : ""}
          ${off ? `<span class="off">-${off}%</span>` : ""}
        </div>
        <div class="card__swatches">
          ${p.colors
            .map(
              (c) =>
                `<span class="swatch" style="background:${escapeHTML(
                  c.hex
                )}" title="${escapeHTML(c.name)}"></span>`
            )
            .join("")}
        </div>
      </div>
    </article>`;
  }

  function renderGrid(target, list) {
    if (!target) return;
    target.innerHTML = list.length
      ? list.map(cardHTML).join("")
      : `<div class="empty">
           <h3>Nada por aqui ainda</h3>
           <p>Tente outra categoria ou limpe os filtros.</p>
           <button class="btn btn--ghost" data-reset-filters>Limpar filtros</button>
         </div>`;
  }

  /* --------------------------------------------------------- catálogo */
  function initCatalog() {
    const grid = $("#product-grid");
    if (!grid) return;

    const state = {
      cat: "todos",
      sort: "relevancia",
      q: "",
    };

    const chips = $("#filter-chips");
    if (chips) {
      chips.innerHTML = CATEGORIES.map(
        (c) =>
          `<button class="chip${
            c.id === "todos" ? " is-active" : ""
          }" data-cat="${c.id}">${escapeHTML(c.label)}</button>`
      ).join("");
    }

    function apply() {
      let list = PRODUCTS.slice();

      if (state.cat !== "todos") {
        list = list.filter((p) => p.category === state.cat);
      }

      if (state.q) {
        const q = state.q.toLowerCase();
        list = list.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            categoryLabel(p.category).toLowerCase().includes(q)
        );
      }

      switch (state.sort) {
        case "menor":
          list.sort((a, b) => a.price - b.price);
          break;
        case "maior":
          list.sort((a, b) => b.price - a.price);
          break;
        case "nome":
          list.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
          break;
        case "desconto":
          list.sort(
            (a, b) =>
              offPercent(b.price, b.priceFrom) - offPercent(a.price, a.priceFrom)
          );
          break;
        default:
          break;
      }

      renderGrid(grid, list);

      const info = $("#results-info");
      if (info) {
        info.textContent = `${list.length} ${
          list.length === 1 ? "peça" : "peças"
        }`;
      }

      const searchTitle = $("#search-title");
      if (searchTitle) {
        if (state.q) {
          searchTitle.hidden = false;
          searchTitle.innerHTML = `${list.length} ${
            list.length === 1 ? "resultado" : "resultados"
          } para <strong>“${escapeHTML(state.q)}”</strong>`;
        } else {
          searchTitle.hidden = true;
        }
      }

      const h1 = $("#catalog-title");
      if (h1 && state.q) h1.textContent = "Busca";
    }

    chips?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-cat]");
      if (!btn) return;
      state.cat = btn.dataset.cat;
      $$(".chip", chips).forEach((c) =>
        c.classList.toggle("is-active", c === btn)
      );
      apply();
    });

    $("#sort-select")?.addEventListener("change", (e) => {
      state.sort = e.target.value;
      apply();
    });

    const url = new URLSearchParams(location.search);
    const catParam = url.get("cat");
    if (catParam && CATEGORIES.some((c) => c.id === catParam)) {
      state.cat = catParam;
      $$(".chip", chips).forEach((c) =>
        c.classList.toggle("is-active", c.dataset.cat === catParam)
      );
    }
    const qParam = url.get("q");
    if (qParam) state.q = qParam;

    apply();
  }

  /* Adição rápida: usa o primeiro tamanho disponível e a primeira cor.
     O aviso diz exatamente o que entrou, pra ninguém se surpreender depois. */
  function quickAdd(id) {
    const p = getProduct(id);
    if (!p) return;
    const size = p.sizes.find((s) => !p.soldOut.includes(s)) || p.sizes[0];
    const color = p.colors[0].name;
    Cart.add({
      id: p.id,
      name: p.name,
      price: p.price,
      image: p.image,
      size: size,
      color: color,
      qty: 1,
    });
    Toast.show(`${p.name} · tam. ${size}, ${color} — no carrinho`);
  }

  /* ------------------------------------------------------ página produto */
  function initPDP() {
    const root = $("#pdp");
    if (!root) return;

    const id = new URLSearchParams(location.search).get("id");
    const p = getProduct(id) || PRODUCTS[0];

    document.title = `${p.name} — Censura 18`;

    const off = offPercent(p.price, p.priceFrom);

    // Galeria: use o campo  images: [foto1, foto2, ...]  no data.js para
    // ter mais de uma foto por peça. Com uma só, a tira de miniaturas nem
    // aparece.
    const shots = Array.isArray(p.images) && p.images.length
      ? p.images
      : [p.image];

    root.innerHTML = `
      <div class="gallery">
        <div class="gallery__main">
          <img id="pdp-shot" src="${escapeHTML(p.image)}" alt="${escapeHTML(
      p.name
    )}" onerror="this.onerror=null;this.src='${PLACEHOLDER(p.name)}'">
        </div>
        ${
          shots.length > 1
            ? `<div class="gallery__thumbs">
          ${shots
            .map(
              (s, i) => `
            <button class="thumb${i === 0 ? " is-active" : ""}" data-shot="${escapeHTML(
                s
              )}" aria-label="Foto ${i + 1}">
              <img src="${escapeHTML(s)}" alt="" loading="lazy"
                   onerror="this.onerror=null;this.src='${PLACEHOLDER(p.name)}'">
            </button>`
            )
            .join("")}
        </div>`
            : ""
        }
      </div>

      <div class="pdp__info">
        <nav class="breadcrumb" aria-label="Você está aqui">
          <a href="index.html">Home</a> <span>/</span>
          <a href="produtos.html?cat=${encodeURIComponent(p.category)}">${escapeHTML(
            categoryLabel(p.category)
          )}</a> <span>/</span>
          <span>${escapeHTML(p.name)}</span>
        </nav>

        ${
          p.badge || off
            ? `<div class="card__badges" style="position:static;margin-bottom:8px;flex-direction:row">
                 ${
                   p.badge
                     ? `<span class="badge">${escapeHTML(p.badge)}</span>`
                     : ""
                 }
                 ${off ? `<span class="badge badge--sale">-${off}% OFF</span>` : ""}
               </div>`
            : ""
        }

        <h1 class="pdp__title">${escapeHTML(p.name)}</h1>

        <div class="pdp__price">
          <span class="now">${money(p.price)}</span>
          ${p.priceFrom ? `<span class="was">${money(p.priceFrom)}</span>` : ""}
          ${(() => {
            const plano = CheckoutTools.installmentPlan
              ? CheckoutTools.installmentPlan(p.price)
              : null;
            return plano && plano.count >= 2
              ? `<span class="pix">ou ${plano.count}x de ${money(plano.each)} sem juros</span>`
              : "";
          })()}
        </div>

        <p class="pdp__desc">${escapeHTML(p.description)}</p>

        <div class="opt">
          <div class="opt__head">
            <span>Cor</span><span class="val" id="color-label">${
              escapeHTML(p.colors[0].name) || ""
            }</span>
          </div>
          <div class="opt__row" id="color-row">
            ${p.colors
              .map(
                (c, i) => `
              <button class="color-btn${i === 0 ? " is-active" : ""}"
                      data-color="${escapeHTML(c.name)}"
                      style="background:${escapeHTML(c.hex)}"
                      aria-label="${escapeHTML(c.name)}"></button>`
              )
              .join("")}
          </div>
        </div>

        <div class="opt">
          <div class="opt__head">
            <span>Tamanho</span>
            <button type="button" class="val guide-toggle" id="guide-toggle"
                    aria-expanded="false" aria-controls="size-guide">
              Guia de medidas
            </button>
          </div>
          <div class="opt__row" id="size-row">
            ${p.sizes
              .map(
                (s) => `
              <button class="size-btn" data-size="${escapeHTML(s)}"
                      ${p.soldOut.includes(s) ? "disabled" : ""}>${escapeHTML(
                  s
                )}</button>`
              )
              .join("")}
          </div>

          <div class="guide" id="size-guide" hidden>
            <table>
              <thead>
                <tr><th>Tam.</th><th>Tórax</th><th>Comprimento</th><th>Manga</th></tr>
              </thead>
              <tbody>
                <tr><td>P</td><td>52 cm</td><td>70 cm</td><td>20 cm</td></tr>
                <tr><td>M</td><td>55 cm</td><td>72 cm</td><td>21 cm</td></tr>
                <tr><td>G</td><td>58 cm</td><td>74 cm</td><td>22 cm</td></tr>
                <tr><td>GG</td><td>61 cm</td><td>76 cm</td><td>23 cm</td></tr>
                <tr><td>XG</td><td>64 cm</td><td>78 cm</td><td>24 cm</td></tr>
              </tbody>
            </table>
            <p>Medidas aproximadas, tiradas com a peça reta — podem variar
            até 2 cm por lote. Em dúvida entre dois tamanhos, escolha o
            maior: o streetwear é pra ficar solto.</p>
          </div>
        </div>

        <div class="opt">
          <div class="opt__head"><span>Quantidade</span></div>
          <span class="qty">
            <button id="qty-minus" aria-label="Diminuir">−</button>
            <span id="qty-val">1</span>
            <button id="qty-plus" aria-label="Aumentar">+</button>
          </span>
        </div>

        <div class="pdp__cta">
          <button class="btn" id="add-cart">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/>
              <path d="M3 6h18M16 10a4 4 0 0 1-8 0"/>
            </svg>
            Adicionar ao carrinho
          </button>
          <button class="btn btn--ghost" id="buy-now">Comprar agora</button>
        </div>

        <p class="drawer__note" style="text-align:center">
          Frete grátis acima de R$ 299 · Troca em até 30 dias ·
          Retire em uma das 6 lojas físicas
        </p>

        <div class="pdp__extra">
          <div class="acc is-open">
            <button class="acc__btn">Detalhes
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 5v14M5 12h14"/></svg>
            </button>
            <div class="acc__panel"><div>
              <ul style="list-style:disc;padding-left:18px">
                ${p.details.map((d) => `<li>${escapeHTML(d)}</li>`).join("")}
              </ul>
            </div></div>
          </div>
          <div class="acc">
            <button class="acc__btn">Composição e cuidados
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 5v14M5 12h14"/></svg>
            </button>
            <div class="acc__panel"><div><p>${escapeHTML(p.care)}</p></div></div>
          </div>
          <div class="acc">
            <button class="acc__btn">Entrega e trocas
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 5v14M5 12h14"/></svg>
            </button>
            <div class="acc__panel"><div>
              <p>Entregamos para todo o Brasil. O frete é calculado junto com a
              loja por WhatsApp, e você também pode retirar em qualquer uma das
              nossas 6 lojas físicas na Baixada Fluminense. Trocas em até 30
              dias, com a peça sem uso e a etiqueta intacta.</p>
              <div class="frete-pdp">
                <label for="frete-pdp-cep">Simule o frete da sua entrega</label>
                <div class="coupon-control">
                  <input id="frete-pdp-cep" type="text" inputmode="numeric" maxlength="9"
                         autocomplete="postal-code" placeholder="00000-000"
                         value="${escapeHTML(C18Frete.formatCep(Checkout.cep))}">
                  <button type="button" id="frete-pdp-calc">Calcular</button>
                </div>
                <div id="frete-pdp-result" aria-live="polite"></div>
              </div>
            </div></div>
          </div>
        </div>
      </div>`;

    injectJSONLD("ld-product", {
      "@context": "https://schema.org",
      "@type": "Product",
      name: p.name,
      sku: p.id,
      description: p.description,
      image: [new URL(p.image, location.href).href],
      brand: { "@type": "Brand", name: "Censura 18" },
      category: categoryLabel(p.category),
      offers: {
        "@type": "Offer",
        price: p.price.toFixed(2),
        priceCurrency: "BRL",
        availability: p.soldOut.length === p.sizes.length
          ? "https://schema.org/OutOfStock"
          : "https://schema.org/InStock",
      },
    });

    /* estado da página */
    let size = p.sizes.find((s) => !p.soldOut.includes(s)) || null;
    let color = p.colors[0].name;
    let qty = 1;

    $$("#size-row .size-btn").forEach((b) => {
      b.addEventListener("click", () => {
        if (b.disabled) return;
        $$("#size-row .size-btn").forEach((x) =>
          x.classList.remove("is-active")
        );
        b.classList.add("is-active");
        size = b.dataset.size;
      });
    });

    $$("#color-row .color-btn").forEach((b) => {
      b.addEventListener("click", () => {
        $$("#color-row .color-btn").forEach((x) =>
          x.classList.remove("is-active")
        );
        b.classList.add("is-active");
        color = b.dataset.color;
        const lbl = $("#color-label");
        if (lbl) lbl.textContent = color;
      });
    });

    /* guia de medidas */
    const guideBtn = $("#guide-toggle");
    const guide = $("#size-guide");
    guideBtn?.addEventListener("click", () => {
      const open = guideBtn.getAttribute("aria-expanded") === "true";
      guideBtn.setAttribute("aria-expanded", String(!open));
      if (guide) guide.hidden = open;
    });

    /* acordeões (detalhes, composição e entrega) */
    $$(".acc__btn", root).forEach(bindAccordion);

    $$(".thumb").forEach((t) => {
      t.addEventListener("click", () => {
        $$(".thumb").forEach((x) => x.classList.remove("is-active"));
        t.classList.add("is-active");
        const main = $("#pdp-shot");
        if (main) main.src = t.dataset.shot;
      });
    });

    $("#qty-minus").addEventListener("click", () => {
      if (qty > 1) {
        qty--;
        $("#qty-val").textContent = qty;
      }
    });
    $("#qty-plus").addEventListener("click", () => {
      if (qty < 10) {
        qty++;
        $("#qty-val").textContent = qty;
      }
    });

    function addToCart() {
      if (!size) {
        Toast.show("Escolha um tamanho primeiro");
        $("#size-row")?.scrollIntoView({ block: "center", behavior: "smooth" });
        return false;
      }
      Cart.add({
        id: p.id,
        name: p.name,
        price: p.price,
        image: p.image,
        size: size,
        color: color,
        qty: qty,
      });
      Toast.show(`${p.name} adicionada ao carrinho`);
      return true;
    }

    $("#add-cart").addEventListener("click", addToCart);
    $("#buy-now").addEventListener("click", () => {
      if (addToCart()) openCart();
    });

    /* relacionados */
    const rel = $("#related-grid");
    if (rel) {
      renderGrid(
        rel,
        PRODUCTS.filter((x) => x.category === p.category && x.id !== p.id)
          .concat(PRODUCTS.filter((x) => x.category !== p.category))
          .slice(0, 4)
      );
    }
  }

  /* ------------------------------------------------------------- lojas */
  function initStores() {
    const wrap = $("#stores-grid");
    if (wrap) {
      wrap.innerHTML = STORES.map(
        (s) => `
        <article class="store">
          <div>
            <div class="store__city">${escapeHTML(s.city)}</div>
            <div class="eyebrow" style="margin:6px 0 0">${escapeHTML(
              s.district
            )}</div>
          </div>
          <p class="store__addr">${escapeHTML(s.address)}</p>
          <p class="store__phones">📞 ${escapeHTML(s.phone)}</p>
          <div class="store__actions">
            <a class="btn btn--ghost" style="flex:1"
               href="https://wa.me/${s.whatsapp}?text=${encodeURIComponent(
          `Olá! Vim pelo site da Censura 18 e quero falar com a loja ${s.city} — ${s.district}.`
        )}" target="_blank" rel="noopener">WhatsApp</a>
            <a class="btn btn--ghost" style="flex:1"
               href="https://maps.google.com/?q=${encodeURIComponent(
                 `Censura 18 ${s.address} ${s.city} RJ`
               )}" target="_blank" rel="noopener">Como chegar</a>
          </div>
        </article>`
      ).join("");
    }

    $$("[data-store-select]").forEach((sel) => {
      if (sel.dataset.filled) return;
      sel.innerHTML = STORES.map(
        (s) =>
          `<option value="${s.id}">${escapeHTML(s.city)} — ${escapeHTML(
            s.district
          )}</option>`
      ).join("");
      sel.dataset.filled = "1";
    });
  }

  /* ------------------------------------------------------- contato */
  function initContact() {
    const form = $("#contact-form");
    form?.addEventListener("submit", (e) => {
      e.preventDefault();
      const data = new FormData(form);
      const msg = [
        "*Contato pelo site*",
        `Nome: ${data.get("nome") || "—"}`,
        `E-mail: ${data.get("email") || "—"}`,
        `Assunto: ${data.get("assunto") || "—"}`,
        "",
        data.get("mensagem") || "",
      ].join("\n");
      window.open(
        `https://wa.me/${BRAND.whatsapp}?text=${encodeURIComponent(msg)}`,
        "_blank"
      );
      Toast.show("Abrindo o WhatsApp…");
    });
  }

  /* ----------------------------------------------------- newsletter */
  function initNewsletter() {
    const form = $("#news-form");
    form?.addEventListener("submit", (e) => {
      e.preventDefault();
      const email = $("#news-email")?.value.trim();
      const msg = $("#news-msg");
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        msg.textContent = "Digite um e-mail válido.";
        return;
      }
      msg.textContent = `Valeu! Você entrou na lista — mandamos os drops antes de todo mundo.`;
      form.reset();
    });
  }

  /* --------------------------------------------------------- interface */
  function initUI() {
    /* ano no rodapé */
    $$("[data-year]").forEach((el) => (el.textContent = new Date().getFullYear()));

    /* header sombra ao rolar + botão de topo */
    const header = $(".header");
    const top = $(".fab-top");
    const onScroll = () => {
      header?.classList.toggle("is-stuck", window.scrollY > 10);
      top?.classList.toggle("is-visible", window.scrollY > 600);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    top?.addEventListener("click", () =>
      window.scrollTo({ top: 0, behavior: "smooth" })
    );

    /* menu mobile */
    $("[data-open-nav]")?.addEventListener("click", () => {
      $("#mobile-nav").classList.add("is-open");
      $("#mobile-nav").setAttribute("aria-hidden", "false");
      document.body.classList.add("is-locked");
    });
    $("[data-close-nav]")?.addEventListener("click", closeAll);

    /* busca */
    $("[data-toggle-search]")?.addEventListener("click", () => {
      const s = $(".search");
      s.classList.toggle("is-open");
      if (s.classList.contains("is-open")) $(".search__input").focus();
    });

    const searchForm = $("#search-form");
    searchForm?.addEventListener("submit", (e) => {
      e.preventDefault();
      const q = $(".search__input").value.trim();
      location.href = q ? `produtos.html?q=${encodeURIComponent(q)}` : "produtos.html";
    });

    /* link ativo */
    const here = location.pathname.split("/").pop() || "index.html";
    $$(".nav__link, .mobile-nav__link").forEach((a) => {
      const href = a.getAttribute("href");
      if (href === here) a.classList.add("is-active");
    });

    /* acordeões estáticos (FAQ, etc.) */
    $$(".acc__btn").forEach(bindAccordion);

    /* abrir/fechar carrinho */
    $$("[data-open-cart]").forEach((b) =>
      b.addEventListener("click", (e) => {
        e.preventDefault();
        openCart();
      })
    );
    $("[data-close-cart]")?.addEventListener("click", closeAll);
    overlay()?.addEventListener("click", closeAll);

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeAll();
    });

    /* delegacia de eventos: carrinho + adição rápida */
    document.addEventListener("click", async (e) => {
      const close = e.target.closest("[data-close-cart]");
      if (close && close.tagName === "A") {
        /* deixa a navegação acontecer, só fecha a gaveta */
        closeAll();
      }

      const q = e.target.closest("[data-qty]");
      if (q) {
        const key = q.dataset.key;
        const it = Cart.items.find((i) => Cart.key(i) === key);
        if (it) Cart.setQty(key, it.qty + Number(q.dataset.qty));
        return;
      }

      const rm = e.target.closest("[data-remove]");
      if (rm) {
        Cart.remove(rm.dataset.remove);
        return;
      }

      if (e.target.closest("#coupon-add")) {
        Checkout.updateFromDrawer();
        if (!Checkout.couponCode) {
          Toast.show("Digite um cupom para adicionar");
          $("#coupon-code")?.focus();
          return;
        }
        const description = await lookupCouponDescription(Checkout.couponCode);
        Checkout.couponDescription = description;
        Cart.renderDrawer();
        Toast.show(
          description
            ? `Cupom ${Checkout.couponCode}: ${description}`
            : `Cupom ${Checkout.couponCode} informado`
        );
        return;
      }

      if (e.target.closest("[data-remove-coupon]")) {
        Checkout.couponCode = "";
        Checkout.couponDescription = "";
        Checkout.save();
        Cart.renderDrawer();
        Toast.show("Cupom removido");
        return;
      }

      if (e.target.closest("#gift-card-add")) {
        Checkout.updateFromDrawer();
        if (!Checkout.giftCardCode) {
          Toast.show("Digite o código do cartão presente");
          $("#gift-card-code")?.focus();
          return;
        }
        if (
          window.C18GiftCard &&
          !window.C18GiftCard.isValidGiftCardCode(Checkout.giftCardCode)
        ) {
          Toast.show("Confira o código — ele começa com C18-");
          $("#gift-card-code")?.focus();
          return;
        }
        Cart.renderDrawer();
        Toast.show(`Cartão presente ${Checkout.giftCardCode} informado`);
        return;
      }

      if (e.target.closest("[data-remove-gift-card]")) {
        Checkout.giftCardCode = "";
        Checkout.save();
        Cart.renderDrawer();
        Toast.show("Cartão presente removido");
        return;
      }

      const qa = e.target.closest("[data-quick-add]");
      if (qa) {
        quickAdd(qa.dataset.quickAdd);
        return;
      }

      const reset = e.target.closest("[data-reset-filters]");
      if (reset) {
        location.href = "produtos.html";
      }
    });

    document.addEventListener("change", (e) => {
      if (e.target.id === "store-select") {
        Checkout.storeId = String(e.target.value || "");
        Checkout.save();
      }
    });

    document.addEventListener("input", (e) => {
      if (e.target.id === "seller-code") {
        Checkout.sellerCode = CheckoutTools.normalizeSellerCode(e.target.value);
        e.target.value = Checkout.sellerCode;
        Checkout.save();
      }
      if (e.target.id === "coupon-code") {
        Checkout.couponCode = CheckoutTools.normalizeCouponCode(e.target.value);
        e.target.value = Checkout.couponCode;
        Checkout.save();
      }
      if (e.target.id === "frete-cep") {
        e.target.value = C18Frete.formatCep(e.target.value);
        Checkout.cep = C18Frete.normalizeCep(e.target.value);
        Checkout.save();
      }
    });

    /* Enter no CEP calcula o frete */
    document.addEventListener("keydown", (e) => {
      if (e.target && e.target.id === "frete-cep" && e.key === "Enter") {
        e.preventDefault();
        $("#frete-calc")?.click();
      }
    });

    /* checkout por WhatsApp */
    document.addEventListener("click", (e) => {
      if (!e.target.closest("#checkout-whats")) return;
      Checkout.updateFromDrawer();
      const sel = $("#store-select");
      const store = STORES.find((s) => s.id === (sel && sel.value)) || STORES[0];
      const url = `https://wa.me/${store.whatsapp}?text=${encodeURIComponent(
        buildWhatsMessage(store)
      )}`;
      window.open(url, "_blank", "noopener");
    });

    document.addEventListener("click", (e) => {
      if (e.target.closest("#cart-clear")) {
        if (confirm("Esvaziar o carrinho?")) Cart.clear();
      }
    });
  }

  /* ------------------------------------------------------------ boot */
  document.addEventListener("DOMContentLoaded", () => {
    /* marca + lojas (vale para qualquer página) */
    injectJSONLD("ld-org", {
      "@context": "https://schema.org",
      "@type": "Store",
      name: "Censura 18",
      description:
        "Loja de streetwear, surfwear e beachwear na Baixada Fluminense desde 1989.",
      email: BRAND.email,
      telephone: "+55 21 99865-3133",
      sameAs: [BRAND.instagram, BRAND.facebook, BRAND.threads],
      address: {
        "@type": "PostalAddress",
        addressLocality: "Nova Iguaçu",
        addressRegion: "RJ",
        addressCountry: "BR",
      },
    });

    Checkout.load();
    Cart.load();

    /* Cliente cadastrado: pré-preenche o CEP do frete com o do cadastro. */
    if (
      typeof window.C18Cliente === "object" &&
      typeof window.C18Cliente.currente === "function" &&
      global.C18Frete
    ) {
      const clienteAtual = window.C18Cliente.currente();
      const cepCliente = C18Frete.normalizeCep(clienteAtual?.cep);
      if (C18Frete.isCepValida(cepCliente) && !Checkout.cep) {
        Checkout.cep = cepCliente;
        Checkout.save();
      }
      window.addEventListener("c18:cliente", (e) => {
        const cepNovo = C18Frete.normalizeCep(e.detail?.cep);
        if (C18Frete.isCepValida(cepNovo) && !Checkout.cep) {
          Checkout.cep = cepNovo;
          Checkout.save();
        }
        Cart.renderDrawer();
      });
    }

    Cart.render();
    initUI();
    initCatalog();
    initPDP();
    initStores();
    initContact();
    initNewsletter();

    /* vitrine da home */
    const feat = $("#featured-grid");
    if (feat) {
      const list = FEATURED_IDS.map(getProduct).filter(Boolean);
      renderGrid(feat, list);
    }
  });
})();
