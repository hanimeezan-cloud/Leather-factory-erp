import { runRetention } from "./admin-data.js";
import { query, pool } from "./db.js";
import { env } from "./env.js";

async function main() {
  const archiveOlderThanYears = Number(process.env.RETENTION_ARCHIVE_OLDER_THAN_YEARS ?? 2);
  const deleteArchivedOlderThanYears = process.env.RETENTION_DELETE_ARCHIVED_OLDER_THAN_YEARS
    ? Number(process.env.RETENTION_DELETE_ARCHIVED_OLDER_THAN_YEARS)
    : undefined;

  const result = await runRetention(
    { query },
    null,
    archiveOlderThanYears,
    deleteArchivedOlderThanYears,
    env.allowDestructiveAdminActions,
  );

  console.log(
    `Retention complete: ${result.archived} archived, ${result.deleted} permanently deleted.`,
  );
  if (result.warnings.length) {
    console.log(`Warnings: ${result.warnings.join(" ")}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void pool.end();
  });
