import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".avif"]);

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

function parseBoolean(value, fallback = true) {
  if (value == null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(normalized)) return true;
  if (["false", "0", "no", "n"].includes(normalized)) return false;
  return fallback;
}

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
  const finalHeaders = headers.length > 0 ? headers : rows.length > 0 ? Object.keys(rows[0]) : [];
  const lines = [finalHeaders.join(",")];
  for (const row of rows) {
    lines.push(finalHeaders.map((header) => csvEscape(row[header] ?? "")).join(","));
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, lines.join("\n"), "utf8");
}

async function fetchAllProducts(supabase) {
  const output = [];
  const pageSize = 1000;
  let from = 0;

  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from("products")
      .select("sku, price, image_url, name, category, size")
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

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function toFamilyKey(sku) {
  const value = String(sku ?? "").trim().toUpperCase();
  const parts = value.split("-");
  if (parts.length < 3) return null;
  return `${parts[0]}-${parts[1]}`;
}

function toSkuPrefix(sku) {
  const value = String(sku ?? "").trim().toUpperCase();
  const parts = value.split("-");
  if (parts.length < 2) return null;
  return parts[0];
}

function toReferenceFromSku(sku) {
  const value = String(sku ?? "").trim().toUpperCase();
  const parts = value.split("-");
  if (parts.length < 3) return null;
  return parts[1];
}

function formatPrice(numberValue) {
  const num = Number(numberValue);
  if (!Number.isFinite(num)) return null;
  if (Number.isInteger(num)) return String(num);
  return String(Number(num.toFixed(2)));
}

function readPhotosByBaseName(photosDir) {
  const map = new Map();
  for (const fileName of fs.readdirSync(photosDir)) {
    const ext = path.extname(fileName).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(ext)) continue;
    const base = path.basename(fileName, ext).toUpperCase();
    if (!map.has(base)) map.set(base, []);
    map.get(base).push(fileName);
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.localeCompare(b));
  }
  return map;
}

function listFamilyPhotoCandidates(photosByBase, familyKey) {
  const candidates = [];
  for (const [base, files] of photosByBase.entries()) {
    if (base.startsWith(`${familyKey}-`)) {
      for (const file of files) {
        candidates.push(file);
      }
    }
  }
  candidates.sort((a, b) => a.localeCompare(b));
  return candidates;
}

function pickSourcePhoto({
  row,
  expectedSkuUpper,
  dbBySku,
  photosByBase,
  familyKey,
  nameSizeMatches = [],
}) {
  const currentImageFile = String(row.image_filename ?? "").trim();
  if (currentImageFile) {
    const currentExt = path.extname(currentImageFile).toLowerCase();
    const currentBase = path.basename(currentImageFile, currentExt).toUpperCase();
    const currentExists = photosByBase.get(currentBase)?.includes(currentImageFile);
    if (currentExists) return currentImageFile;
  }

  const dbExact = dbBySku.get(expectedSkuUpper);
  if (dbExact?.image_url) {
    const dbFile = String(dbExact.image_url).split("/").pop() ?? "";
    if (dbFile) {
      const dbExt = path.extname(dbFile).toLowerCase();
      const dbBase = path.basename(dbFile, dbExt).toUpperCase();
      if (photosByBase.get(dbBase)?.includes(dbFile)) {
        return dbFile;
      }
    }
  }

  if (familyKey) {
    const familyCandidates = listFamilyPhotoCandidates(photosByBase, familyKey);
    if (familyCandidates.length > 0) return familyCandidates[0];
  }

  if (nameSizeMatches.length > 0) {
    for (const match of nameSizeMatches) {
      const dbFile = String(match.image_url ?? "").split("/").pop() ?? "";
      if (!dbFile) continue;
      const dbExt = path.extname(dbFile).toLowerCase();
      const dbBase = path.basename(dbFile, dbExt).toUpperCase();
      if (photosByBase.get(dbBase)?.includes(dbFile)) {
        return dbFile;
      }
    }
  }

  return null;
}

function addPhotoEntry(photosByBase, fileName) {
  const ext = path.extname(fileName).toLowerCase();
  const base = path.basename(fileName, ext).toUpperCase();
  if (!photosByBase.has(base)) photosByBase.set(base, []);
  const list = photosByBase.get(base);
  if (!list.includes(fileName)) {
    list.push(fileName);
    list.sort((a, b) => a.localeCompare(b));
  }
}

async function main() {
  loadDotEnv();
  const args = parseArgs(process.argv.slice(2));

  const filePath = path.resolve(args.get("file") ?? "./client-assets/catalog-final.csv");
  const photosDir = path.resolve(args.get("photos") ?? "./client-assets/photos-sku");
  const mode = (args.get("mode") ?? "").toLowerCase();
  const outPath = path.resolve(args.get("out") ?? "./artifacts/catalog-reset-ready.csv");
  const reportPath = path.resolve(
    args.get("report") ?? `./artifacts/catalog-reset-ready-report-${nowStamp()}.json`,
  );
  const fixImages = parseBoolean(args.get("fix-images"), true);
  const fixPerfRef = parseBoolean(args.get("fix-perf-ref"), true);

  if (!["dry-run", "apply"].includes(mode)) {
    throw new Error(
      "Uso: npm run catalog:prepare-reset -- --file <catalog.csv> --photos <photos-dir> --mode <dry-run|apply> [--out <prepared.csv>] [--report <report.json>] [--fix-images true|false] [--fix-perf-ref true|false]",
    );
  }

  if (!fs.existsSync(filePath)) throw new Error(`No existe archivo: ${filePath}`);
  if (!fs.existsSync(photosDir)) throw new Error(`No existe carpeta fotos: ${photosDir}`);

  const { headers, rows } = parseCsv(filePath);
  for (const required of ["sku", "price", "image_filename", "category", "reference_number"]) {
    if (!headers.includes(required)) {
      throw new Error(`Falta columna requerida: ${required}`);
    }
  }

  const supabase = buildSupabaseAdminClient();
  const dbProducts = await fetchAllProducts(supabase);
  const dbBySku = new Map(
    dbProducts.map((row) => [String(row.sku ?? "").toUpperCase(), row]),
  );
  const dbByCategory = new Map();
  for (const row of dbProducts) {
    const category = String(row.category ?? "").trim().toLowerCase();
    if (!dbByCategory.has(category)) dbByCategory.set(category, []);
    dbByCategory.get(category).push(row);
  }

  const familyPrices = new Map();
  for (const product of dbProducts) {
    const sku = String(product.sku ?? "").toUpperCase();
    const family = toFamilyKey(sku);
    if (!family) continue;
    if (!familyPrices.has(family)) familyPrices.set(family, new Set());
    familyPrices.get(family).add(Number(product.price));
  }

  const photosByBase = readPhotosByBaseName(photosDir);

  const preparedRows = [];
  const blockingErrors = [];
  const details = {
    price_filled_exact_sku_rows: [],
    price_filled_family_rows: [],
    price_filled_fallback_rows: [],
    perf_reference_fixed_rows: [],
    images_renamed_or_copied_rows: [],
    image_copy_operations: [],
  };

  for (const { line, row } of rows) {
    const next = { ...row };
    const sku = String(next.sku ?? "").trim();
    const skuUpper = sku.toUpperCase();
    const category = String(next.category ?? "").trim().toLowerCase();
    const size = String(next.size ?? "").trim().toLowerCase();
    const rowNameNorm = normalizeText(next.name);
    const familyKey = toFamilyKey(skuUpper);
    const nameSizeMatches = (dbByCategory.get(category) ?? []).filter((product) => {
      if (!rowNameNorm) return false;
      const dbSize = String(product.size ?? "").trim().toLowerCase();
      if (size && dbSize && size !== dbSize) return false;
      const dbNameNorm = normalizeText(product.name);
      return dbNameNorm.includes(rowNameNorm) || rowNameNorm.includes(dbNameNorm);
    });

    if (!skuUpper) {
      blockingErrors.push(`Linea ${line}: sku vacio.`);
      preparedRows.push(next);
      continue;
    }

    const exactProduct = dbBySku.get(skuUpper);
    if (exactProduct) {
      const current = String(next.price ?? "");
      const formatted = formatPrice(Number(exactProduct.price));
      if (formatted != null && current !== formatted) {
        next.price = formatted;
        details.price_filled_exact_sku_rows.push(sku);
      }
    } else {
      const candidates = [];
      const reasons = [];

      if (familyKey && familyPrices.has(familyKey)) {
        const familySet = familyPrices.get(familyKey);
        if (familySet.size === 1) {
          candidates.push({
            source: "family",
            value: [...familySet][0],
          });
        } else if (familySet.size > 1) {
          reasons.push(
            `precio ambiguo por familia ${familyKey} (${[...familySet].join(", ")})`,
          );
        }
      }

      const skuPrefix = toSkuPrefix(skuUpper);
      const rowRef = String(next.reference_number ?? "").trim().toUpperCase();
      if (skuPrefix && rowRef) {
        const refFamilyKey = `${skuPrefix}-${rowRef}`;
        if (familyPrices.has(refFamilyKey)) {
          const refSet = familyPrices.get(refFamilyKey);
          if (refSet.size === 1) {
            candidates.push({
              source: "reference",
              value: [...refSet][0],
            });
          } else if (refSet.size > 1) {
            reasons.push(
              `precio ambiguo por reference_number ${refFamilyKey} (${[
                ...refSet,
              ].join(", ")})`,
            );
          }
        }
      }

      const currentImage = String(next.image_filename ?? "").trim();
      if (currentImage) {
        const imageBase = path
          .basename(currentImage, path.extname(currentImage))
          .toUpperCase();
        const imageSkuMatch = dbBySku.get(imageBase);
        if (imageSkuMatch) {
          candidates.push({
            source: "image_sku",
            value: Number(imageSkuMatch.price),
          });
        }
      }

      if (nameSizeMatches.length > 0) {
        const matchPrices = [...new Set(nameSizeMatches.map((x) => Number(x.price)).filter((n) => Number.isFinite(n)))];
        if (matchPrices.length === 1) {
          candidates.push({
            source: "name_size",
            value: matchPrices[0],
          });
        } else if (matchPrices.length > 1) {
          reasons.push(
            `precio ambiguo por match nombre+talla (${matchPrices.join(", ")})`,
          );
        }
      }

      const distinct = [...new Set(candidates.map((x) => Number(x.value)))].filter((n) =>
        Number.isFinite(n),
      );

      if (distinct.length === 1) {
        const formatted = formatPrice(distinct[0]);
        if (formatted != null && String(next.price ?? "") !== formatted) {
          next.price = formatted;
          if (candidates.some((x) => x.source === "family")) {
            details.price_filled_family_rows.push(sku);
          } else {
            details.price_filled_fallback_rows.push(sku);
          }
        }
      } else if (distinct.length > 1) {
        blockingErrors.push(
          `Linea ${line} (${sku}): precio conflictivo por multiples fuentes (${distinct.join(
            ", ",
          )}).`,
        );
      } else if (reasons.length > 0) {
        blockingErrors.push(`Linea ${line} (${sku}): ${reasons.join("; ")}.`);
      } else {
        blockingErrors.push(`Linea ${line} (${sku}): no existe precio de familia en DB.`);
      }
    }

    if (fixPerfRef && category === "perfumes") {
      const expectedRef = toReferenceFromSku(skuUpper);
      const currentRef = String(next.reference_number ?? "").trim();
      if (expectedRef && currentRef !== expectedRef) {
        next.reference_number = expectedRef;
        details.perf_reference_fixed_rows.push(sku);
      }
    }

    const exactFiles = photosByBase.get(skuUpper) ?? [];
    if (exactFiles.length > 1) {
      blockingErrors.push(
        `Linea ${line} (${sku}): multiples fotos exact-SKU encontradas (${exactFiles.join(" | ")}).`,
      );
    } else if (exactFiles.length === 1) {
      const expectedFile = exactFiles[0];
      if (String(next.image_filename ?? "") !== expectedFile) {
        next.image_filename = expectedFile;
        details.images_renamed_or_copied_rows.push(sku);
      }
    } else if (fixImages) {
      const sourceFile = pickSourcePhoto({
        row: next,
        expectedSkuUpper: skuUpper,
        dbBySku,
        photosByBase,
        familyKey,
        nameSizeMatches,
      });

      if (!sourceFile) {
        blockingErrors.push(`Linea ${line} (${sku}): no se pudo resolver foto fuente para exact-SKU.`);
      } else {
        const ext = path.extname(sourceFile).toLowerCase();
        const targetFile = `${sku}${ext}`;
        const sourcePath = path.join(photosDir, sourceFile);
        const targetPath = path.join(photosDir, targetFile);

        if (mode === "apply" && !fs.existsSync(targetPath)) {
          fs.copyFileSync(sourcePath, targetPath);
        }

        addPhotoEntry(photosByBase, targetFile);
        next.image_filename = targetFile;
        details.images_renamed_or_copied_rows.push(sku);
        details.image_copy_operations.push({
          sku,
          source_file: sourceFile,
          target_file: targetFile,
        });
      }
    } else {
      blockingErrors.push(`Linea ${line} (${sku}): falta foto exact-SKU y fix-images=false.`);
    }

    preparedRows.push(next);
  }

  writeCsv(
    outPath,
    preparedRows,
    headers,
  );

  const report = {
    generated_at: new Date().toISOString(),
    mode,
    file: filePath,
    photos: photosDir,
    out: outPath,
    fix_images: fixImages,
    fix_perf_ref: fixPerfRef,
    summary: {
      csv_rows: rows.length,
      db_rows: dbProducts.length,
      price_filled_exact_sku: details.price_filled_exact_sku_rows.length,
      price_filled_family: details.price_filled_family_rows.length,
      price_filled_fallback: details.price_filled_fallback_rows.length,
      perf_reference_fixed: details.perf_reference_fixed_rows.length,
      images_renamed_or_copied: details.images_renamed_or_copied_rows.length,
      image_copy_operations: details.image_copy_operations.length,
      blocking_errors: blockingErrors.length,
    },
    details: {
      ...details,
      blocking_errors: blockingErrors,
    },
  };

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");

  console.log(`Prepared CSV: ${outPath}`);
  console.log(`Report JSON: ${reportPath}`);
  console.log(JSON.stringify(report.summary, null, 2));

  if (blockingErrors.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Prepare reset catalog failed:", error);
  process.exit(1);
});
