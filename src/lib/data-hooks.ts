import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  attachOrderSizes,
  clearDemoData,
  createDemoUser,
  getCurrentDemoProfile,
  getDashboardMetrics,
  getDemoData,
  getDemoUsers,
  makeId,
  resetDemoData,
  saveDemoData,
  saveDemoUser,
  toProfile,
  type DemoData,
} from "./demo-data";
import { runDemoDominoWorkflow } from "./demo-domino";
import { nextProductionStage } from "./domain";
import type {
  Approval,
  BomVendorAssignmentResult,
  BomMaterial,
  Customer,
  DashboardMetrics,
  DailyLog,
  DailyUpdate,
  Material,
  MaterialPoEmailLog,
  MaterialPoPreview,
  MaterialPurchaseOrder,
  MaterialRequirement,
  ProductionLine,
  ProductionTimelineEvent,
  ProductionAssignmentResult,
  ProductionStageStatus,
  ProductionStageMoveResult,
  Profile,
  PurchaseOrder,
  PurchaseOrderSize,
  Style,
  Vendor,
} from "./domain";
import { apiRequest, toJsonBody } from "./api-client";
import { isDemoMode } from "./app-config";

// Demo mode uses localStorage-backed sample data; Supabase mode uses the API.

type EntityName =
  | "customers"
  | "purchase-orders"
  | "materials"
  | "approvals"
  | "production-lines"
  | "daily-updates"
  | "daily-logs";

type EntityMap = {
  customers: Customer;
  "purchase-orders": PurchaseOrder;
  materials: Material;
  approvals: Approval;
  "production-lines": ProductionLine;
  "daily-updates": DailyUpdate;
  "daily-logs": DailyLog;
};

export type ArchiveMode = "active" | "archived" | "all";

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

export type ClearTestDataScope =
  | "all-demo-local"
  | "purchase-orders"
  | "customers-purchase-orders"
  | "materials-bom-material-pos"
  | "vendors"
  | "production-daily-logs"
  | "everything-except-users";

export type ClearTestDataMode = "archive" | "hard-delete";

type ArchivedRecord = { id: string; archivedAt?: string | null; archiveReason?: string };

const dataKeys = {
  customers: "customers",
  "purchase-orders": "purchaseOrders",
  materials: "materials",
  approvals: "approvals",
  "production-lines": "productionLines",
  "daily-updates": "dailyUpdates",
  "daily-logs": "dailyLogs",
} as const;

const adminDemoDataKeys = {
  customers: "customers",
  "purchase-orders": "purchaseOrders",
  "bom-materials": "bomMaterials",
  "material-requirements": "materialRequirements",
  "material-pos": "materialPurchaseOrders",
  "material-po-items": "materialPoItems",
  materials: "materials",
  vendors: "vendors",
  approvals: "approvals",
  "production-lines": "productionLines",
  "daily-logs": "dailyLogs",
  "daily-updates": "dailyUpdates",
} as const satisfies Partial<Record<AdminEntity, keyof DemoData>>;

function demoDataKeyForAdminEntity(entity: AdminEntity): keyof DemoData | undefined {
  return (adminDemoDataKeys as Partial<Record<AdminEntity, keyof DemoData>>)[entity];
}

const clearScopeDemoKeys = {
  "purchase-orders": [
    "purchaseOrders",
    "purchaseOrderSizes",
    "materialRequirements",
    "materialPurchaseOrders",
    "materialPoItems",
    "approvals",
    "dailyUpdates",
    "dailyLogs",
    "productionTimeline",
  ],
  "customers-purchase-orders": [
    "customers",
    "purchaseOrders",
    "purchaseOrderSizes",
    "materialRequirements",
    "materialPurchaseOrders",
    "materialPoItems",
    "approvals",
    "dailyUpdates",
    "dailyLogs",
    "productionTimeline",
  ],
  "materials-bom-material-pos": [
    "materials",
    "bomMaterials",
    "materialRequirements",
    "materialPurchaseOrders",
    "materialPoItems",
  ],
  vendors: ["vendors"],
  "production-daily-logs": ["productionLines", "dailyUpdates", "dailyLogs", "productionTimeline"],
  "everything-except-users": [
    "customers",
    "purchaseOrders",
    "purchaseOrderSizes",
    "materials",
    "bomMaterials",
    "vendors",
    "materialRequirements",
    "materialPurchaseOrders",
    "materialPoItems",
    "materialPoEmailLogs",
    "approvals",
    "productionLines",
    "dailyUpdates",
    "dailyLogs",
    "productionTimeline",
  ],
} as const satisfies Partial<Record<ClearTestDataScope, readonly (keyof DemoData)[]>>;

const idPrefixes = {
  customers: "cust",
  "purchase-orders": "po",
  materials: "mat",
  approvals: "app",
  "production-lines": "line",
  "daily-updates": "upd",
  "daily-logs": "log",
} as const;

function archiveMatches(item: unknown, archive: ArchiveMode) {
  const archivedAt = (item as Partial<ArchivedRecord>).archivedAt;
  if (archive === "all") return true;
  if (archive === "archived") return Boolean(archivedAt);
  return !archivedAt;
}

function filterArchive<T>(items: T[], archive: ArchiveMode) {
  return items.filter((item) => archiveMatches(item, archive));
}

function readEntityList<T extends EntityName>(
  entity: T,
  archive: ArchiveMode = "active",
): EntityMap[T][] {
  const data = getDemoData();
  if (entity === "purchase-orders") {
    return filterArchive(
      attachOrderSizes(data.purchaseOrders, data.purchaseOrderSizes),
      archive,
    ) as EntityMap[T][];
  }
  return filterArchive(data[dataKeys[entity]] as EntityMap[T][], archive);
}

function withPurchaseOrderCustomer(
  values: Partial<PurchaseOrder>,
  fallback: Partial<PurchaseOrder> = {},
) {
  const data = getDemoData();
  const customerId = values.customerId ?? fallback.customerId ?? "";
  const customer = data.customers.find((item) => item.id === customerId);
  const customerName =
    values.customerName ?? customer?.customerName ?? values.buyer ?? fallback.customerName ?? "";

  return {
    customerId,
    customerName,
    buyer: values.buyer ?? customerName,
    brand: values.brand ?? customer?.brand ?? fallback.brand ?? "",
  };
}

function normalizeSizes(
  purchaseOrderId: string,
  sizes: Array<Partial<PurchaseOrderSize>> | undefined,
) {
  return (sizes ?? [])
    .filter((size) => String(size.size ?? "").trim())
    .map((size) => ({
      id: size.id || makeId("size"),
      purchaseOrderId,
      size: String(size.size ?? "").trim(),
      quantity: Number(size.quantity ?? 0),
      notes: size.notes ?? "",
    }));
}

function appendDemoTimelineEvent(
  data: ReturnType<typeof getDemoData>,
  purchaseOrderId: string,
  eventType: string,
  eventTitle: string,
  eventDescription = "",
) {
  const order = data.purchaseOrders.find((item) => item.id === purchaseOrderId);
  if (!order) return data;
  const profile = getCurrentDemoProfile();
  const event: ProductionTimelineEvent = {
    id: makeId("timeline"),
    purchaseOrderId,
    poNumber: order.poNumber,
    customerName: order.customerName || order.buyer,
    styleCode: order.styleCode,
    eventType,
    eventTitle,
    eventDescription,
    userId: profile?.userId ?? "",
    userName: profile?.fullName ?? profile?.email ?? "Demo user",
    createdAt: new Date().toISOString(),
  };
  return {
    ...data,
    productionTimeline: [event, ...(data.productionTimeline ?? [])],
  };
}

function appendDemoDominoTimelineEvents(
  data: ReturnType<typeof getDemoData>,
  purchaseOrderId: string,
) {
  const requirementCount = data.materialRequirements.filter(
    (item) => item.purchaseOrderId === purchaseOrderId,
  ).length;
  const materialPoCount = data.materialPurchaseOrders.filter(
    (item) => item.purchaseOrderId === purchaseOrderId && item.status === "Draft",
  ).length;
  const warnings = data.purchaseOrders.find((item) => item.id === purchaseOrderId)?.dominoWarnings;
  let nextData = data;
  if (requirementCount > 0) {
    nextData = appendDemoTimelineEvent(
      nextData,
      purchaseOrderId,
      "material_requirements_generated",
      "Material Requirements Generated",
      `${requirementCount} material requirement row(s) generated from the linked BOM.`,
    );
  }
  if (materialPoCount > 0) {
    nextData = appendDemoTimelineEvent(
      nextData,
      purchaseOrderId,
      "material_po_created",
      "Material PO Drafts Created",
      `${materialPoCount} vendor-wise draft material PO group(s) prepared.`,
    );
  }
  if (!requirementCount && !materialPoCount && warnings?.length) {
    nextData = appendDemoTimelineEvent(
      nextData,
      purchaseOrderId,
      "domino_warning",
      "Domino Workflow Warning",
      "The workflow could not generate downstream material data. Review PO warnings.",
    );
  }
  return nextData;
}

function createEntity<T extends EntityName>(entity: T, values: Partial<EntityMap[T]>) {
  const data = getDemoData();
  const key = dataKeys[entity];

  if (entity === "purchase-orders") {
    const { sizes, ...orderValues } = values as Partial<PurchaseOrder>;
    const id = makeId(idPrefixes[entity]);
    const customerValues = withPurchaseOrderCustomer(orderValues);
    const nextItem = {
      ...orderValues,
      ...customerValues,
      currentStage: orderValues.currentStage ?? "Cutting",
      id,
    } as PurchaseOrder;
    const nextSizes = normalizeSizes(id, sizes);
    let nextData = runDemoDominoWorkflow(
      {
        ...data,
        purchaseOrders: [nextItem, ...data.purchaseOrders],
        purchaseOrderSizes: [...nextSizes, ...data.purchaseOrderSizes],
      },
      id,
    );
    nextData = appendDemoTimelineEvent(
      nextData,
      id,
      "po_created",
      "PO Created",
      `Purchase order ${nextItem.poNumber} was created.`,
    );
    nextData = appendDemoDominoTimelineEvents(nextData, id);
    saveDemoData(nextData);
    return attachOrderSizes(nextData.purchaseOrders, nextData.purchaseOrderSizes).find(
      (item) => item.id === id,
    ) as EntityMap[T];
  }

  const relatedValues =
    entity === "approvals"
      ? {
          buyer:
            data.purchaseOrders.find(
              (item) => item.poNumber === (values as Partial<Approval>).poNumber,
            )?.customerName ??
            data.purchaseOrders.find(
              (item) => item.poNumber === (values as Partial<Approval>).poNumber,
            )?.buyer ??
            "",
        }
      : entity === "daily-updates"
        ? {
            stage: (values as Partial<DailyUpdate>).stage ?? "Cutting",
            lineName:
              data.productionLines.find(
                (item) => item.id === (values as Partial<DailyUpdate>).lineId,
              )?.name ??
              (values as Partial<DailyUpdate>).stage ??
              "",
            department: data.productionLines.find(
              (item) => item.id === (values as Partial<DailyUpdate>).lineId,
            )?.department,
            currentStyle: data.productionLines.find(
              (item) => item.id === (values as Partial<DailyUpdate>).lineId,
            )?.currentStyle,
            customerName:
              data.purchaseOrders.find(
                (item) => item.poNumber === (values as Partial<DailyUpdate>).poNumber,
              )?.customerName ?? "",
            styleCode:
              data.purchaseOrders.find(
                (item) => item.poNumber === (values as Partial<DailyUpdate>).poNumber,
              )?.styleCode ?? "",
          }
        : entity === "daily-logs"
          ? (() => {
              const profile = getCurrentDemoProfile();
              const order = data.purchaseOrders.find(
                (item) => item.id === (values as Partial<DailyLog>).purchaseOrderId,
              );
              const now = new Date().toISOString();
              return {
                title: (values as Partial<DailyLog>).title ?? "",
                note: (values as Partial<DailyLog>).note ?? "",
                date: (values as Partial<DailyLog>).date || now.slice(0, 10),
                authorId: profile?.userId ?? "",
                authorName: profile?.fullName ?? profile?.email ?? "Demo user",
                departmentStage: (values as Partial<DailyLog>).departmentStage ?? "",
                purchaseOrderId: order?.id ?? "",
                poNumber: order?.poNumber ?? "",
                customerName: order?.customerName ?? "",
                priority: (values as Partial<DailyLog>).priority ?? "Medium",
                status: (values as Partial<DailyLog>).status ?? "Open",
                createdAt: now,
                updatedAt: now,
              };
            })()
          : entity === "customers"
            ? {
                status: (values as Partial<Customer>).status ?? "Active",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              }
            : {};
  const nextItem = { ...values, ...relatedValues, id: makeId(idPrefixes[entity]) } as EntityMap[T];
  const nextData = {
    ...data,
    [key]: [nextItem, ...(data[key] as EntityMap[T][])],
    productionLines:
      entity === "daily-updates"
        ? data.productionLines.map((line) =>
            line.id === (nextItem as DailyUpdate).lineId
              ? {
                  ...line,
                  dailyTarget: (nextItem as DailyUpdate).targetQuantity,
                  dailyActual: (nextItem as DailyUpdate).actualQuantity,
                }
              : line,
          )
        : data.productionLines,
  };
  saveDemoData(nextData);
  return nextItem;
}

function updateEntity<T extends EntityName>(
  entity: T,
  values: Partial<EntityMap[T]> & { id: string },
) {
  const data = getDemoData();
  const key = dataKeys[entity];
  const items = data[key] as EntityMap[T][];
  const nextItem = items.find((item) => item.id === values.id);
  if (!nextItem) throw new Error("Record not found.");

  if (entity === "purchase-orders") {
    const { sizes, ...orderValues } = values as Partial<PurchaseOrder> & { id: string };
    const previousOrder = nextItem as PurchaseOrder;
    const customerValues = withPurchaseOrderCustomer(orderValues, nextItem as PurchaseOrder);
    const updated = { ...nextItem, ...orderValues, ...customerValues } as PurchaseOrder;
    const shouldReplaceSizes = Array.isArray(sizes);
    const nextSizes = shouldReplaceSizes
      ? [
          ...normalizeSizes(values.id, sizes),
          ...data.purchaseOrderSizes.filter((size) => size.purchaseOrderId !== values.id),
        ]
      : data.purchaseOrderSizes;
    let nextData = runDemoDominoWorkflow(
      {
        ...data,
        purchaseOrders: data.purchaseOrders.map((item) => (item.id === values.id ? updated : item)),
        purchaseOrderSizes: nextSizes,
      },
      values.id,
    );
    nextData = appendDemoDominoTimelineEvents(nextData, values.id);
    if (orderValues.deliveryDate && orderValues.deliveryDate !== previousOrder.deliveryDate) {
      nextData = appendDemoTimelineEvent(
        nextData,
        values.id,
        "delivery_date_changed",
        "Delivery Date Changed",
        `Delivery date changed from ${previousOrder.deliveryDate || "unset"} to ${orderValues.deliveryDate}.`,
      );
    }
    const savedOrder = nextData.purchaseOrders.find((order) => order.id === values.id);
    if (
      savedOrder?.estimatedCompletionDate &&
      savedOrder.estimatedCompletionDate !== previousOrder.estimatedCompletionDate
    ) {
      nextData = appendDemoTimelineEvent(
        nextData,
        values.id,
        "completion_estimate_changed",
        "Estimated Completion Updated",
        `Estimated completion is now ${savedOrder.estimatedCompletionDate}.`,
      );
    }
    saveDemoData(nextData);
    return attachOrderSizes(nextData.purchaseOrders, nextData.purchaseOrderSizes).find(
      (item) => item.id === values.id,
    ) as EntityMap[T];
  }

  const relatedValues =
    entity === "approvals" && "poNumber" in values
      ? {
          buyer:
            data.purchaseOrders.find(
              (item) => item.poNumber === (values as Partial<Approval>).poNumber,
            )?.customerName ??
            data.purchaseOrders.find(
              (item) => item.poNumber === (values as Partial<Approval>).poNumber,
            )?.buyer ??
            (nextItem as Approval).buyer,
        }
      : entity === "daily-updates" && "lineId" in values
        ? {
            stage: (values as Partial<DailyUpdate>).stage ?? (nextItem as DailyUpdate).stage,
            lineName:
              data.productionLines.find(
                (item) => item.id === (values as Partial<DailyUpdate>).lineId,
              )?.name ??
              (values as Partial<DailyUpdate>).stage ??
              (nextItem as DailyUpdate).lineName,
            department:
              data.productionLines.find(
                (item) => item.id === (values as Partial<DailyUpdate>).lineId,
              )?.department ?? (nextItem as DailyUpdate).department,
            currentStyle:
              data.productionLines.find(
                (item) => item.id === (values as Partial<DailyUpdate>).lineId,
              )?.currentStyle ?? (nextItem as DailyUpdate).currentStyle,
            customerName:
              data.purchaseOrders.find(
                (item) => item.poNumber === (values as Partial<DailyUpdate>).poNumber,
              )?.customerName ?? (nextItem as DailyUpdate).customerName,
            styleCode:
              data.purchaseOrders.find(
                (item) => item.poNumber === (values as Partial<DailyUpdate>).poNumber,
              )?.styleCode ?? (nextItem as DailyUpdate).styleCode,
          }
        : entity === "daily-logs"
          ? (() => {
              const order = data.purchaseOrders.find(
                (item) => item.id === (values as Partial<DailyLog>).purchaseOrderId,
              );
              return {
                purchaseOrderId:
                  (values as Partial<DailyLog>).purchaseOrderId !== undefined
                    ? (order?.id ?? "")
                    : (nextItem as DailyLog).purchaseOrderId,
                poNumber:
                  (values as Partial<DailyLog>).purchaseOrderId !== undefined
                    ? (order?.poNumber ?? "")
                    : (nextItem as DailyLog).poNumber,
                customerName:
                  (values as Partial<DailyLog>).purchaseOrderId !== undefined
                    ? (order?.customerName ?? "")
                    : (nextItem as DailyLog).customerName,
                updatedAt: new Date().toISOString(),
              };
            })()
          : entity === "customers"
            ? { updatedAt: new Date().toISOString() }
            : {};
  const updated = { ...nextItem, ...values, ...relatedValues } as EntityMap[T];
  const nextData = {
    ...data,
    [key]: items.map((item) => (item.id === values.id ? updated : item)),
    purchaseOrders:
      entity === "customers"
        ? data.purchaseOrders.map((order) =>
            order.customerId === values.id
              ? {
                  ...order,
                  customerName: (updated as Customer).customerName,
                  buyer: (updated as Customer).customerName,
                  brand: (updated as Customer).brand || order.brand,
                }
              : order,
          )
        : data.purchaseOrders,
    productionLines:
      entity === "daily-updates"
        ? data.productionLines.map((line) =>
            line.id === (updated as DailyUpdate).lineId
              ? {
                  ...line,
                  dailyTarget: (updated as DailyUpdate).targetQuantity,
                  dailyActual: (updated as DailyUpdate).actualQuantity,
                }
              : line,
          )
        : data.productionLines,
  };
  saveDemoData(nextData);
  return updated;
}

function setDemoFinalApproval(purchaseOrderId: string, approved: boolean) {
  const data = getDemoData();
  const sessionProfile = getCurrentDemoProfile();
  const now = new Date().toISOString();
  let nextData = {
    ...data,
    purchaseOrders: data.purchaseOrders.map((order) =>
      order.id === purchaseOrderId
        ? {
            ...order,
            approved,
            approvedBy: approved ? (sessionProfile?.userId ?? "") : "",
            approvedByName: approved
              ? (sessionProfile?.fullName ?? sessionProfile?.email ?? "Demo user")
              : "",
            approvedDate: approved ? now : "",
          }
        : order,
    ),
  };
  nextData = appendDemoTimelineEvent(
    nextData,
    purchaseOrderId,
    approved ? "approval_given" : "approval_cleared",
    approved ? "Approval Given" : "Approval Cleared",
    approved
      ? "Final approval was given for this purchase order."
      : "Final approval was cleared for this purchase order.",
  );
  saveDemoData(nextData);
  return attachOrderSizes(nextData.purchaseOrders, nextData.purchaseOrderSizes).find(
    (order) => order.id === purchaseOrderId,
  ) as PurchaseOrder;
}

function statusForDemoStage(
  stage: ProductionStageStatus,
  currentStatus: PurchaseOrder["status"],
): PurchaseOrder["status"] {
  if (currentStatus === "Delayed" || currentStatus === "Shipped") return currentStatus;
  if (stage === "Completed") return "Ready To Ship";
  if (stage === "Packing") return "Packing";
  return "Production Running";
}

function moveDemoPurchaseOrderStage(purchaseOrderId: string, currentStage?: ProductionStageStatus) {
  const data = getDemoData();
  const order = data.purchaseOrders.find((item) => item.id === purchaseOrderId);
  if (!order) throw new Error("Purchase order was not found.");

  const nextStage = currentStage ?? nextProductionStage(order.currentStage);
  if (!nextStage) throw new Error("This order is already completed.");

  let nextData = {
    ...data,
    purchaseOrders: data.purchaseOrders.map((item) =>
      item.id === purchaseOrderId
        ? {
            ...item,
            currentStage: nextStage,
            status: statusForDemoStage(nextStage, item.status),
          }
        : item,
    ),
  };
  nextData = appendDemoTimelineEvent(
    nextData,
    purchaseOrderId,
    "stage_changed",
    nextStage === "Completed" ? "Completed" : `Moved to ${nextStage}`,
    `${order.currentStage || "Planning"} -> ${nextStage}`,
  );
  saveDemoData(nextData);
  return {
    purchaseOrder: attachOrderSizes(nextData.purchaseOrders, nextData.purchaseOrderSizes).find(
      (item) => item.id === purchaseOrderId,
    ) as PurchaseOrder,
  } satisfies ProductionStageMoveResult;
}

function demoStyles(archive: ArchiveMode = "active"): Style[] {
  const styles = new Map<string, Style>();
  for (const material of filterArchive(getDemoData().bomMaterials, archive)) {
    const id = material.styleId || `${material.styleCode}-${material.color}-${material.brand}`;
    if (!styles.has(id)) {
      styles.set(id, {
        id,
        styleCode: material.styleCode,
        styleName: material.styleName,
        color: material.color,
        brand: material.brand,
        sizeRange: material.sizeRange,
        notes: "",
      });
    }
  }
  return [...styles.values()].sort((a, b) => a.styleCode.localeCompare(b.styleCode));
}

function setDemoPurchaseOrderStyle(purchaseOrderId: string, styleId: string) {
  const data = getDemoData();
  const style = demoStyles().find((item) => item.id === styleId);
  if (!style) throw new Error("Selected BOM/style was not found.");
  let nextData = runDemoDominoWorkflow(
    {
      ...data,
      purchaseOrders: data.purchaseOrders.map((order) =>
        order.id === purchaseOrderId
          ? {
              ...order,
              styleId,
              styleCode: order.styleCode || style.styleCode,
              styleName: order.styleName || style.styleName,
              color: order.color || style.color,
              brand: order.brand || style.brand,
            }
          : order,
      ),
    },
    purchaseOrderId,
  );
  nextData = appendDemoTimelineEvent(
    nextData,
    purchaseOrderId,
    "bom_linked",
    "BOM Linked",
    "A BOM/style was linked manually from PO detail.",
  );
  nextData = appendDemoDominoTimelineEvents(nextData, purchaseOrderId);
  saveDemoData(nextData);
  return attachOrderSizes(nextData.purchaseOrders, nextData.purchaseOrderSizes).find(
    (order) => order.id === purchaseOrderId,
  ) as PurchaseOrder;
}

type VendorInput = Partial<Omit<Vendor, "materialCategories">> & {
  materialCategories?: string[] | string;
};

function normalizeVendorInput(values: VendorInput) {
  return {
    vendorName: values.vendorName?.trim() ?? "",
    contactPerson: values.contactPerson?.trim() ?? "",
    email: values.email?.trim() ?? "",
    phone: values.phone?.trim() ?? "",
    address: values.address?.trim() ?? "",
    materialCategories: Array.isArray(values.materialCategories)
      ? values.materialCategories.map((item) => item.trim()).filter(Boolean)
      : String(values.materialCategories ?? "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
    notes: values.notes?.trim() ?? "",
    status: values.status ?? "Active",
  } satisfies Omit<Vendor, "id">;
}

function createDemoVendor(values: VendorInput) {
  const data = getDemoData();
  const nextVendor: Vendor = {
    id: makeId("vendor"),
    ...normalizeVendorInput(values),
  };
  saveDemoData({
    ...data,
    vendors: [nextVendor, ...data.vendors],
  });
  return nextVendor;
}

function updateDemoVendor(values: VendorInput & { id: string }) {
  const data = getDemoData();
  const existing = data.vendors.find((vendor) => vendor.id === values.id);
  if (!existing) throw new Error("Vendor was not found.");
  const updated: Vendor = {
    ...existing,
    ...normalizeVendorInput({ ...existing, ...values }),
  };
  const nextData = {
    ...data,
    vendors: data.vendors.map((vendor) => (vendor.id === values.id ? updated : vendor)),
    bomMaterials: data.bomMaterials.map((material) =>
      material.defaultVendorId === values.id
        ? { ...material, defaultVendorName: updated.vendorName }
        : material,
    ),
    materialRequirements: data.materialRequirements.map((requirement) =>
      requirement.vendorId === values.id
        ? { ...requirement, vendorName: updated.vendorName }
        : requirement,
    ),
    materialPurchaseOrders: data.materialPurchaseOrders.map((po) =>
      po.vendorId === values.id ? { ...po, vendorName: updated.vendorName } : po,
    ),
  };
  saveDemoData(nextData);
  return updated;
}

function setDemoBomMaterialVendor(
  bomMaterialId: string,
  vendorId: string,
  regenerateDrafts: boolean,
): BomVendorAssignmentResult {
  const data = getDemoData();
  const target = data.bomMaterials.find((material) => material.id === bomMaterialId);
  if (!target) throw new Error("BOM material was not found.");
  const vendor = data.vendors.find((item) => item.id === vendorId);
  if (vendorId && !vendor) throw new Error("Selected vendor was not found.");

  let nextData = {
    ...data,
    bomMaterials: data.bomMaterials.map((material) =>
      material.id === bomMaterialId
        ? {
            ...material,
            defaultVendorId: vendorId,
            defaultVendorName: vendor?.vendorName ?? "",
          }
        : material,
    ),
  };
  const regeneratedPurchaseOrderIds: string[] = [];

  if (regenerateDrafts && target.styleId) {
    for (const order of nextData.purchaseOrders.filter((item) => item.styleId === target.styleId)) {
      nextData = appendDemoTimelineEvent(
        nextData,
        order.id,
        "vendor_assigned",
        "Vendor Assigned",
        "Default vendor assignment changed for a linked BOM material.",
      );
      nextData = runDemoDominoWorkflow(nextData, order.id);
      nextData = appendDemoDominoTimelineEvents(nextData, order.id);
      regeneratedPurchaseOrderIds.push(order.id);
    }
  }

  saveDemoData(nextData);
  const material = nextData.bomMaterials.find((item) => item.id === bomMaterialId);
  return {
    material: material as BomMaterial,
    regeneratedPurchaseOrderIds,
  };
}

function regenerateDemoPurchaseOrderDomino(purchaseOrderId: string) {
  let nextData = runDemoDominoWorkflow(getDemoData(), purchaseOrderId);
  nextData = appendDemoDominoTimelineEvents(nextData, purchaseOrderId);
  saveDemoData(nextData);
  return attachOrderSizes(nextData.purchaseOrders, nextData.purchaseOrderSizes).find(
    (order) => order.id === purchaseOrderId,
  ) as PurchaseOrder;
}

function assignDemoPurchaseOrderToProductionLine(lineId: string, purchaseOrderId: string | null) {
  let data = getDemoData();
  const line = data.productionLines.find((item) => item.id === lineId);
  if (!line) throw new Error("Production line was not found.");

  const previousOrder = data.purchaseOrders.find((order) => order.poNumber === line.currentOrder);
  const order = purchaseOrderId
    ? data.purchaseOrders.find((item) => item.id === purchaseOrderId)
    : null;
  if (purchaseOrderId && !order) throw new Error("Purchase order was not found.");

  data = {
    ...data,
    productionLines: data.productionLines.map((item) =>
      item.id === lineId
        ? {
            ...item,
            currentOrder: order?.poNumber ?? "",
            currentStyle: order?.styleCode || order?.styleName || "",
          }
        : item,
    ),
    purchaseOrders: data.purchaseOrders.map((item) => {
      if (previousOrder && item.id === previousOrder.id && item.id !== order?.id) {
        return {
          ...item,
          assignedProductionLineId:
            item.assignedProductionLineId === lineId ? "" : item.assignedProductionLineId,
          assignedLastingLineId:
            item.assignedLastingLineId === lineId ? "" : item.assignedLastingLineId,
        };
      }
      if (order && item.id === order.id) {
        return line.department === "Bottom"
          ? {
              ...item,
              assignedLastingLineId: lineId,
              plannedDailyCapacity: line.capacity,
            }
          : {
              ...item,
              assignedProductionLineId: lineId,
            };
      }
      return item;
    }),
  };

  if (previousOrder && previousOrder.id !== order?.id) {
    data = runDemoDominoWorkflow(data, previousOrder.id);
  }
  if (order) {
    data = runDemoDominoWorkflow(data, order.id);
  }
  saveDemoData(data);

  return {
    line: data.productionLines.find((item) => item.id === lineId) as ProductionLine,
    purchaseOrder: order
      ? (attachOrderSizes(data.purchaseOrders, data.purchaseOrderSizes).find(
          (item) => item.id === order.id,
        ) as PurchaseOrder)
      : null,
  } satisfies ProductionAssignmentResult;
}

function useEntityList<T extends EntityName>(
  entity: T,
  enabled = true,
  archive: ArchiveMode = "active",
) {
  return useQuery({
    queryKey: [entity, archive],
    enabled,
    queryFn: () =>
      isDemoMode
        ? Promise.resolve(readEntityList(entity, archive))
        : apiRequest<EntityMap[T][]>(`/${entity}?archive=${archive}`),
  });
}

function invalidateDemoData(queryClient: ReturnType<typeof useQueryClient>, entity: EntityName) {
  queryClient.invalidateQueries({ queryKey: [entity] });
  queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  queryClient.invalidateQueries({ queryKey: ["reports"] });
  if (entity === "customers" || entity === "purchase-orders") {
    queryClient.invalidateQueries({ queryKey: ["customers"] });
    queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
    queryClient.invalidateQueries({ queryKey: ["material-requirements"] });
    queryClient.invalidateQueries({ queryKey: ["material-pos"] });
    queryClient.invalidateQueries({ queryKey: ["production-timeline"] });
  }
  if (entity === "daily-updates") {
    queryClient.invalidateQueries({ queryKey: ["production-lines"] });
  }
  if (entity === "daily-logs") {
    queryClient.invalidateQueries({ queryKey: ["daily-logs"] });
    queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
  }
}

function useCreateEntity<T extends EntityName>(entity: T) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: Partial<EntityMap[T]>) =>
      isDemoMode
        ? Promise.resolve(createEntity(entity, values))
        : apiRequest<EntityMap[T]>(`/${entity}`, {
            method: "POST",
            body: toJsonBody(values),
          }),
    onSuccess: () => invalidateDemoData(queryClient, entity),
  });
}

function useUpdateEntity<T extends EntityName>(entity: T) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: Partial<EntityMap[T]> & { id: string }) =>
      isDemoMode
        ? Promise.resolve(updateEntity(entity, values))
        : apiRequest<EntityMap[T]>(`/${entity}/${values.id}`, {
            method: "PATCH",
            body: toJsonBody(
              Object.fromEntries(Object.entries(values).filter(([key]) => key !== "id")),
            ),
          }),
    onSuccess: () => invalidateDemoData(queryClient, entity),
  });
}

export const useCustomers = (archive: ArchiveMode = "active") =>
  useEntityList("customers", true, archive);
export const useCreateCustomer = () => useCreateEntity("customers");
export const useUpdateCustomer = () => useUpdateEntity("customers");

export function useCustomer(id: string | undefined) {
  return useQuery({
    queryKey: ["customers", id],
    enabled: Boolean(id),
    queryFn: () => {
      if (!id) throw new Error("Customer id is required.");
      return isDemoMode
        ? Promise.resolve(readEntityList("customers").find((item) => item.id === id) ?? null)
        : apiRequest<Customer>(`/customers/${id}`);
    },
  });
}

export const usePurchaseOrders = (enabled = true, archive: ArchiveMode = "active") =>
  useEntityList("purchase-orders", enabled, archive);
export const useCreatePurchaseOrder = () => useCreateEntity("purchase-orders");
export const useUpdatePurchaseOrder = () => useUpdateEntity("purchase-orders");

export function useSetFinalApproval() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ purchaseOrderId, approved }: { purchaseOrderId: string; approved: boolean }) =>
      isDemoMode
        ? Promise.resolve(setDemoFinalApproval(purchaseOrderId, approved))
        : apiRequest<PurchaseOrder>(`/purchase-orders/${purchaseOrderId}/final-approval`, {
            method: "PATCH",
            body: toJsonBody({ approved }),
          }),
    onSuccess: (updated, variables) => {
      queryClient.setQueryData<PurchaseOrder[]>(["purchase-orders"], (orders) =>
        orders?.map((order) => (order.id === updated.id ? updated : order)),
      );
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      queryClient.invalidateQueries({ queryKey: ["purchase-orders", variables.purchaseOrderId] });
      queryClient.invalidateQueries({
        queryKey: ["production-timeline", variables.purchaseOrderId],
      });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["reports"] });
    },
  });
}

export function useMovePurchaseOrderStage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      purchaseOrderId,
      currentStage,
    }: {
      purchaseOrderId: string;
      currentStage: ProductionStageStatus;
    }) =>
      isDemoMode
        ? Promise.resolve(moveDemoPurchaseOrderStage(purchaseOrderId, currentStage))
        : apiRequest<ProductionStageMoveResult>(`/purchase-orders/${purchaseOrderId}/stage`, {
            method: "PATCH",
            body: toJsonBody({ currentStage }),
          }),
    onSuccess: (result, variables) => {
      queryClient.setQueryData<PurchaseOrder[]>(["purchase-orders"], (orders) =>
        orders?.map((order) =>
          order.id === result.purchaseOrder.id ? result.purchaseOrder : order,
        ),
      );
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      queryClient.invalidateQueries({ queryKey: ["purchase-orders", variables.purchaseOrderId] });
      queryClient.invalidateQueries({
        queryKey: ["production-timeline", variables.purchaseOrderId],
      });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["reports"] });
    },
  });
}

export function usePurchaseOrderSizes(purchaseOrderId: string | undefined) {
  return useQuery({
    queryKey: ["purchase-orders", purchaseOrderId, "sizes"],
    enabled: Boolean(purchaseOrderId),
    queryFn: () => {
      if (!purchaseOrderId) return Promise.resolve([]);
      return isDemoMode
        ? Promise.resolve(
            getDemoData().purchaseOrderSizes.filter(
              (size) => size.purchaseOrderId === purchaseOrderId,
            ),
          )
        : apiRequest<PurchaseOrderSize[]>(`/purchase-orders/${purchaseOrderId}/sizes`);
    },
  });
}

export function useSavePurchaseOrderSizes(purchaseOrderId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sizes: Array<Partial<PurchaseOrderSize>>) => {
      if (isDemoMode) {
        const data = getDemoData();
        const nextSizes = normalizeSizes(purchaseOrderId, sizes);
        saveDemoData({
          ...data,
          purchaseOrderSizes: [
            ...nextSizes,
            ...data.purchaseOrderSizes.filter((size) => size.purchaseOrderId !== purchaseOrderId),
          ],
        });
        return Promise.resolve(nextSizes);
      }
      return apiRequest<PurchaseOrderSize[]>(`/purchase-orders/${purchaseOrderId}/sizes`, {
        method: "PUT",
        body: toJsonBody({ sizes }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      queryClient.invalidateQueries({ queryKey: ["purchase-orders", purchaseOrderId, "sizes"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["reports"] });
    },
  });
}

export const useMaterials = (archive: ArchiveMode = "active") =>
  useEntityList("materials", true, archive);
export const useCreateMaterial = () => useCreateEntity("materials");
export const useUpdateMaterial = () => useUpdateEntity("materials");

export function useBomMaterials(archive: ArchiveMode = "active") {
  return useQuery({
    queryKey: ["bom-materials", archive],
    queryFn: () =>
      isDemoMode
        ? Promise.resolve(filterArchive(getDemoData().bomMaterials, archive))
        : apiRequest<BomMaterial[]>(`/bom-materials?archive=${archive}`),
  });
}

export function useStyles(archive: ArchiveMode = "active") {
  return useQuery({
    queryKey: ["styles", archive],
    queryFn: () =>
      isDemoMode
        ? Promise.resolve(demoStyles(archive))
        : apiRequest<Style[]>(`/styles?archive=${archive}`),
  });
}

export function useLinkPurchaseOrderStyle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ purchaseOrderId, styleId }: { purchaseOrderId: string; styleId: string }) =>
      isDemoMode
        ? Promise.resolve(setDemoPurchaseOrderStyle(purchaseOrderId, styleId))
        : apiRequest<PurchaseOrder>(`/purchase-orders/${purchaseOrderId}/link-style`, {
            method: "PATCH",
            body: toJsonBody({ styleId }),
          }),
    onSuccess: (updated, variables) => {
      queryClient.setQueryData<PurchaseOrder[]>(["purchase-orders"], (orders) =>
        orders?.map((order) => (order.id === updated.id ? updated : order)),
      );
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      queryClient.invalidateQueries({ queryKey: ["purchase-orders", variables.purchaseOrderId] });
      queryClient.invalidateQueries({
        queryKey: ["material-requirements", variables.purchaseOrderId],
      });
      queryClient.invalidateQueries({ queryKey: ["material-pos"] });
      queryClient.invalidateQueries({ queryKey: ["material-pos", variables.purchaseOrderId] });
      queryClient.invalidateQueries({
        queryKey: ["production-timeline", variables.purchaseOrderId],
      });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["reports"] });
    },
  });
}

export function useRegeneratePurchaseOrderDomino() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (purchaseOrderId: string) =>
      isDemoMode
        ? Promise.resolve(regenerateDemoPurchaseOrderDomino(purchaseOrderId))
        : apiRequest<PurchaseOrder>(`/purchase-orders/${purchaseOrderId}/regenerate-domino`, {
            method: "POST",
          }),
    onSuccess: (updated) => {
      queryClient.setQueryData<PurchaseOrder[]>(["purchase-orders"], (orders) =>
        orders?.map((order) => (order.id === updated.id ? updated : order)),
      );
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      queryClient.invalidateQueries({ queryKey: ["material-requirements", updated.id] });
      queryClient.invalidateQueries({ queryKey: ["material-pos"] });
      queryClient.invalidateQueries({ queryKey: ["material-pos", updated.id] });
      queryClient.invalidateQueries({ queryKey: ["production-timeline", updated.id] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useVendors(enabled = true, archive: ArchiveMode = "active") {
  return useQuery({
    queryKey: ["vendors", archive],
    enabled,
    queryFn: () =>
      isDemoMode
        ? Promise.resolve(filterArchive(getDemoData().vendors, archive))
        : apiRequest<Vendor[]>(`/vendors?archive=${archive}`),
  });
}

export function useVendor(id: string | undefined) {
  return useQuery({
    queryKey: ["vendors", id],
    enabled: Boolean(id),
    queryFn: () => {
      if (!id) throw new Error("Vendor id is required.");
      return isDemoMode
        ? Promise.resolve(getDemoData().vendors.find((vendor) => vendor.id === id) ?? null)
        : apiRequest<Vendor>(`/vendors/${id}`);
    },
  });
}

export function useCreateVendor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: VendorInput) =>
      isDemoMode
        ? Promise.resolve(createDemoVendor(values))
        : apiRequest<Vendor>("/vendors", {
            method: "POST",
            body: toJsonBody(normalizeVendorInput(values)),
          }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vendors"] });
    },
  });
}

export function useUpdateVendor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: VendorInput & { id: string }) =>
      isDemoMode
        ? Promise.resolve(updateDemoVendor(values))
        : apiRequest<Vendor>(`/vendors/${values.id}`, {
            method: "PATCH",
            body: toJsonBody(normalizeVendorInput(values)),
          }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vendors"] });
      queryClient.invalidateQueries({ queryKey: ["bom-materials"] });
      queryClient.invalidateQueries({ queryKey: ["material-requirements"] });
      queryClient.invalidateQueries({ queryKey: ["material-pos"] });
    },
  });
}

export function useUpdateBomMaterialVendor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      bomMaterialId,
      vendorId,
      regenerateDrafts,
    }: {
      bomMaterialId: string;
      vendorId: string;
      regenerateDrafts?: boolean;
    }) =>
      isDemoMode
        ? Promise.resolve(
            setDemoBomMaterialVendor(bomMaterialId, vendorId, Boolean(regenerateDrafts)),
          )
        : apiRequest<BomVendorAssignmentResult>(`/bom-materials/${bomMaterialId}/default-vendor`, {
            method: "PATCH",
            body: toJsonBody({ vendorId, regenerateDrafts: Boolean(regenerateDrafts) }),
          }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["bom-materials"] });
      queryClient.invalidateQueries({ queryKey: ["material-requirements"] });
      queryClient.invalidateQueries({ queryKey: ["material-pos"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      for (const purchaseOrderId of result.regeneratedPurchaseOrderIds) {
        queryClient.invalidateQueries({ queryKey: ["purchase-orders", purchaseOrderId] });
        queryClient.invalidateQueries({ queryKey: ["material-requirements", purchaseOrderId] });
        queryClient.invalidateQueries({ queryKey: ["material-pos", purchaseOrderId] });
        queryClient.invalidateQueries({ queryKey: ["production-timeline", purchaseOrderId] });
      }
    },
  });
}

export function useMaterialRequirements(purchaseOrderId: string | undefined) {
  return useQuery({
    queryKey: ["material-requirements", purchaseOrderId],
    enabled: Boolean(purchaseOrderId),
    queryFn: () => {
      if (!purchaseOrderId) return Promise.resolve([]);
      return isDemoMode
        ? Promise.resolve(
            getDemoData().materialRequirements.filter(
              (item) => item.purchaseOrderId === purchaseOrderId,
            ),
          )
        : apiRequest<MaterialRequirement[]>(
            `/purchase-orders/${purchaseOrderId}/material-requirements`,
          );
    },
  });
}

export function useAllMaterialRequirements(enabled = true) {
  return useQuery({
    queryKey: ["material-requirements"],
    enabled,
    queryFn: () =>
      isDemoMode
        ? Promise.resolve(filterArchive(getDemoData().materialRequirements, "active"))
        : apiRequest<MaterialRequirement[]>("/material-requirements"),
  });
}

function attachDemoMaterialPoItems(data = getDemoData()) {
  const itemsByMaterialPo = new Map<string, typeof data.materialPoItems>();
  for (const item of filterArchive(data.materialPoItems, "active")) {
    const items = itemsByMaterialPo.get(item.materialPoId) ?? [];
    items.push(item);
    itemsByMaterialPo.set(item.materialPoId, items);
  }

  return filterArchive(data.materialPurchaseOrders, "active").map((po) => {
    const items = itemsByMaterialPo.get(po.id) ?? [];
    const vendor = data.vendors.find((item) => item.id === po.vendorId);
    const lastSentLog = [...(data.materialPoEmailLogs ?? [])]
      .filter(
        (item) => item.materialPoId === po.id && (item.status === "Sent" || item.status === "Demo"),
      )
      .sort((a, b) => b.sentAt.localeCompare(a.sentAt))[0];
    return {
      ...po,
      vendorEmail: vendor?.email ?? "",
      lastSentAt: lastSentLog?.sentAt ?? "",
      items,
      itemCount: items.length,
    };
  });
}

function buildDemoMaterialPoPreview(materialPoId: string): MaterialPoPreview {
  const data = getDemoData();
  const materialPo = attachDemoMaterialPoItems(data).find((item) => item.id === materialPoId);
  if (!materialPo) throw new Error("Material PO was not found.");
  const vendor = data.vendors.find((item) => item.id === materialPo.vendorId);
  return {
    companyName: "Footwear Production Hub",
    vendorName: materialPo.vendorName || "Unassigned Vendor",
    vendorContact: vendor?.contactPerson ?? "",
    vendorEmail: vendor?.email ?? "",
    materialPoNumber: materialPo.materialPoNumber,
    generatedDate: materialPo.generatedDate,
    expectedDeliveryDate: materialPo.expectedDeliveryDate,
    customerName: materialPo.customerName,
    customerPoNumber: materialPo.poNumber,
    styleCode: materialPo.styleCode,
    color: materialPo.color,
    notes: materialPo.notes,
    items: (materialPo.items ?? []).map((item) => ({
      materialName: item.materialName,
      specification: item.specification,
      quantity: item.quantity,
      unit: item.unit,
      expectedDeliveryDate: materialPo.expectedDeliveryDate,
      notes: item.notes,
    })),
  };
}

function defaultMaterialPoSubject(preview: MaterialPoPreview) {
  return `Material PO ${preview.materialPoNumber} - ${preview.customerName} - ${preview.styleCode}`;
}

function defaultMaterialPoBody(preview: MaterialPoPreview) {
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

function sendDemoMaterialPoEmail({
  materialPoId,
  recipientEmail,
  subject,
  body,
}: {
  materialPoId: string;
  recipientEmail: string;
  subject: string;
  body: string;
}) {
  if (!recipientEmail.trim()) throw new Error("Recipient email is required.");
  const data = getDemoData();
  const preview = buildDemoMaterialPoPreview(materialPoId);
  const profile = getCurrentDemoProfile();
  const log: MaterialPoEmailLog = {
    id: makeId("mpo-email"),
    materialPoId,
    sentAt: new Date().toISOString(),
    sentBy: profile?.userId ?? "",
    sentByName: profile?.fullName ?? profile?.email ?? "Demo user",
    recipientEmail,
    emailSubject: subject || defaultMaterialPoSubject(preview),
    emailBody: body || defaultMaterialPoBody(preview),
    attachmentPath: `${preview.materialPoNumber}.xlsx`,
    status: "Demo",
    errorMessage: "",
  };
  const nextData = {
    ...data,
    materialPurchaseOrders: data.materialPurchaseOrders.map((item) =>
      item.id === materialPoId ? { ...item, status: "Sent" as const } : item,
    ),
    materialPoEmailLogs: [log, ...(data.materialPoEmailLogs ?? [])],
  };
  saveDemoData(nextData);
  const materialPo = attachDemoMaterialPoItems(nextData).find((item) => item.id === materialPoId);
  if (!materialPo) throw new Error("Material PO was not found.");
  return {
    materialPo,
    logs: nextData.materialPoEmailLogs.filter((item) => item.materialPoId === materialPoId),
    message: "Demo Email Sent",
  };
}

export function useMaterialPurchaseOrders(
  purchaseOrderId?: string,
  enabled = true,
  archive: ArchiveMode = "active",
) {
  return useQuery({
    queryKey: purchaseOrderId
      ? ["material-pos", purchaseOrderId, archive]
      : ["material-pos", archive],
    enabled,
    queryFn: () => {
      if (isDemoMode) {
        const orders = filterArchive(attachDemoMaterialPoItems(), archive);
        return Promise.resolve(
          purchaseOrderId
            ? orders.filter((item) => item.purchaseOrderId === purchaseOrderId)
            : orders,
        );
      }
      const suffix = purchaseOrderId
        ? `?purchaseOrderId=${encodeURIComponent(purchaseOrderId)}&archive=${archive}`
        : `?archive=${archive}`;
      return apiRequest<MaterialPurchaseOrder[]>(`/material-pos${suffix}`);
    },
  });
}

export function useMaterialPoPreview(materialPoId: string | undefined) {
  return useQuery({
    queryKey: ["material-pos", materialPoId, "preview"],
    enabled: Boolean(materialPoId),
    queryFn: () => {
      if (!materialPoId) throw new Error("Material PO id is required.");
      return isDemoMode
        ? Promise.resolve(buildDemoMaterialPoPreview(materialPoId))
        : apiRequest<MaterialPoPreview>(`/material-pos/${materialPoId}/preview`);
    },
  });
}

export function useMaterialPoEmailLogs(materialPoId: string | undefined) {
  return useQuery({
    queryKey: ["material-pos", materialPoId, "email-logs"],
    enabled: Boolean(materialPoId),
    queryFn: () => {
      if (!materialPoId) return Promise.resolve([]);
      return isDemoMode
        ? Promise.resolve(
            (getDemoData().materialPoEmailLogs ?? []).filter(
              (item) => item.materialPoId === materialPoId,
            ),
          )
        : apiRequest<MaterialPoEmailLog[]>(`/material-pos/${materialPoId}/email-logs`);
    },
  });
}

export function useSendMaterialPoEmail() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: {
      materialPoId: string;
      recipientEmail: string;
      subject: string;
      body: string;
    }) =>
      isDemoMode
        ? Promise.resolve(sendDemoMaterialPoEmail(values))
        : apiRequest<{
            materialPo: MaterialPurchaseOrder;
            logs: MaterialPoEmailLog[];
            message: string;
          }>(`/material-pos/${values.materialPoId}/send-email`, {
            method: "POST",
            body: toJsonBody({
              recipientEmail: values.recipientEmail,
              subject: values.subject,
              body: values.body,
            }),
          }),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ["material-pos"] });
      queryClient.invalidateQueries({
        queryKey: ["material-pos", variables.materialPoId, "preview"],
      });
      queryClient.invalidateQueries({
        queryKey: ["material-pos", variables.materialPoId, "email-logs"],
      });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export const useApprovals = (archive: ArchiveMode = "active") =>
  useEntityList("approvals", true, archive);
export const useCreateApproval = () => useCreateEntity("approvals");
export const useUpdateApproval = () => useUpdateEntity("approvals");

export const useProductionLines = (archive: ArchiveMode = "active") =>
  useEntityList("production-lines", true, archive);
export const useCreateProductionLine = () => useCreateEntity("production-lines");
export const useUpdateProductionLine = () => useUpdateEntity("production-lines");

export function useAssignPurchaseOrderToProductionLine() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      lineId,
      purchaseOrderId,
    }: {
      lineId: string;
      purchaseOrderId: string | null;
    }) =>
      isDemoMode
        ? Promise.resolve(assignDemoPurchaseOrderToProductionLine(lineId, purchaseOrderId))
        : apiRequest<ProductionAssignmentResult>(`/production-lines/${lineId}/assign-po`, {
            method: "POST",
            body: toJsonBody({ purchaseOrderId }),
          }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["production-lines"] });
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      queryClient.invalidateQueries({ queryKey: ["material-requirements"] });
      queryClient.invalidateQueries({ queryKey: ["material-pos"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      if (result.purchaseOrder) {
        queryClient.invalidateQueries({
          queryKey: ["material-requirements", result.purchaseOrder.id],
        });
        queryClient.invalidateQueries({ queryKey: ["material-pos", result.purchaseOrder.id] });
      }
    },
  });
}

export const useDailyUpdates = (archive: ArchiveMode = "active") =>
  useEntityList("daily-updates", true, archive);
export const useCreateDailyUpdate = () => useCreateEntity("daily-updates");
export const useUpdateDailyUpdate = () => useUpdateEntity("daily-updates");

export const useDailyLogs = (purchaseOrderId?: string, archive: ArchiveMode = "active") =>
  useQuery({
    queryKey: ["daily-logs", purchaseOrderId ?? "all", archive],
    queryFn: () => {
      if (isDemoMode) {
        const logs = filterArchive(getDemoData().dailyLogs, archive);
        return Promise.resolve(
          purchaseOrderId ? logs.filter((log) => log.purchaseOrderId === purchaseOrderId) : logs,
        );
      }
      const query = purchaseOrderId
        ? `?purchaseOrderId=${encodeURIComponent(purchaseOrderId)}&archive=${archive}`
        : `?archive=${archive}`;
      return apiRequest<DailyLog[]>(`/daily-logs${query}`);
    },
  });
export const useCreateDailyLog = () => useCreateEntity("daily-logs");
export const useUpdateDailyLog = () => useUpdateEntity("daily-logs");

export function useProductionTimeline(purchaseOrderId: string | undefined) {
  return useQuery({
    queryKey: ["production-timeline", purchaseOrderId],
    enabled: Boolean(purchaseOrderId),
    queryFn: () => {
      if (!purchaseOrderId) return Promise.resolve([]);
      if (isDemoMode) {
        return Promise.resolve(
          [...(getDemoData().productionTimeline ?? [])]
            .filter((event) => event.purchaseOrderId === purchaseOrderId)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        );
      }
      return apiRequest<ProductionTimelineEvent[]>(`/purchase-orders/${purchaseOrderId}/timeline`);
    },
  });
}

const businessQueryKeys = [
  "customers",
  "purchase-orders",
  "materials",
  "bom-materials",
  "styles",
  "vendors",
  "material-requirements",
  "material-pos",
  "approvals",
  "production-lines",
  "daily-updates",
  "daily-logs",
  "production-timeline",
  "dashboard",
  "reports",
];

function invalidateBusinessData(queryClient: ReturnType<typeof useQueryClient>) {
  for (const key of businessQueryKeys) {
    queryClient.invalidateQueries({ queryKey: [key] });
  }
}

function updateDemoCollection(
  key: keyof DemoData,
  updater: (items: ArchivedRecord[]) => ArchivedRecord[],
) {
  const data = getDemoData();
  const items = (data[key] as unknown[]).map((item) => item as ArchivedRecord);
  const nextData = {
    ...data,
    [key]: updater(items),
  } as DemoData;
  saveDemoData(nextData);
}

function archiveDemoEntity(entity: AdminEntity, id: string, reason: string) {
  const key = demoDataKeyForAdminEntity(entity);
  if (!key) throw new Error("This demo record type cannot be archived from Admin Tools.");
  let found = false;
  updateDemoCollection(key, (items) =>
    items.map((item) => {
      if (item.id !== id) return item;
      found = true;
      return {
        ...item,
        archivedAt: item.archivedAt || new Date().toISOString(),
        archiveReason: reason,
      };
    }),
  );
  if (!found) throw new Error("Record was not found in demo data.");
  return { archived: 1, warnings: [] as string[] };
}

function restoreDemoEntity(entity: AdminEntity, id: string) {
  const key = demoDataKeyForAdminEntity(entity);
  if (!key) throw new Error("This demo record type cannot be restored from Admin Tools.");
  let found = false;
  updateDemoCollection(key, (items) =>
    items.map((item) => {
      if (item.id !== id) return item;
      found = true;
      return { ...item, archivedAt: null, archiveReason: "" };
    }),
  );
  if (!found) throw new Error("Record was not found in demo data.");
  return { restored: 1 };
}

function hardDeleteDemoEntity(entity: AdminEntity, id: string) {
  const key = demoDataKeyForAdminEntity(entity);
  if (!key) throw new Error("This demo record type cannot be deleted from Admin Tools.");
  let found = false;
  updateDemoCollection(key, (items) =>
    items.filter((item) => {
      if (item.id !== id) return true;
      found = true;
      return false;
    }),
  );
  if (!found) throw new Error("Record was not found in demo data.");
  return { deleted: 1 };
}

function clearDemoTestData(scope: ClearTestDataScope, mode: ClearTestDataMode) {
  if (scope === "all-demo-local") {
    if (mode === "hard-delete") {
      clearDemoData();
    }
    resetDemoData();
    return {
      archived: 0,
      deleted: 0,
      warnings: ["Demo local data was restored to the seeded sample set."],
    };
  }

  const keys = clearScopeDemoKeys[scope];
  if (!keys) throw new Error("This demo clear scope is not available.");
  const timestamp = new Date().toISOString();
  const data = getDemoData();
  const nextData = { ...data } as DemoData;
  let changed = 0;

  for (const key of keys) {
    const items = (nextData[key] as unknown[]).map((item) => item as ArchivedRecord);
    changed += items.length;
    nextData[key] =
      mode === "hard-delete"
        ? ([] as never)
        : (items.map((item) => ({
            ...item,
            archivedAt: item.archivedAt || timestamp,
            archiveReason: "Demo test data cleared from Admin Tools.",
          })) as never);
  }

  saveDemoData(nextData);
  return {
    archived: mode === "archive" ? changed : 0,
    deleted: mode === "hard-delete" ? changed : 0,
    warnings: [] as string[],
  };
}

export function useArchiveAdminEntity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: { entity: AdminEntity; id: string; reason: string }) =>
      isDemoMode
        ? Promise.resolve(archiveDemoEntity(values.entity, values.id, values.reason))
        : apiRequest<{ archived: number; warnings: string[] }>(
            `/admin/archive/${values.entity}/${values.id}`,
            {
              method: "PATCH",
              body: toJsonBody({ reason: values.reason }),
            },
          ),
    onSuccess: () => invalidateBusinessData(queryClient),
  });
}

export function useRestoreAdminEntity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: { entity: AdminEntity; id: string }) =>
      isDemoMode
        ? Promise.resolve(restoreDemoEntity(values.entity, values.id))
        : apiRequest<{ restored: number }>(`/admin/restore/${values.entity}/${values.id}`, {
            method: "PATCH",
          }),
    onSuccess: () => invalidateBusinessData(queryClient),
  });
}

export function useHardDeleteAdminEntity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: { entity: AdminEntity; id: string; confirmation: string }) =>
      isDemoMode
        ? Promise.resolve(hardDeleteDemoEntity(values.entity, values.id))
        : apiRequest<{ deleted: number }>(`/admin/hard-delete/${values.entity}/${values.id}`, {
            method: "DELETE",
            body: toJsonBody({ confirmation: values.confirmation }),
          }),
    onSuccess: () => invalidateBusinessData(queryClient),
  });
}

export function useClearTestData() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: {
      scope: ClearTestDataScope;
      mode: ClearTestDataMode;
      confirmation: string;
    }) =>
      isDemoMode
        ? Promise.resolve(clearDemoTestData(values.scope, values.mode))
        : apiRequest<{ archived: number; deleted: number; warnings: string[] }>(
            "/admin/clear-test-data",
            {
              method: "POST",
              body: toJsonBody(values),
            },
          ),
    onSuccess: () => invalidateBusinessData(queryClient),
  });
}

export function useRunRetention() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: {
      archiveOlderThanYears: number;
      deleteArchivedOlderThanYears?: number;
      confirmation?: string;
    }) =>
      isDemoMode
        ? Promise.resolve({
            archived: 0,
            deleted: 0,
            warnings: [
              "Retention is a local PostgreSQL maintenance task. Demo data was unchanged.",
            ],
          })
        : apiRequest<{ archived: number; deleted: number; warnings: string[] }>(
            "/admin/retention/run",
            {
              method: "POST",
              body: toJsonBody(values),
            },
          ),
    onSuccess: () => invalidateBusinessData(queryClient),
  });
}

export function useDashboard() {
  return useQuery({
    queryKey: ["dashboard"],
    queryFn: () =>
      isDemoMode
        ? Promise.resolve(getDashboardMetrics())
        : apiRequest<DashboardMetrics>("/dashboard"),
  });
}

export function useUsers() {
  return useQuery({
    queryKey: ["users"],
    queryFn: () =>
      isDemoMode ? Promise.resolve(getDemoUsers().map(toProfile)) : apiRequest<Profile[]>("/users"),
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: {
      email: string;
      fullName?: string | null;
      department?: string | null;
      role?: Profile["role"];
      active?: boolean;
    }) =>
      isDemoMode
        ? Promise.resolve(createDemoUser(values))
        : apiRequest<Profile>("/users", {
            method: "POST",
            body: toJsonBody(values),
          }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: Partial<Profile> & { userId: string }) =>
      isDemoMode
        ? Promise.resolve(saveDemoUser(values))
        : apiRequest<Profile>(`/users/${values.userId}`, {
            method: "PATCH",
            body: toJsonBody(
              Object.fromEntries(Object.entries(values).filter(([key]) => key !== "userId")),
            ),
          }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });
}
