import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif"]);

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

function inferContentType(fileName) {
  const extension = path.extname(fileName).toLowerCase();
  switch (extension) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".avif":
      return "image/avif";
    default:
      return "application/octet-stream";
  }
}

function ensureEnv() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) {
    throw new Error(
      "Faltan variables SUPABASE_URL/VITE_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY."
    );
  }
  return createClient(url, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function main() {
  loadDotEnv();

  const args = parseArgs(process.argv.slice(2));
  const dir = args.get("dir");
  const bucket = args.get("bucket") ?? "product-images";
  const prefix = args.get("prefix") ?? "";
  const output = args.get("output") ?? "images-manifest.json";
  const upsert = args.get("upsert") === "true";

  if (!dir) {
    throw new Error(
      "Uso: npm run upload:images -- --dir <carpeta> [--bucket product-images] [--prefix temporada] [--output images-manifest.json] [--upsert true]"
    );
  }

  const fullDir = path.resolve(dir);
  if (!fs.existsSync(fullDir)) {
    throw new Error(`No existe la carpeta: ${fullDir}`);
  }

  const files = fs
    .readdirSync(fullDir)
    .filter((file) => IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase()));

  if (files.length === 0) {
    throw new Error("No se encontraron imagenes compatibles en la carpeta.");
  }

  const supabase = ensureEnv();
  const manifest = {
    bucket,
    generated_at: new Date().toISOString(),
    files: {},
  };

  for (const fileName of files) {
    const localPath = path.join(fullDir, fileName);
    const storagePath = prefix ? `${prefix}/${fileName}` : fileName;
    const content = fs.readFileSync(localPath);

    const { error } = await supabase.storage.from(bucket).upload(storagePath, content, {
      contentType: inferContentType(fileName),
      upsert,
    });

    if (error && !error.message.toLowerCase().includes("already exists")) {
      throw new Error(`Error subiendo ${fileName}: ${error.message}`);
    }

    const { data } = supabase.storage.from(bucket).getPublicUrl(storagePath);
    manifest.files[fileName] = data.publicUrl;
    console.log(`OK: ${fileName} -> ${data.publicUrl}`);
  }

  fs.writeFileSync(path.resolve(output), JSON.stringify(manifest, null, 2), "utf8");
  console.log(`Manifest generado: ${path.resolve(output)}`);
}

main().catch((error) => {
  console.error("Upload fallido:", error);
  process.exit(1);
});
