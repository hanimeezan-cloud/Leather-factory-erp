import { makeId } from "./demo-data";
import type {
  BomMaterial,
  DominoWarning,
  MaterialCalculationType,
  MaterialPoItem,
  MaterialPurchaseOrder,
  MaterialRequirement,
  PurchaseOrder,
} from "./domain";
import type { DemoData } from "./demo-data";

type DraftGroup = {
  vendorId: string;
  vendorName: string;
  requirements: MaterialRequirement[];
  warnings: DominoWarning[];
};

const lockedMaterialPoStatuses = new Set(["Sent", "Confirmed", "Completed", "Cancelled"]);

function warning(code: string, message: string, severity: DominoWarning["severity"] = "warning") {
  return { code, message, severity };
}

function normalizeStyleMatchValue(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function styleKey(value: Pick<PurchaseOrder | BomMaterial, "styleCode" | "color" | "brand">) {
  return [value.styleCode, value.color, value.brand]
    .map((item) => normalizeStyleMatchValue(item))
    .join("::");
}

function styleLabel(value: Pick<BomMaterial, "styleCode" | "color" | "brand">) {
  return [value.styleCode, value.color, value.brand].filter(Boolean).join(" / ");
}

function roundQuantity(value: number) {
  return Math.round(value * 10000) / 10000;
}

function isSoleMaterial(material: Pick<BomMaterial, "category" | "materialName">) {
  return [material.category, material.materialName].join(" ").toLowerCase().includes("sole");
}

function calculationTypeForBom(material: BomMaterial): MaterialCalculationType {
  if (material.calculationType) return material.calculationType;
  return isSoleMaterial(material) ? "Size Wise" : "Per Pair";
}

function sizeSpecification(baseSpecification: string | undefined, size: string) {
  return [baseSpecification, `Size ${size}`].filter(Boolean).join(" - ");
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function shipmentRisk(completionDate: string | undefined, deliveryDate: string | undefined) {
  if (!completionDate || !deliveryDate) return "Unknown";
  const completion = new Date(`${completionDate}T00:00:00.000Z`).getTime();
  const delivery = new Date(`${deliveryDate}T00:00:00.000Z`).getTime();
  const daysBefore = Math.floor((delivery - completion) / (24 * 60 * 60 * 1000));
  if (daysBefore >= 7) return "Low";
  if (daysBefore >= 0) return "Medium";
  return "High";
}

function nextMaterialPoNumber(materialPurchaseOrders: MaterialPurchaseOrder[]) {
  const year = new Date().getFullYear();
  const max = materialPurchaseOrders.reduce((highest, item) => {
    const match = item.materialPoNumber.match(/^MPO-\d{4}-(\d+)$/);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);
  return `MPO-${year}-${String(max + 1).padStart(4, "0")}`;
}

function withItems(data: DemoData, po: MaterialPurchaseOrder): MaterialPurchaseOrder {
  const items = data.materialPoItems.filter((item) => item.materialPoId === po.id);
  return { ...po, items, itemCount: items.length };
}

function clearDraftDominoForPo(data: DemoData, purchaseOrderId: string): DemoData {
  const draftIds = new Set(
    data.materialPurchaseOrders
      .filter((item) => item.purchaseOrderId === purchaseOrderId && item.status === "Draft")
      .map((item) => item.id),
  );
  return {
    ...data,
    materialRequirements: data.materialRequirements.filter(
      (item) => item.purchaseOrderId !== purchaseOrderId,
    ),
    materialPoItems: data.materialPoItems.filter((item) => !draftIds.has(item.materialPoId)),
    materialPurchaseOrders: data.materialPurchaseOrders.filter((item) => !draftIds.has(item.id)),
  };
}

function clearDraftItemsAndRequirementsForPo(data: DemoData, purchaseOrderId: string): DemoData {
  const draftIds = new Set(
    data.materialPurchaseOrders
      .filter((item) => item.purchaseOrderId === purchaseOrderId && item.status === "Draft")
      .map((item) => item.id),
  );
  return {
    ...data,
    materialRequirements: data.materialRequirements.filter(
      (item) => item.purchaseOrderId !== purchaseOrderId,
    ),
    materialPoItems: data.materialPoItems.filter((item) => !draftIds.has(item.materialPoId)),
  };
}

export function runDemoDominoWorkflow(data: DemoData, purchaseOrderId: string): DemoData {
  const order = data.purchaseOrders.find((item) => item.id === purchaseOrderId);
  if (!order) return data;

  const warnings: DominoWarning[] = [];
  const matchingBom = order.styleId
    ? data.bomMaterials.filter((item) => item.styleId === order.styleId)
    : data.bomMaterials.filter((item) => styleKey(item) === styleKey(order));
  if (!matchingBom.length) {
    const orderCode = normalizeStyleMatchValue(order.styleCode);
    const orderBrand = normalizeStyleMatchValue(order.brand);
    const orderColor = normalizeStyleMatchValue(order.color);
    const suggestions = data.bomMaterials
      .filter((item) => {
        const code = normalizeStyleMatchValue(item.styleCode);
        const brand = normalizeStyleMatchValue(item.brand);
        const color = normalizeStyleMatchValue(item.color);
        return (
          code === orderCode ||
          (orderCode.length >= 3 && code.includes(orderCode)) ||
          (code.length >= 3 && orderCode.includes(code)) ||
          (brand === orderBrand && color === orderColor)
        );
      })
      .filter(
        (item, index, all) =>
          all.findIndex((candidate) => candidate.styleId === item.styleId) === index,
      )
      .slice(0, 5);
    const suggestionText = suggestions.length
      ? ` Suggested styles: ${suggestions.map(styleLabel).join("; ")}. Use Link BOM to connect one.`
      : " No similar styles were found. Import the BOM template for this style first.";
    warnings.push(
      warning(
        "missing_bom",
        `No BOM found for this style. Import or create BOM before material requirements can be generated.${suggestionText}`,
      ),
    );
    const cleared = clearDraftDominoForPo(data, purchaseOrderId);
    return {
      ...cleared,
      purchaseOrders: cleared.purchaseOrders.map((item) =>
        item.id === purchaseOrderId
          ? {
              ...item,
              styleId: "",
              dominoWarnings: warnings,
            }
          : item,
      ),
    };
  }

  let nextData = clearDraftItemsAndRequirementsForPo(data, purchaseOrderId);
  const styleId = matchingBom[0].styleId ?? "";
  const lastingLine = nextData.productionLines.find(
    (line) => line.id === order.assignedLastingLineId,
  );
  const capacity = lastingLine?.capacity ?? 0;
  let estimatedLastingDays: number | undefined;
  let estimatedCompletionDate = "";
  let shipmentRiskValue: PurchaseOrder["shipmentRisk"] = "Unknown";
  let productionPlanSummary = "";

  if (!capacity) {
    warnings.push(
      warning("missing_lasting_capacity", "Assigned lasting line or daily capacity is missing."),
    );
  } else {
    estimatedLastingDays = Math.max(Math.ceil(Number(order.quantity || 0) / capacity), 1);
    if (order.plannedStartDate) {
      estimatedCompletionDate = addDays(order.plannedStartDate, estimatedLastingDays - 1);
      shipmentRiskValue = shipmentRisk(estimatedCompletionDate, order.deliveryDate);
    } else {
      warnings.push(warning("missing_planned_start", "Planned start date is missing."));
    }
    productionPlanSummary = `${lastingLine?.name ?? "Selected line"} can finish estimated lasting in ${estimatedLastingDays} day(s).`;
  }

  const existingRequirements = data.materialRequirements.filter(
    (item) => item.purchaseOrderId === purchaseOrderId,
  );
  const sizeRows = nextData.purchaseOrderSizes.filter(
    (item) => item.purchaseOrderId === purchaseOrderId,
  );
  const requirements: MaterialRequirement[] = [];

  for (const bom of matchingBom) {
    const calculationType = calculationTypeForBom(bom);
    const hasConsumption =
      typeof bom.consumptionPerPair === "number" && Number.isFinite(bom.consumptionPerPair);
    const hasFixedQuantity =
      typeof bom.fixedQuantity === "number" && Number.isFinite(bom.fixedQuantity);
    const vendorId = bom.defaultVendorId || "";
    const vendor = nextData.vendors.find((item) => item.id === vendorId);
    if (!vendorId) {
      warnings.push(
        warning(
          "missing_vendor",
          `${bom.materialName} has no vendor assigned and will be grouped as Unassigned Vendor.`,
        ),
      );
    }

    type RequirementPayload = {
      materialName: string;
      specification: string;
      requiredQuantity: number;
      quantityStatus: MaterialRequirement["quantityStatus"];
      notes: string;
      sizeLabel: string;
      sizeValue: string;
    };

    const payloads: RequirementPayload[] = [];
    if (calculationType === "Manual Quantity") {
      warnings.push(
        warning("manual_quantity", `${bom.materialName} is marked for manual quantity entry.`),
      );
      payloads.push({
        materialName: bom.materialName,
        specification: bom.specification,
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
            `${bom.materialName} needs manual quantity because fixed quantity is missing.`,
          ),
        );
      }
      payloads.push({
        materialName: bom.materialName,
        specification: bom.specification,
        requiredQuantity: hasFixedQuantity ? roundQuantity(Number(bom.fixedQuantity)) : 0,
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
            `${bom.materialName}: Size-wise material requires PO size breakdown.`,
          ),
        );
        payloads.push({
          materialName: bom.materialName,
          specification: bom.specification,
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
            `${bom.materialName} needs manual quantity because consumption per pair is missing.`,
          ),
        );
        for (const size of sizeRows) {
          payloads.push({
            materialName: bom.materialName,
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
          payloads.push({
            materialName: bom.materialName,
            specification: sizeSpecification(bom.specification, size.size),
            requiredQuantity: roundQuantity(
              Number(size.quantity || 0) *
                Number(bom.consumptionPerPair || 0) *
                (1 + Number(bom.wastagePercent || 0) / 100),
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
            `${bom.materialName} needs manual quantity because consumption per pair is missing.`,
          ),
        );
      }
      payloads.push({
        materialName: bom.materialName,
        specification: bom.specification,
        requiredQuantity: hasConsumption
          ? roundQuantity(
              Number(order.quantity || 0) *
                Number(bom.consumptionPerPair || 0) *
                (1 + Number(bom.wastagePercent || 0) / 100),
            )
          : 0,
        quantityStatus: hasConsumption ? "Calculated" : "Needs manual quantity",
        notes: hasConsumption ? "" : "Consumption per pair missing.",
        sizeLabel: "",
        sizeValue: "",
      });
    }

    for (const payload of payloads) {
      const existing = existingRequirements.find(
        (item) => item.bomMaterialId === bom.id && (item.sizeValue || "") === payload.sizeValue,
      );
      const receivedQuantity = Number(existing?.receivedQuantity ?? 0);
      requirements.push({
        id: existing?.id || makeId("req"),
        purchaseOrderId,
        customerId: order.customerId,
        styleId,
        bomMaterialId: bom.id,
        parentBomMaterialId: bom.id,
        materialName: payload.materialName,
        specification: payload.specification,
        calculationType,
        sizeLabel: payload.sizeLabel,
        sizeValue: payload.sizeValue,
        requiredQuantity: payload.requiredQuantity,
        orderedQuantity: Number(existing?.orderedQuantity ?? 0),
        receivedQuantity,
        balanceQuantity: Math.max(payload.requiredQuantity - receivedQuantity, 0),
        unit: bom.unit,
        vendorId,
        vendorName: vendor?.vendorName ?? "",
        quantityStatus: payload.quantityStatus,
        notes: existing?.notes ?? payload.notes,
      });
    }
  }

  nextData = {
    ...nextData,
    materialRequirements: [
      ...requirements,
      ...nextData.materialRequirements.filter((item) => item.purchaseOrderId !== purchaseOrderId),
    ],
  };

  const groups = new Map<string, DraftGroup>();
  for (const requirement of requirements) {
    const key = requirement.vendorId || "unassigned";
    const vendor = nextData.vendors.find((item) => item.id === requirement.vendorId);
    const existing = groups.get(key);
    const group = existing ?? {
      vendorId: requirement.vendorId,
      vendorName: vendor?.vendorName ?? "Unassigned Vendor",
      requirements: [],
      warnings: requirement.vendorId
        ? []
        : [
            warning(
              "missing_vendor",
              "This draft contains requirements without an assigned vendor.",
            ),
          ],
    };
    group.requirements.push(requirement);
    groups.set(key, group);
  }

  let materialPurchaseOrders = [...nextData.materialPurchaseOrders];
  let materialPoItems = [...nextData.materialPoItems];
  const touchedMaterialPoIds = new Set<string>();

  for (const group of groups.values()) {
    const existingDraft = materialPurchaseOrders.find(
      (item) =>
        item.purchaseOrderId === purchaseOrderId &&
        item.status === "Draft" &&
        (item.vendorId || "") === group.vendorId,
    );
    const locked = materialPurchaseOrders.find(
      (item) =>
        item.purchaseOrderId === purchaseOrderId &&
        lockedMaterialPoStatuses.has(item.status) &&
        (item.vendorId || "") === group.vendorId,
    );
    if (locked && !existingDraft) {
      warnings.push(
        warning(
          "locked_material_po",
          `${locked.materialPoNumber} is ${locked.status} and was not overwritten.`,
        ),
      );
    }

    const materialPoId = existingDraft?.id || makeId("mpo");
    const materialPo: MaterialPurchaseOrder = {
      id: materialPoId,
      materialPoNumber:
        existingDraft?.materialPoNumber || nextMaterialPoNumber(materialPurchaseOrders),
      vendorId: group.vendorId,
      vendorName: group.vendorName,
      customerId: order.customerId,
      customerName: order.customerName || order.buyer,
      purchaseOrderId,
      poNumber: order.poNumber,
      styleId,
      styleCode: order.styleCode,
      color: order.color,
      generatedDate: new Date().toISOString().slice(0, 10),
      expectedDeliveryDate: order.deliveryDate,
      status: "Draft",
      notes: existingDraft?.notes ?? "",
      warnings: group.warnings,
      itemCount: group.requirements.length,
    };
    touchedMaterialPoIds.add(materialPoId);

    materialPurchaseOrders = existingDraft
      ? materialPurchaseOrders.map((item) => (item.id === existingDraft.id ? materialPo : item))
      : [materialPo, ...materialPurchaseOrders];
    materialPoItems = [
      ...group.requirements.map(
        (requirement) =>
          ({
            id: makeId("mpoi"),
            materialPoId,
            materialRequirementId: requirement.id,
            materialName: requirement.materialName,
            specification: requirement.specification,
            quantity: requirement.requiredQuantity,
            unit: requirement.unit,
            vendorNameSnapshot: group.vendorName,
            notes: requirement.notes,
          }) satisfies MaterialPoItem,
      ),
      ...materialPoItems.filter((item) => item.materialPoId !== materialPoId),
    ];
  }

  materialPurchaseOrders = materialPurchaseOrders.filter(
    (item) =>
      item.purchaseOrderId !== purchaseOrderId ||
      item.status !== "Draft" ||
      touchedMaterialPoIds.has(item.id),
  );

  nextData = {
    ...nextData,
    materialPurchaseOrders: materialPurchaseOrders.map((item) =>
      withItems({ ...nextData, materialPoItems }, item),
    ),
    materialPoItems,
    purchaseOrders: nextData.purchaseOrders.map((item) =>
      item.id === purchaseOrderId
        ? {
            ...item,
            styleId,
            plannedDailyCapacity: capacity || undefined,
            estimatedLastingDays,
            estimatedCompletionDate,
            shipmentRisk: shipmentRiskValue,
            productionPlanSummary,
            dominoWarnings: warnings,
          }
        : item,
    ),
  };

  return nextData;
}
