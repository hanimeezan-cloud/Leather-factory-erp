import {
  type ProductionPlan,
  type ProductionStageStatus,
  type PurchaseOrder,
  type ShipmentRiskStatus,
} from "./domain";

const progressByStage: Record<ProductionStageStatus, number> = {
  Cutting: 25,
  Upper: 50,
  Bottom: 75,
  Packing: 100,
  Completed: 100,
};

export function productionProgressPercent(stage: ProductionStageStatus | undefined) {
  return progressByStage[stage ?? "Cutting"] ?? 0;
}

export function daysUntilDate(dateValue: string | undefined) {
  if (!dateValue) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${dateValue.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  return Math.ceil((target.getTime() - today.getTime()) / 86_400_000);
}

export function calculateShipmentRisk(order: PurchaseOrder): ShipmentRiskStatus {
  if (order.status === "Shipped" || order.currentStage === "Completed") return "Low";
  const daysRemaining = daysUntilDate(order.deliveryDate);
  if (daysRemaining === null) return order.shipmentRisk ?? "Unknown";
  if (daysRemaining < 0) return "High";
  if (daysRemaining <= 7) return "Medium";
  return "Low";
}

export function estimatedFinishDate(order: PurchaseOrder) {
  return order.estimatedCompletionDate || order.deliveryDate || "";
}

export function buildProductionPlan({ order }: { order: PurchaseOrder }): ProductionPlan {
  const finishDate = estimatedFinishDate(order);
  return {
    currentStage: order.currentStage || "Cutting",
    progressPercent: productionProgressPercent(order.currentStage),
    estimatedCompletionDate: finishDate,
    daysRemaining: daysUntilDate(finishDate || order.deliveryDate),
    shipmentRisk: calculateShipmentRisk(order),
  };
}

export function formatPlanDate(dateValue: string | undefined) {
  if (!dateValue) return "-";
  const date = new Date(`${dateValue.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateValue;
  return date.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}
