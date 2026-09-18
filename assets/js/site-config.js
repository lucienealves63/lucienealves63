/* ==========================================================================
   CENSURA 18 — configuração dinâmica da loja (banner + paleta)
   --------------------------------------------------------------------------
   O painel de operações (admin/) salva banners e paletas no Supabase.
   Este script aplica na home, com chave anônima e políticas RLS que só
   expõem o banner ativo e a paleta ativa:

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
  const PALETTE_DEMO_KEY = "c18:demo-palette";
  const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

  // Números de estatística do hero: cada banner traz até 4 pares
  // número/legenda, aplicados por posição em #hero-stat-N-value/-label
  // (index.html → .hero__meta). Regras espelhadas no painel e na migration.
  const HERO_STAT_SLOTS = 4;
  const HERO_STAT_VALUE_MAX = 12;
  const HERO_STAT_LABEL_MAX = 40;

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

  // Textos sempre via textContent — nada de HTML vindo do banco.
  function setText(id, value, maxLength) {
    const el = document.getElementById(id);
    if (!el || typeof value !== "string") return;
    let text = value.trim();
    if (maxLength) text = text.replace(/\s+/g, " ").slice(0, maxLength);
    if (!text) return;
    el.textContent = text;
  }

  function applyHeroStats(stats) {
    if (!Array.isArray(stats)) return;
    stats.slice(0, HERO_STAT_SLOTS).forEach((stat, index) => {
      if (!stat || typeof stat !== "object" || Array.isArray(stat)) return;
      const slot = index + 1;
      setText(`hero-stat-${slot}-value`, stat.value, HERO_STAT_VALUE_MAX);
      setText(`hero-stat-${slot}-label`, stat.label, HERO_STAT_LABEL_MAX);
    });
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

    // Números de estatística da faixa abaixo dos botões
    applyHeroStats(banner.stats);

    // OG image acompanha a arte ativa (útil em compartilhamentos)
    if (banner.image_path) {
      const og = document.querySelector('meta[property="og:image"]');
      if (og) og.setAttribute("content", banner.image_path);
    }
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

    // RLS já restringe: banner ativo na janela de datas e paleta ativa.
    const [bannerResult, paletteResult] = await Promise.all([
      client
        .from("site_banners")
        .select("*")
        .eq("position", "home-hero")
        .eq("active", true)
        .order("priority", { ascending: true })
        .limit(1),
      client.from("site_palettes").select("*").eq("active", true).limit(1),
    ]);

    if (paletteResult.data && paletteResult.data[0]) applyPalette(paletteResult.data[0]);
    if (bannerResult.data && bannerResult.data[0] && isLiveNow(bannerResult.data[0])) {
      applyBanner(bannerResult.data[0]);
    }
  }

  /* --------------------------- modo demonstração -------------------------- */
  function applyFromLocalDemo() {
    try {
      const palette = JSON.parse(localStorage.getItem(PALETTE_DEMO_KEY) || "null");
      if (palette) applyPalette(palette);
      const banner = JSON.parse(localStorage.getItem(BANNER_DEMO_KEY) || "null");
      if (banner && isLiveNow(banner)) applyBanner(banner);
    } catch (_) {
      /* site segue com a arte e a paleta padrão */
    }
  }

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
