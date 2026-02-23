import fs from "node:fs";
import path from "node:path";

const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".avif",
]);

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
  if (/[,"\n]/.test(raw)) return `"${raw.replaceAll('"', '""')}"`;
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

function normalizeSpaces(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function toBool(value, fallback = false) {
  if (value == null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y"].includes(normalized)) return true;
  if (["0", "false", "no", "n"].includes(normalized)) return false;
  return fallback;
}

function parseImageDescriptor(fileName) {
  const extension = path.extname(fileName).toLowerCase();
  if (!SUPPORTED_IMAGE_EXTENSIONS.has(extension)) return null;
  return {
    fileName,
    extension,
    baseName: path.basename(fileName, extension),
    baseUpper: path.basename(fileName, extension).toUpperCase(),
  };
}

function ensureTemplateCsv(filePath, headers) {
  if (fs.existsSync(filePath)) return;
  writeCsv(filePath, headers, []);
}

function loadManualMap(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const { headers, rows } = parseCsv(filePath);
  const required = ["sku", "target_ext", "source_file"];
  const missing = required.filter((header) => !headers.includes(header));
  if (missing.length > 0) {
    throw new Error(`manual-image-map.csv invalido; faltan columnas: ${missing.join(", ")}`);
  }
  return rows
    .map((entry) => ({
      line: entry.line,
      sku: normalizeSpaces(entry.row.sku),
      target_ext: normalizeSpaces(entry.row.target_ext).toLowerCase(),
      source_file: normalizeSpaces(entry.row.source_file),
    }))
    .filter((entry) => entry.sku || entry.source_file || entry.target_ext);
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

function normalizeSizeKey(value) {
  const raw = normalizeSpaces(value);
  if (!raw || raw.toLowerCase() === "none") return "UNICA";
  return raw.toUpperCase();
}

function loadReferenceCatalog(filePath, photosByName) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const { rows } = parseCsv(filePath);
  const exactKeyMap = new Map();
  const nameSizeMap = new Map();

  for (const { row } of rows) {
    const name = normalizeSpaces(row.name);
    const size = normalizeSizeKey(row.size);
    const color = normalizeSpaces(row.color);
    const imageFilename = normalizeSpaces(row.image_filename);
    if (!name || !imageFilename) continue;
    if (!photosByName.has(imageFilename)) continue;

    const record = {
      name,
      size,
      color,
      image_filename: imageFilename,
      sku: normalizeSpaces(row.sku),
    };
    const keyExact = `${normalizeTextKey(name)}||${size}||${normalizeColorKey(color)}`;
    const keyNameSize = `${normalizeTextKey(name)}||${size}`;

    if (!exactKeyMap.has(keyExact)) exactKeyMap.set(keyExact, []);
    exactKeyMap.get(keyExact).push(record);
    if (!nameSizeMap.has(keyNameSize)) nameSizeMap.set(keyNameSize, []);
    nameSizeMap.get(keyNameSize).push(record);
  }

  return { exactKeyMap, nameSizeMap };
}

function buildPhotoIndexes(photosDir) {
  const descriptors = fs
    .readdirSync(photosDir)
    .map((fileName) => parseImageDescriptor(fileName))
    .filter(Boolean);

  const byBase = new Map();
  const byName = new Map();
  for (const descriptor of descriptors) {
    if (!byBase.has(descriptor.baseUpper)) byBase.set(descriptor.baseUpper, []);
    byBase.get(descriptor.baseUpper).push(descriptor.fileName);
    byName.set(descriptor.fileName, descriptor);
  }
  for (const files of byBase.values()) {
    files.sort((a, b) => a.localeCompare(b));
  }

  return { descriptors, byBase, byName };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const filePath = path.resolve(args.get("file") ?? "");
  const photosDir = path.resolve(args.get("photos") ?? "./client-assets/photos-sku");
  const outPath = path.resolve(args.get("out") ?? filePath);
  const mode = (args.get("mode") ?? "dry-run").toLowerCase();
  const reportBase = path.resolve(args.get("report-base") ?? "./artifacts/xlsx-reset/image-coverage");
  const manualMapPath = path.resolve(args.get("manual-map") ?? "./artifacts/xlsx-reset/manual-image-map.csv");
  const referenceCatalogPath = args.get("reference-catalog")
    ? path.resolve(args.get("reference-catalog"))
    : path.resolve("./artifacts/catalog-reset-ready.csv");
  const failOnMissing = toBool(args.get("fail-on-missing"), true);

  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(
      "Uso: node scripts/prepare-image-coverage-for-new-skus.mjs --file <catalog.csv> --photos ./client-assets/photos-sku [--manual-map ./artifacts/xlsx-reset/manual-image-map.csv] [--mode dry-run|apply] [--out <csv>] [--report-base <path>]"
    );
  }
  if (!fs.existsSync(photosDir)) throw new Error(`No existe carpeta fotos: ${photosDir}`);
  if (!["dry-run", "apply"].includes(mode)) throw new Error("--mode debe ser dry-run o apply.");

  ensureTemplateCsv(manualMapPath, ["sku", "target_ext", "source_file"]);
  const manualMapRows = loadManualMap(manualMapPath);
  const manualBySku = new Map();
  const manualMapErrors = [];
  for (const row of manualMapRows) {
    if (!row.sku) continue;
    if (manualBySku.has(row.sku.toUpperCase())) {
      manualMapErrors.push(`SKU duplicado en manual-image-map.csv: ${row.sku}`);
      continue;
    }
    manualBySku.set(row.sku.toUpperCase(), row);
  }

  const { headers, rows } = parseCsv(filePath);
  const outputHeaders = headers.includes("image_filename") ? [...headers] : [...headers, "image_filename"];
  const photos = buildPhotoIndexes(photosDir);
  const referenceCatalog = loadReferenceCatalog(referenceCatalogPath, photos.byName);

  const reportCsvPath = `${reportBase}.csv`;
  const reportJsonPath = `${reportBase}.json`;
  const reportRows = [];
  const outputRows = [];
  const errors = [...manualMapErrors];
  let rowsUpdated = 0;
  let copyOperations = 0;
  let exactMatches = 0;
  let manualMatches = 0;
  let heuristicExactMatches = 0;
  let heuristicNameSizeMatches = 0;

  for (const { line, row } of rows) {
    const next = { ...row };
    const sku = normalizeSpaces(row.sku);
    const currentImage = normalizeSpaces(row.image_filename);
    const targetName = normalizeSpaces(row.name);
    const targetSize = normalizeSizeKey(row.size);
    const targetColor = normalizeSpaces(row.color);

    if (!sku) {
      reportRows.push({
        line,
        sku: "",
        status: "missing_sku",
        image_filename_current: currentImage,
        image_filename_final: currentImage,
        source_file: "",
        action: "none",
        details: "SKU vacio.",
      });
      errors.push(`Linea ${line}: sku obligatorio.`);
      outputRows.push(next);
      continue;
    }

    if (WINDOWS_FILE_FORBIDDEN_CHARS.test(sku)) {
      reportRows.push({
        line,
        sku,
        status: "sku_filename_unsafe",
        image_filename_current: currentImage,
        image_filename_final: currentImage,
        source_file: "",
        action: "none",
        details: "El SKU contiene caracteres no validos para nombre de archivo en Windows.",
      });
      errors.push(`Linea ${line}: SKU no se puede usar como basename de archivo en Windows (${sku}).`);
      outputRows.push(next);
      continue;
    }

    const exactMatchesForSku = photos.byBase.get(sku.toUpperCase()) ?? [];
    if (exactMatchesForSku.length > 1) {
      reportRows.push({
        line,
        sku,
        status: "ambiguous_exact_match",
        image_filename_current: currentImage,
        image_filename_final: currentImage,
        source_file: "",
        action: "none",
        details: `Multiples archivos exactos: ${exactMatchesForSku.join(" | ")}`,
      });
      errors.push(`Linea ${line}: multiples fotos exactas para SKU ${sku}.`);
      outputRows.push(next);
      continue;
    }

    if (exactMatchesForSku.length === 1) {
      const resolved = exactMatchesForSku[0];
      next.image_filename = resolved;
      if (currentImage !== resolved) rowsUpdated += 1;
      exactMatches += 1;
      reportRows.push({
        line,
        sku,
        status: "resolved_exact",
        image_filename_current: currentImage,
        image_filename_final: resolved,
        source_file: resolved,
        action: "use_exact_existing",
        details: "OK",
      });
      outputRows.push(next);
      continue;
    }

    const manual = manualBySku.get(sku.toUpperCase());
    if (manual) {
      const sourceDescriptor = photos.byName.get(manual.source_file);
      const ext = manual.target_ext || sourceDescriptor?.extension || "";

      if (!sourceDescriptor) {
        reportRows.push({
          line,
          sku,
          status: "manual_source_missing",
          image_filename_current: currentImage,
          image_filename_final: currentImage,
          source_file: manual.source_file,
          action: "none",
          details: "source_file no existe en la carpeta de fotos.",
        });
        errors.push(`Linea ${line}: source_file no existe para manual map (${manual.source_file}).`);
        outputRows.push(next);
        continue;
      }

      if (!SUPPORTED_IMAGE_EXTENSIONS.has(ext)) {
        reportRows.push({
          line,
          sku,
          status: "manual_target_ext_invalid",
          image_filename_current: currentImage,
          image_filename_final: currentImage,
          source_file: manual.source_file,
          action: "none",
          details: `Extension no soportada: ${ext || "(vacia)"}`,
        });
        errors.push(`Linea ${line}: target_ext invalida para SKU ${sku}.`);
        outputRows.push(next);
        continue;
      }

      const targetFile = `${sku}${ext}`;
      const sourcePath = path.join(photosDir, sourceDescriptor.fileName);
      const targetPath = path.join(photosDir, targetFile);
      let action = "manual_map";

      if (mode === "apply" && sourceDescriptor.fileName !== targetFile) {
        if (!fs.existsSync(targetPath)) {
          fs.copyFileSync(sourcePath, targetPath);
          copyOperations += 1;
        }
        action = "manual_copy";
      }

      next.image_filename = targetFile;
      if (currentImage !== targetFile) rowsUpdated += 1;
      manualMatches += 1;
      reportRows.push({
        line,
        sku,
        status: "resolved_manual",
        image_filename_current: currentImage,
        image_filename_final: targetFile,
        source_file: sourceDescriptor.fileName,
        action,
        details: "OK",
      });
      outputRows.push(next);
      continue;
    }

    if (referenceCatalog && targetName) {
      const keyExact = `${normalizeTextKey(targetName)}||${targetSize}||${normalizeColorKey(targetColor)}`;
      const keyNameSize = `${normalizeTextKey(targetName)}||${targetSize}`;
      const exactRefMatches = referenceCatalog.exactKeyMap.get(keyExact) ?? [];
      const nameSizeRefMatches = referenceCatalog.nameSizeMap.get(keyNameSize) ?? [];

      let heuristicMatch = null;
      let heuristicType = "";
      if (exactRefMatches.length === 1) {
        heuristicMatch = exactRefMatches[0];
        heuristicType = "reference_name_size_color";
      } else if (exactRefMatches.length === 0 && nameSizeRefMatches.length === 1) {
        heuristicMatch = nameSizeRefMatches[0];
        heuristicType = "reference_name_size";
      }

      if (heuristicMatch) {
        const sourceDescriptor = photos.byName.get(heuristicMatch.image_filename);
        const targetFile = `${sku}${sourceDescriptor.extension}`;
        const sourcePath = path.join(photosDir, sourceDescriptor.fileName);
        const targetPath = path.join(photosDir, targetFile);
        let action = `heuristic_${heuristicType}`;
        if (mode === "apply" && sourceDescriptor.fileName !== targetFile) {
          if (!fs.existsSync(targetPath)) {
            fs.copyFileSync(sourcePath, targetPath);
            copyOperations += 1;
          }
          action = `heuristic_copy_${heuristicType}`;
        }

        next.image_filename = targetFile;
        if (currentImage !== targetFile) rowsUpdated += 1;
        if (heuristicType === "reference_name_size_color") heuristicExactMatches += 1;
        if (heuristicType === "reference_name_size") heuristicNameSizeMatches += 1;

        reportRows.push({
          line,
          sku,
          status: "resolved_heuristic",
          image_filename_current: currentImage,
          image_filename_final: targetFile,
          source_file: sourceDescriptor.fileName,
          action,
          details: `Matched from reference catalog row SKU ${heuristicMatch.sku || "(sin sku)"}`,
        });
        outputRows.push(next);
        continue;
      }
    }

    reportRows.push({
      line,
      sku,
      status: "missing_photo",
      image_filename_current: currentImage,
      image_filename_final: currentImage,
      source_file: "",
      action: "none",
      details: "No hay archivo exacto y no existe manual map para este SKU.",
    });
    if (failOnMissing) {
      errors.push(`Linea ${line}: falta foto para SKU ${sku}.`);
    }
    outputRows.push(next);
  }

  writeCsv(outPath, outputHeaders, outputRows);
  writeCsv(
    reportCsvPath,
    ["line", "sku", "status", "image_filename_current", "image_filename_final", "source_file", "action", "details"],
    reportRows
  );

  const summary = {
    generated_at: new Date().toISOString(),
    mode,
    inputs: {
      file: filePath,
      out: outPath,
      photos: photosDir,
      manual_map: manualMapPath,
      reference_catalog: referenceCatalog && fs.existsSync(referenceCatalogPath) ? referenceCatalogPath : null,
      report_base: reportBase,
      fail_on_missing: failOnMissing,
    },
    photos: {
      files_detected: photos.descriptors.length,
    },
    manual_map: {
      rows: manualMapRows.length,
      errors: manualMapErrors.length,
    },
    results: {
      rows_total: rows.length,
      rows_updated: rowsUpdated,
      resolved_exact: exactMatches,
      resolved_manual: manualMatches,
      resolved_heuristic_name_size_color: heuristicExactMatches,
      resolved_heuristic_name_size: heuristicNameSizeMatches,
      copy_operations: copyOperations,
      missing_photo: reportRows.filter((r) => r.status === "missing_photo").length,
      sku_filename_unsafe: reportRows.filter((r) => r.status === "sku_filename_unsafe").length,
      ambiguous_exact_match: reportRows.filter((r) => r.status === "ambiguous_exact_match").length,
      errors: errors.length,
    },
    outputs: {
      catalog_csv: outPath,
      report_csv: reportCsvPath,
      report_json: reportJsonPath,
      manual_map_template_csv: manualMapPath,
    },
    error_messages: errors,
  };
  writeJson(reportJsonPath, summary);

  console.log(`Catalogo procesado: ${filePath}`);
  console.log(`Salida catalogo: ${outPath}`);
  console.log(`Reporte CSV: ${reportCsvPath}`);
  console.log(`Reporte JSON: ${reportJsonPath}`);
  console.log(
    JSON.stringify(
      {
        rows_total: rows.length,
        rows_updated: rowsUpdated,
        resolved_exact: exactMatches,
        resolved_manual: manualMatches,
        resolved_heuristic_name_size_color: heuristicExactMatches,
        resolved_heuristic_name_size: heuristicNameSizeMatches,
        copy_operations: copyOperations,
        missing_photo: summary.results.missing_photo,
        sku_filename_unsafe: summary.results.sku_filename_unsafe,
        errors: errors.length,
      },
      null,
      2
    )
  );

  if (errors.length > 0) process.exit(1);
}

try {
  main();
} catch (error) {
  console.error("Prepare image coverage for new SKUs failed:", error);
  process.exit(1);
}
