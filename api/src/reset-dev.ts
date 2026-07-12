import "dotenv/config";
import { promises as fs } from "node:fs";
import path from "node:path";
import pg from "pg";

const CONFIRMATION = "DELETE_LOCAL_TEST_DATA";
const protectedTables = new Set(["users", "profiles", "roles", "schema_migrations"]);
const projectRoot = process.cwd();

function isDryRun() {
  return process.argv.includes("--dry-run");
}

function requireSafety(dryRun: boolean) {
  const production = process.env.NODE_ENV === "production";
  const allowed = process.env.ALLOW_DESTRUCTIVE_ADMIN_ACTIONS === "true";
  if (production && !allowed) {
    throw new Error(
      "Refusing to reset data while NODE_ENV=production. Set ALLOW_DESTRUCTIVE_ADMIN_ACTIONS=true only for a safe local development reset.",
    );
  }

  if (!dryRun && process.env.CONFIRM_RESET_DEV !== CONFIRMATION) {
    throw new Error(`Set CONFIRM_RESET_DEV=${CONFIRMATION} to run.`);
  }

  if (!process.env.DATABASE_URL) {
    throw new Error("Missing DATABASE_URL. Set it to the local PostgreSQL database first.");
  }
}

function quoteIdent(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function resolveInsideProject(configuredPath: string) {
  const resolved = path.resolve(projectRoot, configuredPath);
  const relative = path.relative(projectRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(
      `Refusing to clear ${resolved}. Runtime reset folders must be inside the project directory.`,
    );
  }
  return resolved;
}

async function listPublicTables(client: pg.PoolClient) {
  const result = await client.query<{ table_name: string }>(`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_type = 'BASE TABLE'
    order by table_name
  `);
  return result.rows.map((row) => row.table_name);
}

async function countRows(client: pg.PoolClient, tables: string[]) {
  const counts: Record<string, number> = {};
  for (const table of tables) {
    const result = await client.query<{ count: string }>(
      `select count(*)::text as count from public.${quoteIdent(table)}`,
    );
    counts[table] = Number(result.rows[0]?.count ?? 0);
  }
  return counts;
}

async function clearDirectoryContents(folder: string, dryRun: boolean) {
  let entries: string[] = [];
  try {
    entries = await fs.readdir(folder);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      if (!dryRun) await fs.mkdir(folder, { recursive: true });
      return { folder, existed: false, removed: 0 };
    }
    throw error;
  }

  if (!dryRun) {
    await Promise.all(
      entries.map((entry) => fs.rm(path.join(folder, entry), { recursive: true, force: true })),
    );
    await fs.mkdir(folder, { recursive: true });
  }

  return { folder, existed: true, removed: entries.length };
}

async function main() {
  const dryRun = isDryRun();
  requireSafety(dryRun);
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("Missing DATABASE_URL. Set it to the local PostgreSQL database first.");
  }

  const uploadsRoot = resolveInsideProject(process.env.UPLOADS_DIR ?? "uploads");
  const serverFilesRoot = resolveInsideProject(process.env.SERVER_FILES_DIR ?? "server-files");
  const foldersToClear = [
    path.join(uploadsRoot, "po-images"),
    path.join(serverFilesRoot, "material-pos"),
    path.join(serverFilesRoot, "reports"),
    path.join(serverFilesRoot, "production-reports"),
    path.join(serverFilesRoot, "downloads"),
    path.join(serverFilesRoot, "generated-reports"),
  ];

  const pool = new pg.Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  let transactionOpen = false;

  try {
    const allTables = await listPublicTables(client);
    const businessTables = allTables.filter((table) => !protectedTables.has(table));
    const preservedTables = allTables.filter((table) => protectedTables.has(table));
    const beforeCounts = await countRows(client, allTables);

    console.log(dryRun ? "Development reset dry run" : "Development reset");
    console.log(`Preserving tables: ${preservedTables.join(", ") || "(none found)"}`);
    console.log(`Clearing tables: ${businessTables.join(", ") || "(none found)"}`);

    if (dryRun) {
      console.log("Rows that would be cleared:");
      for (const table of businessTables) {
        console.log(`- ${table}: ${beforeCounts[table] ?? 0}`);
      }
      console.log("Folders that would be cleared:");
      for (const folder of foldersToClear) {
        console.log(`- ${folder}`);
      }
      return;
    }

    await client.query("begin");
    transactionOpen = true;
    if (businessTables.length) {
      const tableList = businessTables.map((table) => `public.${quoteIdent(table)}`).join(", ");
      await client.query(`truncate table ${tableList} restart identity cascade`);
    }
    await client.query("commit");
    transactionOpen = false;

    const folderResults = [];
    for (const folder of foldersToClear) {
      folderResults.push(await clearDirectoryContents(folder, dryRun));
    }

    const afterCounts = await countRows(client, allTables);
    console.log("Rows cleared:");
    for (const table of businessTables) {
      console.log(`- ${table}: ${beforeCounts[table] ?? 0} -> ${afterCounts[table] ?? 0}`);
    }
    console.log("Rows preserved:");
    for (const table of preservedTables) {
      console.log(`- ${table}: ${beforeCounts[table] ?? 0} -> ${afterCounts[table] ?? 0}`);
    }
    console.log("Folders cleared:");
    for (const result of folderResults) {
      console.log(
        `- ${result.folder}: ${result.existed ? `${result.removed} item(s) removed` : "created empty folder"}`,
      );
    }
    console.log("Local development business data reset complete.");
  } catch (error) {
    if (transactionOpen) {
      await client.query("rollback").catch(() => undefined);
    }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error((error as Error).message);
  process.exitCode = 1;
});
