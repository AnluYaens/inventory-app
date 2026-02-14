import fs from "node:fs";
import path from "node:path";

const SKU_PATTERN = /^[A-Z0-9]+-[A-Z0-9]+-[A-Z0-9]+$/;

function isPlaceholderReference(value) {
  const normalized = normalizeToken(value);
  if (!normalized) return true;
  if (/^P\d+R\d+$/i.test(normalized)) return true;
  if (/^MISSING/i.test(normalized)) return true;
  if (/^MANUAL/i.test(normalized)) return true;
  return false;
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

function normalizeToken(value) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^A-Za-z0-9]+/g, "")
    .toUpperCase();
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const filePath = path.resolve(args.get("file") ?? "./client-assets/catalog-final.csv");
  const photosDir = path.resolve(args.get("photos") ?? "./client-assets/photos-final");
  const requirePdfReference = args.get("require-pdf-reference") === "true";

  if (!fs.existsSync(filePath)) throw new Error(`No existe archivo: ${filePath}`);
  if (!fs.existsSync(photosDir)) throw new Error(`No existe carpeta fotos: ${photosDir}`);

  const { headers, rows } = parseCsv(filePath);
  const required = [
    "sku",
    "name",
    "category",
    "size",
    "price",
    "initial_stock",
    "image_filename",
    "reference_number",
  ];
  const missingHeaders = required.filter((h) => !headers.includes(h));
  if (missingHeaders.length > 0) {
    throw new Error(`Faltan columnas requeridas: ${missingHeaders.join(", ")}`);
  }

  const photoFiles = new Set(
    fs
      .readdirSync(photosDir)
      .filter((name) => /\.(jpg|jpeg|png|webp|avif)$/i.test(name)),
  );

  const seenSkus = new Set();
  const errors = [];

  for (const item of rows) {
    const { line, row } = item;
    const sku = row.sku;
    const name = row.name;
    const category = row.category;
    const size = row.size;
    const price = row.price;
    const initialStock = row.initial_stock;
    const imageFilename = row.image_filename;
    const reference = row.reference_number;
    const referenceSource = row.reference_source;

    if (!sku) errors.push(`Linea ${line}: sku obligatorio.`);
    if (!name) errors.push(`Linea ${line}: name obligatorio.`);
    if (!category) errors.push(`Linea ${line}: category obligatorio.`);
    if (!size) errors.push(`Linea ${line}: size obligatorio.`);
    if (!reference) errors.push(`Linea ${line}: reference_number obligatorio.`);
    if (reference && isPlaceholderReference(reference)) {
      errors.push(
        `Linea ${line}: reference_number placeholder (${reference}); requiere referencia real.`,
      );
    }

    if (sku && !SKU_PATTERN.test(sku)) {
      errors.push(`Linea ${line}: sku invalido (formato esperado CAT-REF-TALLA).`);
    }

    if (sku && seenSkus.has(sku)) {
      errors.push(`Linea ${line}: sku duplicado (${sku}).`);
    }
    if (sku) seenSkus.add(sku);

    if (sku && reference) {
      const parts = sku.split("-");
      if (parts.length === 3 && normalizeToken(parts[1]) !== normalizeToken(reference)) {
        errors.push(`Linea ${line}: referencia en sku no coincide con reference_number.`);
      }
    }

    if (requirePdfReference) {
      if (!("reference_source" in row)) {
        errors.push(
          `Linea ${line}: falta reference_source para validar referencia exacta desde PDF.`,
        );
      } else if (referenceSource !== "pdf") {
        errors.push(
          `Linea ${line}: reference_source=${referenceSource || "vacio"}; se requiere pdf.`,
        );
      }
    }

    const parsedPrice = Number(price);
    if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
      errors.push(`Linea ${line}: price invalido (${price}).`);
    }

    const parsedStock = Number(initialStock);
    if (!Number.isInteger(parsedStock) || parsedStock < 0) {
      errors.push(`Linea ${line}: initial_stock invalido (${initialStock}).`);
    }

    if (!imageFilename) {
      errors.push(`Linea ${line}: image_filename obligatorio.`);
    } else if (!photoFiles.has(imageFilename)) {
      errors.push(
        `Linea ${line}: image_filename no existe en photos-final (${imageFilename}).`,
      );
    }
  }

  if (errors.length > 0) {
    console.error("VALIDACION FALLIDA:");
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }

  console.log("Validacion OK.");
  console.log(`Archivo: ${filePath}`);
  console.log(`Filas: ${rows.length}`);
  console.log("Formato SKU: CAT-REF-TALLA");
  if (requirePdfReference) {
    console.log("Regla extra: reference_source obligatorio = pdf");
  }
}

main();
