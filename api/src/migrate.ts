import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const migrationsDir = path.resolve(currentDir, "../migrations");

async function ensureMigrationTable() {
  await pool.query(`
    create table if not exists schema_migrations (
      filename text primary key,
      applied_at timestamptz not null default now()
    )
  `);
}

async function appliedMigrationNames() {
  const result = await pool.query<{ filename: string }>(
    "select filename from schema_migrations order by filename",
  );
  return new Set(result.rows.map((row) => row.filename));
}

async function runMigration(filename: string) {
  const sql = await fs.readFile(path.join(migrationsDir, filename), "utf8");
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(sql);
    await client.query("insert into schema_migrations (filename) values ($1)", [filename]);
    await client.query("commit");
    console.log(`Applied ${filename}`);
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    console.error(`Migration failed: ${filename}`);
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  await ensureMigrationTable();
  const applied = await appliedMigrationNames();
  const files = (await fs.readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));

  for (const file of files) {
    if (!applied.has(file)) {
      await runMigration(file);
    }
  }

  console.log("Database migrations are up to date.");
}

main()
  .catch((error) => {
    if ((error as { code?: string }).code === "ECONNREFUSED") {
      console.error(
        [
          "Could not connect to local PostgreSQL.",
          "",
          "The .env file is present, but PostgreSQL is not running or is not listening on DATABASE_URL.",
          "For the bundled local setup, open Docker Desktop and run:",
          "",
          "  npm.cmd run db:start",
          "  npm.cmd run db:migrate",
          "",
          "Current default DATABASE_URL:",
          "  postgresql://postgres:postgres@localhost:5432/footwear_production_hub",
        ].join("\n"),
      );
    } else {
      console.error(error);
    }
    process.exitCode = 1;
  })
  .finally(() => {
    void pool.end();
  });
