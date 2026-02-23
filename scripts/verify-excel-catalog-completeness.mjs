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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function toInt(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} invalido: ${value}`);
  }
  return parsed;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const xlsxProfilePath = path.resolve(
    args.get("xlsx-profile") ?? "./artifacts/xlsx-reset/profile.json",
  );
  const postResetVerifyPath = path.resolve(
    args.get("post-reset-verify") ??
      "./artifacts/live-reset/latest/post-reset-verify.json",
  );

  if (!fs.existsSync(xlsxProfilePath)) {
    throw new Error(`No existe xlsx-profile: ${xlsxProfilePath}`);
  }
  if (!fs.existsSync(postResetVerifyPath)) {
    throw new Error(`No existe post-reset-verify: ${postResetVerifyPath}`);
  }

  const xlsxProfile = readJson(xlsxProfilePath);
  const postResetVerify = readJson(postResetVerifyPath);

  const excelGroupedVariants = toInt(
    xlsxProfile?.grouping?.grouped_variants,
    "grouping.grouped_variants",
  );
  const csvUniqueSkus = toInt(
    postResetVerify?.summary?.csv_unique_skus,
    "summary.csv_unique_skus",
  );
  const dbProducts = toInt(postResetVerify?.summary?.db_products, "summary.db_products");
  const dbNotCsv = toInt(postResetVerify?.summary?.db_not_csv ?? 0, "summary.db_not_csv");
  const csvNotDb = toInt(postResetVerify?.summary?.csv_not_db ?? 0, "summary.csv_not_db");
  const verifyPassed = postResetVerify?.summary?.passed === true;

  const errors = [];
  if (excelGroupedVariants !== csvUniqueSkus) {
    errors.push(
      `Excel grouped_variants (${excelGroupedVariants}) != CSV unique SKUs (${csvUniqueSkus})`,
    );
  }
  if (csvUniqueSkus !== dbProducts) {
    errors.push(`CSV unique SKUs (${csvUniqueSkus}) != DB products (${dbProducts})`);
  }
  if (dbNotCsv !== 0) {
    errors.push(`DB contiene ${dbNotCsv} SKUs que no estan en CSV.`);
  }
  if (csvNotDb !== 0) {
    errors.push(`CSV contiene ${csvNotDb} SKUs que no estan en DB.`);
  }
  if (!verifyPassed) {
    errors.push("post-reset-verify.summary.passed=false");
  }

  const summary = {
    generated_at: new Date().toISOString(),
    inputs: {
      xlsx_profile: xlsxProfilePath,
      post_reset_verify: postResetVerifyPath,
    },
    counts: {
      excel_grouped_variants: excelGroupedVariants,
      csv_unique_skus: csvUniqueSkus,
      db_products: dbProducts,
      db_not_csv: dbNotCsv,
      csv_not_db: csvNotDb,
    },
    passed: errors.length === 0,
    errors,
  };

  console.log("Verificacion de completitud Excel -> CSV -> DB");
  console.log(JSON.stringify(summary, null, 2));

  if (errors.length > 0) {
    process.exit(1);
  }
}

try {
  main();
} catch (error) {
  console.error("Verificacion de completitud fallida:", error);
  process.exit(1);
}

