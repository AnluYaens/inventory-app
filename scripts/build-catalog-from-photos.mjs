import fs from "node:fs";
import path from "node:path";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif"]);

const CATEGORY_LABELS = {
  ACCE: "Accesorios",
  BERM: "Bermudas Shorts",
  CAMI: "Camisas",
  FALD: "Faldas",
  MONE: "Monederos",
  PANT: "Pantalones",
  PERF: "Perfumes",
  VEST: "Vestidos",
  ZAPA: "Zapatos",
};

const CATEGORY_ORDER = ["ZAPA", "BERM", "CAMI", "FALD", "PANT", "VEST", "ACCE", "MONE", "PERF"];
const CATEGORY_INDEX = new Map(
  CATEGORY_ORDER.map((category, index) => [category, index]),
);

const SIZE_HINTS = new Set([
  "XXXS",
  "XXS",
  "XS",
  "S",
  "M",
  "L",
  "XL",
  "XXL",
  "XXXL",
  "UNICA",
]);

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

function csvEscape(value) {
  const raw = value == null ? "" : String(value);
  if (raw.includes(",") || raw.includes('"') || raw.includes("\n")) {
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

function normalizeToken(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^A-Za-z0-9]+/g, "")
    .toUpperCase();
}

function isLikelySizeToken(token) {
  const normalized = normalizeToken(token);
  if (!normalized) return false;
  if (SIZE_HINTS.has(normalized)) return true;
  if (/^\d{2,3}$/.test(normalized)) return true;
  if (/^\d+ML$/.test(normalized)) return true;
  return false;
}

function cleanDescriptorText(tokens) {
  const value = tokens
    .map((token) =>
      String(token)
        .replace(/[()]/g, " ")
        .replace(/&/g, " y "),
    )
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return value;
}

function parsePhotoBase(baseName) {
  const upperBase = baseName.toUpperCase();

  const direct = upperBase.match(/^([A-Z0-9]+)-([A-Z0-9]+)-([A-Z0-9]+)$/);
  if (direct) {
    return {
      categoryCode: direct[1],
      referenceNumber: direct[2],
      size: direct[3],
      descriptor: "",
      parseMode: "direct",
    };
  }

  const compact = upperBase.match(/^([A-Z0-9]+)-(\d+)([A-Z]+)$/);
  if (compact) {
    return {
      categoryCode: compact[1],
      referenceNumber: compact[2],
      size: compact[3],
      descriptor: "",
      parseMode: "compact",
    };
  }

  const rawTokens = upperBase.split("-").filter(Boolean);
  if (rawTokens.length < 2) {
    throw new Error(`Nombre de foto invalido (sin prefijo/ref): ${baseName}`);
  }

  const categoryCode = rawTokens[0];
  const referenceNumber = rawTokens[1];
  let size = "UNICA";
  let descriptorTokens = rawTokens.slice(2);

  if (descriptorTokens.length > 0) {
    if (categoryCode === "PERF") {
      const first = normalizeToken(descriptorTokens[0]);
      const last = normalizeToken(descriptorTokens[descriptorTokens.length - 1]);
      if (/^\d+ML$/.test(first)) {
        size = first;
        descriptorTokens = descriptorTokens.slice(1);
      } else if (/^\d+ML$/.test(last)) {
        size = last;
        descriptorTokens = descriptorTokens.slice(0, -1);
      } else {
        size = "UNICA";
      }
    } else {
      const last = descriptorTokens[descriptorTokens.length - 1];
      if (isLikelySizeToken(last)) {
        size = normalizeToken(last);
        descriptorTokens = descriptorTokens.slice(0, -1);
      } else if (categoryCode === "ACCE" || categoryCode === "MONE") {
        size = "UNICA";
      }
    }

    if (categoryCode === "ACCE" || categoryCode === "MONE") {
      size = "UNICA";
    }
  }

  return {
    categoryCode,
    referenceNumber,
    size,
    descriptor: cleanDescriptorText(descriptorTokens),
    parseMode: "fallback",
  };
}

function deriveCategoryLabel(categoryCode) {
  return CATEGORY_LABELS[categoryCode] ?? "General";
}

function parseSkuParts(sku) {
  const parts = String(sku ?? "").toUpperCase().split("-");
  if (parts.length < 3) return null;
  return {
    categoryCode: parts[0],
    referenceNumber: parts[1],
    size: parts.slice(2).join("-"),
  };
}

function toNumberOrDefault(value, fallback) {
  const parsed = Number(value);
  if (Number.isFinite(parsed)) return String(parsed);
  return String(fallback);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const photosDir = path.resolve(args.get("photos") ?? "./client-assets/fotos-inventario");
  const outputCatalogPath = path.resolve(
    args.get("out") ?? "./client-assets/catalog-final.csv",
  );
  const outputPhotosDir = path.resolve(args.get("photos-out") ?? "./client-assets/photos-sku");
  const sourceCatalogPath = path.resolve(
    args.get("source-catalog") ?? "./client-assets/catalog-final.csv",
  );
  const reportBase = path.resolve(
    args.get("report-base") ?? "./artifacts/catalog-from-photos-report",
  );
  const reportJsonPath = `${reportBase}.json`;
  const reportCsvPath = `${reportBase}.csv`;

  if (!fs.existsSync(photosDir)) {
    throw new Error(`No existe carpeta de fotos: ${photosDir}`);
  }
  if (!fs.existsSync(sourceCatalogPath)) {
    throw new Error(`No existe catalogo fuente: ${sourceCatalogPath}`);
  }

  const { rows: sourceRows } = parseCsv(sourceCatalogPath);
  const existingBySku = new Map();
  for (const { row } of sourceRows) {
    const sku = String(row.sku ?? "").toUpperCase();
    if (!sku || existingBySku.has(sku)) continue;
    existingBySku.set(sku, row);
  }

  const imageFiles = fs
    .readdirSync(photosDir)
    .filter((name) => IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase()));
  if (imageFiles.length === 0) {
    throw new Error("No se encontraron imagenes compatibles.");
  }

  const normalizedEntries = [];
  const parseErrors = [];
  for (const fileName of imageFiles) {
    const extension = path.extname(fileName).toLowerCase();
    const baseName = path.basename(fileName, extension);

    try {
      const parsed = parsePhotoBase(baseName);
      const categoryCode = normalizeToken(parsed.categoryCode);
      const referenceNumber = normalizeToken(parsed.referenceNumber);
      const size = normalizeToken(parsed.size || "UNICA") || "UNICA";
      if (!categoryCode || !referenceNumber || !size) {
        throw new Error(`No se pudo derivar SKU: ${fileName}`);
      }

      normalizedEntries.push({
        fileName,
        extension,
        categoryCode,
        referenceNumber,
        size,
        descriptor: parsed.descriptor,
        parseMode: parsed.parseMode,
      });
    } catch (error) {
      parseErrors.push({
        file_name: fileName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (parseErrors.length > 0) {
    writeJson(reportJsonPath, {
      generated_at: new Date().toISOString(),
      mode: "failed",
      parse_errors: parseErrors,
    });
    throw new Error(
      `No se pudieron parsear ${parseErrors.length} fotos. Ver ${reportJsonPath}`,
    );
  }

  const byBaseSku = new Map();
  for (const entry of normalizedEntries) {
    const baseSku = `${entry.categoryCode}-${entry.referenceNumber}-${entry.size}`;
    if (!byBaseSku.has(baseSku)) byBaseSku.set(baseSku, []);
    byBaseSku.get(baseSku).push(entry);
  }

  const reportRows = [];
  const catalogRows = [];
  const usedSkus = new Set();
  let copiedPhotos = 0;
  let renamedPhotos = 0;
  let reusedFromSource = 0;
  let generatedNames = 0;
  let duplicateResolved = 0;

  fs.mkdirSync(outputPhotosDir, { recursive: true });

  const sortedBaseSkus = [...byBaseSku.keys()].sort((a, b) => a.localeCompare(b));
  for (const baseSku of sortedBaseSkus) {
    const group = byBaseSku.get(baseSku) ?? [];
    group.sort((a, b) => a.fileName.localeCompare(b.fileName));

    for (let idx = 0; idx < group.length; idx += 1) {
      const entry = group[idx];
      let sku = baseSku;

      if (idx > 0) {
        duplicateResolved += 1;
        sku = `${entry.categoryCode}-${entry.referenceNumber}-${entry.size}${idx + 1}`;
      }
      while (usedSkus.has(sku)) {
        duplicateResolved += 1;
        sku = `${entry.categoryCode}-${entry.referenceNumber}-${entry.size}${usedSkus.size % 97}`;
      }
      usedSkus.add(sku);

      const targetFileName = `${sku}${entry.extension}`;
      const sourcePath = path.join(photosDir, entry.fileName);
      const targetPath = path.join(outputPhotosDir, targetFileName);
      if (!fs.existsSync(targetPath)) {
        fs.copyFileSync(sourcePath, targetPath);
        copiedPhotos += 1;
      }
      if (entry.fileName !== targetFileName) {
        renamedPhotos += 1;
      }

      const existing = existingBySku.get(sku);
      const categoryLabel = deriveCategoryLabel(entry.categoryCode);
      let name = existing?.name?.trim() || "";
      if (name) {
        reusedFromSource += 1;
      } else {
        generatedNames += 1;
        const descriptorName = entry.descriptor.trim();
        name = descriptorName
          ? `${categoryLabel} ${entry.referenceNumber} ${descriptorName}`.trim()
          : `${categoryLabel} ${entry.referenceNumber}`;
      }

      const row = {
        sku,
        name,
        category: categoryLabel,
        size: entry.size,
        color: existing?.color ?? "",
        price: toNumberOrDefault(existing?.price, 0),
        cost: existing?.cost ?? "",
        initial_stock: toNumberOrDefault(existing?.initial_stock, 0),
        image_filename: targetFileName,
        reference_number: entry.referenceNumber,
        reference_source: "photo_filename",
        source_page: existing?.source_page ?? "",
      };
      catalogRows.push(row);

      reportRows.push({
        source_file: entry.fileName,
        output_file: targetFileName,
        output_sku: sku,
        category: categoryLabel,
        parse_mode: entry.parseMode,
        reused_existing_metadata: existing ? "true" : "false",
      });
    }
  }

  catalogRows.sort((a, b) => {
    const aParts = parseSkuParts(a.sku);
    const bParts = parseSkuParts(b.sku);
    const aCategory = CATEGORY_INDEX.get(aParts?.categoryCode ?? "") ?? 999;
    const bCategory = CATEGORY_INDEX.get(bParts?.categoryCode ?? "") ?? 999;
    if (aCategory !== bCategory) return aCategory - bCategory;

    const aRefNum = Number(aParts?.referenceNumber ?? "");
    const bRefNum = Number(bParts?.referenceNumber ?? "");
    if (Number.isFinite(aRefNum) && Number.isFinite(bRefNum) && aRefNum !== bRefNum) {
      return aRefNum - bRefNum;
    }

    if ((aParts?.referenceNumber ?? "") !== (bParts?.referenceNumber ?? "")) {
      return (aParts?.referenceNumber ?? "").localeCompare(bParts?.referenceNumber ?? "");
    }

    return (aParts?.size ?? "").localeCompare(bParts?.size ?? "");
  });

  writeCsv(
    outputCatalogPath,
    [
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
      "source_page",
    ],
    catalogRows,
  );

  writeCsv(
    reportCsvPath,
    [
      "source_file",
      "output_file",
      "output_sku",
      "category",
      "parse_mode",
      "reused_existing_metadata",
    ],
    reportRows,
  );

  writeJson(reportJsonPath, {
    generated_at: new Date().toISOString(),
    photos_input_dir: photosDir,
    photos_output_dir: outputPhotosDir,
    catalog_output_file: outputCatalogPath,
    photos_total: imageFiles.length,
    catalog_rows: catalogRows.length,
    copied_photos: copiedPhotos,
    renamed_photos: renamedPhotos,
    duplicate_skus_resolved: duplicateResolved,
    reused_existing_metadata: reusedFromSource,
    generated_names: generatedNames,
    parse_errors: parseErrors.length,
  });

  console.log("Catalogo generado desde fotos.");
  console.log(`Fotos origen: ${imageFiles.length}`);
  console.log(`Filas catalogo: ${catalogRows.length}`);
  console.log(`Fotos copiadas: ${copiedPhotos}`);
  console.log(`Fotos renombradas a SKU: ${renamedPhotos}`);
  console.log(`SKUs duplicados resueltos: ${duplicateResolved}`);
  console.log(`Reporte CSV: ${reportCsvPath}`);
  console.log(`Reporte JSON: ${reportJsonPath}`);
  console.log(`Catalogo: ${outputCatalogPath}`);
}

main();
