import type { QueryResultRow } from "pg";
import type { DbExecutor } from "./db.js";

export type TimelineExecutor = Pick<DbExecutor, "query">;

export type TimelineInsert = {
  purchaseOrderId: string;
  eventType: string;
  eventTitle: string;
  eventDescription?: string;
  userId?: string | null;
};

export async function addProductionTimelineEvent(
  db: TimelineExecutor,
  { purchaseOrderId, eventType, eventTitle, eventDescription = "", userId = null }: TimelineInsert,
) {
  await db.query<QueryResultRow>(
    `
      insert into production_timeline (
        purchase_order_id,
        event_type,
        event_title,
        event_description,
        user_id
      )
      values ($1, $2, $3, $4, $5)
    `,
    [purchaseOrderId, eventType, eventTitle, eventDescription, userId],
  );
}

export async function addDominoTimelineEvents(
  db: TimelineExecutor,
  userId: string,
  purchaseOrderId: string,
  result: { requirementCount: number; materialPoCount: number; warnings?: unknown[] },
) {
  if (result.requirementCount > 0) {
    await addProductionTimelineEvent(db, {
      purchaseOrderId,
      eventType: "material_requirements_generated",
      eventTitle: "Material Requirements Generated",
      eventDescription: `${result.requirementCount} material requirement row(s) generated from the linked BOM.`,
      userId,
    });
  }

  if (result.materialPoCount > 0) {
    await addProductionTimelineEvent(db, {
      purchaseOrderId,
      eventType: "material_po_created",
      eventTitle: "Material PO Drafts Created",
      eventDescription: `${result.materialPoCount} vendor-wise draft material PO group(s) prepared.`,
      userId,
    });
  }

  if (!result.requirementCount && !result.materialPoCount && result.warnings?.length) {
    await addProductionTimelineEvent(db, {
      purchaseOrderId,
      eventType: "domino_warning",
      eventTitle: "Domino Workflow Warning",
      eventDescription:
        "The workflow could not generate downstream material data. Review PO warnings.",
      userId,
    });
  }
}
