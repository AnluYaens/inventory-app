import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".avif",
]);

const LEGACY_PREFIXES = ["AMN-", "SKU-"];

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
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  }
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
  if (lines.length === 0) throw new Error(`CSV vacio: ${filePath}`);
  const headers = parseCsvLine(lines[0]).map((header) => header.trim());
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

function readManifest(manifestPath) {
  const raw = fs.readFileSync(manifestPath, "utf8");
  const json = JSON.parse(raw);
  if (json && typeof json === "object" && !Array.isArray(json)) {
    if (json.files && typeof json.files === "object") return json.files;
    return json;
  }
  throw new Error("El manifest de imagenes debe ser un objeto JSON.");
}

function parseImageDescriptor(fileName) {
  const extension = path.extname(fileName ?? "").toLowerCase();
  if (!SUPPORTED_IMAGE_EXTENSIONS.has(extension)) return null;
  const baseName = path.basename(fileName, extension);
  if (!baseName) return null;
  return { extension, baseName, baseUpper: baseName.toUpperCase() };
}

async function fetchAllProducts(supabase) {
  const output = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from("products")
      .select("id, sku, image_url")
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

function nowStamp() {
  return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

function startsWithLegacyPrefix(value) {
  const token = String(value ?? "").toUpperCase();
  return LEGACY_PREFIXES.some((prefix) => token.startsWith(prefix));
}

function parseExpectedEvents(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error("--expect-events debe ser entero mayor o igual a 0.");
  }
  return parsed;
}

async function main() {
  loadDotEnv();
  const args = parseArgs(process.argv.slice(2));
  const filePath = path.resolve(args.get("file") ?? "./client-assets/catalog-final.csv");
  const photosDir = path.resolve(args.get("photos") ?? "./client-assets/photos-sku");
  const manifestPathArg = args.get("images-manifest") ?? "./images-manifest.json";
  const expectEvents = parseExpectedEvents(args.get("expect-events") ?? "0");
  const outputPath = path.resolve(
    args.get("output") ?? `./artifacts/live-verify-alignment-${nowStamp()}.json`,
  );

  if (!fs.existsSync(filePath)) throw new Error(`No existe archivo: ${filePath}`);
  if (!fs.existsSync(photosDir)) throw new Error(`No existe carpeta fotos: ${photosDir}`);

  const manifestPath = path.resolve(manifestPathArg);
  const manifestMap = fs.existsSync(manifestPath) ? readManifest(manifestPath) : null;

  const { headers, rows } = parseCsv(filePath);
  for (const required of ["sku", "image_filename"]) {
    if (!headers.includes(required)) {
      throw new Error(`Falta columna requerida en CSV: ${required}`);
    }
  }

  const csvSkuMap = new Map();
  const errors = [];
  for (const { line, row } of rows) {
    const sku = (row.sku ?? "").trim();
    const imageFilename = (row.image_filename ?? "").trim();
    if (!sku) {
      errors.push(`Linea ${line}: sku vacio.`);
      continue;
    }
    if (!imageFilename) {
      errors.push(`Linea ${line}: image_filename vacio para ${sku}.`);
      continue;
    }
    const key = sku.toUpperCase();
    if (csvSkuMap.has(key)) {
      errors.push(`Linea ${line}: sku duplicado en CSV (${sku}).`);
      continue;
    }
    csvSkuMap.set(key, { sku, imageFilename, line });
  }

  const photosBySku = new Map();
  for (const fileName of fs.readdirSync(photosDir)) {
    const descriptor = parseImageDescriptor(fileName);
    if (!descriptor) continue;
    if (!photosBySku.has(descriptor.baseUpper)) photosBySku.set(descriptor.baseUpper, []);
    photosBySku.get(descriptor.baseUpper).push(fileName);
  }
  for (const files of photosBySku.values()) {
    files.sort((a, b) => a.localeCompare(b));
  }

  for (const [skuKey, meta] of csvSkuMap.entries()) {
    const matches = photosBySku.get(skuKey) ?? [];
    if (matches.length === 0) {
      errors.push(`CSV SKU sin foto exacta en carpeta: ${meta.sku}`);
      continue;
    }
    if (matches.length > 1) {
      errors.push(`CSV SKU con multiples fotos exactas: ${meta.sku} -> ${matches.join(" | ")}`);
      continue;
    }
    if (matches[0] !== meta.imageFilename) {
      errors.push(
        `CSV SKU ${meta.sku} tiene image_filename=${meta.imageFilename}, esperado=${matches[0]}.`,
      );
    }
  }

  const supabase = buildSupabaseAdminClient();
  const products = await fetchAllProducts(supabase);
  const dbSkuMap = new Map();
  for (const product of products) {
    dbSkuMap.set(String(product.sku ?? "").toUpperCase(), product);
  }

  const dbSkuSet = new Set(dbSkuMap.keys());
  const csvSkuSet = new Set(csvSkuMap.keys());
  const dbNotCsv = [...dbSkuSet].filter((sku) => !csvSkuSet.has(sku));
  const csvNotDb = [...csvSkuSet].filter((sku) => !dbSkuSet.has(sku));
  const legacySkus = [...dbSkuSet].filter((sku) => startsWithLegacyPrefix(sku));

  if (dbNotCsv.length > 0) {
    errors.push(`SKUs en DB que no estan en CSV: ${dbNotCsv.length}`);
  }
  if (csvNotDb.length > 0) {
    errors.push(`SKUs en CSV que no estan en DB: ${csvNotDb.length}`);
  }
  if (legacySkus.length > 0) {
    errors.push(`SKUs legacy detectados en DB: ${legacySkus.length}`);
  }

  const imageMismatches = [];
  const missingManifestEntries = [];
  for (const [skuKey, meta] of csvSkuMap.entries()) {
    const product = dbSkuMap.get(skuKey);
    if (!product) continue;

    const currentImageUrl = String(product.image_url ?? "");
    if (!currentImageUrl) {
      imageMismatches.push({
        sku: meta.sku,
        reason: "image_url vacio en DB",
        expected: manifestMap ? String(manifestMap[meta.imageFilename] ?? "") : meta.imageFilename,
        current: "",
      });
      continue;
    }

    if (manifestMap) {
      const expectedUrl = manifestMap[meta.imageFilename];
      if (!expectedUrl) {
        missingManifestEntries.push({
          sku: meta.sku,
          image_filename: meta.imageFilename,
        });
        continue;
      }
      if (currentImageUrl !== expectedUrl) {
        imageMismatches.push({
          sku: meta.sku,
          reason: "image_url distinto al manifest",
          expected: expectedUrl,
          current: currentImageUrl,
        });
      }
      continue;
    }

    const parsedUrl = parseImageDescriptor(currentImageUrl.split("/").pop() ?? "");
    if (!parsedUrl) {
      imageMismatches.push({
        sku: meta.sku,
        reason: "image_url con extension no soportada",
        expected: meta.imageFilename,
        current: currentImageUrl,
      });
      continue;
    }
    if (parsedUrl.baseUpper !== skuKey) {
      imageMismatches.push({
        sku: meta.sku,
        reason: "basename(image_url) no coincide con SKU",
        expected: meta.sku,
        current: parsedUrl.baseName,
      });
    }
  }

  if (missingManifestEntries.length > 0) {
    errors.push(`Manifest incompleto para image_filename: ${missingManifestEntries.length}`);
  }
  if (imageMismatches.length > 0) {
    errors.push(`Productos con image_url inconsistente: ${imageMismatches.length}`);
  }

  const { count: stockCount, error: stockError } = await supabase
    .from("stock_snapshots")
    .select("product_id", { head: true, count: "exact" });
  if (stockError) throw stockError;

  const { count: eventCount, error: eventError } = await supabase
    .from("inventory_events")
    .select("id", { head: true, count: "exact" });
  if (eventError) throw eventError;

  const expectedProducts = csvSkuSet.size;
  if (products.length !== expectedProducts) {
    errors.push(`Conteo products distinto. DB=${products.length} CSV=${expectedProducts}`);
  }
  if ((stockCount ?? 0) !== expectedProducts) {
    errors.push(`Conteo stock_snapshots distinto. stock=${stockCount ?? 0} esperado=${expectedProducts}`);
  }
  if ((eventCount ?? 0) !== expectEvents) {
    errors.push(`Conteo inventory_events distinto. events=${eventCount ?? 0} esperado=${expectEvents}`);
  }

  const report = {
    generated_at: new Date().toISOString(),
    file: filePath,
    photos_dir: photosDir,
    images_manifest: manifestMap ? manifestPath : null,
    expected_events: expectEvents,
    summary: {
      passed: errors.length === 0,
      csv_rows: rows.length,
      csv_unique_skus: csvSkuSet.size,
      db_products: products.length,
      db_stock_snapshots: stockCount ?? 0,
      db_inventory_events: eventCount ?? 0,
      db_not_csv: dbNotCsv.length,
      csv_not_db: csvNotDb.length,
      legacy_skus_in_db: legacySkus.length,
      image_mismatches: imageMismatches.length,
      missing_manifest_entries: missingManifestEntries.length,
      errors: errors.length,
    },
    details: {
      errors,
      db_not_csv: dbNotCsv,
      csv_not_db: csvNotDb,
      legacy_skus_in_db: legacySkus,
      image_mismatches: imageMismatches,
      missing_manifest_entries: missingManifestEntries,
    },
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), "utf8");

  console.log("Verificacion live DB vs CSV completada.");
  console.log(`Reporte: ${outputPath}`);
  console.log(JSON.stringify(report.summary, null, 2));

  if (errors.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Verificacion fallida:", error);
  process.exit(1);
});
