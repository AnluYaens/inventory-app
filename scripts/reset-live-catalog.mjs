import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

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

function parseImageMode(value) {
  const mode = (value ?? "photos").trim().toLowerCase();
  if (!["photos", "icons"].includes(mode)) {
    throw new Error("--image-mode debe ser photos o icons.");
  }
  return mode;
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
      if (!(key in process.env)) process.env[key] = value;
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

function csvEscape(value) {
  const raw = value == null ? "" : String(value);
  if (raw.includes(",") || raw.includes('"') || raw.includes("\n")) {
    return `"${raw.replaceAll('"', '""')}"`;
  }
  return raw;
}

function writeCsv(filePath, rows, preferredHeaders = []) {
  const headers = preferredHeaders.length
    ? preferredHeaders
    : rows.length > 0
      ? Object.keys(rows[0])
      : [];
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape(row[header] ?? "")).join(","));
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, lines.join("\n"), "utf8");
}

function nowStamp() {
  return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function runNodeScript(scriptPath, args, logPath) {
  const fullScriptPath = path.resolve(scriptPath);
  const result = spawnSync(process.execPath, [fullScriptPath, ...args], {
    encoding: "utf8",
    stdio: "pipe",
  });

  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const combined = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");

  if (logPath) {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.writeFileSync(logPath, `${combined}\n`, "utf8");
  }

  if (stdout.trim()) console.log(stdout.trim());
  if (stderr.trim()) console.error(stderr.trim());

  if (result.error) {
    throw new Error(
      `No se pudo ejecutar ${path.basename(scriptPath)}: ${result.error.message}`,
    );
  }

  if (result.status !== 0) {
    throw new Error(
      `Fallo ${path.basename(scriptPath)} (exit ${result.status ?? "unknown"}).`,
    );
  }

  return { stdout, stderr };
}

async function fetchAllRows(supabase, table, columns, orderColumn = "id") {
  const output = [];
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .order(orderColumn, { ascending: true })
      .range(from, to);
    if (error) throw error;
    const rows = data ?? [];
    output.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return output;
}

async function countRows(supabase, table, column = "id") {
  const { count, error } = await supabase
    .from(table)
    .select(column, { head: true, count: "exact" });
  if (error) throw error;
  return count ?? 0;
}

async function listStorageFiles(supabase, bucket) {
  const queue = [""];
  const files = [];
  while (queue.length > 0) {
    const currentPrefix = queue.shift();
    let offset = 0;
    while (true) {
      const { data, error } = await supabase.storage.from(bucket).list(currentPrefix, {
        limit: 100,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
      if (error) throw error;
      const rows = data ?? [];
      if (rows.length === 0) break;

      for (const item of rows) {
        const isFolder = !item.metadata;
        const itemPath = currentPrefix ? `${currentPrefix}/${item.name}` : item.name;
        if (isFolder) queue.push(itemPath);
        else files.push(itemPath);
      }

      if (rows.length < 100) break;
      offset += 100;
    }
  }
  return files;
}

function ensureValidMode(mode) {
  if (!["dry-run", "apply"].includes(mode)) {
    throw new Error("--mode debe ser dry-run o apply.");
  }
}

async function main() {
  loadDotEnv();
  const args = parseArgs(process.argv.slice(2));
  const mode = (args.get("mode") ?? "dry-run").toLowerCase();
  const imageMode = parseImageMode(args.get("image-mode"));
  const catalogFile = path.resolve(args.get("file") ?? "./client-assets/catalog-final.csv");
  const photosDir = path.resolve(args.get("photos") ?? "./client-assets/photos-sku");
  const imagesManifestPath = path.resolve(args.get("images-manifest") ?? "./images-manifest.json");
  const backupDirBase = path.resolve(args.get("backup-dir") ?? "./artifacts/backups");
  const bucket = args.get("bucket") ?? "product-images";
  const confirmReset = args.get("confirm-reset") ?? "false";

  ensureValidMode(mode);
  if (mode === "apply" && confirmReset !== "true") {
    throw new Error("Para apply se requiere --confirm-reset true.");
  }

  if (!fs.existsSync(catalogFile)) throw new Error(`No existe archivo: ${catalogFile}`);
  if (imageMode === "photos" && !fs.existsSync(photosDir)) {
    throw new Error(`No existe carpeta fotos: ${photosDir}`);
  }

  const stamp = nowStamp();
  const runDir = path.resolve(`./artifacts/live-reset/${stamp}`);
  const backupDir = path.join(backupDirBase, stamp);
  const preflightDir = path.join(runDir, "preflight");
  const applyDir = path.join(runDir, "apply");
  const reportPath = path.join(runDir, "reset-report.json");
  const reconciledFile = path.join(preflightDir, "catalog-reconciled.csv");
  const reconcileReportBase = path.join(preflightDir, "reconcile-report");
  const reconcileLog = path.join(preflightDir, "reconcile.log");
  const validateLog = path.join(preflightDir, "validate.log");
  const importDryRunLog = path.join(preflightDir, "import-dry-run.log");
  const syntheticManifestPath = path.join(preflightDir, "manifest-preflight.json");
  const uploadLog = path.join(applyDir, "upload-images.log");
  const importApplyLog = path.join(applyDir, "import-apply.log");
  const verifyLog = path.join(runDir, "verify.log");
  const verifyOutput = path.join(runDir, "post-reset-verify.json");

  fs.mkdirSync(preflightDir, { recursive: true });
  fs.mkdirSync(applyDir, { recursive: true });

  const summary = {
    mode,
    generated_at: new Date().toISOString(),
    inputs: {
      image_mode: imageMode,
      file: catalogFile,
      photos: imageMode === "photos" ? photosDir : null,
      images_manifest: imageMode === "photos" ? imagesManifestPath : null,
      backup_dir: backupDir,
      bucket,
      confirm_reset: confirmReset,
    },
    preflight: {},
    backup: {},
    storage: {},
    reset: {},
    import: {},
    verification: {},
  };

  const supabase = buildSupabaseAdminClient();

  console.log(
    imageMode === "photos"
      ? "Step 1/7: Preflight reconcile + validate + import dry-run"
      : "Step 1/7: Preflight validate + import dry-run (icons; sin fotos)",
  );

  let preflightFileToUse = catalogFile;
  let preflightManifestToUse = null;

  if (imageMode === "photos") {
    runNodeScript(
      "./scripts/reconcile-sku-images.mjs",
      [
        "--file",
        catalogFile,
        "--photos",
        photosDir,
        "--out",
        reconciledFile,
        "--report-base",
        reconcileReportBase,
      ],
      reconcileLog,
    );
    preflightFileToUse = reconciledFile;
  }

  const validateArgs = ["--file", preflightFileToUse, "--image-mode", imageMode];
  if (imageMode === "photos") {
    validateArgs.push("--photos", photosDir);
  }
  runNodeScript("./scripts/validate-catalog-final.mjs", validateArgs, validateLog);

  const importDryRunArgs = [
    "--file",
    preflightFileToUse,
    "--mode",
    "dry-run",
    "--image-mode",
    imageMode,
  ];

  if (imageMode === "photos") {
    preflightManifestToUse = imagesManifestPath;
    if (!fs.existsSync(imagesManifestPath)) {
      const fakeManifest = {};
      const raw = fs.readFileSync(preflightFileToUse, "utf8");
      const lines = raw.split(/\r?\n/g).filter((line) => line.trim() !== "");
      const headers = lines[0].split(",").map((h) => h.trim());
      const idx = headers.indexOf("image_filename");
      for (let i = 1; i < lines.length; i += 1) {
        const values = lines[i].split(",");
        const fileName = (values[idx] ?? "").trim();
        if (!fileName) continue;
        fakeManifest[fileName] = `https://preflight.local/${encodeURIComponent(fileName)}`;
      }
      fs.writeFileSync(
        syntheticManifestPath,
        JSON.stringify({ generated_at: new Date().toISOString(), files: fakeManifest }, null, 2),
        "utf8",
      );
      preflightManifestToUse = syntheticManifestPath;
    }
    importDryRunArgs.push("--images-manifest", preflightManifestToUse);
  }

  runNodeScript("./scripts/import-catalog.mjs", importDryRunArgs, importDryRunLog);

  summary.preflight = {
    image_mode: imageMode,
    source_file: catalogFile,
    reconciled_file: imageMode === "photos" ? reconciledFile : null,
    preflight_file_used: preflightFileToUse,
    reconcile_report_csv: imageMode === "photos" ? `${reconcileReportBase}.csv` : null,
    reconcile_report_json: imageMode === "photos" ? `${reconcileReportBase}.json` : null,
    reconcile_log: imageMode === "photos" ? reconcileLog : null,
    validate_log: validateLog,
    import_dry_run_log: importDryRunLog,
    manifest_used: preflightManifestToUse,
    skipped_steps:
      imageMode === "icons" ? ["reconcile-sku-images", "images-manifest preflight"] : [],
  };

  console.log("Step 2/7: Backup completo de tablas live");
  const productsRows = await fetchAllRows(
    supabase,
    "products",
    "id, name, sku, category, size, color, price, cost, image_url, created_at, updated_at",
    "sku",
  );
  const stockRows = await fetchAllRows(
    supabase,
    "stock_snapshots",
    "product_id, stock, updated_at",
    "product_id",
  );
  const eventRows = await fetchAllRows(
    supabase,
    "inventory_events",
    "id, product_id, type, qty_change, status, note, device_id, local_event_id, user_id, created_at",
    "created_at",
  );

  fs.mkdirSync(backupDir, { recursive: true });
  const backupProductsJson = path.join(backupDir, "products.json");
  const backupProductsCsv = path.join(backupDir, "products.csv");
  const backupStockJson = path.join(backupDir, "stock_snapshots.json");
  const backupStockCsv = path.join(backupDir, "stock_snapshots.csv");
  const backupEventsJson = path.join(backupDir, "inventory_events.json");
  const backupEventsCsv = path.join(backupDir, "inventory_events.csv");
  const backupSummaryPath = path.join(backupDir, "backup-summary.json");

  fs.writeFileSync(backupProductsJson, JSON.stringify(productsRows, null, 2), "utf8");
  writeCsv(backupProductsCsv, productsRows);
  fs.writeFileSync(backupStockJson, JSON.stringify(stockRows, null, 2), "utf8");
  writeCsv(backupStockCsv, stockRows);
  fs.writeFileSync(backupEventsJson, JSON.stringify(eventRows, null, 2), "utf8");
  writeCsv(backupEventsCsv, eventRows);

  const backupSummary = {
    generated_at: new Date().toISOString(),
    products_count: productsRows.length,
    stock_snapshots_count: stockRows.length,
    inventory_events_count: eventRows.length,
  };
  fs.writeFileSync(backupSummaryPath, JSON.stringify(backupSummary, null, 2), "utf8");
  summary.backup = {
    dir: backupDir,
    products_json: backupProductsJson,
    products_csv: backupProductsCsv,
    stock_snapshots_json: backupStockJson,
    stock_snapshots_csv: backupStockCsv,
    inventory_events_json: backupEventsJson,
    inventory_events_csv: backupEventsCsv,
    summary_json: backupSummaryPath,
    counts: backupSummary,
  };

  console.log("Step 3/7: Evaluar/limpiar bucket de imagenes");
  const storageFiles = await listStorageFiles(supabase, bucket);
  summary.storage = {
    files_in_bucket_before: storageFiles.length,
    sample_before: storageFiles.slice(0, 30),
    removed_files: 0,
  };

  if (mode === "apply" && storageFiles.length > 0) {
    for (const batch of chunk(storageFiles, 100)) {
      const { error } = await supabase.storage.from(bucket).remove(batch);
      if (error) throw error;
      summary.storage.removed_files += batch.length;
    }
  }

  console.log("Step 4/7: Reset de datos legacy");
  const productsBefore = await countRows(supabase, "products", "id");
  const stockBefore = await countRows(supabase, "stock_snapshots", "product_id");
  const eventsBefore = await countRows(supabase, "inventory_events", "id");

  summary.reset = {
    counts_before: {
      products: productsBefore,
      stock_snapshots: stockBefore,
      inventory_events: eventsBefore,
    },
    counts_after_delete: null,
  };

  if (mode === "apply") {
    const { error: deleteEventsError } = await supabase
      .from("inventory_events")
      .delete()
      .not("id", "is", null);
    if (deleteEventsError) throw deleteEventsError;

    const { error: deleteProductsError } = await supabase
      .from("products")
      .delete()
      .not("id", "is", null);
    if (deleteProductsError) throw deleteProductsError;
  }

  const productsAfterDelete = await countRows(supabase, "products", "id");
  const stockAfterDelete = await countRows(supabase, "stock_snapshots", "product_id");
  const eventsAfterDelete = await countRows(supabase, "inventory_events", "id");
  summary.reset.counts_after_delete = {
    products: productsAfterDelete,
    stock_snapshots: stockAfterDelete,
    inventory_events: eventsAfterDelete,
  };

  console.log("Step 5/7: Carga limpia (upload + import apply)");
  let manifestInUse =
    imageMode === "photos" && fs.existsSync(imagesManifestPath) ? imagesManifestPath : null;
  let importReportPath = null;
  if (mode === "apply") {
    if (imageMode === "photos") {
      runNodeScript(
        "./scripts/upload-product-images.mjs",
        [
          "--dir",
          photosDir,
          "--bucket",
          bucket,
          "--output",
          imagesManifestPath,
          "--upsert",
          "true",
        ],
        uploadLog,
      );
      manifestInUse = imagesManifestPath;
    }

    const importApplyArgs = [
      "--file",
      preflightFileToUse,
      "--mode",
      "apply",
      "--image-mode",
      imageMode,
    ];
    if (imageMode === "photos") {
      importApplyArgs.push("--images-manifest", imagesManifestPath);
    }

    const importApplyResult = runNodeScript(
      "./scripts/import-catalog.mjs",
      importApplyArgs,
      importApplyLog,
    );

    const combined = `${importApplyResult.stdout}\n${importApplyResult.stderr}`;
    const match = combined.match(/Reporte:\s*(.+)/i);
    if (match) importReportPath = path.resolve(match[1].trim());
  }

  summary.import = {
    image_mode: imageMode,
    source_file_used: preflightFileToUse,
    manifest_path: manifestInUse,
    upload_log: mode === "apply" && imageMode === "photos" ? uploadLog : null,
    import_apply_log: mode === "apply" ? importApplyLog : null,
    import_report: importReportPath,
    skipped_steps:
      imageMode === "icons" ? ["upload-product-images"] : [],
  };

  console.log("Step 6/7: Verificacion post-reset");
  if (mode === "apply") {
    const verifyArgs = [
      "--file",
      preflightFileToUse,
      "--image-mode",
      imageMode,
      "--expect-events",
      "0",
      "--output",
      verifyOutput,
    ];
    if (imageMode === "photos") {
      verifyArgs.push("--photos", photosDir, "--images-manifest", imagesManifestPath);
    }
    runNodeScript("./scripts/live-verify-alignment.mjs", verifyArgs, verifyLog);
    summary.verification = { report: verifyOutput, passed: true, log: verifyLog };
  } else {
    summary.verification = {
      report: null,
      passed: false,
      reason: "No aplica en dry-run.",
    };
  }

  console.log("Step 7/7: Guardar reporte consolidado");
  fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2), "utf8");
  console.log(`Reporte consolidado: ${reportPath}`);
  if (mode === "dry-run") {
    console.log("Dry-run completo. No se aplicaron cambios en DB ni Storage.");
  } else {
    console.log("Apply completo. Catalogo live reseteado y verificado.");
  }
}

main().catch((error) => {
  console.error("Reset live catalog fallido:", error);
  process.exit(1);
});
