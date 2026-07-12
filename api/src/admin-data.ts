import type { QueryResultRow } from "pg";
import type { DbExecutor, SqlParams } from "./db.js";
import { HttpError } from "./http.js";

export type AdminEntity =
  | "customers"
  | "purchase-orders"
  | "styles"
  | "bom-materials"
  | "material-requirements"
  | "material-pos"
  | "material-po-items"
  | "materials"
  | "vendors"
  | "approvals"
  | "production-lines"
  | "daily-logs"
  | "daily-updates"
  | "reports";

export type ClearScope =
  | "purchase-orders"
  | "customers-purchase-orders"
  | "materials-bom-material-pos"
  | "vendors"
  | "production-daily-logs"
  | "everything-except-users";

type EntityConfig = {
  table: string;
  label: string;
  activeWarningSql?: string;
  archivedDeleteOrder?: string[];
};

export const adminEntities: Record<AdminEntity, EntityConfig> = {
  customers: {
    table: "customers",
    label: "Customer",
    activeWarningSql:
      "select count(*)::int as count from purchase_orders where customer_id = $1 and archived_at is null and status not in ('Shipped')",
  },
  "purchase-orders": {
    table: "purchase_orders",
    label: "Purchase Order",
    activeWarningSql:
      "select count(*)::int as count from material_purchase_orders where purchase_order_id = $1 and archived_at is null and status in ('Sent', 'Confirmed', 'Completed')",
  },
  styles: {
    table: "styles",
    label: "Style",
    activeWarningSql:
      "select count(*)::int as count from purchase_orders where style_id = $1 and archived_at is null and status not in ('Shipped')",
  },
  "bom-materials": {
    table: "bom_materials",
    label: "BOM Material",
    activeWarningSql:
      "select count(*)::int as count from material_requirements where bom_material_id = $1 and archived_at is null",
  },
  "material-requirements": { table: "material_requirements", label: "Material Requirement" },
  "material-pos": {
    table: "material_purchase_orders",
    label: "Material PO",
    activeWarningSql:
      "select case when exists(select 1 from material_purchase_orders where id = $1 and status not in ('Draft', 'Ready')) then 1 else 0 end::int as count",
    archivedDeleteOrder: ["material_po_items", "material_purchase_orders"],
  },
  "material-po-items": { table: "material_po_items", label: "Material PO Item" },
  materials: { table: "materials", label: "Material" },
  vendors: {
    table: "vendors",
    label: "Vendor",
    activeWarningSql:
      "select count(*)::int as count from material_purchase_orders where vendor_id = $1 and archived_at is null and status = 'Draft'",
  },
  approvals: { table: "approvals", label: "Approval" },
  "production-lines": {
    table: "production_lines",
    label: "Production Line",
    activeWarningSql:
      "select case when exists(select 1 from production_lines where id = $1 and current_order_id is not null) then 1 else 0 end::int as count",
  },
  "daily-logs": { table: "daily_logs", label: "Daily Log" },
  "daily-updates": { table: "daily_production_updates", label: "Daily Update" },
  reports: { table: "reports", label: "Report" },
};

const clearScopeTables: Record<ClearScope, string[]> = {
  "purchase-orders": [
    "material_po_items",
    "material_purchase_orders",
    "material_requirements",
    "purchase_order_sizes",
    "production_timeline",
    "daily_logs",
    "daily_production_updates",
    "approvals",
    "purchase_orders",
  ],
  "customers-purchase-orders": [
    "material_po_items",
    "material_purchase_orders",
    "material_requirements",
    "purchase_order_sizes",
    "production_timeline",
    "daily_logs",
    "daily_production_updates",
    "approvals",
    "purchase_orders",
    "customers",
  ],
  "materials-bom-material-pos": [
    "material_po_items",
    "material_purchase_orders",
    "material_requirements",
    "materials",
    "bom_materials",
    "styles",
  ],
  vendors: ["vendors"],
  "production-daily-logs": ["daily_logs", "daily_production_updates", "production_lines"],
  "everything-except-users": [
    "material_po_email_logs",
    "material_po_items",
    "material_purchase_orders",
    "material_requirements",
    "purchase_order_sizes",
    "production_timeline",
    "daily_logs",
    "daily_production_updates",
    "approvals",
    "materials",
    "bom_materials",
    "styles",
    "purchase_orders",
    "customers",
    "vendors",
    "production_lines",
    "alerts",
    "reports",
  ],
};

const archivableTables = new Set([
  "customers",
  "purchase_orders",
  "styles",
  "bom_materials",
  "material_requirements",
  "material_purchase_orders",
  "material_po_items",
  "materials",
  "vendors",
  "approvals",
  "production_lines",
  "daily_logs",
  "daily_production_updates",
  "reports",
]);

async function rows<T extends QueryResultRow>(
  db: DbExecutor,
  text: string,
  params: SqlParams = [],
) {
  return (await db.query<T>(text, params)).rows;
}

async function countRows(db: DbExecutor, table: string, where = "true", params: SqlParams = []) {
  const row = (
    await rows<{ count: string | number }>(
      db,
      `select count(*) as count from ${table} where ${where}`,
      params,
    )
  )[0];
  return Number(row?.count ?? 0);
}

export async function archiveEntity(
  db: DbExecutor,
  entity: AdminEntity,
  id: string,
  userId: string,
  reason: string,
) {
  const config = adminEntities[entity];
  const warnings: string[] = [];
  if (config.activeWarningSql) {
    const warningCount = Number(
      (await rows<{ count: number }>(db, config.activeWarningSql, [id]))[0]?.count ?? 0,
    );
    if (warningCount > 0) {
      warnings.push(`${config.label} has ${warningCount} linked active or protected record(s).`);
    }
  }

  if (entity === "purchase-orders") {
    await db.query(
      `
        update material_requirements
        set archived_at = now(), archived_by = $2, archive_reason = $3
        where purchase_order_id = $1 and archived_at is null
      `,
      [id, userId, reason || "Archived with purchase order."],
    );
    await db.query(
      `
        update material_purchase_orders
        set archived_at = now(), archived_by = $2, archive_reason = $3
        where purchase_order_id = $1 and status = 'Draft' and archived_at is null
      `,
      [id, userId, reason || "Archived with purchase order."],
    );
  }

  const result = await db.query(
    `
      update ${config.table}
      set archived_at = coalesce(archived_at, now()),
          archived_by = $2,
          archive_reason = $3
      where id = $1
      returning id
    `,
    [id, userId, reason],
  );
  if (!result.rows[0]) throw new HttpError(404, "Record not found.");
  return { archived: 1, warnings };
}

export async function restoreEntity(db: DbExecutor, entity: AdminEntity, id: string) {
  const config = adminEntities[entity];
  const result = await db.query(
    `
      update ${config.table}
      set archived_at = null,
          archived_by = null,
          archive_reason = ''
      where id = $1
      returning id
    `,
    [id],
  );
  if (!result.rows[0]) throw new HttpError(404, "Record not found.");
  return { restored: 1 };
}

export async function hardDeleteArchivedEntity(db: DbExecutor, entity: AdminEntity, id: string) {
  const config = adminEntities[entity];
  const count = await countRows(db, config.table, "id = $1 and archived_at is not null", [id]);
  if (!count) throw new HttpError(400, "Only archived records can be permanently deleted.");

  if (entity === "material-pos") {
    await db.query(
      "delete from material_po_items where material_po_id = $1 and archived_at is not null",
      [id],
    );
  }

  await db.query(`delete from ${config.table} where id = $1 and archived_at is not null`, [id]);
  return { deleted: 1 };
}

export async function clearTestData(
  db: DbExecutor,
  scope: ClearScope,
  userId: string,
  mode: "archive" | "hard-delete",
  allowDestructive: boolean,
) {
  const tables = clearScopeTables[scope];
  const result: Record<string, number> = {};
  let archived = 0;
  let deleted = 0;

  if (mode === "hard-delete" && !allowDestructive) {
    throw new HttpError(
      403,
      "Permanent delete is disabled. Set ALLOW_DESTRUCTIVE_ADMIN_ACTIONS=true to enable it locally.",
    );
  }

  for (const table of tables) {
    if (mode === "archive" && archivableTables.has(table)) {
      const update = await db.query(
        `
          update ${table}
          set archived_at = coalesce(archived_at, now()),
              archived_by = $1,
              archive_reason = 'Clear test data: ${scope}'
          where archived_at is null
        `,
        [userId],
      );
      result[table] = update.rowCount ?? 0;
      archived += update.rowCount ?? 0;
    } else if (mode === "hard-delete") {
      const deleteResult = archivableTables.has(table)
        ? await db.query(`delete from ${table} where archived_at is not null`)
        : await db.query(`delete from ${table}`);
      result[table] = deleteResult.rowCount ?? 0;
      deleted += deleteResult.rowCount ?? 0;
    }
  }

  return { mode, scope, archived, deleted, affected: result, warnings: [] as string[] };
}

export async function runRetention(
  db: DbExecutor,
  userId: string | null,
  archiveOlderThanYears: number,
  deleteArchivedOlderThanYears: number | undefined,
  allowDestructive: boolean,
) {
  const archived: Record<string, number> = {};
  const deleted: Record<string, number> = {};
  const archivedBy = userId ?? null;

  const archiveOrders = await db.query(
    `
      update purchase_orders
      set archived_at = now(), archived_by = $2, archive_reason = 'Auto archive retention rule'
      where archived_at is null
        and status in ('Shipped', 'Ready To Ship')
        and delivery_date < current_date - ($1::text || ' years')::interval
    `,
    [archiveOlderThanYears, archivedBy],
  );
  archived.purchase_orders = archiveOrders.rowCount ?? 0;

  const archiveLogs = await db.query(
    `
      update daily_logs
      set archived_at = now(), archived_by = $2, archive_reason = 'Auto archive retention rule'
      where archived_at is null
        and status = 'Resolved'
        and log_date < current_date - ($1::text || ' years')::interval
    `,
    [archiveOlderThanYears, archivedBy],
  );
  archived.daily_logs = archiveLogs.rowCount ?? 0;

  if (deleteArchivedOlderThanYears !== undefined) {
    if (!allowDestructive) {
      throw new HttpError(
        403,
        "Retention permanent delete is disabled by ALLOW_DESTRUCTIVE_ADMIN_ACTIONS.",
      );
    }
    for (const table of [
      "material_po_items",
      "material_purchase_orders",
      "material_requirements",
      "daily_logs",
      "daily_production_updates",
      "approvals",
      "purchase_orders",
      "reports",
    ]) {
      const response = await db.query(
        `
          delete from ${table}
          where archived_at is not null
            and archived_at < now() - ($1::text || ' years')::interval
        `,
        [deleteArchivedOlderThanYears],
      );
      deleted[table] = response.rowCount ?? 0;
    }
  }

  return {
    archived: Object.values(archived).reduce((sum, value) => sum + value, 0),
    deleted: Object.values(deleted).reduce((sum, value) => sum + value, 0),
    affected: { archived, deleted },
    warnings: [] as string[],
  };
}
