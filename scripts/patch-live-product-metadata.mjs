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

function toBool(input, fallback = true) {
  if (input == null) return fallback;
  const normalized = String(input).trim().toLowerCase();
  if (["1", "true", "yes", "y"].includes(normalized)) return true;
  if (["0", "false", "no", "n"].includes(normalized)) return false;
  return fallback;
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

function buildTimestamp() {
  return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

async function main() {
  loadDotEnv();
  const args = parseArgs(process.argv.slice(2));
  const mode = (args.get("mode") ?? "dry-run").toLowerCase();
  if (!["dry-run", "apply"].includes(mode)) {
    throw new Error("El parametro --mode debe ser dry-run o apply.");
  }

  const updateCategory = toBool(args.get("update-category"), true);
  const updateImage = toBool(args.get("update-image"), true);
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
    .select("id, sku, name, category, image_url")
    .order("created_at", { ascending: true })
    .limit(5000);
  if (error) throw error;

  const rows = products ?? [];
  const summary = {
    mode,
    update_category: updateCategory,
    update_image: updateImage,
    scanned: rows.length,
    amn_products: 0,
    non_amn_products: 0,
    unknown_sku_code: 0,
    missing_image_mapping: 0,
    ambiguous_image_mapping: 0,
    candidates: 0,
    category_updates_planned: 0,
    image_updates_planned: 0,
    updated_rows: 0,
    errors: 0,
  };

  const patchRows = [];
  const errorRows = [];

  for (const product of rows) {
    const sku = product.sku ?? "";
    const code = deriveSkuCode(sku);
    if (!code) {
      summary.non_amn_products += 1;
      continue;
    }
    summary.amn_products += 1;

    const expectedCategory = CATEGORY_BY_CODE[code] ?? null;
    if (!expectedCategory) {
      summary.unknown_sku_code += 1;
    }

    const imageResolution = resolveExpectedImageForSku(sku, imageIndex);
    const expectedImage = imageResolution.image;
    if (!expectedImage && imageResolution.source === "not_found") {
      summary.missing_image_mapping += 1;
    }
    if (
      !expectedImage &&
      (imageResolution.source === "ambiguous_cat_ref_size" ||
        imageResolution.source === "ambiguous_cat_ref")
    ) {
      summary.ambiguous_image_mapping += 1;
    }

    const patch = {};
    const categoryMismatch = Boolean(
      expectedCategory && (product.category ?? null) !== expectedCategory,
    );
    const imageMismatch = Boolean(
      expectedImage && (product.image_url ?? "") !== expectedImage.url,
    );

    if (updateCategory && categoryMismatch) {
      patch.category = expectedCategory;
      summary.category_updates_planned += 1;
    }
    if (updateImage && imageMismatch) {
      patch.image_url = expectedImage.url;
      summary.image_updates_planned += 1;
    }

    if (Object.keys(patch).length === 0) {
      continue;
    }

    summary.candidates += 1;
    const item = {
      product_id: product.id,
      sku,
      name: product.name ?? "",
      category_current: product.category ?? "",
      category_expected: expectedCategory ?? "",
      image_url_current: product.image_url ?? "",
      image_filename_expected: expectedImage?.filename ?? "",
      image_url_expected: expectedImage?.url ?? "",
      image_resolution_source: imageResolution.source,
      patch_category: patch.category ?? "",
      patch_image_url: patch.image_url ?? "",
      applied: "false",
      error: "",
    };

    if (mode === "apply") {
      const { error: updateError } = await supabase
        .from("products")
        .update(patch)
        .eq("id", product.id);
      if (updateError) {
        summary.errors += 1;
        item.error = updateError.message;
        errorRows.push(item);
      } else {
        summary.updated_rows += 1;
        item.applied = "true";
      }
    }

    patchRows.push(item);
  }

  const timestamp = buildTimestamp();
  const basePath = path.resolve(
    `./artifacts/live-metadata-patch-report-${timestamp}`,
  );
  const jsonPath = `${basePath}.json`;
  const csvPath = `${basePath}.csv`;

  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        images_manifest: imagesManifestPath,
        summary,
        errors: errorRows,
      },
      null,
      2,
    ),
    "utf8",
  );

  writeCsv(
    csvPath,
    [
      "product_id",
      "sku",
      "name",
      "category_current",
      "category_expected",
      "image_url_current",
      "image_filename_expected",
      "image_url_expected",
      "image_resolution_source",
      "patch_category",
      "patch_image_url",
      "applied",
      "error",
    ],
    patchRows,
  );

  console.log("Patch de metadata completado.");
  console.log(`Modo: ${mode}`);
  console.log(`JSON: ${jsonPath}`);
  console.log(`CSV: ${csvPath}`);
  console.log(JSON.stringify(summary, null, 2));
  if (summary.errors > 0) process.exit(1);
}

main().catch((error) => {
  console.error("Patch fallido:", error);
  process.exit(1);
});
