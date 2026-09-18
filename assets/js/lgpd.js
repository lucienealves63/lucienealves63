/* Censura 18 — aviso de privacidade e consentimento (LGPD, Lei 13.709/2018)
 *
 * O site não usa cookies de rastreamento e não envia dados para terceiros:
 * carrinho e preferências ficam no localStorage do próprio navegador. Este
 * módulo registra a escolha do visitante no banner e avisa o resto do site
 * quando ele prefere guardar apenas o essencial:
 *
 *   C18LGPD.canPersistPreferences() → false  ⇒  o app.js deixa de salvar
 *   as preferências do checkout (código do vendedor, cupom e cartão
 *   presente) e apaga o que já estava gravado. O carrinho continua salvo —
 *   é essencial para a compra, como o item no carrinho de uma loja física.
 *
 * A mesma escolha comanda a medição de audiência (assets/js/analytics.js):
 * ao responder, este módulo dispara o evento "c18:lgpd-change" no document.
 * Com "Aceitar", o site passa a contar páginas visitadas, cliques (mapa de
 * calor), rolagem e origem do tráfego — sempre sem terceiros, sem cookie e
 * sem dado pessoal. Com "Só o essencial", nada é medido e o que porventura
 * estava guardado é apagado.
 */
(function (global) {
  "use strict";

  const CONSENT_KEY = "c18:lgpd-consent";
  const STATUS = { GRANTED: "granted", ESSENTIAL: "essential" };

  /* Dados que deixam de ser guardados quando o visitante escolhe
     "Só o essencial". Carrinho (c18:carrinho) e configurações de
     demonstração do painel (c18:demo-banner / c18:demo-palette) ficam:
     são necessários para o funcionamento e não são dados pessoais. */
  const OPTIONAL_KEYS = [
    "c18:checkout",
    "c18:analytics-session",
    "c18:analytics-visitor",
    "c18:demo-analytics",
  ];

  function storageRef(storage) {
    return (
      storage ||
      (typeof global.localStorage !== "undefined" ? global.localStorage : null)
    );
  }

  /* → { status: "granted" | "essential", at: ISO } ou null (sem resposta). */
  function getConsent(storage) {
    const ref = storageRef(storage);
    if (!ref) return null;
    try {
      const saved = JSON.parse(ref.getItem(CONSENT_KEY) || "null");
      if (
        saved &&
        (saved.status === STATUS.GRANTED || saved.status === STATUS.ESSENTIAL)
      ) {
        return { status: saved.status, at: saved.at || null };
      }
    } catch (_) {
      /* valor ilegível = ainda não respondido */
    }
    return null;
  }

  function setConsent(status, storage) {
    const choice =
      status === STATUS.GRANTED ? STATUS.GRANTED : STATUS.ESSENTIAL;
    const ref = storageRef(storage);
    if (ref) {
      try {
        ref.setItem(
          CONSENT_KEY,
          JSON.stringify({ status: choice, at: new Date().toISOString() })
        );
      } catch (_) {
        /* modo privado: a escolha vale só para esta sessão */
      }
    }
    return choice;
  }

  function hasFullConsent(storage) {
    const consent = getConsent(storage);
    return Boolean(consent) && consent.status === STATUS.GRANTED;
  }

  /* Sem resposta ainda ou com "Aceitar" → pode salvar preferências. */
  function canPersistPreferences(storage) {
    const consent = getConsent(storage);
    return !consent || consent.status === STATUS.GRANTED;
  }

  function dropOptionalData(storage) {
    const ref = storageRef(storage);
    if (!ref) return;
    OPTIONAL_KEYS.forEach((key) => {
      try {
        ref.removeItem(key);
      } catch (_) {
        /* storage indisponível: não há nada para apagar */
      }
    });
  }

  /* Avisa o resto do site (audiência e preferências) sobre a escolha. */
  function notify(status, doc) {
    if (!doc || typeof doc.dispatchEvent !== "function") return;
    if (typeof global.CustomEvent !== "function") return;
    doc.dispatchEvent(new global.CustomEvent("c18:lgpd-change", { detail: { status } }));
  }

  /* ------------------------------------------------------- banner */
  function renderBanner(options) {
    const opts = options || {};
    const doc = opts.document || global.document || null;
    if (!doc || !doc.body || doc.getElementById("lgpd-banner")) return null;

    const wrap = doc.createElement("div");
    wrap.className = "lgpd";
    wrap.id = "lgpd-banner";
    wrap.setAttribute("role", "region");
    wrap.setAttribute("aria-label", "Aviso de privacidade");
    wrap.innerHTML = `
      <div class="lgpd__inner">
        <p>Nós guardamos só o essencial: <strong>seu carrinho e suas
        preferências ficam no seu navegador</strong> e não são compartilhados
        com ninguém — sem cookies de rastreamento. Com
        <strong>Aceitar</strong>, o site também mede a audiência (páginas
        visitadas, cliques por região e origem da visita) usando um
        <strong>número de sessão aleatório</strong>: sem IP, e-mail ou
        telefone. Saiba mais na
        <a href="${opts.policyHref || "privacidade.html"}">política de privacidade</a>.</p>
        <div class="lgpd__actions">
          <button type="button" class="btn" data-lgpd-accept>Aceitar</button>
          <button type="button" class="btn btn--ghost" data-lgpd-essential>
            Só o essencial (sem medição)
          </button>
        </div>
      </div>`;

    const close = (status) => {
      const choice = setConsent(status, opts.storage);
      if (choice === STATUS.ESSENTIAL) dropOptionalData(opts.storage);
      notify(choice, opts.document || doc);
      if (wrap.remove) wrap.remove();
      else if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
    };

    wrap.querySelector("[data-lgpd-accept]").addEventListener("click", () =>
      close(STATUS.GRANTED)
    );
    wrap.querySelector("[data-lgpd-essential]").addEventListener("click", () =>
      close(STATUS.ESSENTIAL)
    );

    doc.body.appendChild(wrap);
    return wrap;
  }

  function init(options) {
    if (!getConsent(options && options.storage)) renderBanner(options);
  }

  global.C18LGPD = {
    CONSENT_KEY,
    OPTIONAL_KEYS,
    STATUS,
    canPersistPreferences,
    dropOptionalData,
    getConsent,
    hasFullConsent,
    init,
    notify,
    renderBanner,
    setConsent,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = global.C18LGPD;
  }

  if (typeof window !== "undefined" && typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => init());
    } else {
      init();
    }
  }
})(typeof window !== "undefined" ? window : globalThis);
