const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/* --------------------------------------------------------------------
 * Simulação mínima do DOM/localStorage para exercitar site-config.js
 * no modo demonstração (localStorage compartilhado com o admin/).
 * ------------------------------------------------------------------ */

function makeElement(id) {
  return {
    id,
    textContent: "",
    src: "",
    href: "",
    hidden: false,
    style: { display: "", properties: {}, setProperty(name, value) { this.properties[name] = value; } },
    setAttribute(name, value) { (this.attrs = this.attrs || {})[name] = value; },
    getAttribute(name) { return (this.attrs || {})[name]; },
    removeAttribute(name) { delete (this.attrs || {})[name]; },
    querySelector(selector) {
      if (selector === "img") return this.childImg || (this.childImg = makeElement(`${id}-img`));
      return null;
    },
    classList: { _set: new Set(), add(c) { this._set.add(c); }, remove(c) { this._set.delete(c); }, contains(c) { return this._set.has(c); } },
  };
}

function makeDom() {
  const elements = {};
  const id = (name) => (elements[name] = elements[name] || makeElement(name));
  const root = makeElement("documentElement");
  const metaOg = makeElement("og:image");
  return {
    documentElement: root,
    readyState: "complete",
    getElementById: (name) => id(name),
    querySelector: (selector) => {
      if (selector === 'meta[property="og:image"]') return metaOg;
      return null;
    },
    createElement: () => makeElement("tmp"),
    head: { appendChild() {} },
    addEventListener() {},
    _elements: elements,
    _og: metaOg,
  };
}

function makeLocalStorage() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => void store.set(key, String(value)),
    removeItem: (key) => void store.delete(key),
    _store: store,
  };
}

function loadSiteConfig({ storage, palette, banner }) {
  const dom = makeDom();
  const storageRef = storage;
  if (palette) storageRef.setItem("c18:demo-palette", JSON.stringify(palette));
  if (banner) storageRef.setItem("c18:demo-banner", JSON.stringify(banner));

  const window = { C18_SITE: { mode: "static" } };
  const document = dom;
  const localStorage = storageRef;
  const code = fs.readFileSync(path.join(__dirname, "..", "assets", "js", "site-config.js"), "utf8");
  // eslint-disable-next-line no-new-func
  const run = new Function("window", "document", "localStorage", code);
  run(window, document, localStorage);
  return { dom, storage: storageRef };
}

test("modo static: sem dados, o site mantém o padrão", () => {
  const { dom } = loadSiteConfig({ storage: makeLocalStorage() });
  const props = dom.documentElement.style.properties;
  assert.equal(Object.keys(props).length, 0);
  assert.equal(dom.getElementById("hero-title-1").textContent, "");
});

test("modo static: aplica a paleta ativa do painel (demo)", () => {
  const palette = {
    name: "Campanha test",
    colors: {
      primary: "#b62c2c",
      primaryContrast: "#ffffff",
      darkBg: "#1a1a1a",
      darkText: "#f2f2f2",
      pageBg: "#fbfaf8",
      text: "#222222",
      muted: "#777777",
      line: "#e0dcd4",
    },
  };
  const { dom } = loadSiteConfig({ storage: makeLocalStorage(), palette });
  const props = dom.documentElement.style.properties;
  assert.equal(props["--brand"], "#b62c2c");
  assert.equal(props["--brand-contrast"], "#ffffff");
  assert.equal(props["--ink-inverse-bg"], "#1a1a1a");
  assert.equal(props["--ink-inverse-fg"], "#f2f2f2");
  assert.equal(props["--bg"], "#fbfaf8");
  assert.equal(props["--text"], "#222222");
  assert.equal(props["--text-muted"], "#777777");
  assert.equal(props["--line"], "#e0dcd4");
});

test("modo static: cores inválidas são ignoradas", () => {
  const palette = {
    name: "ruim",
    colors: {
      primary: "red",
      primaryContrast: "javascript:alert(1)",
      darkBg: "#111",
      darkText: "#fff",
      pageBg: "#fff",
      text: "#000",
      muted: "#666",
      line: "#ddd",
    },
  };
  const { dom } = loadSiteConfig({ storage: makeLocalStorage(), palette });
  const props = dom.documentElement.style.properties;
  assert.equal(props["--brand"], undefined);
  assert.equal(props["--brand-contrast"], undefined);
  assert.equal(props["--ink-inverse-bg"], "#111");
});

test("modo static: aplica o banner ativo do painel (demo)", () => {
  const banner = {
    id: "banner-1",
    name: "Drop de inverno",
    position: "home-hero",
    image_path: "data:image/jpeg;base64,TESTE",
    title_top: "Drop de",
    title_bottom: "inverno",
    body_text: "Peças novas toda semana.",
    cta_label: "Ver o drop",
    cta_url: "produtos.html?drop=inverno",
    cta_secondary_label: "Lojas",
    cta_secondary_url: "https://maps.google.com/?q=censura18",
    source: "upload",
    active: true,
  };
  const { dom } = loadSiteConfig({ storage: makeLocalStorage(), banner });
  const img = dom.getElementById("hero-media").querySelector("img");
  assert.equal(img.src, "data:image/jpeg;base64,TESTE");
  assert.equal(dom.getElementById("hero-title-1").textContent, "Drop de");
  assert.equal(dom.getElementById("hero-title-2").textContent, "inverno");
  assert.equal(dom.getElementById("hero-text").textContent, "Peças novas toda semana.");
  assert.equal(dom.getElementById("hero-cta").textContent, "Ver o drop");
  assert.equal(dom.getElementById("hero-cta").href, "produtos.html?drop=inverno");
  assert.equal(dom._og.getAttribute("content"), "data:image/jpeg;base64,TESTE");

  // link externo ganha target=_blank
  const cta2 = dom.getElementById("hero-cta-2");
  assert.equal(cta2.href, "https://maps.google.com/?q=censura18");
  assert.equal(cta2.target, "_blank");
});

test("modo static: banner inativo ou fora da janela não é aplicado", () => {
  const base = {
    id: "b", name: "x", position: "home-hero", image_path: "assets/img/hero.jpg",
    source: "upload", active: true,
  };
  let { dom } = loadSiteConfig({ storage: makeLocalStorage(), banner: base });
  assert.equal(dom.getElementById("hero-title-1").textContent, "");

  const pastStart = { ...base, starts_at: "2999-01-01T00:00:00Z" };
  ({ dom } = loadSiteConfig({ storage: makeLocalStorage(), banner: pastStart }));
  assert.equal(dom.getElementById("hero-title-1").textContent, "");

  const ended = { ...base, ends_at: "2000-01-01T00:00:00Z" };
  ({ dom } = loadSiteConfig({ storage: makeLocalStorage(), banner: ended }));
  assert.equal(dom.getElementById("hero-title-1").textContent, "");
});

test("modo static: link javascript: no CTA é bloqueado", () => {
  const banner = {
    id: "b2", name: "x", position: "home-hero", image_path: "assets/img/hero.jpg",
    source: "upload", active: true,
    cta_label: "Clique",
    cta_url: "javascript:alert('xss')",
  };
  const { dom } = loadSiteConfig({ storage: makeLocalStorage(), banner });
  assert.equal(dom.getElementById("hero-cta").href, "");
});

test("contrato demo: chaves e cores batem entre admin/ e o site", () => {
  const adminJs = fs.readFileSync(path.join(__dirname, "..", "admin", "assets", "admin.js"), "utf8");
  const siteJs = fs.readFileSync(path.join(__dirname, "..", "assets", "js", "site-config.js"), "utf8");
  const adminHtml = fs.readFileSync(path.join(__dirname, "..", "admin", "index.html"), "utf8");
  const migration = fs.readFileSync(path.join(__dirname, "..", "supabase", "migrations", "202609170002_banners_paletas.sql"), "utf8");

  for (const key of ["c18:demo-banner", "c18:demo-palette"]) {
    assert.ok(adminJs.includes(`"${key}"`), `admin.js usa ${key}`);
    assert.ok(siteJs.includes(`"${key}"`), `site-config.js usa ${key}`);
  }

  const colorKeys = ["primary", "primaryContrast", "darkBg", "darkText", "pageBg", "text", "muted", "line"];
  for (const key of colorKeys) {
    assert.ok(adminHtml.includes(`data-palette-key="${key}"`), `admin tem o campo ${key}`);
    assert.ok(siteJs.includes(`${key}: "--`), `site-config mapeia ${key}`);
    assert.ok(migration.includes(`'${key}'`), `migration valida ${key}`);
  }
});
