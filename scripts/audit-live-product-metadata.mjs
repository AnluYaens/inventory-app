import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const CATEGORY_BY_CODE = {
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

const IMAGE_EXT_PRIORITY = {
  png: 1,
  jpg: 2,
  jpeg: 3,
  webp: 4,
  avif: 5,
};

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

function readManifest(manifestPath) {
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

function buildImageIndex(manifestMap) {
  const exact = new Map();
  const byCatRefSize = new Map();
  const byCatRef = new Map();

  for (const [filename, url] of Object.entries(manifestMap)) {
    if (typeof url !== "string") continue;
    const extMatch = filename.match(/\.([A-Za-z0-9]+)$/);
    if (!extMatch) continue;

    const ext = extMatch[1].toLowerCase();
    const base = filename.slice(0, filename.length - ext.length - 1).toUpperCase();
    const priority = IMAGE_EXT_PRIORITY[ext] ?? 99;
    const parts = base.split("-");
    const descriptor = {
      filename,
      url,
      ext,
      base,
      priority,
      cat: parts.length >= 5 ? parts[1] : null,
      brand: parts.length >= 5 ? parts[2] : null,
      ref: parts.length >= 5 ? parts[3] : null,
      size: parts.length >= 5 ? parts[4] : null,
    };

    const existing = exact.get(base);
    if (!existing || descriptor.priority < existing.priority) {
      exact.set(base, descriptor);
    }

    if (descriptor.cat && descriptor.ref && descriptor.size) {
      const keyCatRefSize = `${descriptor.cat}|${descriptor.ref}|${descriptor.size}`;
      const keyCatRef = `${descriptor.cat}|${descriptor.ref}`;
      if (!byCatRefSize.has(keyCatRefSize)) byCatRefSize.set(keyCatRefSize, []);
      if (!byCatRef.has(keyCatRef)) byCatRef.set(keyCatRef, []);
      byCatRefSize.get(keyCatRefSize).push(descriptor);
      byCatRef.get(keyCatRef).push(descriptor);
    }
  }

  return { exact, byCatRefSize, byCatRef };
}

function deriveSkuCode(sku) {
  const match = String(sku ?? "").match(/^AMN-([A-Z0-9]+)-/i);
  return match ? match[1].toUpperCase() : null;
}

function parseAmnSku(sku) {
  const parts = String(sku ?? "").toUpperCase().split("-");
  if (parts.length < 5 || parts[0] !== "AMN") return null;
  return {
    cat: parts[1],
    brand: parts[2],
    ref: parts[3],
    size: parts[4],
  };
}

function pickSingleDescriptor(candidates, brand) {
  if (!candidates || candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  const brandMatches = candidates.filter((item) => item.brand === brand);
  if (brandMatches.length === 1) return brandMatches[0];
  return null;
}

function resolveExpectedImageForSku(sku, imageIndex) {
  const skuUpper = String(sku ?? "").toUpperCase();
  const exact = imageIndex.exact.get(skuUpper);
  if (exact) return { image: exact, source: "exact" };

  const parsed = parseAmnSku(skuUpper);
  if (!parsed) return { image: null, source: "non_amn" };

  const keyCatRefSize = `${parsed.cat}|${parsed.ref}|${parsed.size}`;
  const sizeCandidates = imageIndex.byCatRefSize.get(keyCatRefSize) ?? [];
  if (sizeCandidates.length > 0) {
    const selected = pickSingleDescriptor(sizeCandidates, parsed.brand);
    if (selected) return { image: selected, source: "cat_ref_size" };
    return { image: null, source: "ambiguous_cat_ref_size" };
  }

  const keyCatRef = `${parsed.cat}|${parsed.ref}`;
  const refCandidates = imageIndex.byCatRef.get(keyCatRef) ?? [];
  if (refCandidates.length > 0) {
    const selected = pickSingleDescriptor(refCandidates, parsed.brand);
    if (selected) return { image: selected, source: "cat_ref" };
    return { image: null, source: "ambiguous_cat_ref" };
  }

  return { image: null, source: "not_found" };
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

function toBooleanString(value) {
  return value ? "true" : "false";
}

async function main() {
  loadDotEnv();
  const args = parseArgs(process.argv.slice(2));
  const imagesManifestPath = path.resolve(
    args.get("images-manifest") ?? "./images-manifest.json",
  );

  if (!fs.existsSync(imagesManifestPath)) {
    throw new Error(`No existe images-manifest: ${imagesManifestPath}`);
  }

  const manifestMap = readManifest(imagesManifestPath);
  const imageIndex = buildImageIndex(manifestMap);

  const supabase = buildSupabaseAdminClient();
  const { data: products, error } = await supabase
    .from("products")
    .select("id, sku, name, category, size, image_url")
    .order("created_at", { ascending: true })
    .limit(5000);

  if (error) throw error;

  const rows = products ?? [];
  const details = [];
  const summary = {
    scanned: rows.length,
    amn_products: 0,
    non_amn_products: 0,
    unknown_sku_code: 0,
    category_mismatch: 0,
    image_missing_mapping: 0,
    image_ambiguous_mapping: 0,
    image_resolved_by_fallback: 0,
    image_legacy_url: 0,
    image_mismatch: 0,
    needs_any_update: 0,
  };

  for (const product of rows) {
    const sku = product.sku ?? "";
    const code = deriveSkuCode(sku);
    const isAmn = Boolean(code);
    if (isAmn) {
      summary.amn_products += 1;
    } else {
      summary.non_amn_products += 1;
    }

    const expectedCategory = code ? (CATEGORY_BY_CODE[code] ?? null) : null;
    if (code && !expectedCategory) {
      summary.unknown_sku_code += 1;
    }

    const imageResolution = resolveExpectedImageForSku(sku, imageIndex);
    const expectedImage = imageResolution.image;
    const currentImageUrl = product.image_url ?? "";
    const imageLegacyUrl = /\/IMG-P/i.test(currentImageUrl);
    const imageMissingMapping =
      isAmn && !expectedImage && imageResolution.source === "not_found";
    const imageAmbiguousMapping =
      isAmn &&
      !expectedImage &&
      (imageResolution.source === "ambiguous_cat_ref_size" ||
        imageResolution.source === "ambiguous_cat_ref");
    const imageMismatch = Boolean(
      isAmn &&
        expectedImage &&
        currentImageUrl &&
        currentImageUrl !== expectedImage.url,
    );
    const categoryMismatch = Boolean(
      isAmn && expectedCategory && (product.category ?? null) !== expectedCategory,
    );

    if (imageLegacyUrl) summary.image_legacy_url += 1;
    if (imageMissingMapping) summary.image_missing_mapping += 1;
    if (imageAmbiguousMapping) summary.image_ambiguous_mapping += 1;
    if (expectedImage && imageResolution.source !== "exact") {
      summary.image_resolved_by_fallback += 1;
    }
    if (imageMismatch) summary.image_mismatch += 1;
    if (categoryMismatch) summary.category_mismatch += 1;

    const needsAnyUpdate = categoryMismatch || imageMismatch;
    if (needsAnyUpdate) summary.needs_any_update += 1;

    details.push({
      product_id: product.id,
      sku,
      name: product.name ?? "",
      category_current: product.category ?? "",
      category_expected: expectedCategory ?? "",
      category_mismatch: toBooleanString(categoryMismatch),
      image_url_current: currentImageUrl,
      image_filename_expected: expectedImage?.filename ?? "",
      image_url_expected: expectedImage?.url ?? "",
      image_resolution_source: imageResolution.source,
      image_missing_mapping: toBooleanString(imageMissingMapping),
      image_ambiguous_mapping: toBooleanString(imageAmbiguousMapping),
      image_legacy_url: toBooleanString(imageLegacyUrl),
      image_mismatch: toBooleanString(imageMismatch),
      needs_any_update: toBooleanString(needsAnyUpdate),
    });
  }

  const generatedAt = new Date().toISOString();
  const reportJsonPath = path.resolve("./artifacts/live-metadata-audit.json");
  const reportCsvPath = path.resolve("./artifacts/live-metadata-audit.csv");

  fs.mkdirSync(path.dirname(reportJsonPath), { recursive: true });
  fs.writeFileSync(
    reportJsonPath,
    JSON.stringify(
      {
        generated_at: generatedAt,
        images_manifest: imagesManifestPath,
        summary,
      },
      null,
      2,
    ),
    "utf8",
  );

  writeCsv(
    reportCsvPath,
    [
      "product_id",
      "sku",
      "name",
      "category_current",
      "category_expected",
      "category_mismatch",
      "image_url_current",
      "image_filename_expected",
      "image_url_expected",
      "image_resolution_source",
      "image_missing_mapping",
      "image_ambiguous_mapping",
      "image_legacy_url",
      "image_mismatch",
      "needs_any_update",
    ],
    details,
  );

  console.log("Auditoria completada.");
  console.log(`JSON: ${reportJsonPath}`);
  console.log(`CSV: ${reportCsvPath}`);
  console.log(
    JSON.stringify(
      {
        scanned: summary.scanned,
        amn_products: summary.amn_products,
        category_mismatch: summary.category_mismatch,
        image_mismatch: summary.image_mismatch,
        image_missing_mapping: summary.image_missing_mapping,
        image_ambiguous_mapping: summary.image_ambiguous_mapping,
        image_resolved_by_fallback: summary.image_resolved_by_fallback,
        image_legacy_url: summary.image_legacy_url,
        needs_any_update: summary.needs_any_update,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error("Auditoria fallida:", error);
  process.exit(1);
});
