import type { QueryResultRow } from "pg";
import { transaction, type DbExecutor, type SqlParams } from "./db.js";
import { HttpError } from "./http.js";
import type {
  DominoWarning,
  MaterialCalculationType,
  MaterialPoStatus,
  ShipmentRiskStatus,
} from "../../src/lib/domain.js";

type PurchaseOrderRow = {
  id: string;
  customer_id: string | null;
  po_number: string;
  buyer: string;
  style_code: string;
  style_name: string | null;
  color: string;
  brand: string | null;
  style_id?: string | null;
  quantity: number;
  delivery_date: string;
  assigned_lasting_line_id?: string | null;
  planned_start_date?: string | null;
};

type BomRow = {
  id: string;
  style_id: string;
  category?: string | null;
  material_name: string;
  specification?: string | null;
  unit?: string | null;
  consumption_per_pair?: number | null;
  wastage_percent?: number | null;
  calculation_type?: MaterialCalculationType | null;
  fixed_quantity?: number | null;
  default_vendor_id?: string | null;
};

type PurchaseOrderSizeRow = {
  size: string;
  quantity: number;
};

type StyleRow = {
  id: string;
  style_code: string;
  style_name?: string | null;
  color?: string | null;
  brand?: string | null;
};

type RequirementRow = {
  id: string;
  purchase_order_id: string;
  bom_material_id: string | null;
  parent_bom_material_id?: string | null;
  vendor_id: string | null;
  material_name: string;
  specification: string | null;
  required_quantity: number | null;
  ordered_quantity: number | null;
  received_quantity: number | null;
  unit: string | null;
  notes: string | null;
};

type MaterialPoRow = {
  id: string;
  material_po_number: string;
  vendor_id: string | null;
  status: MaterialPoStatus;
};

const lockedMaterialPoStatuses = new Set(["Sent", "Confirmed", "Completed", "Cancelled"]);

function warning(code: string, message: string, severity: DominoWarning["severity"] = "warning") {
  return { code, message, severity };
}

export function normalizeStyleMatchValue(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function normalizedStyleKey(value: {
  style_code?: string | null;
  styleCode?: string | null;
  color?: string | null;
  brand?: string | null;
}) {
  return [
    normalizeStyleMatchValue(value.style_code ?? value.styleCode),
    normalizeStyleMatchValue(value.color),
    normalizeStyleMatchValue(value.brand),
  ].join("::");
}

function styleLabel(style: StyleRow) {
  return [style.style_code, style.color, style.brand].filter(Boolean).join(" / ");
}

function suggestedStyles(styles: StyleRow[], order: PurchaseOrderRow) {
  const orderCode = normalizeStyleMatchValue(order.style_code);
  const orderBrand = normalizeStyleMatchValue(order.brand);
  const orderColor = normalizeStyleMatchValue(order.color);
  return styles
    .filter((style) => {
      const code = normalizeStyleMatchValue(style.style_code);
      const brand = normalizeStyleMatchValue(style.brand);
      const color = normalizeStyleMatchValue(style.color);
      return (
        code === orderCode ||
        (orderCode.length >= 3 && code.includes(orderCode)) ||
        (code.length >= 3 && orderCode.includes(code)) ||
        (brand === orderBrand && color === orderColor)
      );
    })
    .slice(0, 5);
}

function roundQuantity(value: number) {
  return Math.round(value * 10000) / 10000;
}

function isSoleMaterial(bom: Pick<BomRow, "category" | "material_name">) {
  return [bom.category, bom.material_name].join(" ").toLowerCase().includes("sole");
}

function calculationTypeForBom(bom: BomRow): MaterialCalculationType {
  if (bom.calculation_type) return bom.calculation_type;
  return isSoleMaterial(bom) ? "Size Wise" : "Per Pair";
}

function sizeSpecification(baseSpecification: string | null | undefined, size: string) {
  return [baseSpecification, `Size ${size}`].filter(Boolean).join(" - ");
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function shipmentRisk(
  completionDate: string | null | undefined,
  deliveryDate: string | null | undefined,
): ShipmentRiskStatus {
  if (!completionDate || !deliveryDate) return "Unknown";
  const completion = new Date(`${completionDate}T00:00:00.000Z`).getTime();
  const delivery = new Date(`${deliveryDate}T00:00:00.000Z`).getTime();
  const daysBefore = Math.floor((delivery - completion) / (24 * 60 * 60 * 1000));
  if (daysBefore >= 7) return "Low";
  if (daysBefore >= 0) return "Medium";
  return "High";
}

async function rows<T extends QueryResultRow>(
  db: DbExecutor,
  text: string,
  params: SqlParams = [],
) {
  return (await db.query<T>(text, params)).rows;
}

async function one<T extends QueryResultRow>(db: DbExecutor, text: string, params: SqlParams = []) {
  const row = (await rows<T>(db, text, params))[0];
  if (!row) throw new HttpError(404, "Record not found.");
  return row;
}

async function clearDraftDominoForPo(db: DbExecutor, purchaseOrderId: string) {
  const draftIds = (
    await rows<{ id: string }>(
      db,
      "select id from material_purchase_orders where purchase_order_id = $1 and status = 'Draft'",
      [purchaseOrderId],
    )
  ).map((item) => item.id);

  if (draftIds.length) {
    await db.query("delete from material_po_items where material_po_id = any($1::uuid[])", [
      draftIds,
    ]);
    await db.query(
      "delete from material_purchase_orders where id = any($1::uuid[]) and status = 'Draft'",
      [draftIds],
    );
  }

  await db.query("delete from material_requirements where purchase_order_id = $1", [
    purchaseOrderId,
  ]);
}

async function clearDraftItemsAndRequirementsForPo(db: DbExecutor, purchaseOrderId: string) {
  const draftIds = (
    await rows<{ id: string }>(
      db,
      "select id from material_purchase_orders where purchase_order_id = $1 and status = 'Draft'",
      [purchaseOrderId],
    )
  ).map((item) => item.id);

  if (draftIds.length) {
    await db.query("delete from material_po_items where material_po_id = any($1::uuid[])", [
      draftIds,
    ]);
  }

  await db.query("delete from material_requirements where purchase_order_id = $1", [
    purchaseOrderId,
  ]);
}

async function nextMaterialPoNumber(db: DbExecutor) {
  const row = await one<{ value: string }>(db, "select next_material_po_number() as value");
  return row.value;
}

async function runDominoWorkflowInTransaction(
  db: DbExecutor,
  userId: string,
  purchaseOrderId: string,
) {
  const order = await one<PurchaseOrderRow>(
    db,
    `
      select
        id,
        customer_id,
        po_number,
        buyer,
        style_code,
        style_name,
        color,
        brand,
        style_id,
        quantity,
        delivery_date::text as delivery_date,
        assigned_lasting_line_id,
        planned_start_date::text as planned_start_date
      from purchase_orders
      where id = $1
    `,
    [purchaseOrderId],
  );
  const warnings: DominoWarning[] = [];

  const allStyles = await rows<StyleRow>(
    db,
    `
      select id, style_code, style_name, color, brand
      from styles
      order by style_code, color, brand
    `,
  );
  const manuallyLinkedStyle = order.style_id
    ? allStyles.find((candidate) => candidate.id === order.style_id)
    : undefined;
  const style =
    manuallyLinkedStyle ??
    allStyles.find((candidate) => normalizedStyleKey(candidate) === normalizedStyleKey(order));

  if (!style?.id) {
    const suggestions = suggestedStyles(allStyles, order);
    const suggestionText = suggestions.length
      ? ` Suggested styles: ${suggestions.map(styleLabel).join("; ")}. Use Link BOM to connect one.`
      : " No similar styles were found. Import the BOM template for this style first.";
    warnings.push(
      warning(
        "missing_bom",
        `No BOM found for this style. Import or create BOM before material requirements can be generated.${suggestionText}`,
      ),
    );
    await clearDraftDominoForPo(db, purchaseOrderId);
    await db.query(
      `
        update purchase_orders
        set style_id = null, domino_warnings = $2::jsonb, updated_by = $3
        where id = $1
      `,
      [purchaseOrderId, JSON.stringify(warnings), userId],
    );
    return { warnings, requirementCount: 0, materialPoCount: 0 };
  }

  const styleId = style.id;
  const bomRows = await rows<BomRow>(
    db,
    `
      select
        id,
        style_id,
        category,
        material_name,
        specification,
        unit,
        consumption_per_pair,
        wastage_percent,
        calculation_type,
        fixed_quantity,
        default_vendor_id
      from bom_materials
      where style_id = $1
      order by material_name
    `,
    [styleId],
  );

  if (!bomRows.length) {
    warnings.push(
      warning(
        "missing_bom",
        "No BOM found for this style. Import or create BOM before material requirements can be generated.",
      ),
    );
    await clearDraftDominoForPo(db, purchaseOrderId);
    await db.query(
      `
        update purchase_orders
        set style_id = $2, domino_warnings = $3::jsonb, updated_by = $4
        where id = $1
      `,
      [purchaseOrderId, styleId, JSON.stringify(warnings), userId],
    );
    return { warnings, requirementCount: 0, materialPoCount: 0 };
  }

  const sizeRows = await rows<PurchaseOrderSizeRow>(
    db,
    `
      select size, quantity
      from purchase_order_sizes
      where purchase_order_id = $1
      order by size
    `,
    [purchaseOrderId],
  );

  await clearDraftItemsAndRequirementsForPo(db, purchaseOrderId);

  const line = order.assigned_lasting_line_id
    ? (
        await rows<{ line_name?: string | null; capacity?: number | null }>(
          db,
          "select line_name, capacity from production_lines where id = $1",
          [order.assigned_lasting_line_id],
        )
      )[0]
    : null;
  const capacity = Number(line?.capacity ?? 0);
  let estimatedLastingDays: number | null = null;
  let estimatedCompletionDate: string | null = null;
  let shipmentRiskValue: ShipmentRiskStatus = "Unknown";
  let productionPlanSummary = "";

  if (!capacity) {
    warnings.push(
      warning("missing_lasting_capacity", "Assigned lasting line or daily capacity is missing."),
    );
  } else {
    estimatedLastingDays = Math.max(Math.ceil(Number(order.quantity || 0) / capacity), 1);
    if (order.planned_start_date) {
      estimatedCompletionDate = addDays(order.planned_start_date, estimatedLastingDays - 1);
      shipmentRiskValue = shipmentRisk(estimatedCompletionDate, order.delivery_date);
    } else {
      warnings.push(warning("missing_planned_start", "Planned start date is missing."));
    }
    productionPlanSummary = `${line?.line_name ?? "Selected line"} can finish estimated lasting in ${estimatedLastingDays} day(s).`;
  }

  const createdRequirements: RequirementRow[] = [];
  for (const bom of bomRows) {
    const calculationType = calculationTypeForBom(bom);
    if (!bom.default_vendor_id) {
      warnings.push(
        warning(
          "missing_vendor",
          `${bom.material_name} has no vendor assigned and will be grouped as Unassigned Vendor.`,
        ),
      );
    }

    const rawConsumption = bom.consumption_per_pair;
    const hasConsumption =
      rawConsumption !== null &&
      rawConsumption !== undefined &&
      Number.isFinite(Number(rawConsumption));
    const rawFixedQuantity = bom.fixed_quantity;
    const hasFixedQuantity =
      rawFixedQuantity !== null &&
      rawFixedQuantity !== undefined &&
      Number.isFinite(Number(rawFixedQuantity));

    type RequirementPayload = {
      materialName: string;
      specification: string;
      requiredQuantity: number;
      quantityStatus: "Calculated" | "Needs manual quantity";
      notes: string;
      sizeLabel: string;
      sizeValue: string;
    };

    const requirementPayloads: RequirementPayload[] = [];

    if (calculationType === "Manual Quantity") {
      warnings.push(
        warning("manual_quantity", `${bom.material_name} is marked for manual quantity entry.`),
      );
      requirementPayloads.push({
        materialName: bom.material_name,
        specification: bom.specification ?? "",
        requiredQuantity: 0,
        quantityStatus: "Needs manual quantity",
        notes: "Manual quantity required.",
        sizeLabel: "",
        sizeValue: "",
      });
    } else if (calculationType === "Fixed Quantity") {
      if (!hasFixedQuantity) {
        warnings.push(
          warning(
            "missing_fixed_quantity",
            `${bom.material_name} needs manual quantity because fixed quantity is missing.`,
          ),
        );
      }
      requirementPayloads.push({
        materialName: bom.material_name,
        specification: bom.specification ?? "",
        requiredQuantity: hasFixedQuantity ? roundQuantity(Number(rawFixedQuantity)) : 0,
        quantityStatus: hasFixedQuantity ? "Calculated" : "Needs manual quantity",
        notes: hasFixedQuantity ? "" : "Fixed quantity missing.",
        sizeLabel: "",
        sizeValue: "",
      });
    } else if (calculationType === "Size Wise") {
      if (!sizeRows.length) {
        warnings.push(
          warning(
            "missing_sizes",
            `${bom.material_name}: Size-wise material requires PO size breakdown.`,
          ),
        );
        requirementPayloads.push({
          materialName: bom.material_name,
          specification: bom.specification ?? "",
          requiredQuantity: 0,
          quantityStatus: "Needs manual quantity",
          notes: "Size-wise material requires PO size breakdown.",
          sizeLabel: "",
          sizeValue: "",
        });
      } else if (!hasConsumption) {
        warnings.push(
          warning(
            "missing_consumption",
            `${bom.material_name} needs manual quantity because consumption per pair is missing.`,
          ),
        );
        for (const size of sizeRows) {
          requirementPayloads.push({
            materialName: bom.material_name,
            specification: sizeSpecification(bom.specification, size.size),
            requiredQuantity: 0,
            quantityStatus: "Needs manual quantity",
            notes: `Size ${size.size}: consumption per pair missing.`,
            sizeLabel: `Size ${size.size}`,
            sizeValue: size.size,
          });
        }
      } else {
        for (const size of sizeRows) {
          requirementPayloads.push({
            materialName: bom.material_name,
            specification: sizeSpecification(bom.specification, size.size),
            requiredQuantity: roundQuantity(
              Number(size.quantity || 0) *
                Number(rawConsumption || 0) *
                (1 + Number(bom.wastage_percent || 0) / 100),
            ),
            quantityStatus: "Calculated",
            notes: `Generated from PO size ${size.size}.`,
            sizeLabel: `Size ${size.size}`,
            sizeValue: size.size,
          });
        }
      }
    } else {
      if (!hasConsumption) {
        warnings.push(
          warning(
            "missing_consumption",
            `${bom.material_name} needs manual quantity because consumption per pair is missing.`,
          ),
        );
      }
      requirementPayloads.push({
        materialName: bom.material_name,
        specification: bom.specification ?? "",
        requiredQuantity: hasConsumption
          ? roundQuantity(
              Number(order.quantity || 0) *
                Number(rawConsumption || 0) *
                (1 + Number(bom.wastage_percent || 0) / 100),
            )
          : 0,
        quantityStatus: hasConsumption ? "Calculated" : "Needs manual quantity",
        notes: hasConsumption ? "" : "Consumption per pair missing.",
        sizeLabel: "",
        sizeValue: "",
      });
    }

    for (const payload of requirementPayloads) {
      const requirement = await one<RequirementRow>(
        db,
        `
          insert into material_requirements (
            purchase_order_id,
            customer_id,
            style_id,
            bom_material_id,
            parent_bom_material_id,
            material_name,
            specification,
            calculation_type,
            size_label,
            size_value,
            required_quantity,
            ordered_quantity,
            received_quantity,
            balance_quantity,
            unit,
            vendor_id,
            quantity_status,
            notes,
            created_by,
            updated_by
          )
          values ($1, $2, $3, $4, $4, $5, $6, $7, $8, $9, $10, 0, 0, $10, $11, $12, $13, $14, $15, $15)
          returning
            id,
            purchase_order_id,
            bom_material_id,
            parent_bom_material_id,
            vendor_id,
            material_name,
            specification,
            required_quantity,
            ordered_quantity,
            received_quantity,
            unit,
            notes
        `,
        [
          purchaseOrderId,
          order.customer_id,
          styleId,
          bom.id,
          payload.materialName,
          payload.specification,
          calculationType,
          payload.sizeLabel,
          payload.sizeValue,
          payload.requiredQuantity,
          bom.unit ?? "",
          bom.default_vendor_id || null,
          payload.quantityStatus,
          payload.notes,
          userId,
        ],
      );
      createdRequirements.push(requirement);
    }
  }

  const groups = new Map<string, RequirementRow[]>();
  for (const requirement of createdRequirements) {
    const key = requirement.vendor_id || "unassigned";
    groups.set(key, [...(groups.get(key) ?? []), requirement]);
  }

  const existingMaterialPos = await rows<MaterialPoRow>(
    db,
    `
      select id, material_po_number, vendor_id, status
      from material_purchase_orders
      where purchase_order_id = $1
    `,
    [purchaseOrderId],
  );
  let materialPoCount = 0;
  const touchedMaterialPoIds = new Set<string>();

  for (const [key, requirements] of groups) {
    const vendorId = key === "unassigned" ? null : key;
    const existingDraft = existingMaterialPos.find(
      (item) => item.status === "Draft" && (item.vendor_id ?? "") === (vendorId ?? ""),
    );
    const locked = existingMaterialPos.find(
      (item) =>
        lockedMaterialPoStatuses.has(item.status) && (item.vendor_id ?? "") === (vendorId ?? ""),
    );
    if (locked && !existingDraft) {
      warnings.push(
        warning(
          "locked_material_po",
          `${locked.material_po_number} is ${locked.status} and was not overwritten.`,
        ),
      );
    }

    const groupWarnings = vendorId
      ? []
      : [warning("missing_vendor", "This draft contains requirements without an assigned vendor.")];
    const materialPo = existingDraft
      ? await one<{ id: string }>(
          db,
          `
            update material_purchase_orders
            set
              vendor_id = $2,
              customer_id = $3,
              purchase_order_id = $4,
              style_id = $5,
              generated_date = current_date,
              expected_delivery_date = $6,
              status = 'Draft',
              notes = '',
              warnings = $7::jsonb,
              updated_by = $8
            where id = $1
            returning id
          `,
          [
            existingDraft.id,
            vendorId,
            order.customer_id,
            purchaseOrderId,
            styleId,
            order.delivery_date || null,
            JSON.stringify(groupWarnings),
            userId,
          ],
        )
      : await one<{ id: string }>(
          db,
          `
            insert into material_purchase_orders (
              material_po_number,
              vendor_id,
              customer_id,
              purchase_order_id,
              style_id,
              generated_date,
              expected_delivery_date,
              status,
              notes,
              warnings,
              created_by,
              updated_by
            )
            values ($1, $2, $3, $4, $5, current_date, $6, 'Draft', '', $7::jsonb, $8, $8)
            returning id
          `,
          [
            await nextMaterialPoNumber(db),
            vendorId,
            order.customer_id,
            purchaseOrderId,
            styleId,
            order.delivery_date || null,
            JSON.stringify(groupWarnings),
            userId,
          ],
        );

    touchedMaterialPoIds.add(materialPo.id);
    await db.query("delete from material_po_items where material_po_id = $1", [materialPo.id]);
    for (const requirement of requirements) {
      await db.query(
        `
          insert into material_po_items (
            material_po_id,
            material_requirement_id,
            material_name,
            specification,
            quantity,
            unit,
            vendor_name_snapshot,
            notes,
            created_by,
            updated_by
          )
          values ($1, $2, $3, $4, $5, $6, '', $7, $8, $8)
        `,
        [
          materialPo.id,
          requirement.id,
          requirement.material_name,
          requirement.specification ?? "",
          Number(requirement.required_quantity ?? 0),
          requirement.unit ?? "",
          requirement.notes ?? "",
          userId,
        ],
      );
    }
    materialPoCount += 1;
  }

  const staleDraftIds = existingMaterialPos
    .filter((item) => item.status === "Draft" && !touchedMaterialPoIds.has(item.id))
    .map((item) => item.id);
  if (staleDraftIds.length) {
    await db.query(
      "delete from material_purchase_orders where id = any($1::uuid[]) and status = 'Draft'",
      [staleDraftIds],
    );
  }

  await db.query(
    `
      update purchase_orders
      set
        style_id = $2,
        planned_daily_capacity = $3,
        estimated_lasting_days = $4,
        estimated_completion_date = $5,
        shipment_risk = $6,
        production_plan_summary = $7,
        domino_warnings = $8::jsonb,
        updated_by = $9
      where id = $1
    `,
    [
      purchaseOrderId,
      styleId,
      capacity || null,
      estimatedLastingDays,
      estimatedCompletionDate,
      shipmentRiskValue,
      productionPlanSummary,
      JSON.stringify(warnings),
      userId,
    ],
  );

  return { warnings, requirementCount: createdRequirements.length, materialPoCount };
}

export async function runDominoWorkflow(userId: string, purchaseOrderId: string) {
  return transaction((client) => runDominoWorkflowInTransaction(client, userId, purchaseOrderId));
}

export async function runDominoWorkflowOnDb(
  db: DbExecutor,
  userId: string,
  purchaseOrderId: string,
) {
  return runDominoWorkflowInTransaction(db, userId, purchaseOrderId);
}
