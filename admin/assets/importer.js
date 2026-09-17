(function (global) {
  "use strict";

  const FIELD_ALIASES = {
    code: ["cod produto", "codigo produto", "codigo", "sku", "referencia", "ref"],
    description: ["descricao", "produto", "nome", "nome produto"],
    brand: ["comprador", "marca", "brand"],
    collection: ["colecao", "collection"],
    category: ["grupo", "categoria", "category"],
    price: ["varejo", "preco varejo", "preco", "valor"],
    quantity: ["qtd estoque", "quantidade estoque", "estoque", "saldo", "quantidade"],
    color: ["cor", "color"],
    size: ["tamanho", "tam", "size"],
    ecommerce: ["e commerce", "ecommerce", "publicar", "site"],
    reference: ["referencia", "ref", "referencia produto"],
  };

  function normalizeText(value) {
    return String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .toLowerCase();
  }

  function normalizeHeader(value) {
    return normalizeText(value)
      .replace(/[.()]/g, "")
      .replace(/\bqtd\.?\b/g, "qtd");
  }

  function getColumnMap(headers) {
    const normalized = headers.map((header) => ({
      original: header,
      normalized: normalizeHeader(header),
    }));

    return Object.fromEntries(
      Object.entries(FIELD_ALIASES).map(([field, aliases]) => {
        const match = normalized.find((header) =>
          aliases.some((alias) => header.normalized === normalizeHeader(alias))
        );
        return [field, match?.original ?? null];
      })
    );
  }

  function parseMoney(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const raw = String(value ?? "").trim();
    if (!raw) return 0;

    const clean = raw.replace(/R\$/gi, "").replace(/\s/g, "");
    const normalized = clean.includes(",")
      ? clean.replace(/\./g, "").replace(",", ".")
      : clean;
    const parsed = Number(normalized.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function parseQuantity(value) {
    if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
    const parsed = Number(String(value ?? "0").replace(",", "."));
    return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
  }

  function parseBoolean(value) {
    if (typeof value === "boolean") return value;
    const normalized = normalizeText(value);
    return ["1", "sim", "s", "true", "x", "ativo", "publicado"].includes(normalized);
  }

  function stringValue(value, fallback = "") {
    const normalized = String(value ?? "").trim();
    return normalized || fallback;
  }

  function mapRows(rawRows) {
    if (!Array.isArray(rawRows) || rawRows.length === 0) {
      return { rows: [], errors: ["A planilha não possui linhas."], columnMap: {} };
    }

    const headers = Array.from(
      new Set(rawRows.flatMap((row) => Object.keys(row || {})))
    );
    const columnMap = getColumnMap(headers);
    const required = ["code", "description", "brand", "collection", "category"];
    const missing = required.filter((field) => !columnMap[field]);
    const errors = missing.map(
      (field) => `Coluna obrigatória não encontrada: ${field}`
    );

    const rows = rawRows
      .map((raw, index) => {
        const read = (field) =>
          columnMap[field] ? raw[columnMap[field]] : undefined;
        const rawCode = stringValue(read("code"));
        const alterdataCode = ["cod produto", "codigo produto"].includes(
          normalizeHeader(columnMap.code || "")
        );
        const code = alterdataCode && /^\d{1,9}$/.test(rawCode)
          ? rawCode.padStart(10, "0")
          : rawCode;
        const explicitReference = stringValue(read("reference"));

        return {
          rowNumber: index + 2,
          code,
          reference: explicitReference || code,
          description: stringValue(read("description")),
          brand: stringValue(read("brand"), "SEM MARCA"),
          collection: stringValue(read("collection"), "SEM COLEÇÃO"),
          category: stringValue(read("category"), "SEM CATEGORIA"),
          price: parseMoney(read("price")),
          quantity: parseQuantity(read("quantity")),
          color: stringValue(read("color"), "ÚNICA"),
          size: stringValue(read("size"), "ÚNICO"),
          ecommerce: parseBoolean(read("ecommerce")),
          source: raw,
        };
      })
      .filter((row) =>
        row.code || row.description || row.collection || row.category
      );

    rows.forEach((row) => {
      if (!row.code) errors.push(`Linha ${row.rowNumber}: código vazio.`);
      if (!row.description) errors.push(`Linha ${row.rowNumber}: descrição vazia.`);
      if (row.quantity < 0) {
        errors.push(`Linha ${row.rowNumber}: estoque negativo (${row.quantity}).`);
      }
    });

    const validRows = rows.filter(
      (row) => row.code && row.description && row.quantity >= 0
    );

    return { rows: validRows, errors, columnMap };
  }

  function uniqueOptions(rows, field) {
    const counts = new Map();
    rows.forEach((row) => {
      const value = stringValue(row[field]);
      if (!value) return;
      counts.set(value, (counts.get(value) || 0) + 1);
    });

    return Array.from(counts, ([value, count]) => ({ value, count })).sort(
      (a, b) => a.value.localeCompare(b.value, "pt-BR", { numeric: true })
    );
  }

  function filterRows(rows, selection) {
    const collections = new Set(selection?.collections || []);
    const references = new Set(selection?.references || []);
    const typed = normalizeText(selection?.typedReference || "");
    const mode = selection?.mode || "collection";

    return rows.filter((row) => {
      if (mode === "collection") {
        return collections.size === 0 || collections.has(row.collection);
      }

      if (references.size > 0 && references.has(row.reference)) return true;
      if (!typed) return references.size === 0;
      return (
        normalizeText(row.reference).includes(typed) ||
        normalizeText(row.code).includes(typed) ||
        normalizeText(row.description).includes(typed)
      );
    });
  }

  function summarize(rows) {
    return {
      rows: rows.length,
      products: new Set(rows.map((row) => `${row.brand}|${row.description}|${row.collection}`)).size,
      references: new Set(rows.map((row) => row.reference)).size,
      collections: new Set(rows.map((row) => row.collection)).size,
      brands: new Set(rows.map((row) => row.brand)).size,
      categories: new Set(rows.map((row) => row.category)).size,
      units: rows.reduce((total, row) => total + Math.max(0, row.quantity), 0),
      value: rows.reduce(
        (total, row) => total + Math.max(0, row.quantity) * Math.max(0, row.price),
        0
      ),
    };
  }

  global.C18Importer = {
    FIELD_ALIASES,
    filterRows,
    getColumnMap,
    mapRows,
    normalizeHeader,
    normalizeText,
    parseBoolean,
    parseMoney,
    parseQuantity,
    summarize,
    uniqueOptions,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = global.C18Importer;
  }
})(typeof window !== "undefined" ? window : globalThis);
