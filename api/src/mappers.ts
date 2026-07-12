import type {
  Alert,
  Approval,
  BomMaterial,
  Customer,
  DailyLog,
  DailyUpdate,
  DominoWarning,
  Material,
  MaterialPoItem,
  MaterialPoEmailLog,
  MaterialPurchaseOrder,
  MaterialRequirement,
  ProductionTimelineEvent,
  ProductionLine,
  PurchaseOrder,
  PurchaseOrderSize,
  Style,
  Vendor,
} from "../../src/lib/domain.js";

function related<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

type PurchaseOrderRow = {
  id?: string;
  customer_id?: string | null;
  customers?:
    | { customer_name?: string | null; brand?: string | null }
    | { customer_name?: string | null; brand?: string | null }[]
    | null;
  po_number: string;
  buyer: string;
  po_date?: string | null;
  article?: string | null;
  brand?: string | null;
  style_code: string;
  style_name?: string | null;
  color: string;
  quantity: number;
  price?: number | null;
  currency?: string | null;
  delivery_date: string;
  status: PurchaseOrder["status"];
  notes?: string | null;
  product_image_url?: string | null;
  approved?: boolean | null;
  approved_by?: string | null;
  approved_at?: string | null;
  approved_by_profile?:
    | { email?: string | null; full_name?: string | null }
    | { email?: string | null; full_name?: string | null }[]
    | null;
  style_id?: string | null;
  assigned_production_line_id?: string | null;
  assigned_lasting_line_id?: string | null;
  current_stage?: PurchaseOrder["currentStage"] | null;
  planned_start_date?: string | null;
  planned_daily_capacity?: number | null;
  estimated_lasting_days?: number | null;
  estimated_completion_date?: string | null;
  shipment_risk?: PurchaseOrder["shipmentRisk"] | null;
  production_plan_summary?: string | null;
  domino_warnings?: DominoWarning[] | null;
  purchase_order_sizes?: PurchaseOrderSizeRow[] | null;
};

type CustomerRow = {
  id: string;
  customer_name: string;
  brand?: string | null;
  contact_person?: string | null;
  email?: string | null;
  phone?: string | null;
  country?: string | null;
  notes?: string | null;
  status: Customer["status"];
  created_at?: string | null;
  updated_at?: string | null;
};

type PurchaseOrderSizeRow = {
  id: string;
  purchase_order_id: string;
  size: string;
  quantity: number;
  notes?: string | null;
};

type RelatedPurchaseOrder = {
  po_number?: string | null;
  buyer?: string | null;
};

type MaterialRow = {
  id: string;
  material_name: string;
  supplier: string;
  purchase_orders?: RelatedPurchaseOrder | RelatedPurchaseOrder[] | null;
  po_number?: string | null;
  required_qty?: number | null;
  received_qty?: number | null;
  unit?: string | null;
  status: Material["status"];
  expected_arrival?: string | null;
  actual_arrival?: string | null;
};

type BomMaterialRow = {
  id: string;
  style_id?: string | null;
  category?: string | null;
  material_category?: string | null;
  material_name: string;
  specification?: string | null;
  supplier?: string | null;
  unit?: string | null;
  consumption_per_pair?: number | null;
  wastage_percent?: number | null;
  calculation_type?: BomMaterial["calculationType"] | null;
  fixed_quantity?: number | null;
  criticality?: string | null;
  critical?: boolean | null;
  notes?: string | null;
  default_vendor_id?: string | null;
  vendors?: { vendor_name?: string | null } | { vendor_name?: string | null }[] | null;
  styles?:
    | {
        style_code?: string | null;
        style_name?: string | null;
        color?: string | null;
        brand?: string | null;
        size_range?: string | null;
      }
    | {
        style_code?: string | null;
        style_name?: string | null;
        color?: string | null;
        brand?: string | null;
        size_range?: string | null;
      }[]
    | null;
};

type VendorRow = {
  id: string;
  vendor_name: string;
  contact_person?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  material_categories?: string[] | null;
  notes?: string | null;
  status: Vendor["status"];
};

type StyleRow = {
  id: string;
  style_code: string;
  style_name?: string | null;
  color?: string | null;
  brand?: string | null;
  size_range?: string | null;
  notes?: string | null;
};

type MaterialRequirementRow = {
  id: string;
  purchase_order_id: string;
  customer_id?: string | null;
  style_id?: string | null;
  bom_material_id?: string | null;
  parent_bom_material_id?: string | null;
  material_name: string;
  specification?: string | null;
  calculation_type?: MaterialRequirement["calculationType"] | null;
  size_label?: string | null;
  size_value?: string | null;
  required_quantity?: number | null;
  ordered_quantity?: number | null;
  received_quantity?: number | null;
  balance_quantity?: number | null;
  unit?: string | null;
  vendor_id?: string | null;
  quantity_status: MaterialRequirement["quantityStatus"];
  notes?: string | null;
  vendors?: { vendor_name?: string | null } | { vendor_name?: string | null }[] | null;
};

type MaterialPoItemRow = {
  id: string;
  material_po_id: string;
  material_requirement_id?: string | null;
  material_name: string;
  specification?: string | null;
  quantity?: number | null;
  unit?: string | null;
  vendor_name_snapshot?: string | null;
  notes?: string | null;
};

type MaterialPurchaseOrderRow = {
  id: string;
  material_po_number: string;
  vendor_id?: string | null;
  customer_id?: string | null;
  purchase_order_id: string;
  style_id?: string | null;
  generated_date: string;
  expected_delivery_date?: string | null;
  status: MaterialPurchaseOrder["status"];
  notes?: string | null;
  warnings?: DominoWarning[] | null;
  last_sent_at?: string | null;
  vendors?:
    | { vendor_name?: string | null; email?: string | null }
    | { vendor_name?: string | null; email?: string | null }[]
    | null;
  customers?: { customer_name?: string | null } | { customer_name?: string | null }[] | null;
  purchase_orders?:
    | { po_number?: string | null; style_code?: string | null; color?: string | null }
    | { po_number?: string | null; style_code?: string | null; color?: string | null }[]
    | null;
  material_po_items?: MaterialPoItemRow[] | null;
};

type MaterialPoEmailLogRow = {
  id: string;
  material_po_id: string;
  sent_at: string;
  sent_by?: string | null;
  recipient_email: string;
  email_subject: string;
  email_body?: string | null;
  attachment_path?: string | null;
  status: MaterialPoEmailLog["status"];
  error_message?: string | null;
  sent_by_profile?:
    | { email?: string | null; full_name?: string | null }
    | { email?: string | null; full_name?: string | null }[]
    | null;
};

type ApprovalRow = {
  id: string;
  approval_type: Approval["type"];
  purchase_orders?: RelatedPurchaseOrder | RelatedPurchaseOrder[] | null;
  po_number?: string | null;
  buyer?: string | null;
  status: Approval["status"];
  approval_date: string;
  notes?: string | null;
};

type ProductionLineRow = {
  id: string;
  line_name: string;
  department: ProductionLine["department"];
  current_style?: string | null;
  purchase_orders?: RelatedPurchaseOrder | RelatedPurchaseOrder[] | null;
  current_order?: string | null;
  daily_target: number;
  daily_actual: number;
  capacity: number;
  status: ProductionLine["status"];
};

type DailyUpdateRow = {
  id: string;
  production_date: string;
  production_stage?: DailyUpdate["stage"] | null;
  production_line_id?: string | null;
  production_lines?:
    | {
        line_name?: string | null;
        department?: ProductionLine["department"] | null;
        current_style?: string | null;
      }
    | {
        line_name?: string | null;
        department?: ProductionLine["department"] | null;
        current_style?: string | null;
      }[]
    | null;
  purchase_orders?:
    | {
        po_number?: string | null;
        buyer?: string | null;
        style_code?: string | null;
        customer_name?: string | null;
      }
    | {
        po_number?: string | null;
        buyer?: string | null;
        style_code?: string | null;
        customer_name?: string | null;
      }[]
    | null;
  line_name?: string | null;
  po_number?: string | null;
  department?: ProductionLine["department"] | null;
  current_style?: string | null;
  customer_name?: string | null;
  style_code?: string | null;
  target_quantity: number;
  actual_quantity: number;
  notes?: string | null;
};

type DailyLogRow = {
  id: string;
  title: string;
  note: string;
  log_date: string;
  author_id?: string | null;
  department_stage?: string | null;
  purchase_order_id?: string | null;
  priority: DailyLog["priority"];
  status: DailyLog["status"];
  created_at?: string | null;
  updated_at?: string | null;
  author_profile?:
    | { email?: string | null; full_name?: string | null }
    | { email?: string | null; full_name?: string | null }[]
    | null;
  purchase_orders?:
    | {
        po_number?: string | null;
        buyer?: string | null;
        customer_name?: string | null;
      }
    | {
        po_number?: string | null;
        buyer?: string | null;
        customer_name?: string | null;
      }[]
    | null;
};

type ProductionTimelineRow = {
  id: string;
  purchase_order_id: string;
  event_type: string;
  event_title: string;
  event_description?: string | null;
  user_id?: string | null;
  created_at: string;
  author_profile?:
    | { email?: string | null; full_name?: string | null }
    | { email?: string | null; full_name?: string | null }[]
    | null;
  purchase_orders?:
    | {
        po_number?: string | null;
        style_code?: string | null;
        buyer?: string | null;
        customer_name?: string | null;
      }
    | {
        po_number?: string | null;
        style_code?: string | null;
        buyer?: string | null;
        customer_name?: string | null;
      }[]
    | null;
};

type AlertRow = {
  id: string;
  message: string;
  created_at: string;
  severity: Alert["severity"];
};

export function mapPurchaseOrder(row: PurchaseOrderRow): PurchaseOrder {
  const customer = related(row.customers);
  const approver = related(row.approved_by_profile);
  const sizes = (row.purchase_order_sizes ?? []).map(mapPurchaseOrderSize);
  const sizeTotal = sizes.reduce((sum, size) => sum + Number(size.quantity || 0), 0);
  return {
    id: row.id ?? row.po_number,
    customerId: row.customer_id ?? "",
    customerName: customer?.customer_name ?? row.buyer,
    poNumber: row.po_number,
    buyer: row.buyer || customer?.customer_name || "",
    poDate: row.po_date ?? "",
    article: row.article ?? "",
    brand: row.brand ?? customer?.brand ?? "",
    styleCode: row.style_code,
    styleName: row.style_name ?? "",
    color: row.color,
    quantity: row.quantity,
    price: Number(row.price ?? 0),
    currency: row.currency ?? "USD",
    deliveryDate: row.delivery_date,
    status: row.status,
    notes: row.notes ?? "",
    productImageUrl: row.product_image_url ?? "",
    approved: Boolean(row.approved),
    approvedBy: row.approved_by ?? "",
    approvedByName: approver?.full_name || approver?.email || "",
    approvedDate: row.approved_at ?? "",
    currentStage: row.current_stage ?? "Cutting",
    styleId: row.style_id ?? "",
    assignedProductionLineId: row.assigned_production_line_id ?? "",
    assignedLastingLineId: row.assigned_lasting_line_id ?? "",
    plannedStartDate: row.planned_start_date ?? "",
    plannedDailyCapacity: Number(row.planned_daily_capacity ?? 0),
    estimatedLastingDays: Number(row.estimated_lasting_days ?? 0),
    estimatedCompletionDate: row.estimated_completion_date ?? "",
    shipmentRisk: row.shipment_risk ?? "Unknown",
    productionPlanSummary: row.production_plan_summary ?? "",
    dominoWarnings: row.domino_warnings ?? [],
    sizes,
    sizeTotal,
    sizeTotalWarning:
      sizes.length > 0 && sizeTotal !== row.quantity
        ? `Size total ${sizeTotal} does not match PO quantity ${row.quantity}.`
        : undefined,
  };
}

export function mapCustomer(row: CustomerRow): Customer {
  return {
    id: row.id,
    customerName: row.customer_name,
    brand: row.brand ?? "",
    contactPerson: row.contact_person ?? "",
    email: row.email ?? "",
    phone: row.phone ?? "",
    country: row.country ?? "",
    notes: row.notes ?? "",
    status: row.status,
    createdAt: row.created_at ?? undefined,
    updatedAt: row.updated_at ?? undefined,
  };
}

export function mapPurchaseOrderSize(row: PurchaseOrderSizeRow): PurchaseOrderSize {
  return {
    id: row.id,
    purchaseOrderId: row.purchase_order_id,
    size: row.size,
    quantity: row.quantity,
    notes: row.notes ?? "",
  };
}

export function mapMaterial(row: MaterialRow): Material {
  const po = related<RelatedPurchaseOrder>(row.purchase_orders);
  return {
    id: row.id,
    name: row.material_name,
    supplier: row.supplier,
    poNumber: po?.po_number ?? row.po_number ?? "",
    requiredQty: Number(row.required_qty ?? 0),
    receivedQty: Number(row.received_qty ?? 0),
    unit: row.unit ?? "pairs",
    status: row.status,
    expectedArrival: row.expected_arrival ?? "",
    actualArrival: row.actual_arrival ?? "",
  };
}

export function mapBomMaterial(row: BomMaterialRow): BomMaterial {
  const style = related(row.styles);
  const vendor = related(row.vendors);
  return {
    id: row.id,
    styleId: row.style_id ?? "",
    styleCode: style?.style_code ?? "",
    styleName: style?.style_name ?? "",
    color: style?.color ?? "",
    brand: style?.brand ?? "",
    sizeRange: style?.size_range ?? "",
    category: row.category ?? row.material_category ?? "",
    materialName: row.material_name,
    specification: row.specification ?? "",
    supplier: row.supplier ?? "",
    unit: row.unit ?? "",
    consumptionPerPair: Number(row.consumption_per_pair ?? 0),
    wastagePercent: Number(row.wastage_percent ?? 0),
    calculationType: row.calculation_type ?? "Per Pair",
    fixedQuantity:
      row.fixed_quantity === null || row.fixed_quantity === undefined
        ? undefined
        : Number(row.fixed_quantity),
    criticality: row.criticality ?? (row.critical ? "Yes" : "No"),
    notes: row.notes ?? "",
    defaultVendorId: row.default_vendor_id ?? "",
    defaultVendorName: vendor?.vendor_name ?? "",
  };
}

export function mapVendor(row: VendorRow): Vendor {
  return {
    id: row.id,
    vendorName: row.vendor_name,
    contactPerson: row.contact_person ?? "",
    email: row.email ?? "",
    phone: row.phone ?? "",
    address: row.address ?? "",
    materialCategories: row.material_categories ?? [],
    notes: row.notes ?? "",
    status: row.status,
  };
}

export function mapStyle(row: StyleRow): Style {
  return {
    id: row.id,
    styleCode: row.style_code,
    styleName: row.style_name ?? "",
    color: row.color ?? "",
    brand: row.brand ?? "",
    sizeRange: row.size_range ?? "",
    notes: row.notes ?? "",
  };
}

export function mapMaterialRequirement(row: MaterialRequirementRow): MaterialRequirement {
  const vendor = related(row.vendors);
  return {
    id: row.id,
    purchaseOrderId: row.purchase_order_id,
    customerId: row.customer_id ?? "",
    styleId: row.style_id ?? "",
    bomMaterialId: row.bom_material_id ?? "",
    parentBomMaterialId: row.parent_bom_material_id ?? row.bom_material_id ?? "",
    materialName: row.material_name,
    specification: row.specification ?? "",
    calculationType: row.calculation_type ?? "Per Pair",
    sizeLabel: row.size_label ?? "",
    sizeValue: row.size_value ?? "",
    requiredQuantity: Number(row.required_quantity ?? 0),
    orderedQuantity: Number(row.ordered_quantity ?? 0),
    receivedQuantity: Number(row.received_quantity ?? 0),
    balanceQuantity: Number(row.balance_quantity ?? 0),
    unit: row.unit ?? "",
    vendorId: row.vendor_id ?? "",
    vendorName: vendor?.vendor_name ?? "",
    quantityStatus: row.quantity_status,
    notes: row.notes ?? "",
  };
}

export function mapMaterialPoItem(row: MaterialPoItemRow): MaterialPoItem {
  return {
    id: row.id,
    materialPoId: row.material_po_id,
    materialRequirementId: row.material_requirement_id ?? "",
    materialName: row.material_name,
    specification: row.specification ?? "",
    quantity: Number(row.quantity ?? 0),
    unit: row.unit ?? "",
    vendorNameSnapshot: row.vendor_name_snapshot ?? "",
    notes: row.notes ?? "",
  };
}

export function mapMaterialPurchaseOrder(row: MaterialPurchaseOrderRow): MaterialPurchaseOrder {
  const vendor = related(row.vendors);
  const customer = related(row.customers);
  const po = related(row.purchase_orders);
  const items = (row.material_po_items ?? []).map(mapMaterialPoItem);
  return {
    id: row.id,
    materialPoNumber: row.material_po_number,
    vendorId: row.vendor_id ?? "",
    vendorName: vendor?.vendor_name ?? "Unassigned Vendor",
    vendorEmail: vendor?.email ?? "",
    customerId: row.customer_id ?? "",
    customerName: customer?.customer_name ?? "",
    purchaseOrderId: row.purchase_order_id,
    poNumber: po?.po_number ?? "",
    styleId: row.style_id ?? "",
    styleCode: po?.style_code ?? "",
    color: po?.color ?? "",
    generatedDate: row.generated_date,
    expectedDeliveryDate: row.expected_delivery_date ?? "",
    status: row.status,
    notes: row.notes ?? "",
    warnings: row.warnings ?? [],
    itemCount: items.length,
    lastSentAt: row.last_sent_at ?? "",
    items,
  };
}

export function mapMaterialPoEmailLog(row: MaterialPoEmailLogRow): MaterialPoEmailLog {
  const sender = related(row.sent_by_profile);
  return {
    id: row.id,
    materialPoId: row.material_po_id,
    sentAt: row.sent_at,
    sentBy: row.sent_by ?? "",
    sentByName: sender?.full_name || sender?.email || "",
    recipientEmail: row.recipient_email,
    emailSubject: row.email_subject,
    emailBody: row.email_body ?? "",
    attachmentPath: row.attachment_path ?? "",
    status: row.status,
    errorMessage: row.error_message ?? "",
  };
}

export function mapApproval(row: ApprovalRow): Approval {
  const po = related<RelatedPurchaseOrder>(row.purchase_orders);
  return {
    id: row.id,
    type: row.approval_type,
    poNumber: po?.po_number ?? row.po_number ?? "",
    buyer: po?.buyer ?? row.buyer ?? "",
    status: row.status,
    date: row.approval_date,
    notes: row.notes ?? "",
  };
}

export function mapProductionLine(row: ProductionLineRow): ProductionLine {
  const po = related<RelatedPurchaseOrder>(row.purchase_orders);
  return {
    id: row.id,
    name: row.line_name,
    department: row.department,
    currentStyle: row.current_style ?? "",
    currentOrder: po?.po_number ?? row.current_order ?? "",
    dailyTarget: row.daily_target,
    dailyActual: row.daily_actual,
    capacity: row.capacity,
    status: row.status,
  };
}

export function mapDailyUpdate(row: DailyUpdateRow): DailyUpdate {
  const line = related<{
    line_name?: string | null;
    department?: ProductionLine["department"] | null;
    current_style?: string | null;
  }>(row.production_lines);
  const po = related<{
    po_number?: string | null;
    buyer?: string | null;
    style_code?: string | null;
    customer_name?: string | null;
  }>(row.purchase_orders);
  return {
    id: row.id,
    date: row.production_date,
    stage: row.production_stage ?? "Cutting",
    lineId: row.production_line_id ?? "",
    lineName: line?.line_name ?? row.line_name ?? "",
    department: line?.department ?? row.department ?? undefined,
    poNumber: po?.po_number ?? row.po_number ?? "",
    customerName: po?.customer_name ?? po?.buyer ?? row.customer_name ?? "",
    styleCode: po?.style_code ?? row.style_code ?? "",
    currentStyle: line?.current_style ?? row.current_style ?? "",
    targetQuantity: row.target_quantity,
    actualQuantity: row.actual_quantity,
    notes: row.notes ?? "",
  };
}

export function mapDailyLog(row: DailyLogRow): DailyLog {
  const author = related<{
    email?: string | null;
    full_name?: string | null;
  }>(row.author_profile);
  const po = related<{
    po_number?: string | null;
    buyer?: string | null;
    customer_name?: string | null;
  }>(row.purchase_orders);
  return {
    id: row.id,
    title: row.title,
    note: row.note,
    date: row.log_date,
    authorId: row.author_id ?? "",
    authorName: author?.full_name || author?.email || "",
    departmentStage: row.department_stage ?? "",
    purchaseOrderId: row.purchase_order_id ?? "",
    poNumber: po?.po_number ?? "",
    customerName: po?.customer_name ?? po?.buyer ?? "",
    priority: row.priority,
    status: row.status,
    createdAt: row.created_at ?? undefined,
    updatedAt: row.updated_at ?? undefined,
  };
}

export function mapProductionTimelineEvent(row: ProductionTimelineRow): ProductionTimelineEvent {
  const author = related<{
    email?: string | null;
    full_name?: string | null;
  }>(row.author_profile);
  const po = related<{
    po_number?: string | null;
    style_code?: string | null;
    buyer?: string | null;
    customer_name?: string | null;
  }>(row.purchase_orders);
  return {
    id: row.id,
    purchaseOrderId: row.purchase_order_id,
    poNumber: po?.po_number ?? "",
    customerName: po?.customer_name ?? po?.buyer ?? "",
    styleCode: po?.style_code ?? "",
    eventType: row.event_type,
    eventTitle: row.event_title,
    eventDescription: row.event_description ?? "",
    userId: row.user_id ?? "",
    userName: author?.full_name || author?.email || "System",
    createdAt: row.created_at,
  };
}

export function mapAlert(row: AlertRow): Alert {
  return {
    id: row.id,
    message: row.message,
    time: row.created_at,
    severity: row.severity,
  };
}
