/* DOM mínimo para executar o painel (admin/) dentro do Node.
   Não é um navegador: é o suficiente para carregar os scripts na mesma ordem
   do admin/index.html, navegar entre páginas e disparar os eventos que o
   painel escuta. Os elementos nascem sob demanda (qualquer "#id" existe),
   então o teste pega o HTML que cada painel gerou. */

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..", "..");

/* mesma ordem de admin/index.html */
const SCRIPTS = [
  "assets/js/coupons.js",
  "assets/js/analytics.js",
  "admin/assets/config.js",
  "admin/assets/importer.js",
  "admin/assets/channels.js",
  "admin/assets/audience.js",
  "admin/assets/admin.js",
];

function classListOf(element) {
  const set = new Set();
  const sync = () => { element.className = Array.from(set).join(" "); };
  return {
    add: (...names) => { names.forEach((name) => set.add(name)); sync(); },
    remove: (...names) => { names.forEach((name) => set.delete(name)); sync(); },
    contains: (name) => set.has(name),
    toggle: (name, force) => {
      const on = force === undefined ? !set.has(name) : Boolean(force);
      if (on) set.add(name); else set.delete(name);
      sync();
      return on;
    },
    _set: set,
  };
}

function createElement(tag, selector, documentRef) {
  const element = {
    tagName: String(tag || "div").toUpperCase(),
    selector: selector || "",
    id: (selector || "").startsWith("#") ? selector.slice(1) : "",
    className: "",
    textContent: "",
    innerHTML: "",
    value: "",
    placeholder: "",
    href: "",
    src: "",
    type: "",
    checked: false,
    disabled: false,
    hidden: false,
    open: false,
    scrollTop: 0,
    scrollHeight: 0,
    dataset: {},
    attributes: new Map(),
    children: [],
    childNodes: [],
    options: [],
    files: [],
    listeners: new Map(),
    parentNode: null,
    parentElement: null,
  };
  element.classList = classListOf(element);
  element.style = {
    setProperty: () => {},
    removeProperty: () => {},
    getPropertyValue: () => "",
    cssText: "",
  };
  element.setAttribute = (name, value) => {
    element.attributes.set(name, String(value));
    if (name === "value") element.value = String(value);
    if (name === "hidden") element.hidden = true;
    if (name === "disabled") element.disabled = true;
    if (name === "checked") element.checked = true;
    if (name.startsWith("data-")) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      element.dataset[key] = String(value);
    }
  };
  element.getAttribute = (name) => (element.attributes.has(name) ? element.attributes.get(name) : null);
  element.hasAttribute = (name) => element.attributes.has(name);
  element.removeAttribute = (name) => element.attributes.delete(name);
  element.addEventListener = (type, handler) => {
    const list = element.listeners.get(type) || [];
    list.push(handler);
    element.listeners.set(type, list);
  };
  element.removeEventListener = (type, handler) => {
    element.listeners.set(type, (element.listeners.get(type) || []).filter((item) => item !== handler));
  };
  element.dispatchEvent = (event) => {
    (element.listeners.get(event.type) || []).slice().forEach((handler) => handler(event));
    return true;
  };
  element.fire = (type, extra) => element.dispatchEvent(Object.assign({
    type,
    target: element,
    currentTarget: element,
    preventDefault: () => {},
    stopPropagation: () => {},
  }, extra || {}));
  element.appendChild = (child) => {
    element.children.push(child);
    element.childNodes.push(child);
    if (child && typeof child === "object") { child.parentNode = element; child.parentElement = element; }
    return child;
  };
  element.append = (...kids) => kids.forEach((kid) => element.appendChild(kid));
  element.insertBefore = (child) => element.appendChild(child);
  element.removeChild = (child) => {
    element.children = element.children.filter((item) => item !== child);
    element.childNodes = element.childNodes.filter((item) => item !== child);
    return child;
  };
  element.replaceChildren = (...kids) => {
    element.children = [];
    element.childNodes = [];
    kids.forEach((kid) => element.appendChild(kid));
  };
  element.remove = () => { if (element.parentNode) element.parentNode.removeChild(element); };
  element.focus = () => {};
  element.blur = () => {};
  element.select = () => {};
  element.scrollIntoView = () => {};
  element.click = () => element.fire("click");
  element.reset = () => {
    element.value = "";
    element.children.forEach((child) => { if (child && typeof child.reset === "function") child.reset(); });
  };
  element.submit = () => element.fire("submit");
  element.add = (option) => element.options.push(option);
  element.insertAdjacentHTML = (_where, html) => { element.innerHTML += html; };
  element.getBoundingClientRect = () => ({ top: 0, left: 0, width: 1280, height: 900, bottom: 900, right: 1280 });
  element.matches = (selector) => {
    if (!selector) return false;
    if (selector === element.selector) return true;
    if (selector.startsWith("#")) return selector.slice(1) === element.id;
    if (selector.startsWith(".")) return element.classList.contains(selector.slice(1));
    if (selector.startsWith("[")) {
      const name = selector.slice(1, -1).split("=")[0];
      return element.attributes.has(name) || Object.prototype.hasOwnProperty.call(element.dataset, name.replace(/^data-/, ""));
    }
    return selector.toLowerCase() === String(element.tagName).toLowerCase();
  };
  element.closest = (selector) => {
    let node = element;
    while (node) {
      if (node.matches && node.matches(selector)) return node;
      node = node.parentNode;
    }
    return null;
  };
  element.querySelector = (selector) => documentRef.querySelector(selector);
  element.querySelectorAll = (selector) => documentRef.querySelectorAll(selector);
  return element;
}

function createStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(String(key)) ? map.get(String(key)) : null),
    setItem: (key, value) => { map.set(String(key), String(value)); },
    removeItem: (key) => { map.delete(String(key)); },
    clear: () => map.clear(),
    key: (index) => Array.from(map.keys())[index] ?? null,
    get length() { return map.size; },
    _map: map,
  };
}

/* Carrega o painel num contexto isolado e devolve os controles do teste. */
function bootAdmin(options) {
  const opts = options || {};
  const registry = new Map();
  const documentListeners = new Map();
  const collections = new Map();

  const documentRef = {
    readyState: "complete",
    title: "Censura 18 — Painel",
    referrer: "",
    location: null,
    listeners: documentListeners,
    addEventListener: (type, handler) => {
      const list = documentListeners.get(type) || [];
      list.push(handler);
      documentListeners.set(type, list);
    },
    removeEventListener: (type, handler) => {
      documentListeners.set(type, (documentListeners.get(type) || []).filter((item) => item !== handler));
    },
    dispatchEvent: (event) => {
      (documentListeners.get(event.type) || []).slice().forEach((handler) => handler(event));
      return true;
    },
    createElement: (tag) => createElement(tag, "", documentRef),
    createTextNode: (text) => ({ nodeType: 3, textContent: String(text) }),
    createDocumentFragment: () => createElement("fragment", "", documentRef),
    getElementById: (id) => documentRef.querySelector(`#${id}`),
    querySelector: (selector) => {
      if (typeof selector !== "string") return null;
      if (selector.startsWith("#")) {
        if (!registry.has(selector)) registry.set(selector, createElement("div", selector, documentRef));
        return registry.get(selector);
      }
      return createElement("div", selector, documentRef);
    },
    querySelectorAll: (selector) => collections.get(selector) || [],
    elementFromPoint: () => null,
  };

  const body = createElement("body", "", documentRef);
  const documentElement = createElement("html", "", documentRef);
  documentRef.body = body;
  documentRef.documentElement = documentElement;

  const location = {
    href: "https://censura18.com.br/admin/",
    origin: "https://censura18.com.br",
    protocol: "https:",
    host: "censura18.com.br",
    hostname: "censura18.com.br",
    pathname: "/admin/",
    search: "",
    hash: "",
    assign: () => {},
    replace: () => {},
    reload: () => {},
  };
  documentRef.location = location;

  const localStorage = createStorage();
  const sessionStorage = createStorage();

  const sandbox = {
    document: documentRef,
    location,
    localStorage,
    sessionStorage,
    navigator: { userAgent: "node-test", language: "pt-BR", onLine: true, clipboard: { writeText: async () => {} } },
    history: { pushState: () => {}, replaceState: () => {}, back: () => {} },
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    Blob: class Blob {
      constructor(parts, blobOptions) {
        this.parts = parts || [];
        this.type = (blobOptions && blobOptions.type) || "";
        this.size = this.parts.reduce((total, part) => total + String(part).length, 0);
      }
    },
    fetch: opts.fetch || (async () => { throw new Error("rede desligada no teste"); }),
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }),
    requestAnimationFrame: (fn) => setTimeout(() => fn(Date.now()), 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    innerWidth: 1440,
    innerHeight: 900,
    scrollY: 0,
    scrollTo: () => {},
    alert: () => {},
    confirm: () => true,
    print: () => {},
    C18_SUPABASE: opts.supabase || null,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  sandbox.top = sandbox;
  sandbox.parent = sandbox;

  /* URL.createObjectURL só existe no navegador — o download do feed usa */
  if (!URL.createObjectURL) {
    URL.createObjectURL = () => "blob:teste";
    URL.revokeObjectURL = () => {};
  }

  const context = vm.createContext(sandbox);
  const loaded = [];
  SCRIPTS.forEach((relative) => {
    const file = path.join(ROOT, relative);
    const code = fs.readFileSync(file, "utf8");
    vm.runInContext(code, context, { filename: relative });
    loaded.push(relative);
  });

  const get = (selector) => documentRef.querySelector(selector);
  const html = (selector) => String(get(selector).innerHTML || "");
  const text = (selector) => String(get(selector).textContent || "");

  /* evento delegado no document, como o painel escuta */
  const fireDocument = (type, target, extra) => {
    documentRef.dispatchEvent(Object.assign({
      type,
      target: target || body,
      currentTarget: documentRef,
      preventDefault: () => {},
      stopPropagation: () => {},
    }, extra || {}));
  };

  const navTarget = (page) => ({
    dataset: { nav: page },
    matches: () => false,
    closest: (selector) => (selector === "[data-nav]" ? { dataset: { nav: page } } : null),
  });

  return {
    sandbox,
    context,
    document: documentRef,
    registry,
    collections,
    loaded,
    get,
    html,
    text,
    localStorage,
    fireDocument,
    navigate: (page) => fireDocument("click", navTarget(page)),
    /* alvo sintético para os cliques delegados: o painel lê dataset.* */
    clickSelector: (selector, dataset) => {
      const data = dataset || {};
      const target = {
        dataset: data,
        matches: (value) => value === selector,
        closest: (value) => (value === selector ? { dataset: data } : null),
      };
      fireDocument("click", target);
    },
    change: (selector, value) => {
      const element = get(selector);
      element.value = value;
      fireDocument("change", element);
      element.fire("change");
    },
    clickElement: (selector, extra) => get(selector).fire("click", extra),
    submit: (selector) => {
      const element = get(selector);
      fireDocument("submit", element);
      element.fire("submit");
    },
    setCollection: (selector, elements) => { collections.set(selector, elements); },
    drainTimers: () => new Promise((resolve) => setTimeout(resolve, 30)),
  };
}

module.exports = { bootAdmin, SCRIPTS, ROOT };
