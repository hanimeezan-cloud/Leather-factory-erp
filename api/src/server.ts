import express from "express";
import cors from "cors";
import ExcelJS from "exceljs";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { env } from "./env.js";
import { requireActive, requireAuth, requireRoles, type AuthedRequest } from "./auth.js";
import { runDominoWorkflow } from "./domino.js";
import {
  archiveEntity,
  clearTestData,
  hardDeleteArchivedEntity,
  restoreEntity,
  runRetention,
} from "./admin-data.js";
import { asyncHandler, HttpError, sendError } from "./http.js";
import { confirmBomImport, confirmPoImport, previewBomImport, previewPoImport } from "./imports.js";
import { many, one, pool, query, transaction, type SqlParams, type SqlValue } from "./db.js";
import { addDominoTimelineEvents, addProductionTimelineEvent } from "./timeline.js";
import {
  mapApproval,
  mapBomMaterial,
  mapCustomer,
  mapDailyLog,
  mapDailyUpdate,
  mapMaterialPoEmailLog,
  mapMaterialPurchaseOrder,
  mapMaterialRequirement,
  mapMaterial,
  mapProductionLine,
  mapProductionTimelineEvent,
  mapPurchaseOrder,
  mapPurchaseOrderSize,
  mapAlert,
  mapStyle,
  mapVendor,
} from "./mappers.js";
import {
  approvalPatchSchema,
  approvalSchema,
  adminEntitySchema,
  archiveActionSchema,
  bomDefaultVendorSchema,
  customerPatchSchema,
  customerSchema,
  dailyLogPatchSchema,
  dailyLogSchema,
  dailyUpdatePatchSchema,
  dailyUpdateSchema,
  finalApprovalSchema,
  clearTestDataSchema,
  hardDeleteSchema,
  idParamSchema,
  materialPatchSchema,
  materialPoEmailSchema,
  materialSchema,
  productionLinePatchSchema,
  productionLineAssignmentSchema,
  productionLineSchema,
  productionStageSchema,
  purchaseOrderPatchSchema,
  purchaseOrderSizesSchema,
  purchaseOrderSchema,
  reportParamSchema,
  retentionRunSchema,
  styleLinkSchema,
  userCreateSchema,
  userPatchSchema,
  vendorPatchSchema,
  vendorSchema,
} from "./validation.js";
import type {
  MaterialPoPreview,
  ProductionDepartment,
  ProductionStage,
  ReportType,
  Role,
} from "../../src/lib/domain.js";
import { PRODUCTION_STAGES } from "../../src/lib/domain.js";

const app = express();
const api = express.Router();
const uploadsRoot = path.resolve(process.cwd(), env.uploadsDir);
const serverFilesRoot = path.resolve(process.cwd(), env.serverFilesDir);
const materialPoFilesRoot = path.join(serverFilesRoot, "material-pos");
const poImageUploadDir = path.join(uploadsRoot, "po-images");
const maxImageBytes = 5 * 1024 * 1024;
const maxMultipartBytes = maxImageBytes + 1024 * 1024;
const maxExcelBytes = 10 * 1024 * 1024;
const maxExcelMultipartBytes = maxExcelBytes + 1024 * 1024;
const localDb = { query };

function redactConnectionString(value: string) {
  try {
    const url = new URL(value);
    if (url.password) url.password = "****";
    return url.toString();
  } catch {
    return value.replace(/:\/\/([^:/@]+):([^@]+)@/, "://$1:****@");
  }
}

app.use(
  cors({
    origin: env.corsOrigin,
    credentials: true,
    exposedHeaders: ["Content-Disposition", "X-Report-Audit"],
  }),
);
app.use(express.json({ limit: "1mb" }));
app.use(
  "/uploads/po-images",
  express.static(poImageUploadDir, {
    dotfiles: "ignore",
    index: false,
    maxAge: "1h",
    setHeaders: (res) => {
      res.setHeader("X-Content-Type-Options", "nosniff");
    },
  }),
);

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

function parse<T>(schema: { parse: (value: unknown) => T }, value: unknown) {
  try {
    return schema.parse(value);
  } catch (error: unknown) {
    const issues =
      typeof error === "object" && error !== null && "errors" in error
        ? (error as { errors?: { message?: string }[] }).errors
        : undefined;
    throw new HttpError(400, issues?.[0]?.message ?? "Invalid request");
  }
}

function readRequestBuffer(req: AuthedRequest, maxBytes: number) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;

    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new HttpError(413, "Upload is too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", () => reject(new HttpError(400, "Could not read upload request.")));
  });
}

function getMultipartBoundary(contentType: string | undefined) {
  const match = contentType?.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  return match?.[1] ?? match?.[2] ?? null;
}

function parseHeaders(text: string) {
  return Object.fromEntries(
    text.split("\r\n").flatMap((line) => {
      const index = line.indexOf(":");
      if (index === -1) return [];
      return [[line.slice(0, index).trim().toLowerCase(), line.slice(index + 1).trim()]];
    }),
  );
}

function parseSingleMultipartFile(buffer: Buffer, boundary: string) {
  const delimiter = Buffer.from(`--${boundary}`);
  const headerSeparator = Buffer.from("\r\n\r\n");
  let position = buffer.indexOf(delimiter);

  while (position !== -1) {
    position += delimiter.length;
    if (buffer.subarray(position, position + 2).toString("latin1") === "--") break;
    if (buffer.subarray(position, position + 2).toString("latin1") === "\r\n") position += 2;

    const headerEnd = buffer.indexOf(headerSeparator, position);
    if (headerEnd === -1) break;

    const headers = parseHeaders(buffer.subarray(position, headerEnd).toString("latin1"));
    const contentDisposition = headers["content-disposition"] ?? "";
    const isFile = /filename=/i.test(contentDisposition);
    const dataStart = headerEnd + headerSeparator.length;
    const nextBoundary = buffer.indexOf(Buffer.from(`\r\n--${boundary}`), dataStart);
    if (nextBoundary === -1) break;

    if (isFile) {
      return {
        contentType: headers["content-type"] ?? "",
        data: buffer.subarray(dataStart, nextBoundary),
      };
    }

    position = nextBoundary + 2;
    position = buffer.indexOf(delimiter, position);
  }

  throw new HttpError(400, "No uploaded file was found.");
}

function imageExtension(contentType: string, data: Buffer) {
  const normalized = contentType.toLowerCase();
  const isPng = data.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const isJpeg = data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  const isGif =
    data.subarray(0, 6).toString("latin1") === "GIF87a" ||
    data.subarray(0, 6).toString("latin1") === "GIF89a";
  const isWebp =
    data.subarray(0, 4).toString("latin1") === "RIFF" &&
    data.subarray(8, 12).toString("latin1") === "WEBP";

  if (normalized === "image/png" && isPng) return ".png";
  if ((normalized === "image/jpeg" || normalized === "image/jpg") && isJpeg) return ".jpg";
  if (normalized === "image/gif" && isGif) return ".gif";
  if (normalized === "image/webp" && isWebp) return ".webp";
  return null;
}

async function readExcelUpload(req: AuthedRequest) {
  const boundary = getMultipartBoundary(req.headers["content-type"]);
  if (!boundary) throw new HttpError(400, "Expected multipart Excel upload.");

  const upload = parseSingleMultipartFile(
    await readRequestBuffer(req, maxExcelMultipartBytes),
    boundary,
  );
  if (!upload.data.length) throw new HttpError(400, "Uploaded workbook is empty.");
  if (upload.data.length > maxExcelBytes) throw new HttpError(413, "Excel upload is too large.");
  if (!upload.data.subarray(0, 2).equals(Buffer.from("PK"))) {
    throw new HttpError(400, "Upload must be an .xlsx workbook.");
  }
  return upload.data;
}

function optionalDate(value: string | undefined) {
  if (value === undefined) return undefined;
  return value ? value : null;
}

function stripUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

async function updateRecord(
  table: string,
  keyColumn: string,
  keyValue: string,
  payload: Record<string, SqlValue | undefined>,
) {
  const entries = Object.entries(payload).filter(([, value]) => value !== undefined);
  if (!entries.length) return;
  const sets = entries.map(([column], index) => `${column} = $${index + 1}`).join(", ");
  await query(`update ${table} set ${sets} where ${keyColumn} = $${entries.length + 1}`, [
    ...entries.map(([, value]) => value as SqlValue),
    keyValue,
  ]);
}

async function findPurchaseOrderId(poNumber: string) {
  const rows = await many<{ id: string }>(
    `
      select id
      from purchase_orders
      where po_number = $1
        and archived_at is null
      order by created_at desc
      limit 2
    `,
    [poNumber],
  );
  if (rows.length > 1) {
    throw new HttpError(
      400,
      `More than one active purchase order uses PO number ${poNumber}. Open the specific PO before adding linked records.`,
    );
  }
  const row = rows[0];
  if (!row) throw new HttpError(400, `Purchase order ${poNumber} was not found.`);
  return row.id;
}

async function getCustomerDisplay(customerId: string | undefined) {
  if (!customerId) return null;
  return one<{ customer_name?: string | null; brand?: string | null }>(
    "select customer_name, brand from customers where id = $1",
    [customerId],
  );
}

function customerPayload(values: Partial<ReturnType<typeof customerSchema.parse>>) {
  return {
    customer_name: values.customerName,
    brand: values.brand,
    contact_person: values.contactPerson,
    email: values.email,
    phone: values.phone,
    country: values.country,
    notes: values.notes,
    status: values.status,
  };
}

async function purchaseOrderPayload(values: Partial<ReturnType<typeof purchaseOrderSchema.parse>>) {
  const customerId = values.customerId === undefined ? undefined : values.customerId || null;
  const customer = await getCustomerDisplay(customerId ?? undefined);
  return {
    customer_id: customerId,
    po_number: values.poNumber,
    buyer: values.buyer || values.customerName || customer?.customer_name,
    po_date: optionalDate(values.poDate),
    article: values.article,
    brand: values.brand || customer?.brand,
    style_code: values.styleCode,
    style_name: values.styleName,
    color: values.color,
    quantity: values.quantity,
    price: values.price,
    currency: values.currency,
    delivery_date: values.deliveryDate,
    status: values.status,
    notes: values.notes,
    product_image_url: values.productImageUrl,
    current_stage: values.currentStage,
    assigned_production_line_id:
      values.assignedProductionLineId === undefined
        ? undefined
        : values.assignedProductionLineId || null,
    assigned_lasting_line_id:
      values.assignedLastingLineId === undefined ? undefined : values.assignedLastingLineId || null,
    planned_start_date: optionalDate(values.plannedStartDate),
  };
}

async function materialPayload(values: Partial<ReturnType<typeof materialSchema.parse>>) {
  return {
    material_name: values.name,
    supplier: values.supplier,
    purchase_order_id: values.poNumber ? await findPurchaseOrderId(values.poNumber) : undefined,
    required_qty: values.requiredQty,
    received_qty: values.receivedQty,
    unit: values.unit,
    status: values.status,
    expected_arrival: optionalDate(values.expectedArrival),
    actual_arrival: optionalDate(values.actualArrival),
  };
}

function vendorPayload(values: Partial<ReturnType<typeof vendorSchema.parse>>) {
  return {
    vendor_name: values.vendorName,
    contact_person: values.contactPerson,
    email: values.email,
    phone: values.phone,
    address: values.address,
    material_categories: values.materialCategories,
    notes: values.notes,
    status: values.status,
  };
}

async function approvalPayload(values: Partial<ReturnType<typeof approvalSchema.parse>>) {
  return {
    approval_type: values.type,
    purchase_order_id: values.poNumber ? await findPurchaseOrderId(values.poNumber) : undefined,
    status: values.status,
    approval_date: optionalDate(values.date),
    notes: values.notes,
  };
}

async function productionLinePayload(
  values: Partial<ReturnType<typeof productionLineSchema.parse>>,
) {
  return {
    line_name: values.name,
    department: values.department,
    current_style: values.currentStyle,
    current_order_id: values.currentOrder ? await findPurchaseOrderId(values.currentOrder) : null,
    daily_target: values.dailyTarget,
    daily_actual: values.dailyActual,
    capacity: values.capacity,
    status: values.status,
  };
}

async function dailyUpdatePayload(values: Partial<ReturnType<typeof dailyUpdateSchema.parse>>) {
  return {
    production_date: optionalDate(values.date),
    production_stage: values.stage,
    production_line_id: values.lineId || null,
    purchase_order_id: values.poNumber ? await findPurchaseOrderId(values.poNumber) : null,
    target_quantity: values.targetQuantity,
    actual_quantity: values.actualQuantity,
    notes: values.notes,
  };
}

function dailyLogPayload(values: Partial<ReturnType<typeof dailyLogSchema.parse>>) {
  return {
    title: values.title,
    note: values.note,
    log_date: optionalDate(values.date),
    department_stage: values.departmentStage,
    purchase_order_id: values.purchaseOrderId || null,
    priority: values.priority,
    status: values.status,
  };
}

const productionStageLabels: Record<ProductionStage, string> = {
  Cutting: "Cutting",
  Upper: "Upper",
  Bottom: "Bottom",
  Packing: "Packing",
};

const productionStageOrder: ProductionStage[] = [...PRODUCTION_STAGES];

function achievementPercent(actual: number, target: number) {
  return target ? Math.round((actual / target) * 100) : 0;
}

function requirePurchasePatchPermission(role: Role | null, body: Record<string, unknown>) {
  if (role === "Owner" || role === "Planning") return;

  const keys = Object.keys(body);
  if (role === "Purchasing" && keys.every((key) => ["status", "notes"].includes(key))) return;
  if (
    role === "Warehouse" &&
    keys.every((key) => key === "status") &&
    ["Ready To Ship", "Shipped"].includes(String(body.status))
  ) {
    return;
  }

  throw new HttpError(403, "This role can only update permitted purchase order status fields.");
}

function statusForProductionStage(stage: string, currentStatus: string | null | undefined) {
  if (currentStatus === "Delayed" || currentStatus === "Shipped") return currentStatus;
  if (stage === "Completed") return "Ready To Ship";
  if (stage === "Packing") return "Packing";
  return "Production Running";
}

type UserProfileRow = {
  user_id: string;
  email?: string | null;
  full_name?: string | null;
  department?: string | null;
  role?: Role | null;
  active?: boolean | null;
};

function mapUser(row: UserProfileRow) {
  return {
    userId: row.user_id,
    email: row.email ?? "",
    fullName: row.full_name ?? null,
    department: row.department ?? null,
    role: row.role ?? null,
    active: Boolean(row.active),
  };
}

const customerSql = `
  select
    id,
    customer_name,
    brand,
    contact_person,
    email,
    phone,
    country,
    notes,
    status,
    created_at::text as created_at,
    updated_at::text as updated_at
  from customers
`;

const purchaseOrderSql = `
  select
    po.id,
    po.customer_id,
    po.po_number,
    po.buyer,
    po.po_date::text as po_date,
    po.article,
    po.brand,
    po.style_code,
    po.style_name,
    po.color,
    po.quantity,
    po.price,
    po.currency,
    po.delivery_date::text as delivery_date,
    po.status,
    po.notes,
    po.product_image_url,
    po.approved,
    po.approved_by,
    po.approved_at::text as approved_at,
    coalesce(po.current_stage, 'Cutting') as current_stage,
    po.style_id,
    po.assigned_production_line_id,
    po.assigned_lasting_line_id,
    po.planned_start_date::text as planned_start_date,
    po.planned_daily_capacity,
    po.estimated_lasting_days,
    po.estimated_completion_date::text as estimated_completion_date,
    coalesce(po.shipment_risk, 'Unknown') as shipment_risk,
    po.production_plan_summary,
    po.domino_warnings,
    json_build_object('customer_name', c.customer_name, 'brand', c.brand) as customers,
    case
      when approver.id is null then null
      else json_build_object('email', approver.email, 'full_name', approver_profile.full_name)
    end as approved_by_profile,
    coalesce((
      select json_agg(
        json_build_object(
          'id', pos.id,
          'purchase_order_id', pos.purchase_order_id,
          'size', pos.size,
          'quantity', pos.quantity,
          'notes', pos.notes
        )
        order by pos.size
      )
      from purchase_order_sizes pos
      where pos.purchase_order_id = po.id
    ), '[]'::json) as purchase_order_sizes
  from purchase_orders po
  left join customers c on c.id = po.customer_id
  left join users approver on approver.id = po.approved_by
  left join profiles approver_profile on approver_profile.user_id = approver.id
`;

const bomMaterialSql = `
  select
    bm.id,
    bm.style_id,
    bm.category,
    bm.material_category,
    bm.material_name,
    bm.specification,
    bm.supplier,
    bm.unit,
    bm.consumption_per_pair,
    bm.wastage_percent,
    bm.calculation_type,
    bm.fixed_quantity,
    bm.criticality,
    bm.critical,
    bm.notes,
    bm.default_vendor_id,
    json_build_object(
      'style_code', s.style_code,
      'style_name', s.style_name,
      'color', s.color,
      'brand', s.brand,
      'size_range', s.size_range
    ) as styles,
    case when v.id is null then null else json_build_object('vendor_name', v.vendor_name) end as vendors
  from bom_materials bm
  left join styles s on s.id = bm.style_id
  left join vendors v on v.id = bm.default_vendor_id
`;

const vendorSql = `
  select
    id,
    vendor_name,
    contact_person,
    email,
    phone,
    address,
    material_categories,
    notes,
    status
  from vendors
`;

const styleSql = `
  select
    id,
    style_code,
    style_name,
    color,
    brand,
    size_range,
    notes
  from styles
`;

const materialRequirementSql = `
  select
    mr.id,
    mr.purchase_order_id,
    mr.customer_id,
    mr.style_id,
    mr.bom_material_id,
    mr.parent_bom_material_id,
    mr.material_name,
    mr.specification,
    mr.calculation_type,
    mr.size_label,
    mr.size_value,
    mr.required_quantity,
    mr.ordered_quantity,
    mr.received_quantity,
    mr.balance_quantity,
    mr.unit,
    mr.vendor_id,
    mr.quantity_status,
    mr.notes,
    case when v.id is null then null else json_build_object('vendor_name', v.vendor_name) end as vendors
  from material_requirements mr
  left join vendors v on v.id = mr.vendor_id
`;

const materialPoSql = `
  select
    mpo.id,
    mpo.material_po_number,
    mpo.vendor_id,
    mpo.customer_id,
    mpo.purchase_order_id,
    mpo.style_id,
    mpo.generated_date::text as generated_date,
    mpo.expected_delivery_date::text as expected_delivery_date,
    mpo.status,
    mpo.notes,
    mpo.warnings,
    (
      select max(log.sent_at)::text
      from material_po_email_logs log
      where log.material_po_id = mpo.id
        and log.status in ('Sent', 'Demo')
    ) as last_sent_at,
    case when v.id is null then null else json_build_object('vendor_name', v.vendor_name, 'email', v.email) end as vendors,
    case when c.id is null then null else json_build_object('customer_name', c.customer_name) end as customers,
    json_build_object('po_number', po.po_number, 'style_code', po.style_code, 'color', po.color) as purchase_orders,
    coalesce((
      select json_agg(
        json_build_object(
          'id', mpi.id,
          'material_po_id', mpi.material_po_id,
          'material_requirement_id', mpi.material_requirement_id,
          'material_name', mpi.material_name,
          'specification', mpi.specification,
          'quantity', mpi.quantity,
          'unit', mpi.unit,
          'vendor_name_snapshot', mpi.vendor_name_snapshot,
          'notes', mpi.notes
        )
        order by mpi.material_name
      )
      from material_po_items mpi
      where mpi.material_po_id = mpo.id
        and mpi.archived_at is null
    ), '[]'::json) as material_po_items
  from material_purchase_orders mpo
  left join vendors v on v.id = mpo.vendor_id
  left join customers c on c.id = mpo.customer_id
  left join purchase_orders po on po.id = mpo.purchase_order_id
`;

const materialPoEmailLogSql = `
  select
    log.id,
    log.material_po_id,
    log.sent_at::text as sent_at,
    log.sent_by,
    log.recipient_email,
    log.email_subject,
    log.email_body,
    log.attachment_path,
    log.status,
    log.error_message,
    case
      when sender.id is null then null
      else json_build_object('email', sender.email, 'full_name', sender_profile.full_name)
    end as sent_by_profile
  from material_po_email_logs log
  left join users sender on sender.id = log.sent_by
  left join profiles sender_profile on sender_profile.user_id = sender.id
`;

const productionLineSql = `
  select
    pl.id,
    pl.line_name,
    pl.department,
    pl.current_style,
    pl.daily_target,
    pl.daily_actual,
    pl.capacity,
    pl.status,
    case when po.id is null then null else json_build_object('po_number', po.po_number) end as purchase_orders
  from production_lines pl
  left join purchase_orders po on po.id = pl.current_order_id
`;

const dailyUpdateSql = `
  select
    du.id,
    du.production_date::text as production_date,
    du.production_stage,
    du.production_line_id,
    du.target_quantity,
    du.actual_quantity,
    du.notes,
    json_build_object(
      'line_name', pl.line_name,
      'department', pl.department,
      'current_style', pl.current_style
    ) as production_lines,
    case
      when po.id is null then null
      else json_build_object(
        'po_number', po.po_number,
        'buyer', po.buyer,
        'style_code', po.style_code,
        'customer_name', c.customer_name
      )
    end as purchase_orders
  from daily_production_updates du
  left join production_lines pl on pl.id = du.production_line_id
  left join purchase_orders po on po.id = du.purchase_order_id
  left join customers c on c.id = po.customer_id
`;

const dailyLogSql = `
  select
    dl.id,
    dl.title,
    dl.note,
    dl.log_date::text as log_date,
    dl.author_id,
    dl.department_stage,
    dl.purchase_order_id,
    dl.priority,
    dl.status,
    dl.created_at::text as created_at,
    dl.updated_at::text as updated_at,
    case
      when author.id is null then null
      else json_build_object('email', author.email, 'full_name', author_profile.full_name)
    end as author_profile,
    case
      when po.id is null then null
      else json_build_object(
        'po_number', po.po_number,
        'buyer', po.buyer,
        'customer_name', c.customer_name
      )
    end as purchase_orders
  from daily_logs dl
  left join users author on author.id = dl.author_id
  left join profiles author_profile on author_profile.user_id = author.id
  left join purchase_orders po on po.id = dl.purchase_order_id
  left join customers c on c.id = po.customer_id
`;

const productionTimelineSql = `
  select
    pt.id,
    pt.purchase_order_id,
    pt.event_type,
    pt.event_title,
    pt.event_description,
    pt.user_id,
    pt.created_at::text as created_at,
    case
      when author.id is null then null
      else json_build_object('email', author.email, 'full_name', author_profile.full_name)
    end as author_profile,
    case
      when po.id is null then null
      else json_build_object(
        'po_number', po.po_number,
        'buyer', po.buyer,
        'customer_name', c.customer_name,
        'style_code', po.style_code
      )
    end as purchase_orders
  from production_timeline pt
  left join users author on author.id = pt.user_id
  left join profiles author_profile on author_profile.user_id = author.id
  left join purchase_orders po on po.id = pt.purchase_order_id
  left join customers c on c.id = po.customer_id
`;

async function purchaseOrderRows(
  where = "",
  params: SqlParams = [],
  order = "order by po.delivery_date asc",
) {
  return many(`${purchaseOrderSql} ${where} ${order}`, params);
}

function archiveMode(req: AuthedRequest) {
  const value = typeof req.query.archive === "string" ? req.query.archive : "active";
  return value === "archived" || value === "all" ? value : "active";
}

function archiveWhere(alias: string, mode: string) {
  if (mode === "all") return "true";
  if (mode === "archived") return `${alias}.archived_at is not null`;
  return `${alias}.archived_at is null`;
}

async function purchaseOrderById(id: string) {
  return one(`${purchaseOrderSql} where po.id = $1`, [id]);
}

async function productionLineById(id: string) {
  return one(`${productionLineSql} where pl.id = $1`, [id]);
}

async function bomMaterialById(id: string) {
  return one(`${bomMaterialSql} where bm.id = $1`, [id]);
}

function safeMaterialPoFilename(materialPoNumber: string) {
  const base = materialPoNumber.replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "");
  return `${base || "material-po"}.xlsx`;
}

function assertInsideDirectory(root: string, target: string) {
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new HttpError(400, "Generated attachment path is outside the allowed folder.");
  }
}

function generationFailure(prefix: string, error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error.";
  const status = error instanceof HttpError ? error.status : 500;
  return new HttpError(status, `${prefix} because ${message}`);
}

type MaterialPoPreviewRow = {
  id: string;
  material_po_number: string;
  generated_date?: string | null;
  expected_delivery_date?: string | null;
  status: string;
  notes?: string | null;
  vendor_name?: string | null;
  vendor_contact?: string | null;
  vendor_email?: string | null;
  customer_name?: string | null;
  po_number?: string | null;
  style_code?: string | null;
  color?: string | null;
  items?: Array<{
    material_name?: string | null;
    specification?: string | null;
    quantity?: number | string | null;
    unit?: string | null;
    notes?: string | null;
  }> | null;
};

async function materialPoPreview(materialPoId: string): Promise<MaterialPoPreview> {
  const row = await one<MaterialPoPreviewRow>(
    `
      select
        mpo.id,
        mpo.material_po_number,
        mpo.generated_date::text as generated_date,
        mpo.expected_delivery_date::text as expected_delivery_date,
        mpo.status,
        mpo.notes,
        v.vendor_name,
        v.contact_person as vendor_contact,
        v.email as vendor_email,
        c.customer_name,
        po.po_number,
        po.style_code,
        po.color,
        coalesce((
          select json_agg(
            json_build_object(
              'material_name', mpi.material_name,
              'specification', mpi.specification,
              'quantity', mpi.quantity,
              'unit', mpi.unit,
              'notes', mpi.notes
            )
            order by mpi.material_name
          )
          from material_po_items mpi
          where mpi.material_po_id = mpo.id
            and mpi.archived_at is null
        ), '[]'::json) as items
      from material_purchase_orders mpo
      left join vendors v on v.id = mpo.vendor_id
      left join customers c on c.id = mpo.customer_id
      left join purchase_orders po on po.id = mpo.purchase_order_id
      where mpo.id = $1
    `,
    [materialPoId],
  );

  return {
    companyName: env.companyName,
    vendorName: row.vendor_name || "Unassigned Vendor",
    vendorContact: row.vendor_contact ?? "",
    vendorEmail: row.vendor_email ?? "",
    materialPoNumber: row.material_po_number,
    generatedDate: row.generated_date ?? "",
    expectedDeliveryDate: row.expected_delivery_date ?? "",
    customerName: row.customer_name ?? "",
    customerPoNumber: row.po_number ?? "",
    styleCode: row.style_code ?? "",
    color: row.color ?? "",
    notes: row.notes ?? "",
    items: (row.items ?? []).map((item) => ({
      materialName: item.material_name ?? "",
      specification: item.specification ?? "",
      quantity: Number(item.quantity ?? 0),
      unit: item.unit ?? "",
      expectedDeliveryDate: row.expected_delivery_date ?? "",
      notes: item.notes ?? "",
    })),
  };
}

function materialPoSubject(preview: MaterialPoPreview) {
  return `Material PO ${preview.materialPoNumber} - ${preview.customerName} - ${preview.styleCode}`;
}

function materialPoBody(preview: MaterialPoPreview) {
  return [
    `Dear ${preview.vendorName},`,
    "",
    `Please find attached the material purchase order for ${preview.styleCode} / ${preview.customerPoNumber}.`,
    "",
    "Kindly confirm receipt and expected delivery date.",
    "",
    "Regards,",
    preview.companyName,
  ].join("\n");
}

async function writeMaterialPoWorkbook(preview: MaterialPoPreview) {
  const year = new Date().getFullYear().toString();
  const outputDir = path.join(materialPoFilesRoot, year);
  await fs.mkdir(outputDir, { recursive: true });
  const filename = safeMaterialPoFilename(preview.materialPoNumber);
  const filePath = path.join(outputDir, filename);
  assertInsideDirectory(materialPoFilesRoot, filePath);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = preview.companyName;
  const worksheet = workbook.addWorksheet("Material PO");

  worksheet.mergeCells("A1:F1");
  worksheet.getCell("A1").value = preview.companyName;
  worksheet.getCell("A1").font = { bold: true, size: 16 };
  worksheet.getCell("A1").alignment = { horizontal: "center" };

  const infoRows = [
    ["Vendor", preview.vendorName, "Material PO", preview.materialPoNumber],
    ["Vendor Contact", preview.vendorContact || "-", "Date", preview.generatedDate || "-"],
    [
      "Vendor Email",
      preview.vendorEmail || "-",
      "Expected Delivery",
      preview.expectedDeliveryDate || "-",
    ],
    ["Customer", preview.customerName || "-", "Customer PO", preview.customerPoNumber || "-"],
    ["Style", preview.styleCode || "-", "Color", preview.color || "-"],
  ];
  for (const [index, values] of infoRows.entries()) {
    const row = worksheet.getRow(index + 3);
    row.values = values;
    row.getCell(1).font = { bold: true };
    row.getCell(3).font = { bold: true };
  }

  const headerRowIndex = 10;
  const headers = [
    "Material Name",
    "Specification",
    "Required Quantity",
    "Unit",
    "Expected Delivery",
    "Notes",
  ];
  worksheet.getRow(headerRowIndex).values = headers;
  worksheet.getRow(headerRowIndex).font = { bold: true };

  preview.items.forEach((item, index) => {
    worksheet.getRow(headerRowIndex + index + 1).values = [
      item.materialName,
      item.specification,
      item.quantity,
      item.unit,
      item.expectedDeliveryDate,
      item.notes,
    ];
  });

  const finalRow = headerRowIndex + Math.max(preview.items.length, 1);
  for (let rowIndex = headerRowIndex; rowIndex <= finalRow; rowIndex += 1) {
    const row = worksheet.getRow(rowIndex);
    row.eachCell((cell) => {
      cell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };
      cell.alignment = { vertical: "top", wrapText: true };
    });
  }

  if (preview.notes) {
    const notesRow = worksheet.getRow(finalRow + 2);
    notesRow.getCell(1).value = "Notes";
    notesRow.getCell(1).font = { bold: true };
    notesRow.getCell(2).value = preview.notes;
  }

  worksheet.columns = [
    { width: 26 },
    { width: 34 },
    { width: 18 },
    { width: 12 },
    { width: 18 },
    { width: 30 },
  ];

  await workbook.xlsx.writeFile(filePath);
  return { filePath, filename };
}

async function sendMaterialPoEmailViaNodemailer({
  recipientEmail,
  subject,
  body,
  attachmentPath,
  attachmentName,
}: {
  recipientEmail: string;
  subject: string;
  body: string;
  attachmentPath: string;
  attachmentName: string;
}) {
  if (!env.smtpHost || !env.smtpFrom) {
    throw new HttpError(
      503,
      "SMTP is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_FROM, and SMTP_USER/SMTP_PASS if required.",
    );
  }

  let nodemailer: typeof import("nodemailer");
  try {
    nodemailer = await import("nodemailer");
  } catch {
    throw new HttpError(
      503,
      "Nodemailer is not installed on this API server. Run npm install nodemailer @types/nodemailer, then restart the API.",
    );
  }

  const transporter = nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpPort === 465,
    auth: env.smtpUser || env.smtpPass ? { user: env.smtpUser, pass: env.smtpPass } : undefined,
  });

  await transporter.sendMail({
    from: env.smtpFrom,
    to: recipientEmail,
    subject,
    text: body,
    attachments: [{ filename: attachmentName, path: attachmentPath }],
  });
}

async function replacePurchaseOrderSizes(
  purchaseOrderId: string,
  sizes: ReturnType<typeof purchaseOrderSizesSchema.parse>["sizes"],
) {
  const seenSizes = new Set<string>();
  for (const size of sizes) {
    const key = size.size.trim().toLowerCase();
    if (seenSizes.has(key)) {
      throw new HttpError(
        400,
        `Size ${size.size} appears more than once. Combine duplicate size rows before saving.`,
      );
    }
    seenSizes.add(key);
  }

  return transaction(async (client) => {
    await client.query("delete from purchase_order_sizes where purchase_order_id = $1", [
      purchaseOrderId,
    ]);
    if (!sizes.length) return [];

    const rows = sizes.map((size) => ({
      size: size.size,
      quantity: size.quantity,
      notes: size.notes ?? "",
    }));
    const result = await client.query<{
      id: string;
      purchase_order_id: string;
      size: string;
      quantity: number;
      notes?: string | null;
    }>(
      `
        insert into purchase_order_sizes (purchase_order_id, size, quantity, notes)
        select $1, item.size, item.quantity, item.notes
        from jsonb_to_recordset($2::jsonb) as item(size text, quantity integer, notes text)
        returning id, purchase_order_id, size, quantity, notes
      `,
      [purchaseOrderId, JSON.stringify(rows)],
    );
    return result.rows.map(mapPurchaseOrderSize);
  });
}

api.use(requireAuth);

api.get(
  "/me",
  asyncHandler<AuthedRequest>(async (req, res) => {
    res.json(req.auth.profile);
  }),
);

api.use(requireActive);

api.patch(
  "/admin/archive/:entity/:id",
  requireRoles("Management"),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { entity, id } = parse(adminEntitySchema, req.params);
    const body = parse(archiveActionSchema, req.body);
    const result = await transaction((client) =>
      archiveEntity(client, entity, id, req.auth.userId, body.reason),
    );
    res.json(result);
  }),
);

api.patch(
  "/admin/restore/:entity/:id",
  requireRoles("Management"),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { entity, id } = parse(adminEntitySchema, req.params);
    const result = await transaction((client) => restoreEntity(client, entity, id));
    res.json(result);
  }),
);

api.delete(
  "/admin/hard-delete/:entity/:id",
  requireRoles("Owner"),
  asyncHandler<AuthedRequest>(async (req, res) => {
    if (!env.allowDestructiveAdminActions) {
      throw new HttpError(
        403,
        "Permanent delete is disabled. Set ALLOW_DESTRUCTIVE_ADMIN_ACTIONS=true to enable it locally.",
      );
    }
    const { entity, id } = parse(adminEntitySchema, req.params);
    parse(hardDeleteSchema, req.body);
    const result = await transaction((client) => hardDeleteArchivedEntity(client, entity, id));
    res.json(result);
  }),
);

api.post(
  "/admin/clear-test-data",
  requireRoles("Owner"),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const body = parse(clearTestDataSchema, req.body);
    const expected = body.mode === "hard-delete" ? "DELETE PERMANENTLY" : "CLEAR TEST DATA";
    if (body.confirmation !== expected) {
      throw new HttpError(400, `Type ${expected} to confirm this action.`);
    }
    if (body.scope === "all-demo-local") {
      throw new HttpError(400, "Demo localStorage can only be cleared from the browser demo mode.");
    }
    const result = await transaction((client) =>
      clearTestData(
        client,
        body.scope as Exclude<typeof body.scope, "all-demo-local">,
        req.auth.userId,
        body.mode,
        env.allowDestructiveAdminActions,
      ),
    );
    res.json(result);
  }),
);

api.post(
  "/admin/retention/run",
  requireRoles("Owner"),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const body = parse(retentionRunSchema, req.body);
    if (
      body.deleteArchivedOlderThanYears !== undefined &&
      body.confirmation !== "DELETE PERMANENTLY"
    ) {
      throw new HttpError(400, "Type DELETE PERMANENTLY to confirm retention hard delete.");
    }
    const result = await transaction((client) =>
      runRetention(
        client,
        req.auth.userId,
        body.archiveOlderThanYears,
        body.deleteArchivedOlderThanYears,
        env.allowDestructiveAdminActions,
      ),
    );
    res.json(result);
  }),
);

api.post(
  "/uploads/po-images",
  requireRoles("Planning", "Sales"),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const boundary = getMultipartBoundary(req.headers["content-type"]);
    if (!boundary) throw new HttpError(400, "Expected multipart image upload.");

    const upload = parseSingleMultipartFile(
      await readRequestBuffer(req, maxMultipartBytes),
      boundary,
    );
    if (!upload.data.length) throw new HttpError(400, "Uploaded image is empty.");
    if (upload.data.length > maxImageBytes) throw new HttpError(413, "Image upload is too large.");

    const extension = imageExtension(upload.contentType, upload.data);
    if (!extension) {
      throw new HttpError(400, "Only PNG, JPEG, GIF, or WebP images are allowed.");
    }

    await fs.mkdir(poImageUploadDir, { recursive: true });
    const filename = `${randomUUID()}${extension}`;
    await fs.writeFile(path.join(poImageUploadDir, filename), upload.data, { flag: "wx" });

    res.status(201).json({ path: `/uploads/po-images/${filename}` });
  }),
);

api.post(
  "/imports/po/preview",
  requireRoles("Planning", "Sales"),
  asyncHandler<AuthedRequest>(async (req, res) => {
    res.json(await previewPoImport(localDb, await readExcelUpload(req)));
  }),
);

api.post(
  "/imports/po/confirm",
  requireRoles("Planning", "Sales"),
  asyncHandler<AuthedRequest>(async (req, res) => {
    if (!req.body?.payload) throw new HttpError(400, "Import payload is required.");
    res.json(
      await transaction((client) =>
        confirmPoImport(client, req.auth.userId, req.body.payload, {
          runDomino: req.auth.role !== "Sales",
        }),
      ),
    );
  }),
);

api.post(
  "/imports/bom/preview",
  requireRoles("Planning", "Purchasing"),
  asyncHandler<AuthedRequest>(async (req, res) => {
    res.json(await previewBomImport(localDb, await readExcelUpload(req)));
  }),
);

api.post(
  "/imports/bom/confirm",
  requireRoles("Planning", "Purchasing"),
  asyncHandler<AuthedRequest>(async (req, res) => {
    if (!req.body?.payload) throw new HttpError(400, "Import payload is required.");
    res.json(
      await transaction((client) => confirmBomImport(client, req.auth.userId, req.body.payload)),
    );
  }),
);

api.get(
  "/users",
  requireRoles("Owner"),
  asyncHandler<AuthedRequest>(async (_req, res) => {
    const rows = await many<UserProfileRow>(`
      select p.user_id, u.email, p.full_name, p.department, p.role, p.active
      from profiles p
      join users u on u.id = p.user_id
      order by p.full_name nulls last, u.email
    `);
    res.json(rows.map(mapUser));
  }),
);

api.post(
  "/users",
  requireRoles("Owner"),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const body = parse(userCreateSchema, req.body);
    const existing = await many<{ id: string }>(
      "select id from users where lower(email) = lower($1) limit 1",
      [body.email],
    );
    if (existing.length) {
      throw new HttpError(400, "A user with this email already exists.");
    }

    const userId = randomUUID();
    await transaction(async (client) => {
      await client.query("insert into users (id, email) values ($1, $2)", [userId, body.email]);
      await client.query(
        `
          insert into profiles (user_id, full_name, department, role, active)
          values ($1, $2, $3, $4, $5)
        `,
        [userId, body.fullName || body.email, body.department || null, body.role, body.active],
      );
    });

    const row = await one<UserProfileRow>(
      `
        select p.user_id, u.email, p.full_name, p.department, p.role, p.active
        from profiles p
        join users u on u.id = p.user_id
        where p.user_id = $1
      `,
      [userId],
    );
    res.status(201).json(mapUser(row));
  }),
);

api.patch(
  "/users/:id",
  requireRoles("Owner"),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { id } = parse(idParamSchema, req.params);
    const body = parse(userPatchSchema, req.body);
    await updateRecord("profiles", "user_id", id, {
      full_name: body.fullName,
      department: body.department,
      role: body.role,
      active: body.active,
    });
    const row = await one<UserProfileRow>(
      `
        select p.user_id, u.email, p.full_name, p.department, p.role, p.active
        from profiles p
        join users u on u.id = p.user_id
        where p.user_id = $1
      `,
      [id],
    );
    res.json(mapUser(row));
  }),
);

api.get(
  "/customers",
  requireRoles("Management", "Planning", "Sales", "Purchasing"),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const rows = await many(
      `${customerSql} where ${archiveWhere("customers", archiveMode(req))} order by customer_name asc`,
    );
    res.json(rows.map(mapCustomer));
  }),
);

api.get(
  "/customers/:id",
  requireRoles("Management", "Planning", "Sales", "Purchasing"),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { id } = parse(idParamSchema, req.params);
    res.json(mapCustomer(await one(`${customerSql} where id = $1`, [id])));
  }),
);

api.post(
  "/customers",
  requireRoles("Planning", "Sales"),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const body = parse(customerSchema, req.body);
    const payload = customerPayload(body);
    const row = await one(
      `
        insert into customers (
          customer_name, brand, contact_person, email, phone, country, notes, status, created_by, updated_by
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
        returning id
      `,
      [
        payload.customer_name,
        payload.brand,
        payload.contact_person,
        payload.email,
        payload.phone,
        payload.country,
        payload.notes,
        payload.status,
        req.auth.userId,
      ],
    );
    res.status(201).json(mapCustomer(await one(`${customerSql} where id = $1`, [row.id])));
  }),
);

api.patch(
  "/customers/:id",
  requireRoles("Planning", "Sales"),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { id } = parse(idParamSchema, req.params);
    const body = parse(customerPatchSchema, req.body);
    await updateRecord("customers", "id", id, {
      ...customerPayload(body),
      updated_by: req.auth.userId,
    });
    res.json(mapCustomer(await one(`${customerSql} where id = $1`, [id])));
  }),
);

api.get(
  "/purchase-orders",
  requireRoles("Management", "Planning", "Sales", "Purchasing", "Production", "Quality"),
  asyncHandler<AuthedRequest>(async (req, res) => {
    res.json(
      (await purchaseOrderRows(`where ${archiveWhere("po", archiveMode(req))}`)).map(
        mapPurchaseOrder,
      ),
    );
  }),
);

api.post(
  "/purchase-orders",
  requireRoles("Planning", "Sales"),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const body = parse(purchaseOrderSchema, req.body);
    const payload = await purchaseOrderPayload(body);
    const row = await one<{ id: string }>(
      `
        insert into purchase_orders (
          customer_id, po_number, buyer, po_date, article, brand, style_code, style_name,
          color, quantity, price, currency, delivery_date, status, notes, product_image_url,
          current_stage, assigned_production_line_id, assigned_lasting_line_id, planned_start_date,
          created_by, updated_by
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $21)
        returning id
      `,
      [
        payload.customer_id,
        payload.po_number,
        payload.buyer,
        payload.po_date,
        payload.article,
        payload.brand,
        payload.style_code,
        payload.style_name,
        payload.color,
        payload.quantity,
        payload.price,
        payload.currency,
        payload.delivery_date,
        payload.status,
        payload.notes,
        payload.product_image_url,
        payload.current_stage,
        payload.assigned_production_line_id,
        payload.assigned_lasting_line_id,
        payload.planned_start_date,
        req.auth.userId,
      ],
    );
    if (body.sizes.length) {
      await replacePurchaseOrderSizes(row.id, body.sizes);
    }
    await addProductionTimelineEvent(localDb, {
      purchaseOrderId: row.id,
      eventType: "po_created",
      eventTitle: "PO Created",
      eventDescription: `Purchase order ${payload.po_number} was created.`,
      userId: req.auth.userId,
    });
    if (req.auth.role !== "Sales") {
      const dominoResult = await runDominoWorkflow(req.auth.userId, row.id);
      await addDominoTimelineEvents(localDb, req.auth.userId, row.id, dominoResult);
    }
    res.status(201).json(mapPurchaseOrder(await purchaseOrderById(row.id)));
  }),
);

api.patch(
  "/purchase-orders/:id",
  requireRoles("Planning", "Purchasing", "Warehouse"),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { id } = parse(idParamSchema, req.params);
    const body = parse(purchaseOrderPatchSchema, req.body);
    requirePurchasePatchPermission(req.auth.role, body);
    const before = await one<{
      delivery_date?: string | null;
      estimated_completion_date?: string | null;
    }>(
      "select delivery_date::text as delivery_date, estimated_completion_date::text as estimated_completion_date from purchase_orders where id = $1",
      [id],
    );
    await updateRecord("purchase_orders", "id", id, {
      ...(await purchaseOrderPayload(body)),
      updated_by: req.auth.userId,
    });
    if (Array.isArray(body.sizes)) {
      await replacePurchaseOrderSizes(id, body.sizes);
    }
    if (
      Object.keys(body).some((key) =>
        [
          "styleCode",
          "color",
          "brand",
          "quantity",
          "deliveryDate",
          "assignedProductionLineId",
          "assignedLastingLineId",
          "plannedStartDate",
        ].includes(key),
      )
    ) {
      const dominoResult = await runDominoWorkflow(req.auth.userId, id);
      await addDominoTimelineEvents(localDb, req.auth.userId, id, dominoResult);
    }
    const saved = mapPurchaseOrder(await purchaseOrderById(id));
    if (body.deliveryDate && before.delivery_date !== saved.deliveryDate) {
      await addProductionTimelineEvent(localDb, {
        purchaseOrderId: id,
        eventType: "delivery_date_changed",
        eventTitle: "Delivery Date Changed",
        eventDescription: `Delivery date changed from ${before.delivery_date || "unset"} to ${saved.deliveryDate}.`,
        userId: req.auth.userId,
      });
    }
    if (
      saved.estimatedCompletionDate &&
      before.estimated_completion_date !== saved.estimatedCompletionDate
    ) {
      await addProductionTimelineEvent(localDb, {
        purchaseOrderId: id,
        eventType: "completion_estimate_changed",
        eventTitle: "Estimated Completion Updated",
        eventDescription: `Estimated completion is now ${saved.estimatedCompletionDate}.`,
        userId: req.auth.userId,
      });
    }
    res.json(saved);
  }),
);

api.patch(
  "/purchase-orders/:id/stage",
  requireRoles("Management", "Planning", "Production"),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { id } = parse(idParamSchema, req.params);
    const body = parse(productionStageSchema, req.body);
    const current = await one<{ status: string | null; current_stage: string | null }>(
      "select status, current_stage from purchase_orders where id = $1",
      [id],
    );
    await updateRecord("purchase_orders", "id", id, {
      current_stage: body.currentStage,
      status: statusForProductionStage(body.currentStage, current.status),
      updated_by: req.auth.userId,
    });
    await addProductionTimelineEvent(localDb, {
      purchaseOrderId: id,
      eventType: "stage_changed",
      eventTitle: body.currentStage === "Completed" ? "Completed" : `Moved to ${body.currentStage}`,
      eventDescription: `${current.current_stage || "Planning"} -> ${body.currentStage}`,
      userId: req.auth.userId,
    });
    res.json({ purchaseOrder: mapPurchaseOrder(await purchaseOrderById(id)) });
  }),
);

api.patch(
  "/purchase-orders/:id/final-approval",
  requireRoles("Management", "Planning"),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { id } = parse(idParamSchema, req.params);
    const body = parse(finalApprovalSchema, req.body);
    await transaction(async (client) => {
      await client.query(
        `
          insert into users (id, email)
          values ($1, $2)
          on conflict (id) do nothing
        `,
        [req.auth.userId, req.auth.email],
      );
      const result = await client.query(
        `
          update purchase_orders
          set
            approved = $1::boolean,
            approved_by = case when $1::boolean then $2::uuid else null::uuid end,
            approved_at = case when $1::boolean then now() else null::timestamptz end,
            updated_by = $2::uuid
          where id = $3
        `,
        [body.approved, req.auth.userId, id],
      );
      if (!result.rowCount) throw new HttpError(404, "Purchase order was not found.");
      await addProductionTimelineEvent(client, {
        purchaseOrderId: id,
        eventType: body.approved ? "approval_given" : "approval_cleared",
        eventTitle: body.approved ? "Approval Given" : "Approval Cleared",
        eventDescription: body.approved
          ? "Final approval was given for this purchase order."
          : "Final approval was cleared for this purchase order.",
        userId: req.auth.userId,
      });
    });
    res.json(mapPurchaseOrder(await purchaseOrderById(id)));
  }),
);

api.patch(
  "/purchase-orders/:id/link-style",
  requireRoles("Management", "Planning", "Purchasing"),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { id } = parse(idParamSchema, req.params);
    const body = parse(styleLinkSchema, req.body);
    const style = await one<{ id: string }>("select id from styles where id = $1", [body.styleId]);
    await query(
      `
        update purchase_orders
        set style_id = $2, updated_by = $3
        where id = $1
      `,
      [id, style.id, req.auth.userId],
    );
    await addProductionTimelineEvent(localDb, {
      purchaseOrderId: id,
      eventType: "bom_linked",
      eventTitle: "BOM Linked",
      eventDescription: "A BOM/style was linked manually from PO detail.",
      userId: req.auth.userId,
    });
    const dominoResult = await runDominoWorkflow(req.auth.userId, id);
    await addDominoTimelineEvents(localDb, req.auth.userId, id, dominoResult);
    res.json(mapPurchaseOrder(await purchaseOrderById(id)));
  }),
);

api.post(
  "/purchase-orders/:id/regenerate-domino",
  requireRoles("Management", "Planning", "Purchasing"),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { id } = parse(idParamSchema, req.params);
    const dominoResult = await runDominoWorkflow(req.auth.userId, id);
    await addDominoTimelineEvents(localDb, req.auth.userId, id, dominoResult);
    res.json(mapPurchaseOrder(await purchaseOrderById(id)));
  }),
);

api.get(
  "/purchase-orders/:id/timeline",
  requireRoles("Management", "Planning", "Sales", "Purchasing", "Production"),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { id } = parse(idParamSchema, req.params);
    const rows = await many(
      `${productionTimelineSql} where pt.purchase_order_id = $1 order by pt.created_at desc limit 100`,
      [id],
    );
    res.json(rows.map(mapProductionTimelineEvent));
  }),
);

api.get(
  "/purchase-orders/:id/sizes",
  requireRoles("Management", "Planning", "Sales", "Purchasing", "Production"),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { id } = parse(idParamSchema, req.params);
    const rows = await many(
      `
        select id, purchase_order_id, size, quantity, notes
        from purchase_order_sizes
        where purchase_order_id = $1
        order by size asc
      `,
      [id],
    );
    res.json(rows.map(mapPurchaseOrderSize));
  }),
);

api.put(
  "/purchase-orders/:id/sizes",
  requireRoles("Planning"),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { id } = parse(idParamSchema, req.params);
    const body = parse(purchaseOrderSizesSchema, req.body);
    res.json(await replacePurchaseOrderSizes(id, body.sizes));
  }),
);

api.get(
  "/styles",
  requireRoles(
    "Management",
    "Planning",
    "Sales",
    "Purchasing",
    "Production",
    "Warehouse",
    "Quality",
  ),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const rows = await many(
      `${styleSql} where ${archiveWhere("styles", archiveMode(req))} order by style_code asc, color asc, brand asc`,
    );
    res.json(rows.map(mapStyle));
  }),
);

api.get(
  "/bom-materials",
  requireRoles(
    "Management",
    "Planning",
    "Sales",
    "Purchasing",
    "Warehouse",
    "Production",
    "Quality",
  ),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const rows = await many(
      `${bomMaterialSql} where ${archiveWhere("bm", archiveMode(req))} order by bm.material_name asc`,
    );
    res.json(rows.map(mapBomMaterial));
  }),
);

api.patch(
  "/bom-materials/:id/default-vendor",
  requireRoles("Management", "Planning", "Purchasing"),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { id } = parse(idParamSchema, req.params);
    const body = parse(bomDefaultVendorSchema, req.body);
    const vendorId = body.vendorId ?? null;

    if (vendorId) {
      await one("select id from vendors where id = $1", [vendorId]);
    }

    await updateRecord("bom_materials", "id", id, {
      default_vendor_id: vendorId,
      updated_by: req.auth.userId,
    });

    const material = await bomMaterialById(id);
    const regeneratedPurchaseOrderIds: string[] = [];

    if (body.regenerateDrafts) {
      const styleId = material.style_id;
      if (styleId) {
        const linkedOrders = await many<{ id: string }>(
          "select id from purchase_orders where style_id = $1 order by delivery_date asc",
          [styleId],
        );
        for (const order of linkedOrders) {
          await addProductionTimelineEvent(localDb, {
            purchaseOrderId: order.id,
            eventType: "vendor_assigned",
            eventTitle: "Vendor Assigned",
            eventDescription: "Default vendor assignment changed for a linked BOM material.",
            userId: req.auth.userId,
          });
          const dominoResult = await runDominoWorkflow(req.auth.userId, order.id);
          await addDominoTimelineEvents(localDb, req.auth.userId, order.id, dominoResult);
          regeneratedPurchaseOrderIds.push(order.id);
        }
      }
    }

    res.json({
      material: mapBomMaterial(await bomMaterialById(id)),
      regeneratedPurchaseOrderIds,
    });
  }),
);

api.get(
  "/vendors",
  requireRoles("Management", "Planning", "Purchasing"),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const rows = await many(
      `${vendorSql} where ${archiveWhere("vendors", archiveMode(req))} order by vendor_name asc`,
    );
    res.json(rows.map(mapVendor));
  }),
);

api.get(
  "/vendors/:id",
  requireRoles("Management", "Planning", "Purchasing"),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { id } = parse(idParamSchema, req.params);
    res.json(mapVendor(await one(`${vendorSql} where id = $1`, [id])));
  }),
);

api.post(
  "/vendors",
  requireRoles("Management", "Planning", "Purchasing"),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const body = parse(vendorSchema, req.body);
    const payload = vendorPayload(body);
    const row = await one<{ id: string }>(
      `
        insert into vendors (
          vendor_name,
          contact_person,
          email,
          phone,
          address,
          material_categories,
          notes,
          status,
          created_by,
          updated_by
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
        returning id
      `,
      [
        payload.vendor_name,
        payload.contact_person,
        payload.email,
        payload.phone,
        payload.address,
        payload.material_categories,
        payload.notes,
        payload.status,
        req.auth.userId,
      ],
    );
    res.status(201).json(mapVendor(await one(`${vendorSql} where id = $1`, [row.id])));
  }),
);

api.patch(
  "/vendors/:id",
  requireRoles("Management", "Planning", "Purchasing"),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { id } = parse(idParamSchema, req.params);
    const body = parse(vendorPatchSchema, req.body);
    await updateRecord("vendors", "id", id, {
      ...vendorPayload(body),
      updated_by: req.auth.userId,
    });
    res.json(mapVendor(await one(`${vendorSql} where id = $1`, [id])));
  }),
);

api.get(
  "/material-requirements",
  requireRoles("Management", "Planning", "Purchasing", "Warehouse"),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const rows = await many(
      `${materialRequirementSql} where ${archiveWhere("mr", archiveMode(req))} order by mr.material_name asc`,
    );
    res.json(rows.map(mapMaterialRequirement));
  }),
);

api.get(
  "/purchase-orders/:id/material-requirements",
  requireRoles("Management", "Planning", "Purchasing"),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { id } = parse(idParamSchema, req.params);
    const rows = await many(
      `${materialRequirementSql} where mr.purchase_order_id = $1 and mr.archived_at is null order by mr.material_name asc`,
      [id],
    );
    res.json(rows.map(mapMaterialRequirement));
  }),
);

api.get(
  "/material-pos",
  requireRoles("Management", "Planning", "Purchasing"),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const purchaseOrderId =
      typeof req.query.purchaseOrderId === "string" ? req.query.purchaseOrderId : "";
    const archiveCondition = archiveWhere("mpo", archiveMode(req));
    const rows = purchaseOrderId
      ? await many(
          `${materialPoSql} where mpo.purchase_order_id = $1 and ${archiveCondition} order by mpo.generated_date desc`,
          [parse(idParamSchema, { id: purchaseOrderId }).id],
        )
      : await many(`${materialPoSql} where ${archiveCondition} order by mpo.generated_date desc`);
    res.json(rows.map(mapMaterialPurchaseOrder));
  }),
);

api.get(
  "/material-pos/:id/preview",
  requireRoles("Management", "Planning", "Purchasing"),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { id } = parse(idParamSchema, req.params);
    res.json(await materialPoPreview(id));
  }),
);

api.get(
  "/material-pos/:id/export.xlsx",
  requireRoles("Management", "Planning", "Purchasing"),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { id } = parse(idParamSchema, req.params);
    let filePath = "";
    let filename = "";
    try {
      const preview = await materialPoPreview(id);
      const written = await writeMaterialPoWorkbook(preview);
      filePath = written.filePath;
      filename = written.filename;
    } catch (error) {
      throw generationFailure("Could not generate Material PO Excel", error);
    }

    res.download(filePath, filename, (error) => {
      if (error && !res.headersSent) {
        res.status(500).json({
          error: `Could not download Material PO Excel because ${error.message}`,
        });
      }
    });
  }),
);

api.get(
  "/material-pos/:id/email-logs",
  requireRoles("Management", "Planning", "Purchasing"),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { id } = parse(idParamSchema, req.params);
    const rows = await many(
      `${materialPoEmailLogSql} where log.material_po_id = $1 order by log.sent_at desc`,
      [id],
    );
    res.json(rows.map(mapMaterialPoEmailLog));
  }),
);

api.post(
  "/material-pos/:id/send-email",
  requireRoles("Management", "Planning", "Purchasing"),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { id } = parse(idParamSchema, req.params);
    const body = parse(materialPoEmailSchema, req.body);
    const preview = await materialPoPreview(id);
    const materialPoStatus = await one<{ status: string }>(
      "select status from material_purchase_orders where id = $1",
      [id],
    );
    if (["Confirmed", "Completed", "Cancelled"].includes(materialPoStatus.status)) {
      throw new HttpError(
        400,
        `Material PO is ${materialPoStatus.status} and cannot be emailed from this screen.`,
      );
    }
    const { filePath, filename } = await writeMaterialPoWorkbook(preview);
    assertInsideDirectory(materialPoFilesRoot, filePath);

    try {
      await sendMaterialPoEmailViaNodemailer({
        recipientEmail: body.recipientEmail,
        subject: body.subject,
        body: body.body,
        attachmentPath: filePath,
        attachmentName: filename,
      });

      await transaction(async (client) => {
        await client.query(
          `
            insert into material_po_email_logs (
              material_po_id,
              sent_by,
              recipient_email,
              email_subject,
              email_body,
              attachment_path,
              status
            )
            values ($1, $2, $3, $4, $5, $6, 'Sent')
          `,
          [id, req.auth.userId, body.recipientEmail, body.subject, body.body, filePath],
        );
        await client.query(
          "update material_purchase_orders set status = 'Sent', updated_by = $2 where id = $1",
          [id, req.auth.userId],
        );
      });
    } catch (sendError) {
      const message = (sendError as Error).message || "Email failed.";
      await query(
        `
          insert into material_po_email_logs (
            material_po_id,
            sent_by,
            recipient_email,
            email_subject,
            email_body,
            attachment_path,
            status,
            error_message
          )
          values ($1, $2, $3, $4, $5, $6, 'Failed', $7)
        `,
        [id, req.auth.userId, body.recipientEmail, body.subject, body.body, filePath, message],
      );
      if (sendError instanceof HttpError) throw sendError;
      throw new HttpError(502, `Email failed: ${message}`);
    }

    const logs = await many(
      `${materialPoEmailLogSql} where log.material_po_id = $1 order by log.sent_at desc`,
      [id],
    );
    const rows = await many(`${materialPoSql} where mpo.id = $1`, [id]);
    res.json({
      materialPo: mapMaterialPurchaseOrder(rows[0]),
      logs: logs.map(mapMaterialPoEmailLog),
      message: "Email sent successfully.",
    });
  }),
);

api.get(
  "/materials",
  requireRoles("Management", "Purchasing", "Warehouse"),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const rows = await many(`
      select
        m.id,
        m.material_name,
        m.supplier,
        m.required_qty,
        m.received_qty,
        m.unit,
        m.status,
        m.expected_arrival::text as expected_arrival,
        m.actual_arrival::text as actual_arrival,
        case when po.id is null then null else json_build_object('po_number', po.po_number) end as purchase_orders
      from materials m
      left join purchase_orders po on po.id = m.purchase_order_id
      where ${archiveWhere("m", archiveMode(req))}
      order by m.expected_arrival asc nulls last
    `);
    res.json(rows.map(mapMaterial));
  }),
);

api.post(
  "/materials",
  requireRoles("Purchasing"),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const body = parse(materialSchema, req.body);
    const payload = await materialPayload(body);
    const row = await one<{ id: string }>(
      `
        insert into materials (
          material_name, supplier, purchase_order_id, required_qty, received_qty, unit, status,
          expected_arrival, actual_arrival, created_by, updated_by
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
        returning id
      `,
      [
        payload.material_name,
        payload.supplier,
        payload.purchase_order_id,
        payload.required_qty,
        payload.received_qty,
        payload.unit,
        payload.status,
        payload.expected_arrival,
        payload.actual_arrival,
        req.auth.userId,
      ],
    );
    const saved = await many(
      `
        select
          m.id, m.material_name, m.supplier, m.required_qty, m.received_qty, m.unit, m.status,
          m.expected_arrival::text as expected_arrival,
          m.actual_arrival::text as actual_arrival,
          json_build_object('po_number', po.po_number) as purchase_orders
        from materials m
        left join purchase_orders po on po.id = m.purchase_order_id
        where m.id = $1
      `,
      [row.id],
    );
    res.status(201).json(mapMaterial(saved[0]));
  }),
);

api.patch(
  "/materials/:id",
  requireRoles("Purchasing"),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { id } = parse(idParamSchema, req.params);
    const body = parse(materialPatchSchema, req.body);
    await updateRecord("materials", "id", id, {
      ...(await materialPayload(body)),
      updated_by: req.auth.userId,
    });
    const saved = await many(
      `
        select
          m.id, m.material_name, m.supplier, m.required_qty, m.received_qty, m.unit, m.status,
          m.expected_arrival::text as expected_arrival,
          m.actual_arrival::text as actual_arrival,
          json_build_object('po_number', po.po_number) as purchase_orders
        from materials m
        left join purchase_orders po on po.id = m.purchase_order_id
        where m.id = $1
      `,
      [id],
    );
    res.json(mapMaterial(saved[0]));
  }),
);

api.get(
  "/approvals",
  requireRoles("Management", "Planning", "Quality"),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const rows = await many(`
      select
        a.id,
        a.approval_type,
        a.status,
        a.approval_date::text as approval_date,
        a.notes,
        case when po.id is null then null else json_build_object('po_number', po.po_number, 'buyer', po.buyer) end as purchase_orders
      from approvals a
      left join purchase_orders po on po.id = a.purchase_order_id
      where ${archiveWhere("a", archiveMode(req))}
      order by a.approval_date asc
    `);
    res.json(rows.map(mapApproval));
  }),
);

api.post(
  "/approvals",
  requireRoles("Management", "Planning"),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const body = parse(approvalSchema, req.body);
    const payload = await approvalPayload(body);
    const row = await one<{ id: string }>(
      `
        insert into approvals (approval_type, purchase_order_id, status, approval_date, notes, created_by, updated_by)
        values ($1, $2, $3, $4, $5, $6, $6)
        returning id
      `,
      [
        payload.approval_type,
        payload.purchase_order_id,
        payload.status,
        payload.approval_date,
        payload.notes,
        req.auth.userId,
      ],
    );
    const rows = await many(
      `
        select
          a.id, a.approval_type, a.status, a.approval_date::text as approval_date, a.notes,
          json_build_object('po_number', po.po_number, 'buyer', po.buyer) as purchase_orders
        from approvals a
        left join purchase_orders po on po.id = a.purchase_order_id
        where a.id = $1
      `,
      [row.id],
    );
    res.status(201).json(mapApproval(rows[0]));
  }),
);

api.patch(
  "/approvals/:id",
  requireRoles("Management", "Planning"),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { id } = parse(idParamSchema, req.params);
    const body = parse(approvalPatchSchema, req.body);
    await updateRecord("approvals", "id", id, {
      ...(await approvalPayload(body)),
      updated_by: req.auth.userId,
    });
    const rows = await many(
      `
        select
          a.id, a.approval_type, a.status, a.approval_date::text as approval_date, a.notes,
          json_build_object('po_number', po.po_number, 'buyer', po.buyer) as purchase_orders
        from approvals a
        left join purchase_orders po on po.id = a.purchase_order_id
        where a.id = $1
      `,
      [id],
    );
    res.json(mapApproval(rows[0]));
  }),
);

api.get(
  "/production-lines",
  requireRoles("Management", "Planning", "Production", "Quality"),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const rows = await many(
      `${productionLineSql} where ${archiveWhere("pl", archiveMode(req))} order by pl.line_name asc`,
    );
    res.json(rows.map(mapProductionLine));
  }),
);

api.post(
  "/production-lines",
  requireRoles("Management", "Planning"),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const body = parse(productionLineSchema, req.body);
    const payload = await productionLinePayload(body);
    const row = await one<{ id: string }>(
      `
        insert into production_lines (
          line_name, department, current_style, current_order_id, daily_target, daily_actual,
          capacity, status, created_by, updated_by
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
        returning id
      `,
      [
        payload.line_name,
        payload.department,
        payload.current_style,
        payload.current_order_id,
        payload.daily_target,
        payload.daily_actual,
        payload.capacity,
        payload.status,
        req.auth.userId,
      ],
    );
    const rows = await many(
      `
        select
          pl.id, pl.line_name, pl.department, pl.current_style, pl.daily_target, pl.daily_actual,
          pl.capacity, pl.status,
          json_build_object('po_number', po.po_number) as purchase_orders
        from production_lines pl
        left join purchase_orders po on po.id = pl.current_order_id
        where pl.id = $1
      `,
      [row.id],
    );
    res.status(201).json(mapProductionLine(rows[0]));
  }),
);

api.patch(
  "/production-lines/:id",
  requireRoles("Management", "Planning"),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { id } = parse(idParamSchema, req.params);
    const body = parse(productionLinePatchSchema, req.body);
    await updateRecord("production_lines", "id", id, {
      ...(await productionLinePayload(body)),
      updated_by: req.auth.userId,
    });
    const rows = await many(
      `
        select
          pl.id, pl.line_name, pl.department, pl.current_style, pl.daily_target, pl.daily_actual,
          pl.capacity, pl.status,
          json_build_object('po_number', po.po_number) as purchase_orders
        from production_lines pl
        left join purchase_orders po on po.id = pl.current_order_id
        where pl.id = $1
      `,
      [id],
    );
    res.json(mapProductionLine(rows[0]));
  }),
);

api.post(
  "/production-lines/:id/assign-po",
  requireRoles("Management", "Planning"),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { id } = parse(idParamSchema, req.params);
    const body = parse(productionLineAssignmentSchema, req.body);
    const line = await one<{
      id: string;
      department: string;
      current_order_id?: string | null;
      capacity?: number | null;
    }>("select id, department, current_order_id, capacity from production_lines where id = $1", [
      id,
    ]);

    const previousOrderId = line.current_order_id ?? null;
    const purchaseOrder = body.purchaseOrderId
      ? await one<{
          id: string;
          po_number: string;
          style_code?: string | null;
          style_name?: string | null;
        }>("select id, po_number, style_code, style_name from purchase_orders where id = $1", [
          body.purchaseOrderId,
        ])
      : null;

    await transaction(async (client) => {
      await client.query(
        `
          update production_lines
          set current_order_id = $2, current_style = $3, updated_by = $4
          where id = $1
        `,
        [
          id,
          purchaseOrder?.id ?? null,
          purchaseOrder ? purchaseOrder.style_code || purchaseOrder.style_name || "" : "",
          req.auth.userId,
        ],
      );

      if (previousOrderId && previousOrderId !== purchaseOrder?.id) {
        await client.query(
          `
            update purchase_orders
            set
              assigned_production_line_id = case when assigned_production_line_id = $1 then null else assigned_production_line_id end,
              assigned_lasting_line_id = case when assigned_lasting_line_id = $1 then null else assigned_lasting_line_id end,
              updated_by = $3
            where id = $2
          `,
          [id, previousOrderId, req.auth.userId],
        );
      }

      if (purchaseOrder) {
        const isLastingLine = line.department === "Bottom";
        await client.query(
          `
            update purchase_orders
            set
              assigned_production_line_id = case when $3::boolean then assigned_production_line_id else $1 end,
              assigned_lasting_line_id = case when $3::boolean then $1 else assigned_lasting_line_id end,
              planned_daily_capacity = case when $3::boolean then $4 else planned_daily_capacity end,
              updated_by = $5
            where id = $2
          `,
          [id, purchaseOrder.id, isLastingLine, line.capacity ?? null, req.auth.userId],
        );
      }
    });

    if (previousOrderId && previousOrderId !== purchaseOrder?.id) {
      await runDominoWorkflow(req.auth.userId, previousOrderId);
    }
    if (purchaseOrder) {
      await runDominoWorkflow(req.auth.userId, purchaseOrder.id);
    }

    res.json({
      line: mapProductionLine(await productionLineById(id)),
      purchaseOrder: purchaseOrder
        ? mapPurchaseOrder(await purchaseOrderById(purchaseOrder.id))
        : null,
    });
  }),
);

api.get(
  "/daily-logs",
  requireRoles("Management", "Planning", "Production", "Warehouse", "Quality"),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const purchaseOrderId = String(req.query.purchaseOrderId ?? "");
    if (purchaseOrderId) {
      parse(idParamSchema, { id: purchaseOrderId });
    }
    const archiveCondition = archiveWhere("dl", archiveMode(req));
    const where = purchaseOrderId
      ? `where dl.purchase_order_id = $1 and ${archiveCondition}`
      : `where ${archiveCondition}`;
    const params = purchaseOrderId ? [purchaseOrderId] : [];
    const rows = await many(
      `${dailyLogSql} ${where} order by dl.log_date desc, dl.created_at desc`,
      params,
    );
    res.json(rows.map(mapDailyLog));
  }),
);

api.post(
  "/daily-logs",
  requireRoles("Management", "Planning", "Production", "Warehouse", "Quality"),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const body = parse(dailyLogSchema, req.body);
    if (
      body.status === "Resolved" &&
      !["Owner", "Management", "Planning"].includes(req.auth.role ?? "")
    ) {
      throw new HttpError(403, "Only Owner, Management, or Planning can resolve daily logs.");
    }
    const payload = dailyLogPayload(body);
    const row = await one<{ id: string }>(
      `
        insert into daily_logs (
          title, note, log_date, author_id, department_stage, purchase_order_id,
          priority, status, created_by, updated_by
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $4, $4)
        returning id
      `,
      [
        payload.title,
        payload.note,
        payload.log_date,
        req.auth.userId,
        payload.department_stage,
        payload.purchase_order_id,
        payload.priority,
        payload.status,
      ],
    );
    const rows = await many(`${dailyLogSql} where dl.id = $1`, [row.id]);
    res.status(201).json(mapDailyLog(rows[0]));
  }),
);

api.patch(
  "/daily-logs/:id",
  requireRoles("Management", "Planning", "Production", "Warehouse", "Quality"),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { id } = parse(idParamSchema, req.params);
    const body = parse(dailyLogPatchSchema, req.body);
    if (
      Object.prototype.hasOwnProperty.call(body, "status") &&
      !["Owner", "Management", "Planning"].includes(req.auth.role ?? "")
    ) {
      throw new HttpError(403, "Only Owner, Management, or Planning can change log status.");
    }
    await updateRecord("daily_logs", "id", id, {
      ...dailyLogPayload(body),
      updated_by: req.auth.userId,
    });
    const rows = await many(`${dailyLogSql} where dl.id = $1`, [id]);
    if (!rows[0]) throw new HttpError(404, "Daily log was not found.");
    res.json(mapDailyLog(rows[0]));
  }),
);

api.get(
  "/daily-updates",
  requireRoles("Management", "Planning", "Production", "Quality"),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const rows = await many(
      `${dailyUpdateSql} where ${archiveWhere("du", archiveMode(req))} order by du.production_date desc`,
    );
    res.json(rows.map(mapDailyUpdate));
  }),
);

api.post(
  "/daily-updates",
  requireRoles("Management", "Planning", "Production"),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const body = parse(dailyUpdateSchema, req.body);
    const payload = await dailyUpdatePayload(body);
    const existing = await many<{ id: string }>(
      `
        select id
        from daily_production_updates
        where production_date = $1
          and production_stage = $2
          and purchase_order_id is not distinct from $3::uuid
          and production_line_id is not distinct from $4::uuid
          and archived_at is null
        order by updated_at desc, created_at desc
        limit 1
      `,
      [
        payload.production_date,
        payload.production_stage,
        payload.purchase_order_id,
        payload.production_line_id,
      ],
    );
    const row = existing[0]
      ? await one<{ id: string }>(
          `
            update daily_production_updates
            set target_quantity = $1,
                actual_quantity = $2,
                notes = $3,
                updated_by = $4
            where id = $5
            returning id
          `,
          [
            payload.target_quantity,
            payload.actual_quantity,
            payload.notes,
            req.auth.userId,
            existing[0].id,
          ],
        )
      : await one<{ id: string }>(
          `
            insert into daily_production_updates (
              production_date, production_stage, production_line_id, purchase_order_id, target_quantity,
              actual_quantity, notes, entered_by, updated_by
            )
            values ($1, $2, $3, $4, $5, $6, $7, $8, $8)
            returning id
          `,
          [
            payload.production_date,
            payload.production_stage,
            payload.production_line_id,
            payload.purchase_order_id,
            payload.target_quantity,
            payload.actual_quantity,
            payload.notes,
            req.auth.userId,
          ],
        );
    const rows = await many(`${dailyUpdateSql} where du.id = $1`, [row.id]);
    if (payload.production_line_id) {
      await updateRecord("production_lines", "id", payload.production_line_id, {
        daily_target: payload.target_quantity,
        daily_actual: payload.actual_quantity,
        updated_by: req.auth.userId,
      });
    }
    res.status(201).json(mapDailyUpdate(rows[0]));
  }),
);

api.patch(
  "/daily-updates/:id",
  requireRoles("Management", "Planning", "Production"),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { id } = parse(idParamSchema, req.params);
    const body = parse(dailyUpdatePatchSchema, req.body);
    await updateRecord("daily_production_updates", "id", id, {
      ...(await dailyUpdatePayload(body)),
      updated_by: req.auth.userId,
    });
    const rows = await many(`${dailyUpdateSql} where du.id = $1`, [id]);
    const saved = rows[0];
    if (saved) {
      if (saved.production_line_id) {
        await updateRecord("production_lines", "id", saved.production_line_id, {
          daily_target: saved.target_quantity,
          daily_actual: saved.actual_quantity,
          updated_by: req.auth.userId,
        });
      }
    }
    res.json(mapDailyUpdate(rows[0]));
  }),
);

api.get(
  "/dashboard",
  requireRoles("Management", "Planning", "Sales"),
  asyncHandler<AuthedRequest>(async (_req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const riskDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const [
      purchaseOrders,
      yesterdayUpdates,
      stageProductionRows,
      productionLineRows,
      alerts,
      materialPendingRows,
      draftMaterialPosRows,
      recentDailyLogs,
      openDailyLogRows,
      highPriorityDailyLogRows,
      todaysDailyLogRows,
    ] = await Promise.all([
      purchaseOrderRows("where po.archived_at is null"),
      many<{ actual_quantity: number | null }>(
        "select actual_quantity from daily_production_updates where production_date = $1 and archived_at is null",
        [yesterday],
      ),
      many<{
        production_stage: ProductionStage;
        target_quantity: number | null;
        actual_quantity: number | null;
      }>(
        `
          with update_rows as (
            select
              coalesce(pl.department, du.production_stage) as production_stage,
              coalesce(sum(du.target_quantity), 0) as target_quantity,
              coalesce(sum(du.actual_quantity), 0) as actual_quantity
            from daily_production_updates du
            left join production_lines pl on pl.id = du.production_line_id
            where du.production_date = $1 and du.archived_at is null
            group by coalesce(pl.department, du.production_stage)
          ),
          line_rows as (
            select
              pl.department as production_stage,
              coalesce(sum(pl.daily_target), 0) as target_quantity,
              coalesce(sum(pl.daily_actual), 0) as actual_quantity
            from production_lines pl
            where pl.archived_at is null
              and not exists (
                select 1
                from daily_production_updates du
                where du.production_date = $1
                  and du.production_line_id = pl.id
                  and du.archived_at is null
              )
            group by pl.department
          )
          select
            production_stage,
            coalesce(sum(target_quantity), 0) as target_quantity,
            coalesce(sum(actual_quantity), 0) as actual_quantity
          from (
            select * from update_rows
            union all
            select * from line_rows
          ) production_rows
          group by production_stage
        `,
        [today],
      ),
      many<{
        department: ProductionStage;
        active_lines: string;
        active_purchase_orders: string;
      }>(
        `
          select
            department,
            count(*) filter (where status <> 'Stopped')::text as active_lines,
            count(current_order_id) filter (where current_order_id is not null)::text as active_purchase_orders
          from production_lines
          where archived_at is null
          group by department
        `,
      ),
      many(
        `
          select id, message, severity, created_at::text as created_at
          from alerts
          order by created_at desc
          limit 8
        `,
      ),
      many<{ count: string }>(
        "select count(*)::text as count from material_requirements where balance_quantity > 0 and archived_at is null",
      ),
      many<{ count: string }>(
        "select count(*)::text as count from material_purchase_orders where status = 'Draft' and archived_at is null",
      ),
      many(
        `${dailyLogSql} where dl.archived_at is null order by dl.log_date desc, dl.created_at desc limit 5`,
      ),
      many<{ count: string }>(
        "select count(*)::text as count from daily_logs where status = 'Open' and archived_at is null",
      ),
      many<{ count: string }>(
        "select count(*)::text as count from daily_logs where status = 'Open' and priority = 'High' and archived_at is null",
      ),
      many<{ count: string }>(
        "select count(*)::text as count from daily_logs where log_date = $1 and archived_at is null",
        [today],
      ),
    ]);

    const mappedPurchaseOrders = purchaseOrders.map(mapPurchaseOrder);
    const productionBreakdown = productionStageOrder.map((stage) => {
      const row = stageProductionRows.find((item) => item.production_stage === stage);
      const lineRow = productionLineRows.find((item) => item.department === stage);
      const target = Number(row?.target_quantity ?? 0);
      const actual = Number(row?.actual_quantity ?? 0);
      const delayedOrdersInStage = mappedPurchaseOrders.some(
        (order) => order.currentStage === stage && order.status === "Delayed",
      );
      const delayedOrUnderTarget = delayedOrdersInStage || actual < target;
      return {
        stage,
        label: productionStageLabels[stage],
        target,
        actual,
        remaining: Math.max(target - actual, 0),
        activeLines: Number(lineRow?.active_lines ?? 0),
        activePurchaseOrders: Number(lineRow?.active_purchase_orders ?? 0),
        difference: actual - target,
        achievementPercent: achievementPercent(actual, target),
        delayedOrUnderTarget,
      };
    });
    const todayProductionTarget = productionBreakdown.reduce((sum, item) => sum + item.target, 0);
    const todayProductionActual = productionBreakdown.reduce((sum, item) => sum + item.actual, 0);

    res.json({
      activeOrders: mappedPurchaseOrders.filter((item) => item.status !== "Shipped").length,
      delayedOrders: mappedPurchaseOrders.filter((item) => item.status === "Delayed").length,
      pendingApprovals: mappedPurchaseOrders.filter(
        (item) => !item.approved && item.status !== "Shipped",
      ).length,
      yesterdayProduction: yesterdayUpdates.reduce(
        (sum, item) => sum + Number(item.actual_quantity ?? 0),
        0,
      ),
      todayProductionTarget,
      todayProductionActual,
      productionAchievementPercent: achievementPercent(
        todayProductionActual,
        todayProductionTarget,
      ),
      productionBreakdown,
      delayedProductionDepartments: productionBreakdown
        .filter((item) => item.delayedOrUnderTarget)
        .map((item) => item.label),
      ordersAtRisk: mappedPurchaseOrders.filter(
        (item) =>
          item.status === "Delayed" ||
          (item.deliveryDate <= riskDate && !["Ready To Ship", "Shipped"].includes(item.status)),
      ).length,
      pendingShipments: mappedPurchaseOrders.filter((item) => item.status === "Ready To Ship")
        .length,
      materialPending: Number(materialPendingRows[0]?.count ?? 0),
      draftMaterialPos: Number(draftMaterialPosRows[0]?.count ?? 0),
      openDailyLogs: Number(openDailyLogRows[0]?.count ?? 0),
      highPriorityDailyLogs: Number(highPriorityDailyLogRows[0]?.count ?? 0),
      todaysDailyLogs: Number(todaysDailyLogRows[0]?.count ?? 0),
      recentDailyLogs: recentDailyLogs.map(mapDailyLog),
      recentAlerts: alerts.map(mapAlert),
      recentPurchaseOrders: mappedPurchaseOrders
        .sort((a, b) => (a.deliveryDate > b.deliveryDate ? 1 : -1))
        .slice(0, 5),
      generatedFor: today,
    });
  }),
);

type DailyProductionReportLine = {
  department: ProductionStage;
  line: string;
  target: number;
  produced: number;
  remaining: number;
  purchaseOrders: string;
};

type DailyProductionReportSection = {
  department: ProductionStage;
  lines: DailyProductionReportLine[];
  totalTarget: number;
  totalProduced: number;
  totalRemaining: number;
};

type DailyProductionReport = {
  title: string;
  date: string;
  sections: DailyProductionReportSection[];
  totals: Record<ProductionStage, number>;
  rows: Record<string, string | number>[];
};

function reportDate(value: unknown) {
  return typeof value === "string" && value
    ? value.slice(0, 10)
    : new Date().toISOString().slice(0, 10);
}

function reportDepartment(value: unknown) {
  return typeof value === "string" && productionStageOrder.includes(value as ProductionStage)
    ? (value as ProductionStage)
    : null;
}

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function rowsToCsv(rows: Record<string, string | number>[]) {
  const columns = rows[0] ? Object.keys(rows[0]) : ["No Data"];
  return [
    columns.map(csvEscape).join(","),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(",")),
  ].join("\n");
}

async function recordReportExport(type: ReportType, userId: string, rowCount: number) {
  try {
    await query("insert into reports (report_type, generated_by, row_count) values ($1, $2, $3)", [
      type,
      userId,
      rowCount,
    ]);
    return true;
  } catch (error) {
    console.error("Report export audit logging failed; continuing with file download.", error);
    return false;
  }
}

async function buildDailyProductionReport(
  date: string,
  departmentFilter: ProductionStage | null = null,
): Promise<DailyProductionReport> {
  const rows = await many<{
    department: ProductionStage;
    line_name: string;
    target_quantity: string | number | null;
    produced_quantity: string | number | null;
    purchase_orders: string | null;
  }>(
    `
      with update_rows as (
        select
          coalesce(pl.department, du.production_stage) as department,
          coalesce(
            pl.line_name,
            nullif(
              concat_ws(
                ' - ',
                po.po_number,
                nullif(c.customer_name, ''),
                nullif(po.style_code, '')
              ),
              ''
            ),
            du.production_stage || ' Entry'
          ) as line_name,
          coalesce(sum(du.target_quantity), 0) as target_quantity,
          coalesce(sum(du.actual_quantity), 0) as produced_quantity,
          string_agg(distinct po.po_number, ', ' order by po.po_number) as purchase_orders
        from daily_production_updates du
        left join production_lines pl on pl.id = du.production_line_id
        left join purchase_orders po on po.id = du.purchase_order_id
        left join customers c on c.id = po.customer_id
        where du.production_date = $1
          and du.archived_at is null
          and ($2::text is null or coalesce(pl.department, du.production_stage) = $2)
        group by
          coalesce(pl.department, du.production_stage),
          coalesce(
            pl.line_name,
            nullif(
              concat_ws(
                ' - ',
                po.po_number,
                nullif(c.customer_name, ''),
                nullif(po.style_code, '')
              ),
              ''
            ),
            du.production_stage || ' Entry'
          )
      ),
      line_rows as (
        select
          pl.department,
          pl.line_name,
          pl.daily_target as target_quantity,
          pl.daily_actual as produced_quantity,
          po.po_number as purchase_orders
        from production_lines pl
        left join purchase_orders po on po.id = pl.current_order_id
        where pl.archived_at is null
          and ($2::text is null or pl.department = $2)
          and not exists (
            select 1
            from daily_production_updates du
            where du.production_date = $1
              and du.production_line_id = pl.id
              and du.archived_at is null
          )
      ),
      report_rows as (
        select *
        from update_rows
        union all
        select *
        from line_rows
      )
      select *
      from report_rows
      order by
        case department
          when 'Cutting' then 1
          when 'Upper' then 2
          when 'Bottom' then 3
          when 'Packing' then 4
          else 5
        end,
        line_name
    `,
    [date, departmentFilter],
  );

  const lineItems: DailyProductionReportLine[] = rows
    .filter((row) => productionStageOrder.includes(row.department))
    .map((row) => {
      const target = Number(row.target_quantity ?? 0);
      const produced = Number(row.produced_quantity ?? 0);
      return {
        department: row.department,
        line: row.line_name || `${row.department} Entry`,
        target,
        produced,
        remaining: Math.max(target - produced, 0),
        purchaseOrders: row.purchase_orders ?? "",
      };
    });

  const reportStages = departmentFilter ? [departmentFilter] : productionStageOrder;
  const sections = reportStages.map((department) => {
    const lines = lineItems.filter((line) => line.department === department);
    const totalTarget = lines.reduce((sum, line) => sum + line.target, 0);
    const totalProduced = lines.reduce((sum, line) => sum + line.produced, 0);
    return {
      department,
      lines,
      totalTarget,
      totalProduced,
      totalRemaining: Math.max(totalTarget - totalProduced, 0),
    };
  });

  const totals = Object.fromEntries(
    sections.map((section) => [section.department, section.totalProduced]),
  ) as Record<ProductionStage, number>;

  const flatRows = sections.flatMap((section) => [
    {
      Department: section.department,
      Line: "",
      Produced: "",
      Target: "",
      Remaining: "",
      "Purchase Orders": "",
    },
    ...section.lines.map((line) => ({
      Department: section.department,
      Line: line.line,
      Produced: line.produced,
      Target: line.target,
      Remaining: line.remaining,
      "Purchase Orders": line.purchaseOrders,
    })),
    {
      Department: `${section.department} Total`,
      Line: "",
      Produced: section.totalProduced,
      Target: section.totalTarget,
      Remaining: section.totalRemaining,
      "Purchase Orders": "",
    },
  ]);

  return {
    title: "Production Report",
    date,
    sections,
    totals,
    rows: flatRows,
  };
}

function styleDailyProductionWorksheet(worksheet: ExcelJS.Worksheet) {
  worksheet.pageSetup = {
    paperSize: 9,
    orientation: "portrait",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: {
      left: 0.35,
      right: 0.35,
      top: 0.45,
      bottom: 0.45,
      header: 0.2,
      footer: 0.2,
    },
  };
  worksheet.columns = [{ width: 34 }, { width: 18 }];
}

function addBorder(row: ExcelJS.Row, from = 1, to = 2) {
  for (let index = from; index <= to; index += 1) {
    row.getCell(index).border = {
      top: { style: "thin" },
      left: { style: "thin" },
      bottom: { style: "thin" },
      right: { style: "thin" },
    };
  }
}

function writeDailyProductionWorksheet(workbook: ExcelJS.Workbook, report: DailyProductionReport) {
  const worksheet = workbook.addWorksheet("Production Report");
  styleDailyProductionWorksheet(worksheet);

  worksheet.mergeCells("A1:B1");
  worksheet.getCell("A1").value = "Production Report";
  worksheet.getCell("A1").font = { bold: true, size: 18 };
  worksheet.getCell("A1").alignment = { horizontal: "center" };

  worksheet.mergeCells("A2:B2");
  worksheet.getCell("A2").value = `Report Date: ${report.date}`;
  worksheet.getCell("A2").font = { bold: true, size: 12 };
  worksheet.getCell("A2").alignment = { horizontal: "center" };

  let rowIndex = 4;
  for (const section of report.sections) {
    worksheet.mergeCells(rowIndex, 1, rowIndex, 2);
    const header = worksheet.getCell(rowIndex, 1);
    header.value = section.department.toUpperCase();
    header.font = { bold: true, size: 13 };
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
    rowIndex += 1;

    const headingRow = worksheet.getRow(rowIndex);
    headingRow.values = ["Line/PO", "Produced"];
    headingRow.font = { bold: true };
    addBorder(headingRow);
    rowIndex += 1;

    if (section.lines.length) {
      for (const line of section.lines) {
        const row = worksheet.getRow(rowIndex);
        row.values = [line.line, line.produced];
        addBorder(row);
        rowIndex += 1;
      }
    } else {
      const row = worksheet.getRow(rowIndex);
      row.values = ["No production entered", 0];
      addBorder(row);
      rowIndex += 1;
    }

    const totalRow = worksheet.getRow(rowIndex);
    totalRow.values = ["Total", section.totalProduced];
    totalRow.font = { bold: true };
    totalRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
    addBorder(totalRow);
    rowIndex += 2;
  }

  worksheet.mergeCells(rowIndex, 1, rowIndex, 2);
  worksheet.getCell(rowIndex, 1).value = "Grand Totals";
  worksheet.getCell(rowIndex, 1).font = { bold: true, size: 13 };
  rowIndex += 1;

  for (const section of report.sections) {
    const row = worksheet.getRow(rowIndex);
    row.values = [`Total ${section.department}`, section.totalProduced];
    row.font = { bold: true };
    addBorder(row);
    rowIndex += 1;
  }

  return worksheet;
}

async function buildReport(
  type: ReportType,
  date = new Date().toISOString().slice(0, 10),
  department: ProductionStage | null = null,
) {
  if (type === "daily-production") {
    return buildDailyProductionReport(date, department);
  }

  if (type === "weekly-production") {
    const rows = await many(
      `${dailyUpdateSql} where du.archived_at is null order by du.production_date desc`,
    );
    const reportRows = rows.map((row) => {
      const item = mapDailyUpdate(row);
      return {
        Date: item.date,
        Department: item.stage,
        Line: item.lineName,
        "PO Number": item.poNumber,
        Customer: item.customerName ?? "",
        Style: item.styleCode || item.currentStyle || "",
        Target: item.targetQuantity,
        Produced: item.actualQuantity,
        Achievement: item.targetQuantity
          ? `${Math.round((item.actualQuantity / item.targetQuantity) * 100)}%`
          : "0%",
        Notes: item.notes,
      };
    });
    return {
      title: "Weekly Production",
      rows: reportRows,
    };
  }

  if (type === "material-status") {
    const rows = await many(`
      select
        m.id,
        m.material_name,
        m.supplier,
        m.required_qty,
        m.received_qty,
        m.unit,
        m.status,
        m.expected_arrival::text as expected_arrival,
        m.actual_arrival::text as actual_arrival,
        case when po.id is null then null else json_build_object('po_number', po.po_number) end as purchase_orders
      from materials m
      left join purchase_orders po on po.id = m.purchase_order_id
      where m.archived_at is null
      order by m.expected_arrival asc nulls last
    `);
    const reportRows = rows.map((row) => {
      const item = mapMaterial(row);
      return {
        Material: item.name,
        Supplier: item.supplier,
        "PO Number": item.poNumber,
        Status: item.status,
        "Expected Arrival": item.expectedArrival,
        "Actual Arrival": item.actualArrival,
      };
    });
    return { title: "Material Status", rows: reportRows };
  }

  const rows = (await purchaseOrderRows("where po.archived_at is null")).map(mapPurchaseOrder);
  return {
    title: type === "shipment-status" ? "Shipment Status" : "Order Progress",
    rows: rows
      .filter(
        (item) =>
          type !== "shipment-status" ||
          ["Packing", "Ready To Ship", "Shipped"].includes(item.status),
      )
      .map((item) => ({
        "PO Number": item.poNumber,
        Customer: item.customerName || item.buyer,
        Brand: item.brand,
        Article: item.article,
        "Style Code": item.styleCode,
        "Style Name": item.styleName,
        Color: item.color,
        Quantity: item.quantity,
        "Delivery Date": item.deliveryDate,
        Status: item.status,
        Notes: item.notes,
      })),
  };
}

api.get(
  "/reports/:type",
  requireRoles("Management", "Planning", "Sales", "Warehouse", "Quality"),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { type } = parse(reportParamSchema, req.params);
    res.json(
      await buildReport(type, reportDate(req.query.date), reportDepartment(req.query.department)),
    );
  }),
);

api.get(
  "/reports/:type/export.xlsx",
  requireRoles("Management", "Planning", "Sales", "Warehouse", "Quality"),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { type } = parse(reportParamSchema, req.params);
    const date = reportDate(req.query.date);
    const department = reportDepartment(req.query.department);
    let report: Awaited<ReturnType<typeof buildReport>>;
    let buffer: Awaited<ReturnType<ExcelJS.Workbook["xlsx"]["writeBuffer"]>>;
    try {
      report = await buildReport(type, date, department);
      const workbook = new ExcelJS.Workbook();
      if (type === "daily-production") {
        writeDailyProductionWorksheet(workbook, report as DailyProductionReport);
      } else {
        const worksheet = workbook.addWorksheet(report.title);
        const columns = report.rows[0] ? Object.keys(report.rows[0]) : ["No Data"];
        worksheet.columns = columns.map((header) => ({
          header,
          key: header,
          width: Math.max(14, header.length + 4),
        }));
        report.rows.forEach((row) => worksheet.addRow(row));
        worksheet.getRow(1).font = { bold: true };
      }
      buffer = await workbook.xlsx.writeBuffer();
    } catch (error) {
      throw generationFailure("Could not generate report", error);
    }

    const auditRecorded = await recordReportExport(type, req.auth.userId, report.rows.length);

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("X-Report-Audit", auditRecorded ? "recorded" : "skipped");
    const suffix = department ? `-${department.toLowerCase()}` : "";
    res.setHeader("Content-Disposition", `attachment; filename="${type}-${date}${suffix}.xlsx"`);
    res.send(Buffer.from(buffer));
  }),
);

api.get(
  "/reports/:type/export.csv",
  requireRoles("Management", "Planning", "Sales", "Warehouse", "Quality"),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { type } = parse(reportParamSchema, req.params);
    const date = reportDate(req.query.date);
    const department = reportDepartment(req.query.department);
    let report: Awaited<ReturnType<typeof buildReport>>;
    try {
      report = await buildReport(type, date, department);
    } catch (error) {
      throw generationFailure("Could not generate report", error);
    }
    const auditRecorded = await recordReportExport(type, req.auth.userId, report.rows.length);
    res.setHeader("Content-Type", "text/csv;charset=utf-8");
    res.setHeader("X-Report-Audit", auditRecorded ? "recorded" : "skipped");
    const suffix = department ? `-${department.toLowerCase()}` : "";
    res.setHeader("Content-Disposition", `attachment; filename="${type}-${date}${suffix}.csv"`);
    res.send(rowsToCsv(report.rows));
  }),
);

app.use("/api", api);
app.use(sendError);

async function prepareRuntime() {
  await fs.mkdir(poImageUploadDir, { recursive: true });
  await fs.mkdir(materialPoFilesRoot, { recursive: true });
  await pool.query("select 1");
}

prepareRuntime()
  .then(() => {
    app.listen(env.port, () => {
      console.log(`Footwear Production Hub API listening on http://localhost:${env.port}`);
    });
  })
  .catch((error: unknown) => {
    const code = (error as { code?: string }).code;
    if (code === "ECONNREFUSED") {
      console.error(
        [
          "Could not connect to local PostgreSQL.",
          "Open Docker Desktop, then run npm.cmd run db:start and npm.cmd run db:migrate.",
          `DATABASE_URL: ${redactConnectionString(env.databaseUrl)}`,
        ].join("\n"),
      );
    } else if (code === "3D000") {
      console.error(
        [
          "The configured local PostgreSQL database does not exist.",
          "Use npm.cmd run db:start for the bundled database, or create the database in your own PostgreSQL server.",
          `DATABASE_URL: ${redactConnectionString(env.databaseUrl)}`,
        ].join("\n"),
      );
    } else {
      console.error(error);
    }
    process.exitCode = 1;
    void pool.end();
  });
