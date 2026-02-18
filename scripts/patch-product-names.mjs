import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_FILE = "./client-assets/catalog-final.csv";
const DEFAULT_SCOPE = "placeholders-only";
const VALID_SCOPES = new Set(["placeholders-only", "all"]);

function nowStamp() {
  return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

function loadDotEnv() {
  for (const envFile of [".env.local", ".env"]) {
    const envPath = path.resolve(envFile);
    if (!fs.existsSync(envPath)) continue;

    const content = fs.readFileSync(envPath, "utf8");
    for (const rawLine of content.split(/\r?\n/g)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const separatorIndex = line.indexOf("=");
      if (separatorIndex <= 0) continue;

      const key = line.slice(0, separatorIndex).trim();
      let value = line.slice(separatorIndex + 1).trim();

      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      if (!(key in process.env)) process.env[key] = value;
    }
  }
}

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

function parseCsv(filePath) {
  const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const lines = raw
    .split(/\r?\n/g)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== "");

  if (lines.length === 0) {
    throw new Error(`CSV vacio: ${filePath}`);
  }

  const headers = parseCsvLine(lines[0]).map((h) => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const values = parseCsvLine(lines[i]);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = (values[index] ?? "").trim();
    });
    rows.push({ line: i + 1, row });
  }
  return { headers, rows };
}

function csvEscape(value) {
  const raw = value == null ? "" : String(value);
  if (raw.includes(",") || raw.includes('"') || raw.includes("\n")) {
    return `"${raw.replaceAll('"', '""')}"`;
  }
  return raw;
}

function writeCsv(filePath, rows, headers) {
  const finalHeaders =
    headers && headers.length > 0
      ? headers
      : rows.length > 0
        ? Object.keys(rows[0])
        : [];

  const lines = [finalHeaders.join(",")];
  for (const row of rows) {
    lines.push(finalHeaders.map((h) => csvEscape(row[h] ?? "")).join(","));
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, lines.join("\n"), "utf8");
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isPlaceholderName(name, category) {
  const normalizedName = normalizeText(name);
  if (!normalizedName) return false;

  const genericPattern = /^([\p{L}\s]+)\s\d{3,4}$/u;
  if (!genericPattern.test(normalizedName)) return false;

  const normalizedCategory = normalizeText(category);
  if (normalizedCategory) {
    const categoryPattern = new RegExp(
      `^${escapeRegex(normalizedCategory)}\\s\\d{3,4}$`,
      "u",
    );
    if (categoryPattern.test(normalizedName)) return true;
  }

  return true;
}

function buildSupabaseAdminClient() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) {
    throw new Error(
      "Faltan variables SUPABASE_URL/VITE_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
  return createClient(url, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function fetchAllProducts(supabase) {
  const output = [];
  const pageSize = 1000;
  let from = 0;

  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from("products")
      .select("id, sku, name, category, price, image_url")
      .order("sku", { ascending: true })
      .range(from, to);

    if (error) throw error;
    const rows = data ?? [];
    output.push(...rows);

    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return output;
}

async function fetchAllStockSnapshots(supabase) {
  const output = [];
  const pageSize = 1000;
  let from = 0;

  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from("stock_snapshots")
      .select("product_id, stock")
      .order("product_id", { ascending: true })
      .range(from, to);

    if (error) throw error;
    const rows = data ?? [];
    output.push(...rows);

    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return output;
}

function createDefaultOutputPaths(args) {
  const stamp = nowStamp();
  const output = args.get("output")
    ? path.resolve(args.get("output"))
    : path.resolve(`./artifacts/name-patch-preview-${stamp}.csv`);
  const report = args.get("report")
    ? path.resolve(args.get("report"))
    : path.resolve(`./artifacts/name-patch-report-${stamp}.json`);
  return { output, report };
}

async function main() {
  loadDotEnv();
  const args = parseArgs(process.argv.slice(2));

  const filePath = path.resolve(args.get("file") ?? DEFAULT_FILE);
  const mode = (args.get("mode") ?? "").toLowerCase();
  const scope = (args.get("scope") ?? DEFAULT_SCOPE).toLowerCase();
  const { output: outputPath, report: reportPath } = createDefaultOutputPaths(args);

  if (!mode || (mode !== "dry-run" && mode !== "apply")) {
    throw new Error(
      "Uso: npm run catalog:patch-names -- --file <catalog.csv> --mode <dry-run|apply> [--output <preview.csv>] [--report <report.json>] [--scope placeholders-only|all]",
    );
  }

  if (!VALID_SCOPES.has(scope)) {
    throw new Error("--scope debe ser placeholders-only o all.");
  }

  if (!fs.existsSync(filePath)) {
    throw new Error(`No existe archivo: ${filePath}`);
  }

  const { headers, rows } = parseCsv(filePath);
  for (const required of ["sku", "name"]) {
    if (!headers.includes(required)) {
      throw new Error(`Falta columna requerida: ${required}`);
    }
  }

  const csvBySku = new Map();
  const duplicateCsvSkus = new Set();
  for (const { line, row } of rows) {
    const sku = String(row.sku ?? "").trim();
    if (!sku) continue;
    const key = sku.toUpperCase();
    if (csvBySku.has(key)) {
      duplicateCsvSkus.add(sku);
      continue;
    }
    csvBySku.set(key, {
      sku,
      line,
      name: String(row.name ?? "").trim(),
      category: String(row.category ?? "").trim(),
      reference_number: String(row.reference_number ?? "").trim(),
    });
  }

  const supabase = buildSupabaseAdminClient();
  const dbProductsBefore = await fetchAllProducts(supabase);
  const dbBySkuBefore = new Map(
    dbProductsBefore.map((p) => [String(p.sku ?? "").toUpperCase(), p]),
  );

  const previewRows = [];
  const candidates = [];
  const errors = [];
  let missingInDb = 0;
  let emptyNameRows = 0;
  let skippedNonPlaceholder = 0;

  for (const [, csvRow] of csvBySku) {
    const dbRow = dbBySkuBefore.get(csvRow.sku.toUpperCase());
    const previewBase = {
      sku: csvRow.sku,
      category: csvRow.category || dbRow?.category || "",
      reference_number: csvRow.reference_number,
      name_db_actual: dbRow?.name ?? "",
      name_csv_nuevo: csvRow.name,
      will_update: "false",
      decision: "",
    };

    if (!dbRow) {
      missingInDb += 1;
      previewRows.push({ ...previewBase, decision: "missing_in_db" });
      continue;
    }

    if (!csvRow.name) {
      emptyNameRows += 1;
      errors.push(`Linea ${csvRow.line}: name vacio para SKU ${csvRow.sku}`);
      previewRows.push({ ...previewBase, decision: "empty_name" });
      continue;
    }

    if (csvRow.name === dbRow.name) {
      previewRows.push({ ...previewBase, decision: "no_change" });
      continue;
    }

    if (
      scope === "placeholders-only" &&
      !isPlaceholderName(dbRow.name, csvRow.category || dbRow.category || "")
    ) {
      skippedNonPlaceholder += 1;
      previewRows.push({ ...previewBase, decision: "skipped_non_placeholder" });
      continue;
    }

    candidates.push({
      id: dbRow.id,
      sku: csvRow.sku,
      oldName: dbRow.name,
      newName: csvRow.name,
    });
    previewRows.push({
      ...previewBase,
      will_update: "true",
      decision: "will_update",
    });
  }

  for (const sku of duplicateCsvSkus) {
    errors.push(`SKU duplicado en CSV: ${sku}`);
  }

  previewRows.sort((a, b) => a.sku.localeCompare(b.sku));
  writeCsv(outputPath, previewRows, [
    "sku",
    "category",
    "reference_number",
    "name_db_actual",
    "name_csv_nuevo",
    "will_update",
    "decision",
  ]);

  let updatedNames = 0;
  let priceChanges = 0;
  let imageUrlChanges = 0;
  let stockChanges = 0;

  const priceBeforeBySku = new Map(
    dbProductsBefore.map((p) => [String(p.sku ?? "").toUpperCase(), Number(p.price ?? 0)]),
  );
  const imageBeforeBySku = new Map(
    dbProductsBefore.map((p) => [String(p.sku ?? "").toUpperCase(), String(p.image_url ?? "")]),
  );
  const productIdBySkuBefore = new Map(
    dbProductsBefore.map((p) => [String(p.sku ?? "").toUpperCase(), p.id]),
  );
  const stockBeforeRows = await fetchAllStockSnapshots(supabase);
  const stockBeforeByProduct = new Map(stockBeforeRows.map((s) => [s.product_id, Number(s.stock)]));

  if (mode === "apply") {
    for (const candidate of candidates) {
      const { error } = await supabase
        .from("products")
        .update({ name: candidate.newName })
        .eq("id", candidate.id);
      if (error) {
        errors.push(`SKU ${candidate.sku}: fallo update name -> ${error.message}`);
        continue;
      }
      updatedNames += 1;
    }

    const dbProductsAfter = await fetchAllProducts(supabase);
    const dbAfterBySku = new Map(
      dbProductsAfter.map((p) => [String(p.sku ?? "").toUpperCase(), p]),
    );

    for (const candidate of candidates) {
      const skuKey = candidate.sku.toUpperCase();
      const beforePrice = priceBeforeBySku.get(skuKey);
      const afterPrice = Number(dbAfterBySku.get(skuKey)?.price ?? 0);
      if (beforePrice != null && beforePrice !== afterPrice) priceChanges += 1;

      const beforeImage = imageBeforeBySku.get(skuKey) ?? "";
      const afterImage = String(dbAfterBySku.get(skuKey)?.image_url ?? "");
      if (beforeImage !== afterImage) imageUrlChanges += 1;
    }

    const stockAfterRows = await fetchAllStockSnapshots(supabase);
    const stockAfterByProduct = new Map(stockAfterRows.map((s) => [s.product_id, Number(s.stock)]));
    for (const candidate of candidates) {
      const skuKey = candidate.sku.toUpperCase();
      const productId = productIdBySkuBefore.get(skuKey);
      if (!productId) continue;
      const beforeStock = stockBeforeByProduct.get(productId) ?? 0;
      const afterStock = stockAfterByProduct.get(productId) ?? 0;
      if (beforeStock !== afterStock) stockChanges += 1;
    }
  }

  const report = {
    generated_at: new Date().toISOString(),
    mode,
    scope,
    file: filePath,
    output_preview: outputPath,
    summary: {
      csv_rows: rows.length,
      db_rows: dbProductsBefore.length,
      updatable_rows: candidates.length,
      skus_missing_in_db: missingInDb,
      empty_name_rows: emptyNameRows,
      skipped_non_placeholder: skippedNonPlaceholder,
      duplicate_csv_skus: duplicateCsvSkus.size,
      updated_names: updatedNames,
      price_changes: priceChanges,
      stock_changes: stockChanges,
      image_url_changes: imageUrlChanges,
      errors: errors.length,
    },
    errors,
  };

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");

  console.log(`Preview CSV: ${outputPath}`);
  console.log(`Reporte JSON: ${reportPath}`);
  console.log(JSON.stringify(report.summary, null, 2));
}

main().catch((error) => {
  console.error("Name patch flow fallido:", error);
  process.exit(1);
});
