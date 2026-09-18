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

test("modo static: aplica os números de estatística do hero (demo)", () => {
  const banner = {
    id: "b3", name: "Faixa nova", position: "home-hero", image_path: "assets/img/hero.jpg",
    source: "upload", active: true,
    stats: [
      { value: "37", label: "anos de rua" },
      { value: "7", label: "lojas físicas" },
      { value: "30k", label: "seguidores" },
      { value: "1990", label: "a origem" },
    ],
  };
  const { dom } = loadSiteConfig({ storage: makeLocalStorage(), banner });

  assert.equal(dom.getElementById("hero-stat-1-value").textContent, "37");
  assert.equal(dom.getElementById("hero-stat-1-label").textContent, "anos de rua");
  assert.equal(dom.getElementById("hero-stat-2-value").textContent, "7");
  assert.equal(dom.getElementById("hero-stat-2-label").textContent, "lojas físicas");
  assert.equal(dom.getElementById("hero-stat-3-value").textContent, "30k");
  assert.equal(dom.getElementById("hero-stat-3-label").textContent, "seguidores");
  assert.equal(dom.getElementById("hero-stat-4-value").textContent, "1990");
  assert.equal(dom.getElementById("hero-stat-4-label").textContent, "a origem");
});

test("modo static: número ou legenda em branco mantém o padrão da home", () => {
  const banner = {
    id: "b4", name: "Faixa parcial", position: "home-hero", image_path: "assets/img/hero.jpg",
    source: "upload", active: true,
    stats: [{ value: "40", label: "" }, { value: "", label: "unidades" }],
  };
  const { dom } = loadSiteConfig({ storage: makeLocalStorage(), banner });

  // preenchido entra; em branco o site não toca no texto padrão
  assert.equal(dom.getElementById("hero-stat-1-value").textContent, "40");
  assert.equal(dom.getElementById("hero-stat-1-label").textContent, "");
  assert.equal(dom.getElementById("hero-stat-2-value").textContent, "");
  assert.equal(dom.getElementById("hero-stat-2-label").textContent, "unidades");
  assert.equal(dom.getElementById("hero-stat-3-value").textContent, "");
  assert.equal(dom.getElementById("hero-stat-4-label").textContent, "");
});

test("modo static: números fora do contrato são ignorados", () => {
  const base = {
    id: "b5", name: "Faixa inválida", position: "home-hero", image_path: "assets/img/hero.jpg",
    source: "upload", active: true,
  };

  // não é lista: nada é aplicado
  let { dom } = loadSiteConfig({ storage: makeLocalStorage(), banner: { ...base, stats: "36 anos" } });
  assert.equal(dom.getElementById("hero-stat-1-value").textContent, "");

  // item que não é objeto é ignorado por posição; textos longos são cortados
  ({ dom } = loadSiteConfig({
    storage: makeLocalStorage(),
    banner: {
      ...base,
      stats: [
        { value: "41", label: "anos de rua" },
        42,
        { value: "9".repeat(30), label: "l".repeat(60) },
        { value: "5", label: "lojas" },
        { value: "extra", label: "além do 4º" },
        { value: "extra2", label: "além do 4º" },
      ],
    },
  }));
  assert.equal(dom.getElementById("hero-stat-1-value").textContent, "41");
  assert.equal(dom.getElementById("hero-stat-2-value").textContent, "");
  assert.equal(dom.getElementById("hero-stat-3-value").textContent, "9".repeat(12));
  assert.equal(dom.getElementById("hero-stat-3-label").textContent, "l".repeat(40));
  assert.equal(dom.getElementById("hero-stat-4-value").textContent, "5");
  // a faixa do hero tem 4 posições: o excedente é descartado
  assert.equal(dom.getElementById("hero-stat-5-value").textContent, "");
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

test("contrato dos números do hero: home, painel, site e migration batem", () => {
  const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", ...parts), "utf8");
  const homeHtml = read("index.html");
  const adminHtml = read("admin", "index.html");
  const adminJs = read("admin", "assets", "admin.js");
  const siteJs = read("assets", "js", "site-config.js");
  const statsMigration = read("supabase", "migrations", "202609200001_hero_stats.sql");

  for (const slot of [1, 2, 3, 4]) {
    // a home expõe o par número/legenda com id posicional
    const homeValue = homeHtml.match(new RegExp(`id="hero-stat-${slot}-value">([^<]*)<`));
    const homeLabel = homeHtml.match(new RegExp(`id="hero-stat-${slot}-label">([^<]*)<`));
    assert.ok(homeValue, `home tem #hero-stat-${slot}-value`);
    assert.ok(homeLabel, `home tem #hero-stat-${slot}-label`);
    // o painel edita exatamente as mesmas posições, com os limites do site
    assert.ok(adminHtml.includes(`id="banner-stat-${slot}-value" maxlength="12"`), `painel edita o número ${slot}`);
    assert.ok(adminHtml.includes(`id="banner-stat-${slot}-label" maxlength="40"`), `painel edita a legenda ${slot}`);
    // o site aplica por posição (mesmo contrato de ids)
    assert.ok(siteJs.includes(`hero-stat-\${slot}-value`), "site-config aplica o número");
    assert.ok(siteJs.includes(`hero-stat-\${slot}-label`), "site-config aplica a legenda");
    // o banner novo do painel já vem com o que está no ar na home
    assert.ok(
      adminJs.includes(`{ value: "${homeValue[1]}", label: "${homeLabel[1]}" }`),
      `DEFAULT_HERO_STATS acompanha a home na posição ${slot}`
    );
  }

  // mesmos limites no site, no painel e no banco
  for (const source of [siteJs, adminJs, statsMigration]) {
    assert.ok(source.includes("HERO_STAT") || source.includes("no máximo 4 números"), "constantes compartilhadas");
  }
  assert.ok(siteJs.includes("const HERO_STAT_SLOTS = 4"), "site limita a 4 posições");
  assert.ok(adminJs.includes("const HERO_STAT_SLOTS = 4"), "painel limita a 4 posições");
  assert.ok(adminJs.includes("const HERO_STAT_VALUE_MAX = 12"), "painel valida o número");
  assert.ok(adminJs.includes("const HERO_STAT_LABEL_MAX = 40"), "painel valida a legenda");
  assert.ok(statsMigration.includes("stats jsonb not null default '[]'::jsonb"), "migration cria a coluna stats");
  assert.ok(statsMigration.includes("jsonb_array_length(v_stats) > 4"), "migration limita a 4 itens");
  assert.ok(statsMigration.includes("char_length(v_item_value) > 12"), "migration valida o número");
  assert.ok(statsMigration.includes("char_length(v_item_label) > 40"), "migration valida a legenda");
  // o painel manda a faixa no payload e o site consome
  assert.ok(adminJs.includes("stats: readHeroStats()"), "payload do painel inclui stats");
  assert.ok(siteJs.includes("applyHeroStats(banner.stats)"), "site aplica stats do banner");
});
