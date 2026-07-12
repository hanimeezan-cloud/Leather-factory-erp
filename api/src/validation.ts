import { z } from "zod";
import {
  ALERT_SEVERITIES,
  APPROVAL_STATUSES,
  APPROVAL_TYPES,
  CUSTOMER_STATUSES,
  DAILY_LOG_PRIORITIES,
  DAILY_LOG_STATUSES,
  LINE_STATUSES,
  MATERIAL_STATUSES,
  PO_STATUSES,
  PRODUCTION_DEPARTMENTS,
  PRODUCTION_STAGES,
  PRODUCTION_STAGE_STATUSES,
  REPORT_TYPES,
  ROLES,
  VENDOR_STATUSES,
} from "../../src/lib/domain.js";

export const idParamSchema = z.object({ id: z.string().uuid() });

export const reportParamSchema = z.object({
  type: z.enum(REPORT_TYPES),
});

export const customerSchema = z.object({
  customerName: z.string().trim().min(1),
  brand: z.string().trim().optional().default(""),
  contactPerson: z.string().trim().optional().default(""),
  email: z
    .union([z.string().trim().email(), z.literal("")])
    .optional()
    .default(""),
  phone: z.string().trim().optional().default(""),
  country: z.string().trim().optional().default(""),
  notes: z.string().trim().optional().default(""),
  status: z.enum(CUSTOMER_STATUSES).default("Active"),
});

export const customerPatchSchema = customerSchema.partial();

export const purchaseOrderSizeSchema = z.object({
  id: z.union([z.string().uuid(), z.literal("")]).optional(),
  size: z.string().trim().min(1),
  quantity: z.coerce.number().int().min(0),
  notes: z.string().trim().optional().default(""),
});

export const purchaseOrderSizesSchema = z.object({
  sizes: z.array(purchaseOrderSizeSchema),
});

const requiredCustomerIdSchema = z.preprocess(
  (value) => (value === "" || value === null ? undefined : value),
  z.string({ required_error: "Customer is required." }).uuid("Customer is required."),
);

const optionalUuidSchema = z.preprocess(
  (value) => (value === "" || value === null ? undefined : value),
  z.string().uuid().optional(),
);

export const purchaseOrderSchema = z.object({
  customerId: requiredCustomerIdSchema,
  customerName: z.string().trim().optional().default(""),
  poNumber: z.string().trim().min(1),
  buyer: z.string().trim().optional().default(""),
  poDate: z.string().trim().optional().default(""),
  article: z.string().trim().optional().default(""),
  brand: z.string().trim().optional().default(""),
  styleCode: z.string().trim().optional().default(""),
  styleName: z.string().trim().optional().default(""),
  color: z.string().trim().optional().default(""),
  quantity: z.coerce.number().int().positive(),
  price: z.coerce.number().min(0).default(0),
  currency: z.string().trim().optional().default("USD"),
  deliveryDate: z.string().trim().min(1),
  status: z.enum(PO_STATUSES).default("Planning"),
  notes: z.string().trim().optional().default(""),
  productImageUrl: z.string().trim().optional().default(""),
  currentStage: z.enum(PRODUCTION_STAGE_STATUSES).default("Cutting"),
  assignedProductionLineId: optionalUuidSchema,
  assignedLastingLineId: optionalUuidSchema,
  plannedStartDate: z.string().trim().optional().default(""),
  sizes: z.array(purchaseOrderSizeSchema).optional().default([]),
});

export const purchaseOrderPatchSchema = purchaseOrderSchema.partial();

export const materialSchema = z.object({
  name: z.string().trim().min(1),
  supplier: z.string().trim().min(1),
  poNumber: z.string().trim().min(1),
  requiredQty: z.coerce.number().min(0).optional().default(0),
  receivedQty: z.coerce.number().min(0).optional().default(0),
  unit: z.string().trim().optional().default("pairs"),
  status: z.enum(MATERIAL_STATUSES).default("Not Ordered"),
  expectedArrival: z.string().trim().optional().default(""),
  actualArrival: z.string().trim().optional().default(""),
});

export const materialPatchSchema = materialSchema.partial();

export const vendorSchema = z.object({
  vendorName: z.string().trim().min(1, "Vendor name is required."),
  contactPerson: z.string().trim().optional().default(""),
  email: z
    .union([z.string().trim().email(), z.literal("")])
    .optional()
    .default(""),
  phone: z.string().trim().optional().default(""),
  address: z.string().trim().optional().default(""),
  materialCategories: z
    .preprocess(
      (value) => {
        if (Array.isArray(value)) return value;
        if (typeof value === "string") {
          return value
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean);
        }
        return [];
      },
      z.array(z.string().trim().min(1)),
    )
    .optional()
    .default([]),
  notes: z.string().trim().optional().default(""),
  status: z.enum(VENDOR_STATUSES).default("Active"),
});

export const vendorPatchSchema = vendorSchema.partial();

export const approvalSchema = z.object({
  type: z.enum(APPROVAL_TYPES),
  poNumber: z.string().trim().min(1),
  status: z.enum(APPROVAL_STATUSES).default("Pending"),
  date: z.string().trim().min(1),
  notes: z.string().trim().optional().default(""),
});

export const approvalPatchSchema = approvalSchema.partial();

export const productionLineSchema = z.object({
  name: z.string().trim().min(1),
  department: z.enum(PRODUCTION_DEPARTMENTS),
  currentStyle: z.string().trim().optional().default(""),
  currentOrder: z.string().trim().optional().default(""),
  dailyTarget: z.coerce.number().int().min(0).default(0),
  dailyActual: z.coerce.number().int().min(0).default(0),
  capacity: z.coerce.number().int().min(0).default(0),
  status: z.enum(LINE_STATUSES).default("Running"),
});

export const productionLinePatchSchema = productionLineSchema.partial();

export const dailyUpdateSchema = z.object({
  date: z.string().trim().min(1),
  stage: z.enum(PRODUCTION_STAGES).default("Cutting"),
  lineId: optionalUuidSchema.default(""),
  poNumber: z.string().trim().optional().default(""),
  targetQuantity: z.coerce.number().int().min(0),
  actualQuantity: z.coerce.number().int().min(0),
  notes: z.string().trim().optional().default(""),
});

export const productionLineAssignmentSchema = z.object({
  purchaseOrderId: z.preprocess(
    (value) => (value === "" || value === null ? null : value),
    z.string().uuid("Select a valid purchase order.").nullable(),
  ),
});

export const dailyUpdatePatchSchema = dailyUpdateSchema.partial();

export const dailyLogSchema = z.object({
  title: z.string().trim().min(1, "Log title is required."),
  note: z.string().trim().min(1, "Log note is required."),
  date: z.string().trim().min(1, "Log date is required."),
  departmentStage: z.string().trim().optional().default(""),
  purchaseOrderId: optionalUuidSchema.default(""),
  priority: z.enum(DAILY_LOG_PRIORITIES).default("Medium"),
  status: z.enum(DAILY_LOG_STATUSES).default("Open"),
});

export const dailyLogPatchSchema = dailyLogSchema.partial();

export const userPatchSchema = z.object({
  fullName: z.string().trim().nullable().optional(),
  department: z.string().trim().nullable().optional(),
  role: z.enum(ROLES).nullable().optional(),
  active: z.boolean().optional(),
});

export const userCreateSchema = z.object({
  email: z.string().trim().email(),
  fullName: z.string().trim().optional().default(""),
  department: z.string().trim().optional().default(""),
  role: z.enum(ROLES).default("Sales"),
  active: z.boolean().default(false),
});

export const finalApprovalSchema = z.object({
  approved: z.boolean(),
});

export const productionStageSchema = z.object({
  currentStage: z.enum(PRODUCTION_STAGE_STATUSES),
});

export const styleLinkSchema = z.object({
  styleId: z.string().uuid("Select a valid BOM/style."),
});

export const bomDefaultVendorSchema = z.object({
  vendorId: z.preprocess(
    (value) => (value === "" || value === null ? null : value),
    z.string().uuid("Select a valid vendor.").nullable().optional(),
  ),
  regenerateDrafts: z.boolean().optional().default(false),
});

export const materialPoEmailSchema = z.object({
  recipientEmail: z.string().trim().email("Enter a valid vendor email address."),
  subject: z.string().trim().min(1, "Email subject is required."),
  body: z.string().trim().min(1, "Email body is required."),
});

export const adminEntitySchema = z.object({
  entity: z.enum([
    "customers",
    "purchase-orders",
    "styles",
    "bom-materials",
    "material-requirements",
    "material-pos",
    "material-po-items",
    "materials",
    "vendors",
    "approvals",
    "production-lines",
    "daily-logs",
    "daily-updates",
    "reports",
  ]),
  id: z.string().uuid(),
});

export const archiveActionSchema = z.object({
  reason: z.string().trim().optional().default(""),
  confirmation: z.string().trim().optional().default(""),
});

export const hardDeleteSchema = z.object({
  confirmation: z.literal("DELETE PERMANENTLY"),
});

export const clearTestDataSchema = z.object({
  scope: z.enum([
    "all-demo-local",
    "purchase-orders",
    "customers-purchase-orders",
    "materials-bom-material-pos",
    "vendors",
    "production-daily-logs",
    "everything-except-users",
  ]),
  mode: z.enum(["archive", "hard-delete"]).default("archive"),
  confirmation: z.string().trim(),
});

export const retentionRunSchema = z.object({
  archiveOlderThanYears: z.coerce.number().int().min(1).max(20).default(2),
  deleteArchivedOlderThanYears: z.coerce.number().int().min(3).max(50).optional(),
  confirmation: z.string().trim().optional().default(""),
});

export const alertSchema = z.object({
  message: z.string().trim().min(1),
  severity: z.enum(ALERT_SEVERITIES).default("info"),
});
