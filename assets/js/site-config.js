/* ==========================================================================
   CENSURA 18 — configuração dinâmica da loja (banners + paleta)
   --------------------------------------------------------------------------
   O painel de operações (admin/) salva banners e paletas no Supabase.
   Este script aplica na home e no catálogo, com chave anônima e políticas
   RLS que só expõem banners ativos e a paleta ativa:

     • home-hero      → arte e textos do hero da home;
     • category-hero  → banner OPCIONAL de cada categoria (o catálogo só
       mostra quando existe um banner ativo para a categoria filtrada);
     • paleta         → 8 cores aplicadas nas variáveis CSS da loja.

     mode: "supabase" → busca em site_banners / site_palettes (produção)
     mode: "static"   → lê do localStorage do próprio navegador. No modo
                        demonstração, o admin/ e o site vivem no mesmo
                        navegador, então as alterações feitas no painel
                        aparecem aqui ao recarregar a home.

   Nunca coloque service_role aqui — apenas URL e anon key (públicas).
   ========================================================================== */

/* --- Configuração pública (mesmo padrão do admin/assets/config.js) ----- */
window.C18_SITE = window.C18_SITE || {
  mode: "static",
  supabaseUrl: "",
  supabaseAnonKey: "",
};

(function () {
  "use strict";

  const cfg = window.C18_SITE;
  const BANNER_DEMO_KEY = "c18:demo-banner";
  const CATEGORY_BANNER_DEMO_KEY = "c18:demo-category-banners";
  const PALETTE_DEMO_KEY = "c18:demo-palette";
  const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

  /* Banners de categoria ativos, carregados no boot (vazio = o catálogo
     fica exatamente como é hoje: sem banner nenhum). */
  let categoryBanners = [];

  /* Criado cedo para o app.js poder registrar a categoria mesmo que os
     banners ainda estejam sendo buscados (setCategory é anexado abaixo). */
  window.C18SiteBanners = window.C18SiteBanners || { current: "", lastApplied: null };

  // Mapa cor salva no painel → variável CSS da loja (assets/css/style.css)
  const PALETTE_VARS = {
    primary: "--brand",
    primaryContrast: "--brand-contrast",
    darkBg: "--ink-inverse-bg",
    darkText: "--ink-inverse-fg",
    pageBg: "--bg",
    text: "--text",
    muted: "--text-muted",
    line: "--line",
  };

  function setIfHex(scope, cssVar, value) {
    if (typeof value === "string" && HEX.test(value)) {
      scope.style.setProperty(cssVar, value);
    }
  }

  function applyPalette(palette) {
    const colors = palette && palette.colors;
    if (!colors || typeof colors !== "object") return;
    const scope = document.documentElement;
    Object.entries(PALETTE_VARS).forEach(([key, cssVar]) => setIfHex(scope, cssVar, colors[key]));
  }

  function applyBanner(banner) {
    if (!banner) return;

    // Imagem do hero
    if (banner.image_path) {
      const media = document.getElementById("hero-media");
      const img = media ? media.querySelector("img") : null;
      if (img) {
        media.classList.remove("is-missing");
        img.style.display = "";
        img.src = banner.image_path;
      }
    }

    // Textos (textContent — nenhum HTML injetado a partir do banco)
    const setText = (id, value) => {
      const el = document.getElementById(id);
      if (el && typeof value === "string" && value.trim()) el.textContent = value.trim();
    };

    const setHref = (id, value) => {
      const el = document.getElementById(id);
      if (!el || typeof value !== "string" || !value.trim()) return;
      const url = value.trim();
      // bloqueia schemes perigosos; relativo, absoluto e externo são permitidos
      if (/^\s*(javascript|data|vbscript):/i.test(url)) return;
      el.href = url;
      if (/^https?:\/\//i.test(url)) {
        el.target = "_blank";
        el.rel = "noopener";
      } else {
        el.removeAttribute("target");
        el.removeAttribute("rel");
      }
    };

    setText("hero-title-1", banner.title_top);
    setText("hero-title-2", banner.title_bottom);
    setText("hero-text", banner.body_text);
    setText("hero-cta", banner.cta_label);
    setHref("hero-cta", banner.cta_url);
    setText("hero-cta-2", banner.cta_secondary_label);
    setHref("hero-cta-2", banner.cta_secondary_url);

    // OG image acompanha a arte ativa (útil em compartilhamentos)
    if (banner.image_path) {
      const og = document.querySelector('meta[property="og:image"]');
      if (og) og.setAttribute("content", banner.image_path);
    }
  }

  /* ------------------------------------------------------------------
     Banner de categoria (opcional)

     O contêiner já existe em produtos.html e produto.html com o atributo
     hidden. Quando não há banner ativo para a categoria, ele continua
     escondido — nada muda no layout. Todo o conteúdo vindo do banco é
     aplicado com textContent/href (nunca innerHTML), como no hero.
     ------------------------------------------------------------------ */
  function safeUrl(value) {
    const url = String(value || "").trim();
    if (!url) return "";
    if (/^\s*(javascript|data|vbscript):/i.test(url)) return "";
    return url;
  }

  function applyCategoryBanner(banner) {
    const box = document.getElementById("category-banner");
    if (!box) return false;
    if (!banner || !isLiveNow(banner)) {
      box.hidden = true;
      box.removeAttribute("data-category");
      return false;
    }

    const image = document.getElementById("category-banner-img");
    const src = safeUrl(banner.image_path);
    if (image) {
      if (src) {
        image.src = src;
        image.hidden = false;
        image.alt = banner.name || "";
        box.classList.remove("is-missing");
      } else {
        image.hidden = true;
        box.classList.add("is-missing");
      }
    }

    const setText = (id, value) => {
      const el = document.getElementById(id);
      if (!el) return;
      const text = typeof value === "string" ? value.trim() : "";
      el.textContent = text;
      el.hidden = !text;
    };

    const setLink = (id, label, href) => {
      const el = document.getElementById(id);
      if (!el) return;
      const text = typeof label === "string" ? label.trim() : "";
      const url = safeUrl(href);
      if (!text || !url) { el.hidden = true; return; }
      el.textContent = text;
      el.href = url;
      if (/^https?:\/\//i.test(url)) { el.target = "_blank"; el.rel = "noopener"; }
      else { el.removeAttribute("target"); el.removeAttribute("rel"); }
      el.hidden = false;
    };

    setText("category-banner-kicker", banner.title_top);
    setText("category-banner-title", banner.title_bottom || banner.name);
    setText("category-banner-text", banner.body_text);
    setLink("category-banner-cta", banner.cta_label, banner.cta_url);
    setLink("category-banner-cta-2", banner.cta_secondary_label, banner.cta_secondary_url);

    box.setAttribute("data-category", String(banner.category || ""));
    box.hidden = false;
    window.C18SiteBanners.lastApplied = banner;
    return true;
  }

  /* Chamado pelo app.js quando o visitante troca o filtro de categoria
     (ou abre a página de um produto). Ids aceitos: o do site ("camisetas")
     e o nome vindo do estoque ("T SHIRT", "CAMISETA"…). */
  function setCategory(categoryId) {
    const wanted = String(categoryId || "").trim();
    const box = document.getElementById("category-banner");
    if (!wanted || wanted === "todos") {
      if (box) { box.hidden = true; box.removeAttribute("data-category"); }
      window.C18SiteBanners.current = "";
      return false;
    }
    const needle = wanted
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
    const match = categoryBanners.find((banner) => {
      const value = String(banner.category || "")
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
        .replace(/[^a-z0-9]+/g, "");
      return value === needle;
    });
    window.C18SiteBanners.current = wanted;
    if (!match) return applyCategoryBanner(null);
    trackBannerView(match);
    return applyCategoryBanner(match);
  }

  /* O banner de categoria aparece na medição de audiência (banner_view) —
     assim o painel mostra se a arte opcional está sendo vista. */
  function trackBannerView(banner) {
    const analytics = window.C18Analytics;
    if (!analytics || typeof analytics.track !== "function") return;
    analytics.track("banner_view", {
      target: `Banner de categoria: ${banner.name || banner.category || ""}`,
      category: banner.category || "",
    });
  }

  function isLiveNow(banner) {
    if (!banner || banner.active === false) return false;
    const now = Date.now();
    if (banner.starts_at && new Date(banner.starts_at).getTime() > now) return false;
    if (banner.ends_at && new Date(banner.ends_at).getTime() < now) return false;
    return true;
  }

  /* ---------------------------- modo Supabase ---------------------------- */
  function loadSupabaseLib() {
    if (window.supabase) return Promise.resolve(window.supabase);
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
      script.onload = () => (window.supabase ? resolve(window.supabase) : reject(new Error("Supabase não carregou")));
      script.onerror = () => reject(new Error("Falha ao carregar o cliente Supabase"));
      document.head.appendChild(script);
    });
  }

  async function applyFromSupabase() {
    const lib = await loadSupabaseLib();
    const client = lib.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // RLS já restringe: banners ativos na janela de datas e paleta ativa.
    const [bannerResult, categoryResult, paletteResult] = await Promise.all([
      client
        .from("site_banners")
        .select("*")
        .eq("position", "home-hero")
        .eq("active", true)
        .order("priority", { ascending: true })
        .limit(1),
      client
        .from("site_banners")
        .select("*")
        .eq("position", "category-hero")
        .eq("active", true)
        .order("priority", { ascending: true })
        .limit(60),
      client.from("site_palettes").select("*").eq("active", true).limit(1),
    ]);

    if (paletteResult.data && paletteResult.data[0]) applyPalette(paletteResult.data[0]);
    if (bannerResult.data && bannerResult.data[0] && isLiveNow(bannerResult.data[0])) {
      applyBanner(bannerResult.data[0]);
    }
    categoryBanners = (categoryResult.data || []).filter(isLiveNow);
    restoreCategoryBanner();
  }

  /* Se o app.js escolheu a categoria antes dos banners chegarem (ordem de
     carregamento), aplica assim que a lista existir. */
  function restoreCategoryBanner() {
    const wanted = window.C18SiteBanners.current;
    if (wanted) setCategory(wanted);
  }

  /* --------------------------- modo demonstração -------------------------- */
  function applyFromLocalDemo() {
    try {
      const palette = JSON.parse(localStorage.getItem(PALETTE_DEMO_KEY) || "null");
      if (palette) applyPalette(palette);
      const banner = JSON.parse(localStorage.getItem(BANNER_DEMO_KEY) || "null");
      if (banner && isLiveNow(banner)) applyBanner(banner);
      const saved = JSON.parse(localStorage.getItem(CATEGORY_BANNER_DEMO_KEY) || "[]");
      categoryBanners = Array.isArray(saved) ? saved.filter(isLiveNow) : [];
    } catch (_) {
      /* site segue com a arte e a paleta padrão */
    }
    restoreCategoryBanner();
  }

  /* API pública usada pelo app.js (filtros de categoria e página do produto). */
  Object.assign(window.C18SiteBanners, {
    setCategory,
    list: () => categoryBanners.slice(),
    has: (categoryId) => {
      const needle = String(categoryId || "")
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
        .replace(/[^a-z0-9]+/g, "");
      return categoryBanners.some((banner) => String(banner.category || "")
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
        .replace(/[^a-z0-9]+/g, "") === needle);
    },
  });

  function boot() {
    if (cfg.mode === "supabase" && cfg.supabaseUrl && cfg.supabaseAnonKey) {
      applyFromSupabase().catch((error) => console.warn("Banner/paleta dinâmicos indisponíveis:", error.message));
    } else {
      applyFromLocalDemo();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
