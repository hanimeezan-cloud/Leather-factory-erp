export const ROLES = [
  "Owner",
  "Management",
  "Planning",
  "Sales",
  "Purchasing",
  "Warehouse",
  "Production",
  "Quality",
] as const;

export type Role = (typeof ROLES)[number];

export const PO_STATUSES = [
  "Planning",
  "Materials Pending",
  "Production Running",
  "Packing",
  "Ready To Ship",
  "Shipped",
  "Delayed",
] as const;

export type POStatus = (typeof PO_STATUSES)[number];

export const CUSTOMER_STATUSES = ["Active", "Inactive", "Prospect"] as const;

export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

export const MATERIAL_STATUSES = [
  "Not Ordered",
  "Ordered",
  "In Transit",
  "Received",
  "Delayed",
] as const;

export type MaterialStatus = (typeof MATERIAL_STATUSES)[number];

export const VENDOR_STATUSES = ["Active", "Inactive"] as const;

export type VendorStatus = (typeof VENDOR_STATUSES)[number];

export const MATERIAL_REQUIREMENT_QUANTITY_STATUSES = [
  "Calculated",
  "Needs manual quantity",
] as const;

export type MaterialRequirementQuantityStatus =
  (typeof MATERIAL_REQUIREMENT_QUANTITY_STATUSES)[number];

export const MATERIAL_CALCULATION_TYPES = [
  "Per Pair",
  "Size Wise",
  "Fixed Quantity",
  "Manual Quantity",
] as const;

export type MaterialCalculationType = (typeof MATERIAL_CALCULATION_TYPES)[number];

export const MATERIAL_PO_STATUSES = [
  "Draft",
  "Ready",
  "Sent",
  "Confirmed",
  "Partially Received",
  "Completed",
  "Cancelled",
] as const;

export type MaterialPoStatus = (typeof MATERIAL_PO_STATUSES)[number];

export const SHIPMENT_RISK_STATUSES = ["Low", "Medium", "High", "Unknown"] as const;

export type ShipmentRiskStatus = (typeof SHIPMENT_RISK_STATUSES)[number];

export const APPROVAL_TYPES = [
  "Sample Approval",
  "Material Approval",
  "Customer Approval",
] as const;

export type ApprovalType = (typeof APPROVAL_TYPES)[number];

export const APPROVAL_STATUSES = ["Pending", "Approved", "Rejected", "Delayed"] as const;

export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const PRODUCTION_DEPARTMENTS = ["Cutting", "Upper", "Bottom", "Packing"] as const;

export type ProductionDepartment = (typeof PRODUCTION_DEPARTMENTS)[number];

export const PRODUCTION_STAGES = PRODUCTION_DEPARTMENTS;

export const PRODUCTION_STAGE_STATUSES = [...PRODUCTION_STAGES, "Completed"] as const;

export type ProductionStage = (typeof PRODUCTION_STAGES)[number];

export type ProductionStageStatus = (typeof PRODUCTION_STAGE_STATUSES)[number];

export const LINE_STATUSES = ["Running", "Delayed", "Stopped"] as const;

export type LineStatus = (typeof LINE_STATUSES)[number];

export const ALERT_SEVERITIES = ["info", "warning", "danger"] as const;

export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export const REPORT_TYPES = [
  "daily-production",
  "weekly-production",
  "material-status",
  "order-progress",
  "shipment-status",
] as const;

export type ReportType = (typeof REPORT_TYPES)[number];

export const DAILY_LOG_PRIORITIES = ["Low", "Medium", "High"] as const;

export type DailyLogPriority = (typeof DAILY_LOG_PRIORITIES)[number];

export const DAILY_LOG_STATUSES = ["Open", "Resolved"] as const;

export type DailyLogStatus = (typeof DAILY_LOG_STATUSES)[number];

export interface Profile {
  userId: string;
  email: string;
  fullName: string | null;
  department: string | null;
  role: Role | null;
  active: boolean;
}

export interface Customer {
  id: string;
  customerName: string;
  brand: string;
  contactPerson: string;
  email: string;
  phone: string;
  country: string;
  notes: string;
  status: CustomerStatus;
  createdAt?: string;
  updatedAt?: string;
}

export interface PurchaseOrderSize {
  id: string;
  purchaseOrderId: string;
  size: string;
  quantity: number;
  notes?: string;
}

export interface PurchaseOrder {
  id: string;
  customerId: string;
  customerName: string;
  poNumber: string;
  buyer: string;
  poDate: string;
  article: string;
  brand: string;
  styleCode: string;
  styleName: string;
  color: string;
  quantity: number;
  price: number;
  currency: string;
  deliveryDate: string;
  status: POStatus;
  notes: string;
  productImageUrl: string;
  approved?: boolean;
  approvedBy?: string;
  approvedByName?: string;
  approvedDate?: string;
  currentStage: ProductionStageStatus;
  styleId?: string;
  assignedProductionLineId?: string;
  assignedLastingLineId?: string;
  plannedStartDate?: string;
  plannedDailyCapacity?: number;
  estimatedLastingDays?: number;
  estimatedCompletionDate?: string;
  shipmentRisk?: ShipmentRiskStatus;
  productionPlanSummary?: string;
  dominoWarnings?: DominoWarning[];
  sizes?: PurchaseOrderSize[];
  sizeTotal?: number;
  sizeTotalWarning?: string;
}

export interface Material {
  id: string;
  name: string;
  supplier: string;
  poNumber: string;
  requiredQty: number;
  receivedQty: number;
  unit: string;
  status: MaterialStatus;
  expectedArrival: string;
  actualArrival: string;
}

export interface BomMaterial {
  id: string;
  styleId?: string;
  styleCode: string;
  styleName: string;
  color: string;
  brand: string;
  sizeRange: string;
  category: string;
  materialName: string;
  specification: string;
  supplier: string;
  unit: string;
  consumptionPerPair: number;
  wastagePercent: number;
  calculationType?: MaterialCalculationType;
  fixedQuantity?: number;
  criticality: string;
  notes: string;
  defaultVendorId?: string;
  defaultVendorName?: string;
}

export interface Style {
  id: string;
  styleCode: string;
  styleName: string;
  color: string;
  brand: string;
  sizeRange: string;
  notes: string;
}

export interface DominoWarning {
  code: string;
  message: string;
  severity: "info" | "warning" | "danger";
}

export interface Vendor {
  id: string;
  vendorName: string;
  contactPerson: string;
  email: string;
  phone: string;
  address: string;
  materialCategories: string[];
  notes: string;
  status: VendorStatus;
}

export interface BomVendorAssignmentResult {
  material: BomMaterial;
  regeneratedPurchaseOrderIds: string[];
}

export interface MaterialRequirement {
  id: string;
  purchaseOrderId: string;
  customerId: string;
  styleId: string;
  bomMaterialId: string;
  parentBomMaterialId?: string;
  materialName: string;
  specification: string;
  calculationType?: MaterialCalculationType;
  sizeLabel?: string;
  sizeValue?: string;
  requiredQuantity: number;
  orderedQuantity: number;
  receivedQuantity: number;
  balanceQuantity: number;
  unit: string;
  vendorId: string;
  vendorName: string;
  quantityStatus: MaterialRequirementQuantityStatus;
  notes: string;
}

export interface ProductionAssignmentResult {
  line: ProductionLine;
  purchaseOrder: PurchaseOrder | null;
}

export interface ProductionStageMoveResult {
  purchaseOrder: PurchaseOrder;
}

export interface MaterialPoItem {
  id: string;
  materialPoId: string;
  materialRequirementId: string;
  materialName: string;
  specification: string;
  quantity: number;
  unit: string;
  vendorNameSnapshot: string;
  notes: string;
}

export interface MaterialPoPreviewItem {
  materialName: string;
  specification: string;
  quantity: number;
  unit: string;
  expectedDeliveryDate: string;
  notes: string;
}

export interface MaterialPoPreview {
  companyName: string;
  vendorName: string;
  vendorContact: string;
  vendorEmail: string;
  materialPoNumber: string;
  generatedDate: string;
  expectedDeliveryDate: string;
  customerName: string;
  customerPoNumber: string;
  styleCode: string;
  color: string;
  notes: string;
  items: MaterialPoPreviewItem[];
}

export interface MaterialPoEmailLog {
  id: string;
  materialPoId: string;
  sentAt: string;
  sentBy: string;
  sentByName: string;
  recipientEmail: string;
  emailSubject: string;
  emailBody: string;
  attachmentPath: string;
  status: "Sent" | "Failed" | "Demo";
  errorMessage: string;
}

export interface MaterialPurchaseOrder {
  id: string;
  materialPoNumber: string;
  vendorId: string;
  vendorName: string;
  vendorEmail?: string;
  customerId: string;
  customerName: string;
  purchaseOrderId: string;
  poNumber: string;
  styleId: string;
  styleCode: string;
  color: string;
  generatedDate: string;
  expectedDeliveryDate: string;
  status: MaterialPoStatus;
  notes: string;
  warnings: DominoWarning[];
  itemCount: number;
  lastSentAt?: string;
  items?: MaterialPoItem[];
}

export interface ProductionTimelineEvent {
  id: string;
  purchaseOrderId: string;
  poNumber: string;
  customerName: string;
  styleCode: string;
  eventType: string;
  eventTitle: string;
  eventDescription: string;
  userId: string;
  userName: string;
  createdAt: string;
}

export interface ProductionPlan {
  currentStage: ProductionStageStatus;
  progressPercent: number;
  estimatedCompletionDate: string;
  daysRemaining: number | null;
  shipmentRisk: ShipmentRiskStatus;
}

export interface Approval {
  id: string;
  type: ApprovalType;
  poNumber: string;
  buyer: string;
  status: ApprovalStatus;
  date: string;
  notes: string;
}

export interface ProductionLine {
  id: string;
  name: string;
  department: ProductionDepartment;
  currentStyle: string;
  currentOrder: string;
  dailyTarget: number;
  dailyActual: number;
  capacity: number;
  status: LineStatus;
}

export interface DailyUpdate {
  id: string;
  date: string;
  stage: ProductionStage;
  lineId: string;
  lineName: string;
  department?: ProductionDepartment;
  poNumber: string;
  customerName?: string;
  styleCode?: string;
  currentStyle?: string;
  targetQuantity: number;
  actualQuantity: number;
  notes: string;
}

export interface DailyLog {
  id: string;
  title: string;
  note: string;
  date: string;
  authorId: string;
  authorName: string;
  departmentStage: string;
  purchaseOrderId: string;
  poNumber: string;
  customerName?: string;
  priority: DailyLogPriority;
  status: DailyLogStatus;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProductionDepartmentSummary {
  department: ProductionDepartment;
  label: string;
  target: number;
  actual: number;
  difference: number;
  achievementPercent: number;
  delayedOrUnderTarget: boolean;
}

export interface ProductionStageSummary {
  stage: ProductionStage;
  label: string;
  target: number;
  actual: number;
  remaining: number;
  activeLines: number;
  activePurchaseOrders: number;
  difference: number;
  achievementPercent: number;
  delayedOrUnderTarget: boolean;
}

export interface Alert {
  id: string;
  message: string;
  time: string;
  severity: AlertSeverity;
}

export interface DashboardMetrics {
  activeOrders: number;
  delayedOrders: number;
  pendingApprovals: number;
  yesterdayProduction: number;
  todayProductionTarget: number;
  todayProductionActual: number;
  productionAchievementPercent: number;
  productionBreakdown: ProductionStageSummary[];
  delayedProductionDepartments: string[];
  ordersAtRisk: number;
  pendingShipments: number;
  materialPending: number;
  draftMaterialPos: number;
  openDailyLogs: number;
  highPriorityDailyLogs: number;
  todaysDailyLogs: number;
  recentDailyLogs: DailyLog[];
  recentAlerts: Alert[];
  recentPurchaseOrders: PurchaseOrder[];
}

export const ROUTE_ACCESS: Record<string, Role[]> = {
  "/": ["Owner", "Management", "Planning", "Sales"],
  "/dashboard": ["Owner", "Management", "Planning", "Sales"],
  "/purchase-orders": ["Owner", "Management", "Planning", "Sales", "Purchasing", "Production"],
  "/customers": ["Owner", "Management", "Planning", "Sales", "Purchasing"],
  "/vendors": ["Owner", "Management", "Planning", "Purchasing"],
  "/materials": ["Owner", "Management", "Planning", "Purchasing", "Warehouse"],
  "/material-pos": ["Owner", "Management", "Planning", "Purchasing"],
  "/approvals": ["Owner", "Management", "Planning", "Quality"],
  "/production-lines": ["Owner", "Management", "Planning", "Production"],
  "/daily-updates": ["Owner", "Management", "Planning", "Production", "Warehouse", "Quality"],
  "/daily-logs": ["Owner", "Management", "Planning", "Production", "Warehouse", "Quality"],
  "/reports": ["Owner", "Management", "Planning", "Sales", "Warehouse", "Quality"],
  "/users": ["Owner"],
  "/admin-tools": ["Owner"],
};

export function canApproveFinal(role: Role | null | undefined) {
  return role === "Owner" || role === "Management" || role === "Planning";
}

export function canMoveProductionStage(role: Role | null | undefined) {
  return role === "Owner" || role === "Management" || role === "Planning" || role === "Production";
}

export function nextProductionStage(stage: ProductionStageStatus): ProductionStageStatus | null {
  const index = PRODUCTION_STAGE_STATUSES.indexOf(stage);
  if (index === -1 || index >= PRODUCTION_STAGE_STATUSES.length - 1) return null;
  return PRODUCTION_STAGE_STATUSES[index + 1];
}

export function canAccessPath(role: Role | null | undefined, path: string) {
  if (!role) return false;
  if (role === "Owner") return true;
  const route = Object.keys(ROUTE_ACCESS)
    .filter((candidate) => (candidate === "/" ? path === "/" : path.startsWith(candidate)))
    .sort((a, b) => b.length - a.length)[0];
  return route ? ROUTE_ACCESS[route].includes(role) : false;
}
