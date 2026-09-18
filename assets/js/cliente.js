/* ==========================================================================
   CENSURA 18 — cadastro de clientes
   --------------------------------------------------------------------------
   Lógica compartilhada da conta do cliente: normalização, validação e
   integração com o checkout (pré-preencher CEP, identificar no WhatsApp).

   Dois modos, iguais ao resto do site:

     · modo "supabase" → a página conta.html grava em auth.users +
       public.customers (RLS: cada cliente vê só o próprio cadastro).
     · modo estático (demo) → o perfil fica no localStorage deste
       navegador, com aviso claro na tela.

   LGPD: o perfil só é mantido com consentimento explícito. Com a escolha
   "Só o essencial" do banner, o cache local do cadastro NÃO é gravado —
   o cliente continua logado (sessão de autenticação), mas o site não
   guarda os dados dele no navegador além do essencial à compra.

   Mesmo padrão dos outros módulos: window.C18Cliente + module.exports.
   ========================================================================== */
(function (global) {
  "use strict";

  const CONSENT_KEY = "c18:cliente-atual"; /* cache do perfil logado */
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  /* --------------------------------------------------------- normalização */
  function normalizeNome(value) {
    return String(value ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
  }

  function normalizeEmail(value) {
    return String(value ?? "").trim().toLowerCase().slice(0, 120);
  }

  function normalizeTelefone(value) {
    return String(value ?? "").replace(/\D+/g, "").slice(0, 11);
  }

  function formatTelefone(value) {
    const d = normalizeTelefone(value);
    if (d.length <= 2) return d;
    if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  }

  function normalizeCep(value) {
    return String(value ?? "").replace(/\D+/g, "").slice(0, 8);
  }

  function formatCep(value) {
    const d = normalizeCep(value);
    return d.length <= 5 ? d : `${d.slice(0, 5)}-${d.slice(5)}`;
  }

  function normalizeTexto(value, max) {
    return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max || 80);
  }

  function normalizeUf(value) {
    return String(value ?? "")
      .replace(/[^a-zA-Z]/g, "")
      .toUpperCase()
      .slice(0, 4); /* validação exige exatamente 2 */
  }

  /* ----------------------------------------------------------- validação */
  function isEmailValida(value) {
    return EMAIL_RE.test(normalizeEmail(value));
  }

  /* Fixo: 10 dígitos iniciando 2–5. Móvel: 11 dígitos iniciando 9. */
  function isTelefoneValida(value) {
    const d = normalizeTelefone(value);
    const ddd = Number(d.slice(0, 2));
    if (ddd < 11 || ddd > 99) return false;
    const terceiro = Number(d[2]);
    if (d.length === 10) return terceiro >= 2 && terceiro <= 5;
    if (d.length === 11) return terceiro === 9;
    return false;
  }

  function isSenhaValida(value) {
    return String(value ?? "").length >= 8;
  }

  function isCepValida(value) {
    const d = normalizeCep(value);
    return d.length === 8 && d !== "00000000";
  }

  /* Valida o formulário de criação de conta.
     → { ok, dados, erros: { campo: mensagem } } */
  function validarCadastro(entrada) {
    const dados = {
      nome: normalizeNome(entrada?.nome),
      email: normalizeEmail(entrada?.email),
      telefone: normalizeTelefone(entrada?.telefone),
      senha: String(entrada?.senha ?? ""),
      cep: normalizeCep(entrada?.cep),
      rua: normalizeTexto(entrada?.rua, 120),
      numero: normalizeTexto(entrada?.numero, 12),
      complemento: normalizeTexto(entrada?.complemento, 80),
      bairro: normalizeTexto(entrada?.bairro, 80),
      cidade: normalizeTexto(entrada?.cidade, 80),
      uf: normalizeUf(entrada?.uf),
      consentimento: Boolean(entrada?.consentimento),
    };
    const erros = {};

    if (dados.nome.length < 3 || !dados.nome.includes(" ")) {
      erros.nome = "Informe nome e sobrenome";
    }
    if (!isEmailValida(dados.email)) {
      erros.email = "E-mail inválido";
    }
    if (!isTelefoneValida(dados.telefone)) {
      erros.telefone = "WhatsApp com DDD, ex.: (21) 98765-4321";
    }
    if (!isSenhaValida(dados.senha)) {
      erros.senha = "Mínimo de 8 caracteres";
    }
    if (dados.cep && !isCepValida(dados.cep)) {
      erros.cep = "CEP incompleto";
    }
    if (dados.uf && dados.uf.length !== 2) {
      erros.uf = "UF com 2 letras";
    }
    if (!dados.consentimento) {
      erros.consentimento = "Precisamos do seu consentimento para guardar os dados";
    }

    return { ok: Object.keys(erros).length === 0, dados, erros };
  }

  /* Valida só a parte de endereço (em "Meus dados"). */
  function validarEndereco(entrada) {
    const endereco = {
      cep: normalizeCep(entrada?.cep),
      rua: normalizeTexto(entrada?.rua, 120),
      numero: normalizeTexto(entrada?.numero, 12),
      complemento: normalizeTexto(entrada?.complemento, 80),
      bairro: normalizeTexto(entrada?.bairro, 80),
      cidade: normalizeTexto(entrada?.cidade, 80),
      uf: normalizeUf(entrada?.uf),
    };
    const erros = {};
    if (endereco.cep && !isCepValida(endereco.cep)) erros.cep = "CEP incompleto";
    if (endereco.uf && endereco.uf.length !== 2) erros.uf = "UF com 2 letras";
    return { ok: Object.keys(erros).length === 0, dados: endereco, erros };
  }

  /* --------------------------------------------------- perfil na sessão
     Cache mínimo do cliente logado para o checkout (pré-preencher CEP e
     identificar no WhatsApp). Respeita a escolha LGPD do banner. */
  function podeGuardar() {
    return !(
      global.C18LGPD &&
      typeof global.C18LGPD.canPersistPreferences === "function" &&
      !global.C18LGPD.canPersistPreferences()
    );
  }

  function definirAtual(perfil) {
    if (!perfil) {
      return sair();
    }
    const cache = {
      id: String(perfil.id || ""),
      nome: normalizeNome(perfil.nome),
      email: normalizeEmail(perfil.email),
      telefone: normalizeTelefone(perfil.telefone),
      cep: normalizeCep(perfil.cep),
      rua: normalizeTexto(perfil.rua, 120),
      numero: normalizeTexto(perfil.numero, 12),
      complemento: normalizeTexto(perfil.complemento, 80),
      bairro: normalizeTexto(perfil.bairro, 80),
      cidade: normalizeTexto(perfil.cidade, 80),
      uf: normalizeUf(perfil.uf),
      demo: Boolean(perfil.demo),
    };
    global.__C18_CLIENTE_ATUAL = cache;
    try {
      if (podeGuardar()) {
        global.localStorage.setItem(CONSENT_KEY, JSON.stringify(cache));
      } else {
        global.localStorage.removeItem(CONSENT_KEY);
      }
    } catch (_) {
      /* segue em memória */
    }
    if (typeof global.dispatchEvent === "function" && typeof global.CustomEvent === "function") {
      global.dispatchEvent(new CustomEvent("c18:cliente", { detail: cache }));
    }
    return cache;
  }

  function currente() {
    if (global.__C18_CLIENTE_ATUAL) return global.__C18_CLIENTE_ATUAL;
    try {
      const saved = JSON.parse(global.localStorage.getItem(CONSENT_KEY) || "null");
      if (saved && saved.nome) {
        global.__C18_CLIENTE_ATUAL = saved;
        return saved;
      }
    } catch (_) {
      /* sem cache */
    }
    return null;
  }

  function sair() {
    global.__C18_CLIENTE_ATUAL = null;
    try {
      global.localStorage.removeItem(CONSENT_KEY);
    } catch (_) {
      /* nada guardado */
    }
    if (typeof global.dispatchEvent === "function" && typeof global.CustomEvent === "function") {
      global.dispatchEvent(new CustomEvent("c18:cliente", { detail: null }));
    }
    return null;
  }

  /* ------------------------------------------------------------- WhatsApp */
  function linhasWhatsApp(perfil) {
    const cliente = perfil || currente();
    if (!cliente || !cliente.nome) return [];
    const linhas = [];
    linhas.push(`*Cliente cadastrado:* ${cliente.nome}`);
    if (cliente.telefone) linhas.push(`*WhatsApp:* ${formatTelefone(cliente.telefone)}`);
    const endereco = [cliente.rua, cliente.numero, cliente.complemento]
      .filter(Boolean)
      .join(", ");
    const cidade = [cliente.cidade, cliente.uf].filter(Boolean).join("/");
    if (endereco) {
      linhas.push(`*Endereço:* ${endereco}${cidade ? ` — ${cidade}` : ""}`);
    }
    const cep = formatCep(cliente.cep);
    if (cep) linhas.push(`*CEP:* ${cep}`);
    return linhas;
  }

  global.C18Cliente = {
    CONSENT_KEY,
    currente,
    definirAtual,
    formatCep,
    formatTelefone,
    isCepValida,
    isEmailValida,
    isSenhaValida,
    isTelefoneValida,
    linhasWhatsApp,
    normalizeCep,
    normalizeEmail,
    normalizeNome,
    normalizeTelefone,
    normalizeTexto,
    normalizeUf,
    sair,
    validarCadastro,
    validarEndereco,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = global.C18Cliente;
  }
})(typeof window !== "undefined" ? window : globalThis);
