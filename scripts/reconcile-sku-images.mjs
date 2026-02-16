import fs from "node:fs";
import path from "node:path";

const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".avif",
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

function parseImageDescriptor(fileName) {
  const extension = path.extname(fileName ?? "").toLowerCase();
  if (!SUPPORTED_IMAGE_EXTENSIONS.has(extension)) return null;
  const baseName = path.basename(fileName, extension);
  if (!baseName) return null;
  return {
    fileName,
    extension,
    baseUpper: baseName.toUpperCase(),
  };
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const filePath = path.resolve(args.get("file") ?? "./client-assets/catalog-final.csv");
  const photosDir = path.resolve(args.get("photos") ?? "./client-assets/photos-sku");
  const outPath = path.resolve(args.get("out") ?? filePath);
  const reportBase = path.resolve(
    args.get("report-base") ?? "./artifacts/sku-image-reconcile-report",
  );
  const reportCsvPath = `${reportBase}.csv`;
  const reportJsonPath = `${reportBase}.json`;

  if (!fs.existsSync(filePath)) throw new Error(`No existe archivo: ${filePath}`);
  if (!fs.existsSync(photosDir)) throw new Error(`No existe carpeta fotos: ${photosDir}`);

  const { headers, rows } = parseCsv(filePath);
  if (!headers.includes("sku")) {
    throw new Error("Falta columna requerida: sku");
  }
  if (!headers.includes("image_filename")) {
    headers.push("image_filename");
  }

  const photos = fs
    .readdirSync(photosDir)
    .map((name) => parseImageDescriptor(name))
    .filter(Boolean);
  if (photos.length === 0) {
    throw new Error("No se encontraron fotos compatibles en la carpeta.");
  }

  const photosBySku = new Map();
  for (const photo of photos) {
    if (!photosBySku.has(photo.baseUpper)) photosBySku.set(photo.baseUpper, []);
    photosBySku.get(photo.baseUpper).push(photo.fileName);
  }
  for (const fileList of photosBySku.values()) {
    fileList.sort((a, b) => a.localeCompare(b));
  }

  const reportRows = [];
  const outputRows = [];
  const errors = [];
  let updatedRows = 0;

  for (const { line, row } of rows) {
    const sku = (row.sku ?? "").trim();
    if (!sku) {
      reportRows.push({
        line,
        sku: "",
        status: "missing_sku",
        image_filename_current: row.image_filename ?? "",
        image_filename_suggested: "",
        details: "SKU vacio.",
      });
      errors.push(`Linea ${line}: sku obligatorio.`);
      outputRows.push(row);
      continue;
    }

    const skuKey = sku.toUpperCase();
    const matches = photosBySku.get(skuKey) ?? [];
    if (matches.length === 0) {
      reportRows.push({
        line,
        sku,
        status: "missing_photo",
        image_filename_current: row.image_filename ?? "",
        image_filename_suggested: "",
        details: "No existe archivo exact-SKU.",
      });
      errors.push(`Linea ${line}: no existe foto exact-SKU para (${sku}).`);
      outputRows.push(row);
      continue;
    }

    if (matches.length > 1) {
      reportRows.push({
        line,
        sku,
        status: "ambiguous_photo",
        image_filename_current: row.image_filename ?? "",
        image_filename_suggested: "",
        details: `Multiples archivos: ${matches.join(" | ")}`,
      });
      errors.push(
        `Linea ${line}: multiples fotos exact-SKU para (${sku}): ${matches.join(" | ")}.`,
      );
      outputRows.push(row);
      continue;
    }

    const resolvedFile = matches[0];
    const next = { ...row, image_filename: resolvedFile };
    if ((row.image_filename ?? "") !== resolvedFile) {
      updatedRows += 1;
    }
    outputRows.push(next);
    reportRows.push({
      line,
      sku,
      status: "resolved",
      image_filename_current: row.image_filename ?? "",
      image_filename_suggested: resolvedFile,
      details: "OK",
    });
  }

  writeCsv(
    reportCsvPath,
    [
      "line",
      "sku",
      "status",
      "image_filename_current",
      "image_filename_suggested",
      "details",
    ],
    reportRows,
  );
  writeJson(reportJsonPath, {
    generated_at: new Date().toISOString(),
    file: filePath,
    photos_dir: photosDir,
    output_file: outPath,
    rows_total: rows.length,
    rows_updated: updatedRows,
    errors_count: errors.length,
    errors,
  });

  if (errors.length > 0) {
    console.error("RECONCILIACION FALLIDA:");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    console.error(`Reporte CSV: ${reportCsvPath}`);
    console.error(`Reporte JSON: ${reportJsonPath}`);
    process.exit(1);
  }

  writeCsv(outPath, headers, outputRows);
  console.log("Reconciliacion SKU-imagen OK.");
  console.log(`Archivo actualizado: ${outPath}`);
  console.log(`Filas actualizadas: ${updatedRows}`);
  console.log(`Reporte CSV: ${reportCsvPath}`);
  console.log(`Reporte JSON: ${reportJsonPath}`);
}

main();
