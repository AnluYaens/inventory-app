import fs from "node:fs";
import path from "node:path";
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

async function main() {
  loadDotEnv();
  const args = parseArgs(process.argv.slice(2));
  const outputPath = path.resolve(
    args.get("output") ?? "./artifacts/roles-check-report.json",
  );

  const supabase = buildSupabaseAdminClient();

  const { data: roles, error } = await supabase
    .from("user_roles")
    .select("user_id, role");
  if (error) throw error;

  const admins = (roles ?? []).filter((row) => row.role === "admin");
  const staff = (roles ?? []).filter((row) => row.role === "staff");

  const report = {
    generated_at: new Date().toISOString(),
    totals: {
      role_rows: roles?.length ?? 0,
      admin_rows: admins.length,
      staff_rows: staff.length,
      unique_users: new Set((roles ?? []).map((row) => row.user_id)).size,
    },
    checks: {
      has_at_least_one_admin: admins.length > 0,
    },
    admin_user_ids: admins.map((row) => row.user_id),
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), "utf8");

  if (!report.checks.has_at_least_one_admin) {
    console.error("No hay usuarios admin. Bloqueante para handoff.");
    console.error(`Reporte: ${outputPath}`);
    process.exit(1);
  }

  console.log("Revision de roles completada.");
  console.log(`Reporte: ${outputPath}`);
  console.log(`Admins: ${admins.length}`);
  console.log(`Staff: ${staff.length}`);
}

main().catch((error) => {
  console.error("Revision de roles fallida:", error);
  process.exit(1);
});
