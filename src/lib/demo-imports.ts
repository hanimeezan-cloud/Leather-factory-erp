import type JSZip from "jszip";

import type { TemplateImportPreview, TemplateImportResult } from "./api-client";
import { getCurrentDemoProfile, getDemoData, makeId, saveDemoData } from "./demo-data";
import { runDemoDominoWorkflow } from "./demo-domino";
import type { BomMaterial, MaterialCalculationType, ProductionTimelineEvent } from "./domain";

// DEMO ONLY: strict client-side parser for the standardized BOM import template.
// Supabase mode uses the Express API import endpoints instead.

type CellValue = string | number | boolean | null;
type SheetRows = CellValue[][];
type WorkbookSheets = Record<string, SheetRows>;
type ImportRecord = {
  rowNumber: number;
  row: CellValue[];
  headerMap: Map<string, number>;
};

interface BomImportMaterial {
  styleCode: string;
  styleName: string;
  color: string;
  brand: string;
  sizeRange: string;
  materialCategory: string;
  materialName: string;
  specification: string;
  supplier: string;
  unit: string;
  consumptionPerPair: number;
  wastagePercent: number;
  calculationType: MaterialCalculationType;
  fixedQuantity: number | null;
  criticality: string;
  notes: string;
}

interface BomImportPayload {
  materials: BomImportMaterial[];
}

interface PoImportPayload {
  purchaseOrders: PoImportOrder[];
}

interface PoImportOrder {
  importId: string;
  customerName: string;
  poNumber: string;
  poDate: string;
  article: string;
  styleCode: string;
  color: string;
  brand: string;
  deliveryDate: string;
  currency: string;
  price: number;
  quantity: number;
  assignedProductionLine: string;
  notes: string;
  sizes: PoImportSize[];
}

interface PoImportSize {
  size: string;
  quantity: number;
  unit: string;
  notes: string;
}

const poHeaders = [
  "PO Import ID",
  "Customer Name",
  "Buyer PO Number",
  "PO Date",
  "Article / Style",
  "Style Code",
  "Color",
  "Brand",
  "Delivery / B/L Date",
  "Currency",
  "Price / Pair",
  "Total Pairs",
  "Assigned Production Line",
  "Notes",
] as const;

const sizeHeaders = [
  "PO Import ID",
  "Customer Name",
  "Style Code",
  "Color",
  "Size",
  "Quantity",
  "Pair Unit",
  "Notes",
  "Validation",
] as const;

const bomHeaders = [
  "Style Code",
  "Style Name",
  "Color",
  "Brand",
  "Size Range",
  "Material Category",
  "Material Name",
  "Specification / Details",
  "Supplier",
  "Unit",
  "Consumption / Pair",
  "Wastage %",
  "Critical?",
  "Required Qty Manual Override",
  "Calculated Qty Example",
  "Notes",
  "Import Status",
] as const;

function decodeXml(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function readAttribute(source: string, name: string) {
  const match = source.match(new RegExp(`\\b${name}="([^"]*)"`, "i"));
  return match ? decodeXml(match[1]) : "";
}

function columnIndex(cellRef: string) {
  const letters = cellRef.match(/^[A-Z]+/i)?.[0] ?? "A";
  return (
    letters
      .toUpperCase()
      .split("")
      .reduce((sum, char) => sum * 26 + char.charCodeAt(0) - 64, 0) - 1
  );
}

async function readZipText(zip: JSZip, path: string) {
  const file = zip.file(path);
  return file ? file.async("text") : "";
}

async function loadWorkbookZip(buffer: ArrayBuffer) {
  const module = await import("jszip");
  const JSZipConstructor = (module.default ?? module) as unknown as {
    loadAsync?: (data: ArrayBuffer) => Promise<JSZip>;
  };

  if (typeof JSZipConstructor.loadAsync !== "function") {
    throw new Error("Excel parser failed to load. Refresh the page and try again.");
  }

  return JSZipConstructor.loadAsync(buffer);
}

function parseSharedStrings(xml: string) {
  const strings: string[] = [];
  const matches = xml.match(/<(?:\w+:)?si\b[\s\S]*?<\/(?:\w+:)?si>/g) ?? [];
  for (const item of matches) {
    const parts = [...item.matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)].map((match) =>
      decodeXml(match[1]),
    );
    strings.push(parts.join(""));
  }
  return strings;
}

function parseWorkbookSheetTargets(workbookXml: string, relsXml: string) {
  const rels = new Map<string, string>();
  for (const match of relsXml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = readAttribute(match[1], "Id");
    const target = readAttribute(match[1], "Target");
    if (!id || !target) continue;
    rels.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target}`);
  }

  const sheets = new Map<string, string>();
  for (const match of workbookXml.matchAll(/<(?:\w+:)?sheet\b([^>]*)\/?>/g)) {
    const name = readAttribute(match[1], "name");
    const relationId = readAttribute(match[1], "r:id");
    const target = rels.get(relationId);
    if (name && target) sheets.set(name, target);
  }
  return sheets;
}

function parseWorksheetRows(xml: string, sharedStrings: string[]) {
  const rows: SheetRows = [];
  const rowMatches = xml.match(/<(?:\w+:)?row\b[\s\S]*?<\/(?:\w+:)?row>/g) ?? [];
  for (const rowXml of rowMatches) {
    const rowOpenTag = rowXml.match(/<(?:\w+:)?row\b([^>]*)>/)?.[1] ?? "";
    const rowNumber = Number(readAttribute(rowOpenTag, "r"));
    const row: CellValue[] = [];
    const cellMatches =
      rowXml.match(/<(?:\w+:)?c\b[^>]*\/>|<(?:\w+:)?c\b[^>]*>[\s\S]*?<\/(?:\w+:)?c>/g) ?? [];
    for (const cellXml of cellMatches) {
      const openTag = cellXml.match(/<(?:\w+:)?c\b([^>]*)>/)?.[1] ?? "";
      const ref = readAttribute(openTag, "r");
      const type = readAttribute(openTag, "t");
      const index = columnIndex(ref);
      const rawValue = cellXml.match(/<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/)?.[1];
      const inlineValue = [...cellXml.matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)]
        .map((match) => decodeXml(match[1]))
        .join("");

      if (type === "s" && rawValue !== undefined) {
        row[index] = sharedStrings[Number(rawValue)] ?? "";
      } else if (type === "inlineStr") {
        row[index] = inlineValue;
      } else if (type === "b") {
        row[index] = rawValue === "1";
      } else if (rawValue !== undefined) {
        const text = decodeXml(rawValue);
        row[index] = text !== "" && !Number.isNaN(Number(text)) ? Number(text) : text;
      } else {
        row[index] = inlineValue || null;
      }
    }
    if (Number.isFinite(rowNumber) && rowNumber > 0) {
      rows[rowNumber - 1] = row;
    } else {
      rows.push(row);
    }
  }
  return rows;
}

async function readWorkbook(file: File): Promise<WorkbookSheets> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error("Upload must be an .xlsx workbook.");
  }

  const zip = await loadWorkbookZip(buffer);
  const workbookXml = await readZipText(zip, "xl/workbook.xml");
  const relsXml = await readZipText(zip, "xl/_rels/workbook.xml.rels");
  const sharedStrings = parseSharedStrings(await readZipText(zip, "xl/sharedStrings.xml"));
  const targets = parseWorkbookSheetTargets(workbookXml, relsXml);
  const sheets: WorkbookSheets = {};

  for (const [name, target] of targets) {
    const xml = await readZipText(zip, target);
    if (xml) sheets[name] = parseWorksheetRows(xml, sharedStrings);
  }

  return sheets;
}

function tableFromSheet(
  sheets: WorkbookSheets,
  sheetName: string,
  requiredHeaders: readonly string[],
  errors: string[],
) {
  const sheet = sheets[sheetName];
  if (!sheet) {
    errors.push(`Missing required sheet: ${sheetName}`);
    return [];
  }

  const headerRow = sheet[2] ?? [];
  const headerMap = new Map<string, number>();
  headerRow.forEach((value, index) => {
    const header = String(value ?? "").trim();
    if (header) headerMap.set(header, index);
  });

  for (const header of requiredHeaders) {
    if (!headerMap.has(header)) {
      errors.push(`Sheet ${sheetName} is missing required column: ${header}`);
    }
  }

  if (errors.length) return [];

  return sheet
    .slice(3)
    .map((row, index) => ({ rowNumber: index + 4, row, headerMap }))
    .filter(({ row }) =>
      row.some((value) => value !== null && value !== undefined && value !== ""),
    );
}

function valueFor(record: ImportRecord, header: string) {
  const index = record.headerMap.get(header);
  return index === undefined ? null : record.row[index];
}

function text(value: CellValue) {
  return String(value ?? "").trim();
}

function numberValue(value: CellValue) {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function nullableNumber(value: CellValue) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = numberValue(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isSoleLike(category: string, materialName: string) {
  return [category, materialName].join(" ").toLowerCase().includes("sole");
}

function parseCalculationType(
  value: CellValue,
  category: string,
  materialName: string,
): MaterialCalculationType {
  const normalized = text(value).toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if (!normalized) return isSoleLike(category, materialName) ? "Size Wise" : "Per Pair";
  if (["per pair", "pair", "perpair"].includes(normalized)) return "Per Pair";
  if (["size wise", "size", "sizewise", "size based"].includes(normalized)) return "Size Wise";
  if (["fixed quantity", "fixed qty", "fixed"].includes(normalized)) return "Fixed Quantity";
  if (["manual quantity", "manual qty", "manual"].includes(normalized)) return "Manual Quantity";
  return isSoleLike(category, materialName) ? "Size Wise" : "Per Pair";
}

function normalizeDate(value: CellValue) {
  if (typeof value === "number") {
    const date = new Date(Date.UTC(1899, 11, 30 + Math.floor(value)));
    return date.toISOString().slice(0, 10);
  }
  const raw = text(value);
  if (!raw) return "";
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toISOString().slice(0, 10);
}

function importKey(material: Pick<BomMaterial, "styleCode" | "color" | "brand">) {
  return [material.styleCode, material.color, material.brand]
    .map((item) => item.trim().toLowerCase())
    .join("::");
}

function materialKey(
  material: Pick<BomMaterial, "styleCode" | "color" | "brand" | "category" | "materialName">,
) {
  return [importKey(material), material.category, material.materialName]
    .map((item) => item.trim().toLowerCase())
    .join("::");
}

function appendTimelineEvent(
  data: ReturnType<typeof getDemoData>,
  purchaseOrderId: string,
  eventType: string,
  eventTitle: string,
  eventDescription: string,
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
  return { ...data, productionTimeline: [event, ...(data.productionTimeline ?? [])] };
}

function appendDominoTimelineEvents(data: ReturnType<typeof getDemoData>, purchaseOrderId: string) {
  const requirementCount = data.materialRequirements.filter(
    (item) => item.purchaseOrderId === purchaseOrderId,
  ).length;
  const materialPoCount = data.materialPurchaseOrders.filter(
    (item) => item.purchaseOrderId === purchaseOrderId && item.status === "Draft",
  ).length;
  let nextData = data;
  if (requirementCount > 0) {
    nextData = appendTimelineEvent(
      nextData,
      purchaseOrderId,
      "material_requirements_generated",
      "Material Requirements Generated",
      `${requirementCount} material requirement row(s) generated from the linked BOM.`,
    );
  }
  if (materialPoCount > 0) {
    nextData = appendTimelineEvent(
      nextData,
      purchaseOrderId,
      "material_po_created",
      "Material PO Drafts Created",
      `${materialPoCount} vendor-wise draft material PO group(s) prepared.`,
    );
  }
  return nextData;
}

export async function previewDemoTemplateImport(
  kind: "po" | "bom",
  file: File,
): Promise<TemplateImportPreview> {
  const sheets = await readWorkbook(file);
  return kind === "po" ? previewDemoPoImport(sheets) : previewDemoBomImport(sheets);
}

function previewDemoPoImport(sheets: WorkbookSheets): TemplateImportPreview {
  const errors: string[] = [];
  const warnings: string[] = [];
  const poRecords = tableFromSheet(sheets, "PO_Import", poHeaders, errors);
  const sizeRecords = tableFromSheet(sheets, "PO_Size_Breakdown", sizeHeaders, errors);
  const data = getDemoData();
  const sizeRowsByImportId = new Map<string, PoImportSize[]>();
  const seenWorkbookPos = new Set<string>();
  const rows: Record<string, string | number>[] = [];

  for (const record of sizeRecords) {
    const importId = text(valueFor(record, "PO Import ID"));
    const quantity = numberValue(valueFor(record, "Quantity"));
    const size = text(valueFor(record, "Size"));
    if (!importId && !size && !text(valueFor(record, "Quantity"))) continue;
    if (!importId || !size || !Number.isFinite(quantity)) {
      warnings.push(
        `PO_Size_Breakdown row ${record.rowNumber} was skipped because it is incomplete.`,
      );
      continue;
    }
    const next = sizeRowsByImportId.get(importId) ?? [];
    next.push({
      size,
      quantity,
      unit: text(valueFor(record, "Pair Unit")) || "Pairs",
      notes: text(valueFor(record, "Notes")),
    });
    sizeRowsByImportId.set(importId, next);
  }

  const purchaseOrders: PoImportOrder[] = [];
  for (const record of poRecords) {
    const importId = text(valueFor(record, "PO Import ID"));
    const customerName = text(valueFor(record, "Customer Name"));
    const poNumber = text(valueFor(record, "Buyer PO Number"));
    const quantity = numberValue(valueFor(record, "Total Pairs"));
    const deliveryDate = normalizeDate(valueFor(record, "Delivery / B/L Date"));
    const styleCode = text(valueFor(record, "Style Code"));
    const duplicateKey = `${customerName.toLowerCase()}::${poNumber.toLowerCase()}`;

    if (!importId) errors.push(`PO_Import row ${record.rowNumber}: PO Import ID is required.`);
    if (!customerName) errors.push(`PO_Import row ${record.rowNumber}: Customer Name is required.`);
    if (!poNumber) errors.push(`PO_Import row ${record.rowNumber}: Buyer PO Number is required.`);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      errors.push(`PO_Import row ${record.rowNumber}: Total Pairs must be greater than zero.`);
    }
    if (!deliveryDate)
      errors.push(`PO_Import row ${record.rowNumber}: Delivery / B/L Date is required.`);
    if (!styleCode) warnings.push(`PO_Import row ${record.rowNumber}: Style Code is blank.`);
    if (seenWorkbookPos.has(duplicateKey)) {
      errors.push(
        `PO_Import row ${record.rowNumber}: duplicate customer and PO number in workbook.`,
      );
    }
    seenWorkbookPos.add(duplicateKey);

    const customer = data.customers.find(
      (item) => item.customerName.toLowerCase() === customerName.toLowerCase(),
    );
    if (!customer) {
      warnings.push(`Customer "${customerName}" will be created during import.`);
    } else if (
      data.purchaseOrders.some(
        (item) =>
          item.customerId === customer.id && item.poNumber.toLowerCase() === poNumber.toLowerCase(),
      )
    ) {
      warnings.push(`PO ${poNumber} already exists for ${customerName} and will be updated.`);
    }

    const sizes = sizeRowsByImportId.get(importId) ?? [];
    const sizeTotal = sizes.reduce((sum, size) => sum + size.quantity, 0);
    if (sizes.length && sizeTotal !== quantity) {
      warnings.push(
        `PO ${poNumber || importId}: size total ${sizeTotal} does not match Total Pairs ${quantity}.`,
      );
    }

    const order = {
      importId,
      customerName,
      poNumber,
      poDate: normalizeDate(valueFor(record, "PO Date")),
      article: text(valueFor(record, "Article / Style")),
      styleCode,
      color: text(valueFor(record, "Color")),
      brand: text(valueFor(record, "Brand")),
      deliveryDate,
      currency: text(valueFor(record, "Currency")) || "USD",
      price: numberValue(valueFor(record, "Price / Pair")),
      quantity,
      assignedProductionLine: text(valueFor(record, "Assigned Production Line")),
      notes: text(valueFor(record, "Notes")),
      sizes,
    };
    purchaseOrders.push(order);
    rows.push({
      "PO Import ID": order.importId,
      Customer: order.customerName,
      "PO Number": order.poNumber,
      Style: order.styleCode,
      Quantity: order.quantity,
      "Size Total": sizeTotal,
      Delivery: order.deliveryDate,
    });
  }

  const usedImportIds = new Set(purchaseOrders.map((order) => order.importId));
  for (const importId of sizeRowsByImportId.keys()) {
    if (!usedImportIds.has(importId)) {
      warnings.push(`PO_Size_Breakdown rows for ${importId} do not match a PO_Import row.`);
    }
  }

  if (!purchaseOrders.length && !errors.length) errors.push("No purchase order rows found.");

  return {
    kind: "po",
    errors,
    warnings,
    rows,
    payload: { purchaseOrders },
  };
}

function previewDemoBomImport(sheets: WorkbookSheets): TemplateImportPreview {
  const errors: string[] = [];
  const warnings: string[] = [];
  const records = tableFromSheet(sheets, "BOM_Materials", bomHeaders, errors);
  const materials: BomImportMaterial[] = [];
  const rows: Record<string, string | number>[] = [];

  for (const record of records) {
    const styleCode = text(valueFor(record, "Style Code"));
    const materialCategory = text(valueFor(record, "Material Category"));
    const materialName = text(valueFor(record, "Material Name"));
    const unit = text(valueFor(record, "Unit"));
    const consumptionPerPair = numberValue(valueFor(record, "Consumption / Pair"));
    const calculationType = parseCalculationType(
      valueFor(record, "Calculation Type"),
      materialCategory,
      materialName,
    );
    const fixedQuantity = nullableNumber(valueFor(record, "Fixed Quantity"));

    if (!styleCode) errors.push(`BOM_Materials row ${record.rowNumber}: Style Code is required.`);
    if (!materialCategory)
      errors.push(`BOM_Materials row ${record.rowNumber}: Material Category is required.`);
    if (!materialName)
      errors.push(`BOM_Materials row ${record.rowNumber}: Material Name is required.`);
    if (!unit) errors.push(`BOM_Materials row ${record.rowNumber}: Unit is required.`);
    if (
      ["Per Pair", "Size Wise"].includes(calculationType) &&
      (!Number.isFinite(consumptionPerPair) || consumptionPerPair < 0)
    ) {
      errors.push(
        `BOM_Materials row ${record.rowNumber}: Consumption / Pair must be zero or greater.`,
      );
    }
    if (
      calculationType === "Fixed Quantity" &&
      (fixedQuantity === null || fixedQuantity < 0 || !Number.isFinite(fixedQuantity))
    ) {
      errors.push(
        `BOM_Materials row ${record.rowNumber}: Fixed Quantity is required for Fixed Quantity materials.`,
      );
    }

    const material = {
      styleCode,
      styleName: text(valueFor(record, "Style Name")),
      color: text(valueFor(record, "Color")),
      brand: text(valueFor(record, "Brand")),
      sizeRange: text(valueFor(record, "Size Range")),
      materialCategory,
      materialName,
      specification: text(valueFor(record, "Specification / Details")),
      supplier: text(valueFor(record, "Supplier")),
      unit,
      consumptionPerPair,
      wastagePercent: numberValue(valueFor(record, "Wastage %")),
      calculationType,
      fixedQuantity,
      criticality: text(valueFor(record, "Critical?")) || "No",
      notes: text(valueFor(record, "Notes")),
    };
    materials.push(material);
    rows.push({
      "Style Code": material.styleCode,
      "Material Category": material.materialCategory,
      Material: material.materialName,
      Unit: material.unit,
      "Consumption / Pair": material.consumptionPerPair,
      "Calculation Type": material.calculationType,
      "Fixed Quantity": material.fixedQuantity ?? "",
      Critical: material.criticality,
    });
  }

  if (!materials.length && !errors.length) errors.push("No BOM material rows found.");
  if (materials.some((material) => material.wastagePercent > 1)) {
    warnings.push(
      "Some Wastage % values are greater than 1. Import stores the value exactly as entered.",
    );
  }

  return {
    kind: "bom",
    errors,
    warnings,
    rows,
    payload: { materials },
  };
}

export function confirmDemoTemplateImport(
  kind: "po" | "bom",
  payload: unknown,
): TemplateImportResult {
  return kind === "po" ? confirmDemoPoImport(payload) : confirmDemoBomImport(payload);
}

function confirmDemoPoImport(payload: unknown): TemplateImportResult {
  const purchaseOrders = (payload as PoImportPayload | null)?.purchaseOrders ?? [];
  if (!purchaseOrders.length) throw new Error("No purchase orders were provided for import.");

  let data = getDemoData();
  let createdCustomers = 0;
  let createdPurchaseOrders = 0;
  let updatedPurchaseOrders = 0;
  let createdSizeRows = 0;
  const warnings: string[] = [];
  const seenImportIds = new Set<string>();
  const seenCustomerPos = new Set<string>();

  for (const order of purchaseOrders) {
    const importId = order.importId.trim().toLowerCase();
    const customerKey = order.customerName.trim().toLowerCase();
    const poKey = `${customerKey}::${order.poNumber.trim().toLowerCase()}`;
    if (!importId) throw new Error("PO Import ID is required.");
    if (seenImportIds.has(importId)) throw new Error(`Duplicate PO Import ID: ${order.importId}.`);
    if (!customerKey) throw new Error("Customer Name is required.");
    if (!order.poNumber.trim()) throw new Error("Buyer PO Number is required.");
    if (seenCustomerPos.has(poKey)) {
      throw new Error(`Duplicate PO number for ${order.customerName}: ${order.poNumber}.`);
    }
    if (!Number.isFinite(Number(order.quantity)) || Number(order.quantity) <= 0) {
      throw new Error(
        `PO ${order.poNumber || order.importId}: Total Pairs must be greater than zero.`,
      );
    }
    if (!order.deliveryDate) {
      throw new Error(`PO ${order.poNumber || order.importId}: Delivery date is required.`);
    }
    for (const size of order.sizes) {
      if (!size.size.trim()) throw new Error(`PO ${order.poNumber}: size is required.`);
      if (!Number.isFinite(Number(size.quantity)) || Number(size.quantity) < 0) {
        throw new Error(`PO ${order.poNumber}: size quantity must be zero or greater.`);
      }
    }
    seenImportIds.add(importId);
    seenCustomerPos.add(poKey);
  }

  for (const order of purchaseOrders) {
    const customerKey = order.customerName.trim().toLowerCase();
    let customer = data.customers.find(
      (item) => item.customerName.trim().toLowerCase() === customerKey,
    );
    if (!customer) {
      customer = {
        id: makeId("cust"),
        customerName: order.customerName,
        brand: order.brand,
        contactPerson: "",
        email: "",
        phone: "",
        country: "",
        notes: "Created from standardized PO import.",
        status: "Active",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      data = { ...data, customers: [customer, ...data.customers] };
      createdCustomers += 1;
    }

    const existing = data.purchaseOrders.find(
      (item) =>
        item.customerId === customer?.id &&
        item.poNumber.trim().toLowerCase() === order.poNumber.trim().toLowerCase(),
    );
    const productionLine = data.productionLines.find(
      (line) =>
        line.name.trim().toLowerCase() === order.assignedProductionLine.trim().toLowerCase(),
    );
    const poId = existing?.id || makeId("po");
    const nextOrder = {
      ...(existing ?? {}),
      id: poId,
      customerId: customer.id,
      customerName: customer.customerName,
      poNumber: order.poNumber,
      buyer: customer.customerName,
      poDate: order.poDate,
      article: order.article,
      brand: order.brand || customer.brand,
      styleCode: order.styleCode,
      styleName: order.article,
      color: order.color,
      quantity: order.quantity,
      price: order.price || 0,
      currency: order.currency || "USD",
      deliveryDate: order.deliveryDate,
      status: existing?.status ?? "Planning",
      currentStage: existing?.currentStage ?? "Cutting",
      notes: order.notes,
      productImageUrl: existing?.productImageUrl ?? "",
      assignedProductionLineId: productionLine?.id ?? existing?.assignedProductionLineId ?? "",
      assignedLastingLineId:
        productionLine?.department === "Bottom"
          ? productionLine.id
          : (existing?.assignedLastingLineId ?? ""),
    };

    data = {
      ...data,
      purchaseOrders: existing
        ? data.purchaseOrders.map((item) => (item.id === existing.id ? nextOrder : item))
        : [nextOrder, ...data.purchaseOrders],
      purchaseOrderSizes: [
        ...order.sizes.map((size) => ({
          id: makeId("size"),
          purchaseOrderId: poId,
          size: size.size,
          quantity: size.quantity,
          notes: size.notes,
        })),
        ...data.purchaseOrderSizes.filter((size) => size.purchaseOrderId !== poId),
      ],
    };
    data = appendTimelineEvent(
      data,
      poId,
      existing ? "po_import_updated" : "po_imported",
      existing ? "PO Import Updated" : "PO Imported",
      `Standard template import saved ${order.poNumber}.`,
    );
    data = runDemoDominoWorkflow(data, poId);
    data = appendDominoTimelineEvents(data, poId);
    createdSizeRows += order.sizes.length;
    if (existing) updatedPurchaseOrders += 1;
    else createdPurchaseOrders += 1;

    const saved = data.purchaseOrders.find((item) => item.id === poId);
    for (const item of saved?.dominoWarnings ?? []) {
      warnings.push(`${order.poNumber}: ${item.message}`);
    }
  }

  saveDemoData(data);
  return {
    createdCustomers,
    createdPurchaseOrders,
    updatedPurchaseOrders,
    createdSizeRows,
    warnings,
  };
}

function confirmDemoBomImport(payload: unknown): TemplateImportResult {
  const materials = (payload as BomImportPayload | null)?.materials ?? [];
  if (!materials.length) throw new Error("No BOM material rows were provided for import.");

  const data = getDemoData();
  const existingStyleIds = new Map<string, string>();
  for (const material of data.bomMaterials) {
    existingStyleIds.set(importKey(material), material.styleId || makeId("style"));
  }

  const nextMaterials = [...data.bomMaterials];
  const importedStyles = new Set<string>();
  const seenBomRows = new Set<string>();
  let upsertedBomRows = 0;

  for (const material of materials) {
    if (!material.styleCode.trim()) throw new Error("Style Code is required.");
    if (!material.materialCategory.trim()) {
      throw new Error(`BOM ${material.styleCode}: Material Category is required.`);
    }
    if (!material.materialName.trim()) {
      throw new Error(`BOM ${material.styleCode}: Material Name is required.`);
    }
    if (!material.unit.trim()) throw new Error(`BOM ${material.styleCode}: Unit is required.`);
    if (
      ["Per Pair", "Size Wise"].includes(material.calculationType) &&
      (!Number.isFinite(Number(material.consumptionPerPair)) ||
        Number(material.consumptionPerPair) < 0)
    ) {
      throw new Error(`BOM ${material.styleCode}: Consumption / Pair must be zero or greater.`);
    }
    if (
      material.calculationType === "Fixed Quantity" &&
      (material.fixedQuantity === null || Number(material.fixedQuantity) < 0)
    ) {
      throw new Error(`BOM ${material.styleCode}: Fixed Quantity is required.`);
    }
    const styleKey = importKey({
      styleCode: material.styleCode,
      color: material.color,
      brand: material.brand,
    });
    const bomKey = [
      styleKey,
      material.materialCategory.trim().toLowerCase(),
      material.materialName.trim().toLowerCase(),
    ].join("::");
    if (seenBomRows.has(bomKey)) {
      throw new Error(`Duplicate BOM material: ${material.styleCode} / ${material.materialName}.`);
    }
    seenBomRows.add(bomKey);
    const styleId = existingStyleIds.get(styleKey) ?? makeId("style");
    existingStyleIds.set(styleKey, styleId);
    importedStyles.add(styleKey);

    const row: BomMaterial = {
      id: makeId("bom"),
      styleId,
      styleCode: material.styleCode,
      styleName: material.styleName,
      color: material.color,
      brand: material.brand,
      sizeRange: material.sizeRange,
      category: material.materialCategory,
      materialName: material.materialName,
      specification: material.specification,
      supplier: material.supplier,
      unit: material.unit,
      consumptionPerPair: material.consumptionPerPair,
      wastagePercent: material.wastagePercent,
      calculationType: material.calculationType,
      fixedQuantity: material.fixedQuantity ?? undefined,
      criticality: material.criticality,
      notes: material.notes,
      defaultVendorId: "",
      defaultVendorName: "",
    };
    const existingIndex = nextMaterials.findIndex((item) => materialKey(item) === materialKey(row));
    if (existingIndex >= 0) {
      nextMaterials[existingIndex] = {
        ...row,
        id: nextMaterials[existingIndex].id,
        defaultVendorId: nextMaterials[existingIndex].defaultVendorId ?? "",
        defaultVendorName: nextMaterials[existingIndex].defaultVendorName ?? "",
      };
    } else {
      nextMaterials.unshift(row);
    }
    upsertedBomRows += 1;
  }

  saveDemoData({ ...data, bomMaterials: nextMaterials });

  return {
    upsertedStyles: importedStyles.size,
    upsertedBomRows,
    warnings: [],
  };
}
