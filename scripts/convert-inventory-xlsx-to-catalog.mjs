import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const REQUIRED_EXCEL_HEADERS = [
  "Número Factura",
  "Tienda",
  "Código Prenda",
  "Descripción Prenda",
  "Talla",
  "Color",
  "Precio final",
];

const OUTPUT_HEADERS = [
  "sku",
  "name",
  "category",
  "size",
  "color",
  "price",
  "cost",
  "initial_stock",
  "image_filename",
  "reference_number",
  "reference_source",
  "vendor_code_raw",
  "vendor_code_normalized",
  "source_store",
  "source_invoice_examples",
  "grouped_row_count",
  "sku_collision_applied",
  "synthetic_sku",
  "category_rule",
  "source_line_examples",
];

const FORBIDDEN_SKU_CHARS = /[,"\r\n]/;
const WINDOWS_FILE_FORBIDDEN_CHARS = /[<>:"/\\|?*\u0000-\u001f]/;

function parseArgs(argv) {
  const args = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (!current.startsWith("--")) continue;
    const key = current.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args.set(key, "true");
      continue;
    }
    args.set(key, next);
    i += 1;
  }
  return args;
}

function toBool(value, fallback = false) {
  if (value == null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y"].includes(normalized)) return true;
  if (["0", "false", "no", "n"].includes(normalized)) return false;
  return fallback;
}

function csvEscape(value) {
  const raw = value == null ? "" : String(value);
  if (/[,"\n]/.test(raw)) {
    return `"${raw.replaceAll('"', '""')}"`;
  }
  return raw;
}

function writeCsv(filePath, headers, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape(row[header] ?? "")).join(","));
  }
  fs.writeFileSync(filePath, lines.join("\n"), "utf8");
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
}

function parseCsvLine(line) {
  const out = [];
  let value = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        value += '"';
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      out.push(value);
      value = "";
      continue;
    }
    value += char;
  }
  out.push(value);
  return out;
}

function parseCsvFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const lines = raw
    .split(/\r?\n/g)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== "");
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = parseCsvLine(lines[0]).map((h) => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const values = parseCsvLine(lines[i]);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = (values[index] ?? "").trim();
    });
    rows.push(row);
  }
  return { headers, rows };
}

function normalizeSpaces(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeTextKey(value) {
  return normalizeSpaces(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function normalizeColorKey(value) {
  const normalized = normalizeTextKey(value);
  if (!normalized || normalized === "none") return "";
  return normalized;
}

function normalizeSizeDisplay(value) {
  const raw = normalizeSpaces(value);
  if (!raw || raw.toLowerCase() === "none") return "UNICA";
  return raw.toUpperCase();
}

function normalizeVendorCodeDisplay(value) {
  return normalizeSpaces(value);
}

function normalizeVendorCodeKey(value) {
  return normalizeVendorCodeDisplay(value).toUpperCase();
}

function sanitizeSkuCandidate(value) {
  return normalizeSpaces(value).replaceAll("/", "-");
}

function normalizeSkuSuffixToken(value, fallback = "NA") {
  const token = String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
  return token || fallback;
}

function formatPrice(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  const rounded = Math.round(number * 100) / 100;
  if (Number.isInteger(rounded)) return String(rounded);
  return String(Number(rounded.toFixed(2)));
}

function parsePrice(value) {
  if (value == null || normalizeSpaces(value) === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.round(number * 100) / 100;
}

function safeJoinExamples(values, max = 5) {
  return [...values].slice(0, max).join(" | ");
}

function buildSyntheticSkuCandidate(group, indexInStore = 1) {
  const store = normalizeSkuSuffixToken(group.source_store || "STORE", "STORE").slice(0, 12);
  const name = normalizeSkuSuffixToken(group.name || "ITEM", "ITEM").slice(0, 22);
  const price = normalizeSkuSuffixToken(formatPrice(group.price_number) || "0", "0");
  const size = normalizeSkuSuffixToken(group.size || "UNICA", "UNICA").slice(0, 10);
  const suffix = String(indexInStore).padStart(2, "0");
  return `SYN-${store}-${name}-${price}-${size}-${suffix}`;
}

function classifyCategoryFromRules(name, store) {
  const text = normalizeTextKey(name);
  const storeKey = normalizeTextKey(store);
  const hits = [];

  const pushHit = (category, rule) => {
    if (!hits.some((item) => item.category === category)) hits.push({ category, rule });
  };

  const has = (...patterns) => patterns.some((pattern) => pattern.test(text));

  // Prioridades para evitar ambiguedad en nombres como "short blue jean" o "camisa jean".
  if (has(/\bfalda short\b/)) {
    pushHit("Faldas", "priority:falda_short");
    return { status: "resolved", category: hits[0].category, rule: hits[0].rule, candidates: [hits[0].category] };
  }
  if (has(/\bvestido(s)?\b/, /\bbraga\b/) && !hits.length) {
    pushHit("Vestidos", "priority:vestido_braga");
    return { status: "resolved", category: hits[0].category, rule: hits[0].rule, candidates: [hits[0].category] };
  }
  if (has(/\bcamisa(s)?\b/, /\bcamiseta(s)?\b/, /\btop(s)?\b/, /\bcrop top\b/, /\bblusa(s)?\b/, /\bchaleco(s)?\b/) && !hits.length) {
    pushHit("Camisas", "priority:camisa_top");
    return { status: "resolved", category: hits[0].category, rule: hits[0].rule, candidates: [hits[0].category] };
  }
  if (has(/\bbody\b/, /\bfranela(s)?\b/, /\bfranelilla(s)?\b/, /\bstrapple\b/, /\bbasica\b/, /\bb[aá]sica\b/, /\bcorse\b/, /\bcors[eé]\b/) && !hits.length) {
    pushHit("Camisas", "priority:body_franela_basica");
    return { status: "resolved", category: hits[0].category, rule: hits[0].rule, candidates: [hits[0].category] };
  }
  if (has(/\bchaqueta\b/, /\bblazer\b/, /\bamericana\b/, /\bjersey\b/, /\bjumper\b/) && !hits.length) {
    pushHit("Chaquetas", "priority:chaquetas");
    return { status: "resolved", category: hits[0].category, rule: hits[0].rule, candidates: [hits[0].category] };
  }
  if (has(/\bbolso\b/, /\bcartera\b/, /\bbandolera\b/, /\bporta laptop\b/) && !hits.length) {
    pushHit("Accesorios", "priority:bolso_cartera");
    return { status: "resolved", category: hits[0].category, rule: hits[0].rule, candidates: [hits[0].category] };
  }
  if (has(/\bbotas?\b/, /\bmocasines?\b/, /\bdestalonado\b/, /\btac[oó]n\b/) && !hits.length) {
    pushHit("Zapatos", "priority:zapatos");
    return { status: "resolved", category: hits[0].category, rule: hits[0].rule, candidates: [hits[0].category] };
  }
  if (has(/\bbermuda(s)?\b/, /\bshort(s)?\b/) && !hits.length) {
    pushHit("Bermudas Shorts", "priority:bermuda_short");
    return { status: "resolved", category: hits[0].category, rule: hits[0].rule, candidates: [hits[0].category] };
  }
  if (has(/\bfalda(s)?\b/, /\bskirt(s)?\b/) && !hits.length) {
    pushHit("Faldas", "priority:falda");
    return { status: "resolved", category: hits[0].category, rule: hits[0].rule, candidates: [hits[0].category] };
  }

  if (has(/\bperfume(s)?\b/)) pushHit("Perfumes", "keyword:perfume");
  if (has(/\brimel\b/, /\br[ií]mel\b/, /\bblush\b/, /\blabial(es)?\b/, /\bbrillo(s)?\b/)) {
    pushHit("Maquillaje", "keyword:makeup");
  }
  if (has(/\bzapato(s)?\b/, /\bsandalia(s)?\b/, /\bbotin(es)?\b/, /\bespadrilles\b/, /\bzapat/i)) pushHit("Zapatos", "keyword:zapatos");
  if (has(/\bfalda(s)?\b/, /\bskirt(s)?\b/)) pushHit("Faldas", "keyword:falda");
  if (has(/\bbermuda(s)?\b/, /\bshort(s)?\b/)) pushHit("Bermudas Shorts", "keyword:bermuda_short");
  if (has(/\bvestido(s)?\b/, /\bbraga\b/)) pushHit("Vestidos", "keyword:vestido_braga");
  if (has(/\bjean(s)?\b/, /\bpantal[oó]n(es)?\b/, /\btrouser(s)?\b/) && !has(/\bcamisa\b/, /\btop\b/, /\bvestido\b/, /\bshort\b/, /\bbermuda\b/, /\bfalda\b/)) {
    pushHit("Pantalones", "keyword:pantalon_jean");
  }
  if (has(/\bcamisa(s)?\b/, /\bcamiseta(s)?\b/, /\btop(s)?\b/, /\bblusa(s)?\b/, /\bchaleco(s)?\b/)) {
    pushHit("Camisas", "keyword:camisa_top");
  }
  if (has(/\bbody\b/, /\bfranela(s)?\b/, /\bfranelilla(s)?\b/, /\bstrapple\b/, /\bbasica\b/, /\bb[aá]sica\b/)) {
    pushHit("Camisas", "keyword:body_franela_basica");
  }
  if (has(/\bchaqueta\b/, /\bblazer\b/, /\bamericana\b/, /\bjersey\b/)) {
    pushHit("Chaquetas", "keyword:chaquetas");
  }
  if (has(/\bpantaleta(s)?\b/, /\bbrasilian\b/, /\bbikini de encaje\b/, /\bbikini de algo\b/)) {
    pushHit("Lenceria", "keyword:lenceria");
  }
  if (has(/\btarjetero\b/, /\bbilletera\b/, /\bmonedero\b/)) pushHit("Monederos", "keyword:monedero");
  if (
    has(/\bcartera\b/, /\bbandolera\b/, /\bgorra\b/, /\bgorro\b/, /\bcollar\b/, /\blentes\b/, /\bporta laptop\b/, /\bcinturon\b/, /\bcintur[oó]n\b/, /\bcorrea\b/, /\bbrazalete\b/) &&
    !has(/\bpantal[oó]n\b/, /\bamericana\b/, /\bchaqueta\b/)
  ) {
    pushHit("Accesorios", "keyword:accesorios");
  }
  if (hits.length === 0 && storeKey === "primor" && has(/brillo|labial|rimel|blush/)) {
    pushHit("Maquillaje", "store:primor_makeup");
  }

  if (hits.length === 1) {
    return { status: "resolved", category: hits[0].category, rule: hits[0].rule, candidates: hits.map((x) => x.category) };
  }
  if (hits.length === 0) return { status: "unresolved", category: "", rule: "", candidates: [] };
  return {
    status: "ambiguous",
    category: "",
    rule: hits.map((x) => `${x.category}:${x.rule}`).join(" | "),
    candidates: hits.map((x) => x.category),
  };
}

function loadCategoryOverrides(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const { headers, rows } = parseCsvFile(filePath);
  const required = ["match_type", "match_value", "category"];
  const missing = required.filter((h) => !headers.includes(h));
  if (missing.length > 0) {
    throw new Error(`category-overrides.csv invalido; faltan columnas: ${missing.join(", ")}`);
  }
  return rows
    .map((row) => ({
      match_type: normalizeSpaces(row.match_type).toLowerCase(),
      match_value: normalizeSpaces(row.match_value),
      category: normalizeSpaces(row.category),
    }))
    .filter((row) => row.match_type && row.match_value && row.category);
}

function applyCategoryOverride(group, overrides) {
  if (!overrides?.length) return null;
  const nameKey = normalizeTextKey(group.name);
  const skuKey = String(group.sku ?? "").trim().toUpperCase();
  const vendorKey = String(group.vendor_code_normalized ?? "").trim().toUpperCase();
  for (const rule of overrides) {
    const valueUpper = rule.match_value.toUpperCase();
    const valueNameKey = normalizeTextKey(rule.match_value);
    if (rule.match_type === "sku" && skuKey && skuKey === valueUpper) return rule;
    if (rule.match_type === "vendor_code" && vendorKey && vendorKey === valueUpper) return rule;
    if (rule.match_type === "name_exact" && nameKey === valueNameKey) return rule;
    if (rule.match_type === "name_contains" && valueNameKey && nameKey.includes(valueNameKey)) return rule;
  }
  return null;
}

function ensureTemplateCsv(filePath, headers) {
  if (fs.existsSync(filePath)) return;
  writeCsv(filePath, headers, []);
}

function readWorkbookRowsViaPython({ xlsxPath, sheetName }) {
  const pythonCode = `
import json, sys
from openpyxl import load_workbook

file_path = sys.argv[1]
sheet_name = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] else None
wb = load_workbook(file_path, read_only=True, data_only=True)
ws = wb[sheet_name] if sheet_name else wb[wb.sheetnames[0]]

rows = []
for idx, row in enumerate(ws.iter_rows(values_only=True), start=1):
    rows.append({"line": idx, "values": list(row)})

print(json.dumps({
    "sheet": ws.title,
    "sheetnames": list(wb.sheetnames),
    "rows": rows,
}, ensure_ascii=False))
`.trim();

  const candidates = [
    { cmd: "python", args: ["-c", pythonCode, xlsxPath, sheetName ?? ""] },
    { cmd: "py", args: ["-3", "-c", pythonCode, xlsxPath, sheetName ?? ""] },
  ];

  let lastError = null;
  for (const candidate of candidates) {
    const result = spawnSync(candidate.cmd, candidate.args, {
      encoding: "utf8",
      stdio: "pipe",
    });
    if (result.error) {
      lastError = result.error;
      continue;
    }
    if (result.status !== 0) {
      lastError = new Error(
        `${candidate.cmd} fallo (exit ${result.status}): ${(result.stderr ?? "").trim()}`
      );
      continue;
    }
    try {
      return JSON.parse(result.stdout);
    } catch (error) {
      throw new Error(`No se pudo parsear JSON desde Python/openpyxl: ${error.message}`);
    }
  }

  throw new Error(
    `No se pudo leer el Excel via Python/openpyxl. Error: ${lastError?.message ?? "unknown"}`
  );
}

function detectHeaderRow(workbookRows) {
  for (const row of workbookRows) {
    const cells = row.values.map((value) => normalizeSpaces(value));
    const hasAll = REQUIRED_EXCEL_HEADERS.every((header) => cells.includes(header));
    if (!hasAll) continue;

    const indexByHeader = new Map();
    for (let i = 0; i < cells.length; i += 1) {
      if (!cells[i]) continue;
      if (!indexByHeader.has(cells[i])) indexByHeader.set(cells[i], i);
    }

    return { line: row.line, headers: cells, indexByHeader };
  }
  return null;
}

function parseExcelRecords(workbookPayload) {
  const headerRow = detectHeaderRow(workbookPayload.rows);
  if (!headerRow) {
    throw new Error(
      `No se encontro fila header con columnas requeridas: ${REQUIRED_EXCEL_HEADERS.join(", ")}`
    );
  }

  const records = [];
  for (const row of workbookPayload.rows) {
    if (row.line <= headerRow.line) continue;
    const values = row.values ?? [];
    const read = (header) => {
      const index = headerRow.indexByHeader.get(header);
      return index == null ? null : values[index];
    };

    const invoice = read("Número Factura");
    const store = read("Tienda");
    const code = read("Código Prenda");
    const name = read("Descripción Prenda");
    const size = read("Talla");
    const color = read("Color");
    const price = read("Precio final");

    const isBlank = [invoice, store, code, name, size, color, price].every(
      (value) => value == null || normalizeSpaces(value) === ""
    );
    if (isBlank) continue;

    records.push({
      source_line: row.line,
      invoice_number_raw: invoice == null ? "" : String(invoice),
      store_raw: store == null ? "" : String(store),
      vendor_code_raw: code == null ? "" : String(code),
      name_raw: name == null ? "" : String(name),
      size_raw: size == null ? "" : String(size),
      color_raw: color == null ? "" : String(color),
      price_raw: price,
    });
  }

  return { header_line: headerRow.line, records };
}

function buildSourceRows(rawRecords) {
  return rawRecords.map((record) => {
    const vendorCodeDisplay = normalizeVendorCodeDisplay(record.vendor_code_raw);
    const vendorCodeKey = normalizeVendorCodeKey(record.vendor_code_raw);
    const name = normalizeSpaces(record.name_raw);
    const store = normalizeSpaces(record.store_raw);
    const size = normalizeSizeDisplay(record.size_raw);
    const colorDisplay = normalizeSpaces(record.color_raw);
    const color = colorDisplay && colorDisplay.toLowerCase() !== "none" ? colorDisplay : "";
    let priceNumber = parsePrice(record.price_raw);
    const price_was_missing = priceNumber == null;
    if (priceNumber == null) {
      priceNumber = 0;
    }

    const missingFields = [];
    if (!store) missingFields.push("Tienda");
    if (!name) missingFields.push("Descripción Prenda");

    return {
      ...record,
      invoice_number: normalizeSpaces(record.invoice_number_raw),
      source_store: store,
      vendor_code_normalized: vendorCodeDisplay,
      vendor_code_key: vendorCodeKey,
      name,
      name_key: normalizeTextKey(name),
      size,
      size_key: normalizeTextKey(size),
      color,
      color_key: normalizeColorKey(color),
      price_number: priceNumber,
      price_display: formatPrice(priceNumber),
      price_was_missing,
      missing_fields: missingFields,
    };
  });
}

function buildGroupedVariants(sourceRows) {
  const groupsByVariantKey = new Map();
  const priceSetsByLogicalKey = new Map();

  for (const row of sourceRows) {
    const logicalKey = [
      row.vendor_code_key || "__MISSING_CODE__",
      row.name_key,
      row.size_key,
      row.color_key,
      row.vendor_code_key ? "" : normalizeTextKey(row.source_store),
    ].join("||");

    if (!priceSetsByLogicalKey.has(logicalKey)) {
      priceSetsByLogicalKey.set(logicalKey, new Set());
    }
    if (row.price_number != null) {
      priceSetsByLogicalKey.get(logicalKey).add(row.price_display);
    }

    const variantKey = `${logicalKey}||${row.price_display || "__MISSING_PRICE__"}`;
    if (!groupsByVariantKey.has(variantKey)) {
      groupsByVariantKey.set(variantKey, {
        variant_key: variantKey,
        logical_key: logicalKey,
        rows: [],
        line_numbers: [],
        vendor_code_raw_values: new Set(),
        vendor_code_normalized_values: new Set(),
        source_store_values: new Set(),
        invoice_values: new Set(),
        name_values: new Set(),
        size_values: new Set(),
        color_values: new Set(),
      });
    }

    const group = groupsByVariantKey.get(variantKey);
    group.rows.push(row);
    group.line_numbers.push(row.source_line);
    if (row.vendor_code_raw && normalizeSpaces(row.vendor_code_raw)) {
      group.vendor_code_raw_values.add(normalizeSpaces(row.vendor_code_raw));
    }
    if (row.vendor_code_normalized) group.vendor_code_normalized_values.add(row.vendor_code_normalized);
    if (row.source_store) group.source_store_values.add(row.source_store);
    if (row.invoice_number) group.invoice_values.add(row.invoice_number);
    if (row.name) group.name_values.add(row.name);
    if (row.size) group.size_values.add(row.size);
    if (row.color) group.color_values.add(row.color);
  }

  const groupedValues = [...groupsByVariantKey.values()];
  const priceConflicts = [];
  for (const [logicalKey, prices] of priceSetsByLogicalKey.entries()) {
    if (prices.size <= 1) continue;
    const sampleGroup = groupedValues.find((group) => group.logical_key === logicalKey);
    priceConflicts.push({
      logical_key: logicalKey,
      vendor_code_normalized: safeJoinExamples(sampleGroup?.vendor_code_normalized_values ?? new Set(), 1),
      name: safeJoinExamples(sampleGroup?.name_values ?? new Set(), 1),
      size: safeJoinExamples(sampleGroup?.size_values ?? new Set(), 1),
      color: safeJoinExamples(sampleGroup?.color_values ?? new Set(), 1),
      source_store: safeJoinExamples(sampleGroup?.source_store_values ?? new Set(), 1),
      prices: [...prices].sort((a, b) => Number(a) - Number(b)),
      source_line_examples: safeJoinExamples(new Set((sampleGroup?.line_numbers ?? []).map(String))),
    });
  }

  const consolidated = groupedValues.map((group) => {
    const first = group.rows[0];
    return {
      source_line_first: Math.min(...group.line_numbers),
      source_line_examples: safeJoinExamples(new Set(group.line_numbers.map(String))),
      grouped_row_count: group.rows.length,
      source_store: [...group.source_store_values][0] ?? first.source_store ?? "",
      source_invoice_examples: safeJoinExamples(new Set(group.invoice_values)),
      vendor_code_raw: [...group.vendor_code_raw_values][0] ?? "",
      vendor_code_normalized: [...group.vendor_code_normalized_values][0] ?? "",
      vendor_code_key: first.vendor_code_key || "",
      name: [...group.name_values][0] ?? first.name ?? "",
      name_key: first.name_key ?? "",
      size: [...group.size_values][0] ?? first.size ?? "UNICA",
      size_key: first.size_key ?? normalizeTextKey("UNICA"),
      color: [...group.color_values][0] ?? first.color ?? "",
      color_key: first.color_key ?? "",
      price_number: first.price_number,
      price: first.price_display,
      initial_stock: group.rows.length,
      missing_required: group.rows.some((row) => row.missing_fields.length > 0),
      missing_required_fields: [...new Set(group.rows.flatMap((row) => row.missing_fields))],
      price_missing: false,
      price_was_missing_any: group.rows.some((row) => row.price_was_missing),
      has_missing_vendor_code: !first.vendor_code_key,
      rows: group.rows,
      logical_key: group.logical_key,
      sku: "",
      sku_collision_applied: false,
      synthetic_sku: "",
      reference_number: "",
      reference_source: "",
      category: "",
      category_rule: "",
      category_status: "",
      category_candidates: [],
      image_filename: "",
      sku_filename_unsafe: false,
    };
  });

  consolidated.sort((a, b) => {
    const aCode = a.vendor_code_normalized || "ZZZ";
    const bCode = b.vendor_code_normalized || "ZZZ";
    return (
      aCode.localeCompare(bCode, undefined, { sensitivity: "base" }) ||
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
      a.size.localeCompare(b.size, undefined, { sensitivity: "base" }) ||
      a.color.localeCompare(b.color, undefined, { sensitivity: "base" }) ||
      a.source_line_first - b.source_line_first
    );
  });

  return { consolidated, priceConflicts };
}

function assignSkus(groups, { allowSyntheticSkus }) {
  const skuCollisionsReport = [];
  const syntheticCandidates = [];
  const skuErrors = [];
  const usedSkuKeys = new Set();

  const reserveSku = (group, candidate) => {
    const sku = sanitizeSkuCandidate(candidate);
    if (!sku) return false;
    if (FORBIDDEN_SKU_CHARS.test(sku)) {
      skuErrors.push(`SKU invalido (caracteres prohibidos): ${sku}`);
      return false;
    }
    const key = sku.toUpperCase();
    if (usedSkuKeys.has(key)) return false;
    usedSkuKeys.add(key);
    group.sku = sku;
    group.sku_filename_unsafe = WINDOWS_FILE_FORBIDDEN_CHARS.test(sku);
    return true;
  };

  const codedGroups = groups.filter((group) => group.vendor_code_key);
  const byBaseCode = new Map();
  for (const group of codedGroups) {
    if (!byBaseCode.has(group.vendor_code_key)) byBaseCode.set(group.vendor_code_key, []);
    byBaseCode.get(group.vendor_code_key).push(group);
  }

  for (const list of byBaseCode.values()) {
    list.sort((a, b) => {
      return (
        a.size.localeCompare(b.size, undefined, { sensitivity: "base" }) ||
        a.color.localeCompare(b.color, undefined, { sensitivity: "base" }) ||
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
        a.source_line_first - b.source_line_first
      );
    });
  }

  for (const list of byBaseCode.values()) {
    const baseDisplay = list[0].vendor_code_normalized;
    if (list.length === 1) {
      if (!reserveSku(list[0], baseDisplay)) {
        skuErrors.push(`No se pudo reservar SKU base para codigo ${baseDisplay}.`);
      }
      continue;
    }

    const sizeCandidates = list.map((group) => `${baseDisplay}__T${normalizeSkuSuffixToken(group.size, "UNICA")}`);
    if (new Set(sizeCandidates.map((x) => x.toUpperCase())).size === list.length) {
      for (let i = 0; i < list.length; i += 1) {
        const group = list[i];
        group.sku_collision_applied = true;
        reserveSku(group, sizeCandidates[i]);
        skuCollisionsReport.push({
          source_line_first: group.source_line_first,
          vendor_code: baseDisplay,
          name: group.name,
          size: group.size,
          color: group.color,
          candidate_stage: "size",
          candidate: sizeCandidates[i],
          resolved_sku: group.sku,
          resolution: "size_suffix",
        });
      }
      continue;
    }

    const sizeColorCandidates = list.map(
      (group) =>
        `${baseDisplay}__T${normalizeSkuSuffixToken(group.size, "UNICA")}__C${normalizeSkuSuffixToken(group.color, "NA")}`
    );
    if (new Set(sizeColorCandidates.map((x) => x.toUpperCase())).size === list.length) {
      for (let i = 0; i < list.length; i += 1) {
        const group = list[i];
        group.sku_collision_applied = true;
        reserveSku(group, sizeColorCandidates[i]);
        skuCollisionsReport.push({
          source_line_first: group.source_line_first,
          vendor_code: baseDisplay,
          name: group.name,
          size: group.size,
          color: group.color,
          candidate_stage: "size_color",
          candidate: sizeColorCandidates[i],
          resolved_sku: group.sku,
          resolution: "size_color_suffix",
        });
      }
      continue;
    }

    for (let i = 0; i < list.length; i += 1) {
      const group = list[i];
      const candidate = `${baseDisplay}__T${normalizeSkuSuffixToken(group.size, "UNICA")}__C${normalizeSkuSuffixToken(group.color, "NA")}__V${String(i + 1).padStart(2, "0")}`;
      group.sku_collision_applied = true;
      if (!reserveSku(group, candidate)) {
        skuErrors.push(`No se pudo resolver SKU por indice para ${baseDisplay}.`);
      }
      skuCollisionsReport.push({
        source_line_first: group.source_line_first,
        vendor_code: baseDisplay,
        name: group.name,
        size: group.size,
        color: group.color,
        candidate_stage: "size_color_index",
        candidate,
        resolved_sku: group.sku,
        resolution: "size_color_index_suffix",
      });
    }
  }

  const missingCodeGroups = groups.filter((group) => !group.vendor_code_key);
  const byStore = new Map();
  for (const group of missingCodeGroups) {
    const key = normalizeTextKey(group.source_store) || "store";
    if (!byStore.has(key)) byStore.set(key, []);
    byStore.get(key).push(group);
  }
  for (const list of byStore.values()) {
    list.sort((a, b) => {
      return (
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
        a.price.localeCompare(b.price, undefined, { sensitivity: "base" }) ||
        a.size.localeCompare(b.size, undefined, { sensitivity: "base" }) ||
        a.color.localeCompare(b.color, undefined, { sensitivity: "base" }) ||
        a.source_line_first - b.source_line_first
      );
    });
    for (let i = 0; i < list.length; i += 1) {
      const group = list[i];
      const storeBaseRaw = normalizeSpaces(group.source_store) || "UNKNOWN";
      const storeBase = sanitizeSkuCandidate(storeBaseRaw.toUpperCase());
      const proposed = i === 0 ? storeBase : `${storeBase}__${String(i + 1).padStart(2, "0")}`;
      group.synthetic_sku = proposed;
      syntheticCandidates.push({
        source_line_first: group.source_line_first,
        source_store: group.source_store,
        name: group.name,
        size: group.size,
        color: group.color,
        price: group.price,
        initial_stock: group.initial_stock,
        proposed_synthetic_sku: proposed,
        source_line_examples: group.source_line_examples,
      });
      if (!reserveSku(group, proposed)) {
        skuErrors.push(`No se pudo reservar SKU fallback por tienda ${proposed}.`);
      }
    }
  }

  return { skuCollisionsReport, syntheticCandidates, skuErrors };
}

function finalizeGroupFields(groups, { categoryOverrides, allowSyntheticSkus }) {
  const categoryUnresolved = [];
  const categoryAmbiguous = [];
  const missingRequiredRows = [];

  for (const group of groups) {
    if (group.vendor_code_normalized) {
      group.reference_number = group.vendor_code_normalized;
      group.reference_source = "excel_code";
    } else if (group.sku) {
      group.reference_number = group.synthetic_sku || group.sku;
      group.reference_source = "store_fallback_no_code";
    } else {
      group.reference_number = "";
      group.reference_source = "";
    }

    const autoCategory = classifyCategoryFromRules(group.name, group.source_store);
    group.category = autoCategory.category;
    group.category_rule = autoCategory.rule;
    group.category_status = autoCategory.status;
    group.category_candidates = autoCategory.candidates;

    const override = applyCategoryOverride(group, categoryOverrides);
    if (override) {
      group.category = override.category;
      group.category_rule = `override:${override.match_type}`;
      group.category_status = "resolved";
      group.category_candidates = [override.category];
    }

    if (group.missing_required) {
      missingRequiredRows.push({
        source_line_first: group.source_line_first,
        missing_fields: group.missing_required_fields.join(" | "),
        vendor_code_normalized: group.vendor_code_normalized,
        name: group.name,
        size: group.size,
        color: group.color,
        source_store: group.source_store,
        source_line_examples: group.source_line_examples,
      });
    }

    if (group.category_status === "unresolved") {
      categoryUnresolved.push({
        source_line_first: group.source_line_first,
        vendor_code_normalized: group.vendor_code_normalized,
        sku: group.sku,
        name: group.name,
        size: group.size,
        color: group.color,
        source_store: group.source_store,
        price: group.price,
        initial_stock: group.initial_stock,
        source_line_examples: group.source_line_examples,
      });
    } else if (group.category_status === "ambiguous") {
      categoryAmbiguous.push({
        source_line_first: group.source_line_first,
        vendor_code_normalized: group.vendor_code_normalized,
        sku: group.sku,
        name: group.name,
        size: group.size,
        color: group.color,
        source_store: group.source_store,
        category_candidates: group.category_candidates.join(" | "),
        rule_detail: group.category_rule,
        source_line_examples: group.source_line_examples,
      });
    }
  }

  return { categoryUnresolved, categoryAmbiguous, missingRequiredRows };
}

function toOutputRow(group) {
  return {
    sku: group.sku || "",
    name: group.name || "",
    category: group.category || "",
    size: group.size || "UNICA",
    color: group.color || "",
    price: group.price || "",
    cost: "",
    initial_stock: String(group.initial_stock ?? ""),
    image_filename: group.image_filename || "",
    reference_number: group.reference_number || "",
    reference_source: group.reference_source || "",
    vendor_code_raw: group.vendor_code_raw || "",
    vendor_code_normalized: group.vendor_code_normalized || "",
    source_store: group.source_store || "",
    source_invoice_examples: group.source_invoice_examples || "",
    grouped_row_count: String(group.grouped_row_count ?? ""),
    sku_collision_applied: group.sku_collision_applied ? "true" : "false",
    synthetic_sku: group.synthetic_sku || "",
    category_rule: group.category_rule || "",
    source_line_examples: group.source_line_examples || "",
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const xlsxArg = args.get("xlsx");
  const workbookJsonArg = args.get("workbook-json");
  if (!xlsxArg && !workbookJsonArg) {
    throw new Error(
      "Uso: node scripts/convert-inventory-xlsx-to-catalog.mjs (--xlsx <ruta.xlsx> | --workbook-json <payload.json>) [--sheet Hoja1] [--out ./artifacts/catalog-from-xlsx-staging.csv] [--reports-dir ./artifacts/xlsx-reset] [--allow-synthetic-skus true|false] [--category-overrides <csv>]"
    );
  }

  const xlsxPath = xlsxArg ? path.resolve(xlsxArg) : "";
  if (xlsxArg && !fs.existsSync(xlsxPath)) throw new Error(`No existe archivo: ${xlsxPath}`);
  const workbookJsonPath = workbookJsonArg ? path.resolve(workbookJsonArg) : "";
  if (workbookJsonArg && !fs.existsSync(workbookJsonPath)) {
    throw new Error(`No existe workbook-json: ${workbookJsonPath}`);
  }

  const sheetName = args.get("sheet") ?? "";
  const outPath = path.resolve(args.get("out") ?? "./artifacts/catalog-from-xlsx-staging.csv");
  const reportsDir = path.resolve(args.get("reports-dir") ?? "./artifacts/xlsx-reset");
  const allowSyntheticSkus = toBool(args.get("allow-synthetic-skus"), false);
  const categoryOverridesPath = path.resolve(
    args.get("category-overrides") ?? path.join(reportsDir, "category-overrides.csv")
  );

  fs.mkdirSync(reportsDir, { recursive: true });
  ensureTemplateCsv(categoryOverridesPath, ["match_type", "match_value", "category"]);

  const workbookPayload = workbookJsonPath
    ? JSON.parse(fs.readFileSync(workbookJsonPath, "utf8"))
    : readWorkbookRowsViaPython({ xlsxPath, sheetName: sheetName || null });
  const parsedExcel = parseExcelRecords(workbookPayload);
  const sourceRows = buildSourceRows(parsedExcel.records);
  const { consolidated, priceConflicts } = buildGroupedVariants(sourceRows);
  const categoryOverrides = loadCategoryOverrides(categoryOverridesPath);
  const { skuCollisionsReport, syntheticCandidates, skuErrors } = assignSkus(consolidated, {
    allowSyntheticSkus,
  });
  const { categoryUnresolved, categoryAmbiguous, missingRequiredRows } = finalizeGroupFields(
    consolidated,
    { categoryOverrides, allowSyntheticSkus }
  );

  writeCsv(outPath, OUTPUT_HEADERS, consolidated.map(toOutputRow));

  const paths = {
    profile_json: path.join(reportsDir, "profile.json"),
    review_missing_required_csv: path.join(reportsDir, "review-missing-required.csv"),
    review_sku_collisions_csv: path.join(reportsDir, "review-sku-collisions.csv"),
    review_synthetic_candidates_csv: path.join(reportsDir, "review-synthetic-sku-candidates.csv"),
    review_price_conflicts_csv: path.join(reportsDir, "review-price-conflicts.csv"),
    review_category_unresolved_csv: path.join(reportsDir, "review-category-unresolved.csv"),
    review_category_ambiguous_csv: path.join(reportsDir, "review-category-ambiguous.csv"),
  };

  writeCsv(
    paths.review_missing_required_csv,
    ["source_line_first", "missing_fields", "vendor_code_normalized", "name", "size", "color", "source_store", "source_line_examples"],
    missingRequiredRows
  );
  writeCsv(
    paths.review_sku_collisions_csv,
    ["source_line_first", "vendor_code", "name", "size", "color", "candidate_stage", "candidate", "resolved_sku", "resolution"],
    skuCollisionsReport
  );
  writeCsv(
    paths.review_synthetic_candidates_csv,
    ["source_line_first", "source_store", "name", "size", "color", "price", "initial_stock", "proposed_synthetic_sku", "source_line_examples"],
    syntheticCandidates
  );
  writeCsv(
    paths.review_price_conflicts_csv,
    ["vendor_code_normalized", "name", "size", "color", "source_store", "prices", "source_line_examples", "logical_key"],
    priceConflicts.map((row) => ({ ...row, prices: row.prices.join(" | ") }))
  );
  writeCsv(
    paths.review_category_unresolved_csv,
    ["source_line_first", "vendor_code_normalized", "sku", "name", "size", "color", "source_store", "price", "initial_stock", "source_line_examples"],
    categoryUnresolved
  );
  writeCsv(
    paths.review_category_ambiguous_csv,
    ["source_line_first", "vendor_code_normalized", "sku", "name", "size", "color", "source_store", "category_candidates", "rule_detail", "source_line_examples"],
    categoryAmbiguous
  );

  const skuFilenameUnsafeCount = consolidated.filter((group) => group.sku && group.sku_filename_unsafe).length;
  const syntheticPendingConfirmation = consolidated.filter((group) => group.has_missing_vendor_code && !group.sku).length;

  const blockingErrors = [
    ...priceConflicts.map((row) => `Conflicto de precio: ${row.name} (${row.prices.join(", ")})`),
    ...missingRequiredRows.map((row) => `Campos requeridos faltantes en grupo ${row.source_line_first}: ${row.missing_fields}`),
    ...skuErrors,
    ...categoryUnresolved.map((row) => `Categoria no resuelta (linea ${row.source_line_first}): ${row.name}`),
    ...categoryAmbiguous.map((row) => `Categoria ambigua (linea ${row.source_line_first}): ${row.name} => ${row.category_candidates}`),
  ];

  const profile = {
    generated_at: new Date().toISOString(),
    inputs: {
      xlsx: xlsxPath,
      workbook_json: workbookJsonPath || null,
      sheet_requested: sheetName || null,
      sheet_used: workbookPayload.sheet,
      sheetnames: workbookPayload.sheetnames ?? [],
      allow_synthetic_skus: allowSyntheticSkus,
      category_overrides: categoryOverridesPath,
    },
    excel: {
      header_row: parsedExcel.header_line,
      raw_rows: parsedExcel.records.length,
      rows_missing_vendor_code: sourceRows.filter((r) => !r.vendor_code_key).length,
      rows_missing_price_original: sourceRows.filter((r) => r.price_was_missing).length,
    },
    grouping: {
      grouped_variants: consolidated.length,
      duplicate_rows_collapsed: sourceRows.length - consolidated.length,
      grouped_with_missing_vendor_code: consolidated.filter((g) => g.has_missing_vendor_code).length,
      grouped_price_defaulted_to_zero: consolidated.filter((g) => g.price_was_missing_any).length,
      price_conflicts: priceConflicts.length,
    },
    sku: {
      collision_rows: skuCollisionsReport.length,
      collision_codes: [...new Set(skuCollisionsReport.map((row) => row.vendor_code))].length,
      store_fallback_sku_groups: syntheticCandidates.length,
      synthetic_candidates: syntheticCandidates.length,
      synthetic_pending_confirmation: 0,
      sku_filename_unsafe_count: skuFilenameUnsafeCount,
      sku_errors: skuErrors.length,
    },
    category: {
      resolved: consolidated.filter((g) => g.category_status === "resolved").length,
      unresolved: categoryUnresolved.length,
      ambiguous: categoryAmbiguous.length,
      overrides_loaded: categoryOverrides.length,
    },
    outputs: {
      staging_csv: outPath,
      ...paths,
      category_overrides_template_csv: categoryOverridesPath,
    },
    blocking_errors_count: blockingErrors.length,
    blocking_errors: blockingErrors,
  };
  writeJson(paths.profile_json, profile);

  console.log(`Excel leido: ${xlsxPath}`);
  console.log(`Hoja usada: ${workbookPayload.sheet} (header fila ${parsedExcel.header_line})`);
  console.log(`Filas raw: ${parsedExcel.records.length}`);
  console.log(`Variantes agrupadas: ${consolidated.length}`);
  console.log(`CSV staging: ${outPath}`);
  console.log(`Profile: ${paths.profile_json}`);
  console.log(
    JSON.stringify(
      {
        grouped_variants: consolidated.length,
        price_conflicts: priceConflicts.length,
        missing_required_groups: missingRequiredRows.length,
        store_fallback_sku_groups: syntheticCandidates.length,
        synthetic_pending_confirmation: 0,
        category_unresolved: categoryUnresolved.length,
        category_ambiguous: categoryAmbiguous.length,
        sku_filename_unsafe_count: skuFilenameUnsafeCount,
        blocking_errors: blockingErrors.length,
      },
      null,
      2
    )
  );

  if (blockingErrors.length > 0) process.exit(1);
}

try {
  main();
} catch (error) {
  console.error("Convert inventory xlsx to catalog failed:", error);
  process.exit(1);
}
