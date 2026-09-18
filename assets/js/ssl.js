/* Censura 18 — HTTPS sempre
 *
 * O GitHub Pages já serve o site por HTTPS, mas um domínio próprio
 * recém-apontado (tipo censura18.com.br) pode responder em http:// até o
 * certificado sair — ou até alguém marcar "Enforce HTTPS" nas configurações.
 * Este script, carregado no <head> de todas as páginas:
 *
 *   1. redireciona http:// → https:// preservando caminho, busca e #hash
 *      (fora de localhost, que é o servidor local de desenvolvimento);
 *   2. sobe para https:// qualquer link ou recurso que apareça em http://.
 */
(function (global) {
  "use strict";

  function isLocalHost(hostname) {
    const host = String(hostname || "").toLowerCase();
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      !host.includes(".") || /* hostname simples da rede interna */
      /^\d{1,3}(\.\d{1,3}){3}$/.test(host) /* IPv4 literal */
    );
  }

  function shouldRedirect(loc) {
    const current = loc || global.location || null;
    return Boolean(
      current &&
        current.protocol === "http:" &&
        !isLocalHost(current.hostname)
    );
  }

  function httpsUrlFor(loc) {
    const current = loc || global.location;
    return `https://${current.host}${current.pathname}${current.search}${current.hash}`;
  }

  /* Devolve true quando disparou o redirect (a página atual já era). */
  function forceHttps(loc, redirect) {
    if (!shouldRedirect(loc)) return false;
    const current = loc || global.location;
    const go =
      typeof redirect === "function"
        ? redirect
        : current && typeof current.replace === "function"
          ? current.replace.bind(current)
          : null;
    if (!go) return false;
    go(httpsUrlFor(current));
    return true;
  }

  /* Reescreve http:// → https:// em href/src. Devolve quantos corrigiu. */
  function upgradeInsecureUrls(doc) {
    const root = doc || global.document || null;
    if (!root || typeof root.querySelectorAll !== "function") return 0;
    const nodes = root.querySelectorAll('[href^="http://"], [src^="http://"]');
    let fixed = 0;
    nodes.forEach((el) => {
      ["href", "src"].forEach((attr) => {
        const value = el.getAttribute(attr);
        if (typeof value === "string" && value.indexOf("http://") === 0) {
          el.setAttribute(attr, `https://${value.slice(7)}`);
          fixed += 1;
        }
      });
    });
    return fixed;
  }

  function init() {
    if (forceHttps()) return; /* está redirecionando — a página nova cuida do resto */
    if (!global.document) return;
    if (global.document.readyState === "loading") {
      global.document.addEventListener("DOMContentLoaded", () =>
        upgradeInsecureUrls()
      );
    } else {
      upgradeInsecureUrls();
    }
  }

  global.C18SSL = {
    forceHttps,
    httpsUrlFor,
    init,
    isLocalHost,
    shouldRedirect,
    upgradeInsecureUrls,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = global.C18SSL;
  }

  if (typeof window !== "undefined") global.C18SSL.init();
})(typeof window !== "undefined" ? window : globalThis);
