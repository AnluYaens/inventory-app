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

function toInt(value, label, fallback) {
  if (value == null) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} debe ser entero >= 0.`);
  }
  return parsed;
}

function listDirsSortedByMtime(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  return fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const fullPath = path.join(dirPath, entry.name);
      const stat = fs.statSync(fullPath);
      return {
        name: entry.name,
        fullPath,
        mtimeMs: stat.mtimeMs,
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function listFilesByPatternSorted(pattern) {
  return fs
    .readdirSync(process.cwd(), { withFileTypes: true })
    .filter((entry) => entry.isFile() && pattern.test(entry.name))
    .map((entry) => {
      const fullPath = path.resolve(entry.name);
      const stat = fs.statSync(fullPath);
      return {
        name: entry.name,
        fullPath,
        mtimeMs: stat.mtimeMs,
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function listRootArtifactFiles(artifactsDir) {
  if (!fs.existsSync(artifactsDir)) return [];
  return fs
    .readdirSync(artifactsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(artifactsDir, entry.name));
}

function removePath(targetPath, mode) {
  if (mode === "dry-run") return;
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function splitKeepDelete(items, keepCount) {
  return {
    keep: items.slice(0, keepCount),
    drop: items.slice(keepCount),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = (args.get("mode") ?? "dry-run").toLowerCase();
  if (!["dry-run", "apply"].includes(mode)) {
    throw new Error("--mode debe ser dry-run o apply.");
  }

  const keepLatestBackups = toInt(
    args.get("keep-latest-backups"),
    "--keep-latest-backups",
    1,
  );
  const keepLatestLiveReset = toInt(
    args.get("keep-latest-live-reset"),
    "--keep-latest-live-reset",
    1,
  );
  const keepLatestImportReports = toInt(
    args.get("keep-latest-import-reports"),
    "--keep-latest-import-reports",
    1,
  );

  const artifactsDir = path.resolve("./artifacts");
  const backupsDir = path.resolve("./artifacts/backups");
  const liveResetDir = path.resolve("./artifacts/live-reset");

  const backups = listDirsSortedByMtime(backupsDir);
  const liveResets = listDirsSortedByMtime(liveResetDir);
  const importReports = listFilesByPatternSorted(/^import-report-\d+\.json$/i);
  const rootArtifactFiles = listRootArtifactFiles(artifactsDir);

  const backupPlan = splitKeepDelete(backups, keepLatestBackups);
  const liveResetPlan = splitKeepDelete(liveResets, keepLatestLiveReset);
  const importPlan = splitKeepDelete(importReports, keepLatestImportReports);

  for (const item of backupPlan.drop) removePath(item.fullPath, mode);
  for (const item of liveResetPlan.drop) removePath(item.fullPath, mode);
  for (const item of importPlan.drop) removePath(item.fullPath, mode);
  for (const filePath of rootArtifactFiles) removePath(filePath, mode);

  const report = {
    mode,
    generated_at: new Date().toISOString(),
    keep: {
      backups: backupPlan.keep.map((item) => item.fullPath),
      live_reset: liveResetPlan.keep.map((item) => item.fullPath),
      import_reports: importPlan.keep.map((item) => item.fullPath),
    },
    delete: {
      backups: backupPlan.drop.map((item) => item.fullPath),
      live_reset: liveResetPlan.drop.map((item) => item.fullPath),
      import_reports: importPlan.drop.map((item) => item.fullPath),
      root_artifact_files: rootArtifactFiles,
    },
    counts: {
      backups_kept: backupPlan.keep.length,
      backups_deleted: backupPlan.drop.length,
      live_reset_kept: liveResetPlan.keep.length,
      live_reset_deleted: liveResetPlan.drop.length,
      import_reports_kept: importPlan.keep.length,
      import_reports_deleted: importPlan.drop.length,
      root_artifact_files_deleted: rootArtifactFiles.length,
    },
  };

  const reportPath = path.resolve("./artifacts/prune-artifacts-report.json");
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");

  console.log("Prune de artifacts completado.");
  console.log(`Modo: ${mode}`);
  console.log(`Reporte: ${reportPath}`);
  console.log(JSON.stringify(report.counts, null, 2));
}

main();
