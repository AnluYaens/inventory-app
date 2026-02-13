import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const REQUIRED_COLUMNS = [
  "sku",
  "name",
  "price",
  "initial_stock",
  "image_filename",
];

function loadDotEnv() {
  const envFiles = [".env.local", ".env"];

  for (const envFile of envFiles) {
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

      if (!(key in process.env)) {
        process.env[key] = value;
      }
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
      out.push(value.trim());
      value = "";
      continue;
    }

    value += char;
  }

  out.push(value.trim());
  return out;
}

function parseCsv(text) {
  const lines = text
    .split(/\r?\n/g)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== "");

  if (lines.length === 0) {
    throw new Error("El archivo CSV esta vacio.");
  }

  const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase().trim());
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

function toNumber(value, label, line, { allowNull = false } = {}) {
  if (value === "" || value == null) {
    if (allowNull) return { value: null };
    return { error: `Linea ${line}: ${label} es obligatorio.` };
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return { error: `Linea ${line}: ${label} debe ser numerico.` };
  }
  return { value: number };
}

function toInteger(value, label, line) {
  const parsed = toNumber(value, label, line);
  if (parsed.error) return parsed;
  if (!Number.isInteger(parsed.value)) {
    return { error: `Linea ${line}: ${label} debe ser entero.` };
  }
  return parsed;
}

function readImagesManifest(manifestPath) {
  if (!manifestPath) return null;
  const raw = fs.readFileSync(manifestPath, "utf8");
  const json = JSON.parse(raw);

  if (json && typeof json === "object" && !Array.isArray(json)) {
    if (json.files && typeof json.files === "object") {
      return json.files;
    }
    return json;
  }

  throw new Error("El manifest de imagenes debe ser un objeto JSON.");
}

function resolveImageUrl(imageFilename, manifestMap) {
  const lower = imageFilename.toLowerCase();
  if (lower.startsWith("http://") || lower.startsWith("https://")) {
    return imageFilename;
  }

  if (!manifestMap) {
    return null;
  }

  return manifestMap[imageFilename] ?? null;
}

function normalizeRecord({ row, line }, manifestMap, seenSkus) {
  const sku = row.sku?.trim();
  const name = row.name?.trim();
  const category = row.category?.trim() || null;
  const size = row.size?.trim() || null;
  const color = row.color?.trim() || null;
  const imageFilename = row.image_filename?.trim();
  const notePrefix = `Linea ${line}:`;

  if (!sku) return { error: `${notePrefix} sku es obligatorio.` };
  if (!name) return { error: `${notePrefix} name es obligatorio.` };

  const skuKey = sku.toUpperCase();
  if (seenSkus.has(skuKey)) {
    return { error: `${notePrefix} sku duplicado en el archivo (${sku}).` };
  }
  seenSkus.add(skuKey);

  const price = toNumber(row.price, "price", line);
  if (price.error) return { error: price.error };
  if (price.value < 0) return { error: `${notePrefix} price no puede ser negativo.` };

  const cost = toNumber(row.cost, "cost", line, { allowNull: true });
  if (cost.error) return { error: cost.error };
  if (cost.value != null && cost.value < 0) {
    return { error: `${notePrefix} cost no puede ser negativo.` };
  }

  const stock = toInteger(row.initial_stock, "initial_stock", line);
  if (stock.error) return { error: stock.error };
  if (stock.value < 0) {
    return { error: `${notePrefix} initial_stock no puede ser negativo.` };
  }

  if (!imageFilename) {
    return { error: `${notePrefix} image_filename es obligatorio.` };
  }

  const imageUrl = resolveImageUrl(imageFilename, manifestMap);
  if (!imageUrl) {
    return {
      error: `${notePrefix} no se encontro URL para image_filename (${imageFilename}).`,
    };
  }

  return {
    value: {
      sku,
      name,
      category,
      size,
      color,
      price: price.value,
      cost: cost.value,
      initial_stock: stock.value,
      image_filename: imageFilename,
      image_url: imageUrl,
    },
  };
}

function buildSupabaseAdminClient() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) {
    throw new Error(
      "Faltan variables SUPABASE_URL/VITE_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY para aplicar import."
    );
  }
  return createClient(url, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function applyImport(records) {
  const supabase = buildSupabaseAdminClient();
  const skus = records.map((r) => r.sku);
  const existingSkuMap = new Map();

  const { data: existing, error: existingError } = await supabase
    .from("products")
    .select("id, sku")
    .in("sku", skus);

  if (existingError) throw existingError;
  for (const product of existing ?? []) {
    existingSkuMap.set(product.sku, product.id);
  }

  let inserted = 0;
  let updated = 0;

  for (const record of records) {
    const existed = existingSkuMap.has(record.sku);
    const { data: product, error: upsertError } = await supabase
      .from("products")
      .upsert(
        {
          sku: record.sku,
          name: record.name,
          category: record.category,
          size: record.size,
          color: record.color,
          price: record.price,
          cost: record.cost,
          image_url: record.image_url,
        },
        { onConflict: "sku" }
      )
      .select("id")
      .single();

    if (upsertError) throw upsertError;

    const { error: stockError } = await supabase
      .from("stock_snapshots")
      .upsert(
        {
          product_id: product.id,
          stock: record.initial_stock,
        },
        { onConflict: "product_id" }
      );

    if (stockError) throw stockError;

    if (existed) {
      updated += 1;
    } else {
      inserted += 1;
    }
  }

  return { inserted, updated };
}

function writeReport({ mode, file, records, inserted, updated }) {
  const report = {
    mode,
    file,
    total_rows: records.length,
    inserted,
    updated,
    generated_at: new Date().toISOString(),
  };

  const reportName = `import-report-${Date.now()}.json`;
  fs.writeFileSync(reportName, JSON.stringify(report, null, 2), "utf8");
  return reportName;
}

async function main() {
  loadDotEnv();

  const args = parseArgs(process.argv.slice(2));
  const file = args.get("file");
  const mode = args.get("mode") ?? "dry-run";
  const manifestPath = args.get("images-manifest");

  if (!file) {
    throw new Error(
      "Uso: npm run import:catalog -- --file <ruta.csv> --mode <dry-run|apply> [--images-manifest <manifest.json>]"
    );
  }

  if (mode !== "dry-run" && mode !== "apply") {
    throw new Error("El parametro --mode debe ser dry-run o apply.");
  }

  if (!file.toLowerCase().endsWith(".csv")) {
    throw new Error(
      "Solo se soporta CSV en este pipeline. Exporta tu Excel a .csv y vuelve a correr el comando."
    );
  }

  const text = fs.readFileSync(file, "utf8");
  const { headers, rows } = parseCsv(text);
  const missingColumns = REQUIRED_COLUMNS.filter((column) => !headers.includes(column));
  if (missingColumns.length > 0) {
    throw new Error(`Faltan columnas requeridas: ${missingColumns.join(", ")}`);
  }

  const manifestMap = readImagesManifest(manifestPath);
  const errors = [];
  const records = [];
  const seenSkus = new Set();

  for (const rowInfo of rows) {
    const parsed = normalizeRecord(rowInfo, manifestMap, seenSkus);
    if (parsed.error) {
      errors.push(parsed.error);
      continue;
    }
    records.push(parsed.value);
  }

  if (errors.length > 0) {
    console.error("VALIDACION FALLIDA (strict fail-fast):");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  if (mode === "dry-run") {
    console.log("Dry-run exitoso.");
    console.log(`Archivo: ${path.resolve(file)}`);
    console.log(`Rows validas: ${records.length}`);
    console.log("No se escribieron cambios en Supabase.");
    return;
  }

  const { inserted, updated } = await applyImport(records);
  const reportName = writeReport({
    mode,
    file: path.resolve(file),
    records,
    inserted,
    updated,
  });

  console.log("Importacion aplicada correctamente.");
  console.log(`Insertados: ${inserted}`);
  console.log(`Actualizados: ${updated}`);
  console.log(`Reporte: ${reportName}`);
}

main().catch((error) => {
  console.error("Importacion fallida:", error);
  process.exit(1);
});
