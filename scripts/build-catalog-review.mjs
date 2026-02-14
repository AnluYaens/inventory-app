import fs from "node:fs";
import path from "node:path";

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
    rows.push(row);
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

function cleanToken(value) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^A-Za-z0-9]+/g, "")
    .toUpperCase();
}

function cleanName(value) {
  return (value ?? "")
    .replace(/\s+/g, " ")
    .replace(/\s+\$/g, " $")
    .trim();
}

function normalizeNameKey(value) {
  return cleanName(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function categoryCode(category) {
  const normalized = cleanToken(category);
  if (!normalized) return "GENR";
  if (normalized.startsWith("CAMI")) return "CAMI";
  if (normalized.startsWith("PANT")) return "PANT";
  if (normalized.startsWith("FALD")) return "FALD";
  if (normalized.startsWith("ZAPA") || normalized.startsWith("CALZ")) return "ZAPA";
  if (
    normalized.startsWith("MONE") ||
    normalized.startsWith("BOLS") ||
    normalized.startsWith("CART")
  ) {
    return "MONE";
  }
  if (normalized.startsWith("PERF")) return "PERF";
  if (normalized.startsWith("ACCE")) return "ACCE";
  if (normalized.startsWith("VEST")) return "VEST";
  if (normalized.startsWith("BERM")) return "BERM";
  return normalized.slice(0, 4).padEnd(4, "X");
}

function normalizeReference(value) {
  const normalized = cleanToken(value);
  if (!normalized) return "";
  const digits = normalized.replace(/\D/g, "");
  if (digits.length < 3) return "";
  return normalized;
}

function isSyntheticReference(value) {
  const normalized = normalizeReference(value);
  if (!normalized) return true;
  if (/^P\d+R\d+$/i.test(normalized)) return true;
  if (/^MISSING/i.test(normalized)) return true;
  if (/^MANUAL/i.test(normalized)) return true;
  return false;
}

function extractReferenceFromName(name) {
  const match = String(name ?? "").match(/\(([^)]+)\)/);
  if (!match) return "";
  return normalizeReference(match[1]);
}

function extractReferenceFromSku(sku) {
  const parts = String(sku ?? "").split("-");
  if (parts.length < 3) return "";
  return normalizeReference(parts[1]);
}

function extractReferenceFromImageFilename(imageFilename) {
  const value = String(imageFilename ?? "");
  const match = value.match(/-(\d{3,})-[^-]+\.[A-Za-z0-9]+$/);
  return match ? normalizeReference(match[1]) : "";
}

function makeSku(category, reference, size) {
  const cat = categoryCode(category);
  const ref = normalizeReference(reference) || "MISSINGREF";
  const sizeToken = cleanToken(size || "UNICA") || "UNICA";
  return `${cat}-${ref}-${sizeToken}`;
}

function flagNameNoise(name) {
  return /Tallas?|[$]/i.test(name);
}

function chooseReference(staging, current, fallbackIndex) {
  const candidates = [
    {
      value: normalizeReference(staging?.reference_number),
      source: "pdf",
    },
    {
      value: normalizeReference(extractReferenceFromName(staging?.name_raw || "")),
      source: "pdf_name",
    },
    {
      value: normalizeReference(current?.reference_number),
      source: "catalog_reference",
    },
    {
      value: normalizeReference(extractReferenceFromName(current?.name || "")),
      source: "catalog_name",
    },
    {
      value: normalizeReference(extractReferenceFromSku(current?.sku || "")),
      source: "catalog_sku",
    },
    {
      value: normalizeReference(
        extractReferenceFromImageFilename(current?.image_filename || ""),
      ),
      source: "image_filename",
    },
  ];

  for (const candidate of candidates) {
    if (!candidate.value) continue;
    if (isSyntheticReference(candidate.value)) continue;
    return candidate;
  }

  return {
    value: `MISSING${String(fallbackIndex).padStart(4, "0")}`,
    source: "manual_required",
  };
}

function tokenOverlapScore(a, b) {
  if (!a || !b) return 0;
  const aTokens = new Set(a.split(" ").filter(Boolean));
  const bTokens = new Set(b.split(" ").filter(Boolean));
  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) overlap += 1;
  }
  return overlap;
}

function pickStagingMatch(current, stagingPool, fallbackIndexRef) {
  const currentNameKey = normalizeNameKey(current?.name || "");
  const currentSizeKey = cleanToken(current?.size || "UNICA") || "UNICA";

  let bestIndex = -1;
  let bestScore = -1;
  for (let i = 0; i < stagingPool.length; i += 1) {
    const candidate = stagingPool[i];
    if (candidate.used) continue;

    let score = 0;
    if (candidate.sizeKey === currentSizeKey) score += 6;
    if (candidate.nameKey && currentNameKey && candidate.nameKey === currentNameKey) {
      score += 12;
    } else if (
      candidate.nameKey &&
      currentNameKey &&
      (candidate.nameKey.includes(currentNameKey) ||
        currentNameKey.includes(candidate.nameKey))
    ) {
      score += 8;
    } else {
      score += tokenOverlapScore(candidate.nameKey, currentNameKey);
    }

    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  if (bestIndex >= 0 && bestScore >= 6) {
    stagingPool[bestIndex].used = true;
    return stagingPool[bestIndex].row;
  }

  while (fallbackIndexRef.value < stagingPool.length) {
    const candidate = stagingPool[fallbackIndexRef.value];
    fallbackIndexRef.value += 1;
    if (candidate.used) continue;
    candidate.used = true;
    return candidate.row;
  }

  return null;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const stagingPath = path.resolve(args.get("staging") ?? "./artifacts/catalog_staging.csv");
  const catalogPath = path.resolve(
    args.get("catalog") ?? "./client-assets/catalog-final.csv",
  );
  const photosDir = path.resolve(args.get("photos") ?? "./client-assets/photos-final");
  const reviewPath = path.resolve(args.get("output") ?? "./client-assets/catalog-review.csv");
  const finalPath = path.resolve(
    args.get("final-output") ?? "./client-assets/catalog-final.csv",
  );

  if (!fs.existsSync(stagingPath)) throw new Error(`No existe staging: ${stagingPath}`);
  if (!fs.existsSync(catalogPath)) throw new Error(`No existe catalogo: ${catalogPath}`);
  if (!fs.existsSync(photosDir)) throw new Error(`No existe fotos: ${photosDir}`);

  const { rows: stagingRows } = parseCsv(stagingPath);
  const { rows: currentRows } = parseCsv(catalogPath);
  const photoFiles = new Set(
    fs
      .readdirSync(photosDir)
      .filter((name) => /\.(jpg|jpeg|png|webp|avif)$/i.test(name)),
  );

  const stagingByPage = new Map();
  for (const row of stagingRows) {
    const page = row.source_page ?? "";
    if (!stagingByPage.has(page)) stagingByPage.set(page, []);
    stagingByPage.get(page).push(row);
  }

  const catalogByPage = new Map();
  for (const row of currentRows) {
    const page = row.source_page ?? "";
    if (!catalogByPage.has(page)) catalogByPage.set(page, []);
    catalogByPage.get(page).push(row);
  }

  const sortedPages = [...catalogByPage.keys()].sort((a, b) => Number(a) - Number(b));
  const reviewRows = [];
  const finalRows = [];
  const usedSkus = new Set();
  let fallbackRefCounter = 1;

  for (const page of sortedPages) {
    const pageRows = catalogByPage.get(page) ?? [];
    const stagingPageRows = stagingByPage.get(page) ?? [];
    const stagingPool = stagingPageRows.map((row) => ({
      row,
      used: false,
      nameKey: normalizeNameKey(row.name_raw || ""),
      sizeKey: cleanToken(row.size || "UNICA") || "UNICA",
    }));
    const fallbackIndexRef = { value: 0 };

    for (let idx = 0; idx < pageRows.length; idx += 1) {
      const current = pageRows[idx];
      const staging = pickStagingMatch(current, stagingPool, fallbackIndexRef);

      const categoryFinal = cleanName(staging?.category || current.category || "");
      const sizeFinal = cleanName(staging?.size || current.size || "UNICA");
      const namePdf = cleanName(staging?.name_raw || "");
      const nameFinal = namePdf || cleanName(current.name || "");
      const priceFinal = current.price || staging?.price || "";
      const imageFilename = current.image_filename || "";
      const imageExists = photoFiles.has(imageFilename);

      const selectedRef = chooseReference(staging, current, fallbackRefCounter);
      if (selectedRef.source === "manual_required") {
        fallbackRefCounter += 1;
      }
      const referenceFinal = selectedRef.value;

      let skuFinal = makeSku(categoryFinal, referenceFinal, sizeFinal);
      if (usedSkus.has(skuFinal)) {
        let n = 2;
        while (usedSkus.has(`${skuFinal}${n}`)) n += 1;
        skuFinal = `${skuFinal}${n}`;
      }
      usedSkus.add(skuFinal);

      const notes = [];
      if (!staging) notes.push("missing_staging_match");
      if (!referenceFinal || isSyntheticReference(referenceFinal)) {
        notes.push("missing_reference");
      }
      if (selectedRef.source !== "pdf" && selectedRef.source !== "pdf_name") {
        notes.push(`reference_from_${selectedRef.source}`);
      }
      if (flagNameNoise(nameFinal)) notes.push("name_contains_noise_tokens");
      if (!imageExists) notes.push("missing_photo_file");
      const reviewStatus = notes.length === 0 ? "auto_ok" : "needs_review";

      reviewRows.push({
        source_page: page,
        sku_current: current.sku || "",
        sku_suggested: skuFinal,
        reference_number: referenceFinal,
        reference_source: selectedRef.source,
        name_current: current.name || "",
        name_pdf: namePdf,
        name_suggested: nameFinal,
        category_current: current.category || "",
        category_suggested: categoryFinal,
        size_current: current.size || "",
        size_suggested: sizeFinal,
        price_current: current.price || "",
        price_pdf: staging?.price || "",
        image_filename_current: imageFilename,
        image_filename_suggested: imageFilename,
        review_status: reviewStatus,
        review_notes: notes.join("|"),
      });

      finalRows.push({
        sku: skuFinal,
        name: nameFinal,
        category: categoryFinal,
        size: sizeFinal,
        color: current.color || "",
        price: priceFinal,
        cost: current.cost || "",
        initial_stock: current.initial_stock || "0",
        image_filename: imageFilename,
        reference_number: referenceFinal,
        reference_source: selectedRef.source,
        source_page: page,
      });
    }
  }

  writeCsv(
    reviewPath,
    [
      "source_page",
      "sku_current",
      "sku_suggested",
      "reference_number",
      "reference_source",
      "name_current",
      "name_pdf",
      "name_suggested",
      "category_current",
      "category_suggested",
      "size_current",
      "size_suggested",
      "price_current",
      "price_pdf",
      "image_filename_current",
      "image_filename_suggested",
      "review_status",
      "review_notes",
    ],
    reviewRows,
  );

  writeCsv(
    finalPath,
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
    finalRows,
  );

  const pending = reviewRows.filter((row) => row.review_status !== "auto_ok").length;
  const fromPdf = reviewRows.filter((row) => row.reference_source === "pdf").length;
  console.log(`Review generado: ${reviewPath}`);
  console.log(`Catalogo final sugerido: ${finalPath}`);
  console.log(`Rows review: ${reviewRows.length}`);
  console.log(`Referencias desde PDF: ${fromPdf}`);
  console.log(`Pendientes de revision: ${pending}`);
}

main();
