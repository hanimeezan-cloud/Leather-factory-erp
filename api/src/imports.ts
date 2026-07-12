import JSZip from "jszip";
import type { QueryResultRow } from "pg";
import { runDominoWorkflowOnDb } from "./domino.js";
import type { DbExecutor, SqlParams } from "./db.js";
import { HttpError } from "./http.js";
import { addDominoTimelineEvents, addProductionTimelineEvent } from "./timeline.js";
import type { MaterialCalculationType } from "../../src/lib/domain.js";

type CellValue = string | number | boolean | null;
type SheetRows = CellValue[][];

type WorkbookSheets = Record<string, SheetRows>;

type PreviewRow = Record<string, string | number>;

export interface ImportPreview<TPayload> {
  kind: "po" | "bom";
  errors: string[];
  warnings: string[];
  rows: PreviewRow[];
  payload: TPayload;
}

export interface PoImportPayload {
  purchaseOrders: PoImportOrder[];
}

export interface PoImportOrder {
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

export interface PoImportSize {
  size: string;
  quantity: number;
  unit: string;
  notes: string;
}

export interface BomImportPayload {
  materials: BomImportMaterial[];
}

export interface BomImportMaterial {
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
  requiredQtyManualOverride: number | null;
  calculatedQtyExample: number | null;
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

async function readWorkbook(buffer: Buffer): Promise<WorkbookSheets> {
  if (!buffer.subarray(0, 2).equals(Buffer.from("PK"))) {
    throw new HttpError(400, "Upload must be an .xlsx workbook.");
  }

  const zip = await JSZip.loadAsync(buffer);
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

function normalizeHeader(value: CellValue) {
  return String(value ?? "").trim();
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
    const header = normalizeHeader(value);
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

function valueFor(record: { row: CellValue[]; headerMap: Map<string, number> }, header: string) {
  return record.row[record.headerMap.get(header) ?? -1] ?? "";
}

function text(value: CellValue) {
  return String(value ?? "").trim();
}

function numberValue(value: CellValue) {
  if (value === null || value === undefined || value === "") return 0;
  const next = Number(value);
  return Number.isFinite(next) ? next : Number.NaN;
}

function nullableNumber(value: CellValue) {
  if (value === null || value === undefined || value === "") return null;
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
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

function boolValue(value: CellValue) {
  return ["yes", "true", "1", "y"].includes(text(value).toLowerCase());
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
  if (["size wise", "size", "sizewise", "size based", "size based"].includes(normalized)) {
    return "Size Wise";
  }
  if (["fixed quantity", "fixed qty", "fixed"].includes(normalized)) return "Fixed Quantity";
  if (["manual quantity", "manual qty", "manual"].includes(normalized)) return "Manual Quantity";
  return isSoleLike(category, materialName) ? "Size Wise" : "Per Pair";
}

async function rows<T extends QueryResultRow>(db: DbExecutor, sql: string, params: SqlParams = []) {
  return (await db.query<T>(sql, params)).rows;
}

async function one<T extends QueryResultRow>(db: DbExecutor, sql: string, params: SqlParams = []) {
  const row = (await rows<T>(db, sql, params))[0];
  if (!row) throw new HttpError(404, "Record not found.");
  return row;
}

async function existingCustomerMap(db: DbExecutor) {
  const data = await rows<{ id: string; customer_name: string; brand?: string | null }>(
    db,
    "select id, customer_name, brand from customers",
  );
  return new Map(
    data.map((customer) => [
      String(customer.customer_name ?? "")
        .trim()
        .toLowerCase(),
      customer as { id: string; customer_name: string; brand?: string | null },
    ]),
  );
}

async function existingPurchaseOrderKeys(db: DbExecutor) {
  const data = await rows<{ customer_id?: string | null; po_number?: string | null }>(
    db,
    "select customer_id, po_number from purchase_orders",
  );
  return new Set(
    data.map(
      (order) => `${order.customer_id ?? ""}::${String(order.po_number ?? "").toLowerCase()}`,
    ),
  );
}

export async function previewPoImport(db: DbExecutor, buffer: Buffer) {
  const errors: string[] = [];
  const warnings: string[] = [];
  const sheets = await readWorkbook(buffer);
  const poRecords = tableFromSheet(sheets, "PO_Import", poHeaders, errors);
  const sizeRecords = tableFromSheet(sheets, "PO_Size_Breakdown", sizeHeaders, errors);

  const customers = await existingCustomerMap(db);
  const existingPos = await existingPurchaseOrderKeys(db);
  const sizeRowsByImportId = new Map<string, PoImportSize[]>();
  const seenWorkbookPos = new Set<string>();
  const rows: PreviewRow[] = [];

  for (const record of sizeRecords) {
    const importId = text(valueFor(record, "PO Import ID"));
    const customerName = text(valueFor(record, "Customer Name"));
    const styleCode = text(valueFor(record, "Style Code"));
    const color = text(valueFor(record, "Color"));
    const quantity = numberValue(valueFor(record, "Quantity"));
    const size = text(valueFor(record, "Size"));
    if (
      !importId &&
      !customerName &&
      !styleCode &&
      !color &&
      !size &&
      !text(valueFor(record, "Quantity"))
    ) {
      continue;
    }
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

    if (customerName && !customers.has(customerName.toLowerCase())) {
      warnings.push(`Customer "${customerName}" will be created during import.`);
    }
    const existingCustomer = customers.get(customerName.toLowerCase());
    if (existingCustomer && existingPos.has(`${existingCustomer.id}::${poNumber.toLowerCase()}`)) {
      warnings.push(`PO ${poNumber} already exists for ${customerName} and will be updated.`);
    }

    const sizes = sizeRowsByImportId.get(importId) ?? [];
    const sizeTotal = sizes.reduce((sum, size) => sum + size.quantity, 0);
    if (sizes.length && sizeTotal !== quantity) {
      warnings.push(
        `PO ${poNumber || importId}: size total ${sizeTotal} does not match Total Pairs ${quantity}.`,
      );
    }

    const order: PoImportOrder = {
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
  } satisfies ImportPreview<PoImportPayload>;
}

export async function confirmPoImport(
  db: DbExecutor,
  userId: string,
  payload: PoImportPayload,
  options: { runDomino?: boolean } = {},
) {
  if (!payload?.purchaseOrders?.length) {
    throw new HttpError(400, "No purchase orders were provided for import.");
  }

  const warnings: string[] = [];
  const customers = await existingCustomerMap(db);
  const seenImportIds = new Set<string>();
  const seenCustomerPos = new Set<string>();
  let createdCustomers = 0;
  let createdPurchaseOrders = 0;
  let updatedPurchaseOrders = 0;
  let createdSizeRows = 0;

  for (const order of payload.purchaseOrders) {
    const customerKey = order.customerName.trim().toLowerCase();
    const poKey = `${customerKey}::${order.poNumber.trim().toLowerCase()}`;
    if (!order.importId?.trim()) throw new HttpError(400, "PO Import ID is required.");
    if (seenImportIds.has(order.importId.trim().toLowerCase())) {
      throw new HttpError(400, `Duplicate PO Import ID in payload: ${order.importId}.`);
    }
    if (seenCustomerPos.has(poKey)) {
      throw new HttpError(
        400,
        `Duplicate PO number in payload for ${order.customerName}: ${order.poNumber}.`,
      );
    }
    seenImportIds.add(order.importId.trim().toLowerCase());
    seenCustomerPos.add(poKey);
    if (!customerKey) throw new HttpError(400, "Customer Name is required.");
    if (!order.poNumber?.trim()) throw new HttpError(400, "Buyer PO Number is required.");
    if (!Number.isFinite(Number(order.quantity)) || Number(order.quantity) <= 0) {
      throw new HttpError(
        400,
        `PO ${order.poNumber || order.importId}: Total Pairs must be greater than zero.`,
      );
    }
    if (!order.deliveryDate) {
      throw new HttpError(
        400,
        `PO ${order.poNumber || order.importId}: Delivery date is required.`,
      );
    }
    const seenSizes = new Set<string>();
    for (const size of order.sizes) {
      if (!size.size?.trim()) throw new HttpError(400, `PO ${order.poNumber}: size is required.`);
      const sizeKey = size.size.trim().toLowerCase();
      if (seenSizes.has(sizeKey)) {
        throw new HttpError(400, `PO ${order.poNumber}: size ${size.size} appears more than once.`);
      }
      seenSizes.add(sizeKey);
      if (!Number.isFinite(Number(size.quantity)) || Number(size.quantity) < 0) {
        throw new HttpError(400, `PO ${order.poNumber}: size quantity must be zero or greater.`);
      }
    }
    let customer = customers.get(customerKey);

    if (!customer) {
      customer = await one<{ id: string; customer_name: string; brand?: string | null }>(
        db,
        `
          insert into customers (customer_name, brand, status, created_by, updated_by)
          values ($1, $2, 'Active', $3, $3)
          returning id, customer_name, brand
        `,
        [order.customerName, order.brand, userId],
      );
      customers.set(customerKey, customer);
      createdCustomers += 1;
    }

    const existing = (
      await rows<{ id: string; status: string; product_image_url: string }>(
        db,
        `
          select id, status, product_image_url
          from purchase_orders
          where customer_id = $1 and po_number = $2
          limit 1
        `,
        [customer.id, order.poNumber],
      )
    )[0];

    const poPayload = {
      customer_id: customer.id,
      po_number: order.poNumber,
      buyer: order.customerName,
      po_date: order.poDate || null,
      article: order.article,
      brand: order.brand || customer.brand || "",
      style_code: order.styleCode,
      style_name: order.article,
      color: order.color,
      quantity: order.quantity,
      price: order.price || 0,
      currency: order.currency || "USD",
      delivery_date: order.deliveryDate,
      status: existing?.status ?? "Planning",
      notes: order.notes,
      product_image_url: existing?.product_image_url ?? "",
      updated_by: userId,
    };

    const poValues = [
      poPayload.customer_id,
      poPayload.po_number,
      poPayload.buyer,
      poPayload.po_date,
      poPayload.article,
      poPayload.brand,
      poPayload.style_code,
      poPayload.style_name,
      poPayload.color,
      poPayload.quantity,
      poPayload.price,
      poPayload.currency,
      poPayload.delivery_date,
      poPayload.status,
      poPayload.notes,
      poPayload.product_image_url,
      userId,
    ] as const;
    const poRow = existing?.id
      ? await one<{ id: string }>(
          db,
          `
            update purchase_orders
            set
              customer_id = $1,
              po_number = $2,
              buyer = $3,
              po_date = $4,
              article = $5,
              brand = $6,
              style_code = $7,
              style_name = $8,
              color = $9,
              quantity = $10,
              price = $11,
              currency = $12,
              delivery_date = $13,
              status = $14,
              notes = $15,
              product_image_url = $16,
              updated_by = $17
            where id = $18
            returning id
          `,
          [...poValues, existing.id],
        )
      : await one<{ id: string }>(
          db,
          `
            insert into purchase_orders (
              customer_id,
              po_number,
              buyer,
              po_date,
              article,
              brand,
              style_code,
              style_name,
              color,
              quantity,
              price,
              currency,
              delivery_date,
              status,
              notes,
              product_image_url,
              created_by,
              updated_by
            )
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $17)
            returning id
          `,
          poValues,
        );

    await db.query("delete from purchase_order_sizes where purchase_order_id = $1", [poRow.id]);

    if (order.sizes.length) {
      for (const size of order.sizes) {
        await db.query(
          `
            insert into purchase_order_sizes (purchase_order_id, size, quantity, notes)
            values ($1, $2, $3, $4)
          `,
          [poRow.id, size.size, size.quantity, size.notes],
        );
      }
      createdSizeRows += order.sizes.length;
    }

    await addProductionTimelineEvent(db, {
      purchaseOrderId: poRow.id,
      eventType: existing?.id ? "po_import_updated" : "po_imported",
      eventTitle: existing?.id ? "PO Import Updated" : "PO Imported",
      eventDescription: `Standard template import saved ${order.poNumber}.`,
      userId,
    });

    if (options.runDomino ?? true) {
      const dominoResult = await runDominoWorkflowOnDb(db, userId, poRow.id);
      await addDominoTimelineEvents(db, userId, poRow.id, dominoResult);
      for (const item of dominoResult.warnings) {
        warnings.push(`PO ${order.poNumber}: ${item.message}`);
      }
    }
    if (existing?.id) updatedPurchaseOrders += 1;
    else createdPurchaseOrders += 1;

    const sizeTotal = order.sizes.reduce((sum, size) => sum + size.quantity, 0);
    if (order.sizes.length && sizeTotal !== order.quantity) {
      warnings.push(
        `PO ${order.poNumber}: size total ${sizeTotal} does not match Total Pairs ${order.quantity}.`,
      );
    }
  }

  return {
    createdCustomers,
    createdPurchaseOrders,
    updatedPurchaseOrders,
    createdSizeRows,
    warnings,
  };
}

export async function previewBomImport(_db: DbExecutor, buffer: Buffer) {
  const errors: string[] = [];
  const warnings: string[] = [];
  const sheets = await readWorkbook(buffer);
  const records = tableFromSheet(sheets, "BOM_Materials", bomHeaders, errors);
  const materials: BomImportMaterial[] = [];
  const rows: PreviewRow[] = [];

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

    const material: BomImportMaterial = {
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
      requiredQtyManualOverride: nullableNumber(valueFor(record, "Required Qty Manual Override")),
      calculatedQtyExample: nullableNumber(valueFor(record, "Calculated Qty Example")),
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
  } satisfies ImportPreview<BomImportPayload>;
}

export async function confirmBomImport(db: DbExecutor, userId: string, payload: BomImportPayload) {
  if (!payload?.materials?.length) {
    throw new HttpError(400, "No BOM material rows were provided for import.");
  }

  const styleIds = new Map<string, string>();
  const seenBomRows = new Set<string>();
  let upsertedStyles = 0;
  let upsertedBomRows = 0;

  for (const material of payload.materials) {
    if (!material.styleCode?.trim()) throw new HttpError(400, "Style Code is required.");
    if (!material.materialCategory?.trim()) {
      throw new HttpError(400, `BOM ${material.styleCode}: Material Category is required.`);
    }
    if (!material.materialName?.trim()) {
      throw new HttpError(400, `BOM ${material.styleCode}: Material Name is required.`);
    }
    if (!material.unit?.trim())
      throw new HttpError(400, `BOM ${material.styleCode}: Unit is required.`);
    if (
      ["Per Pair", "Size Wise"].includes(material.calculationType) &&
      (!Number.isFinite(Number(material.consumptionPerPair)) ||
        Number(material.consumptionPerPair) < 0)
    ) {
      throw new HttpError(
        400,
        `BOM ${material.styleCode}: Consumption / Pair must be zero or greater.`,
      );
    }
    if (
      material.calculationType === "Fixed Quantity" &&
      (material.fixedQuantity === null || Number(material.fixedQuantity) < 0)
    ) {
      throw new HttpError(
        400,
        `BOM ${material.styleCode}: Fixed Quantity is required for Fixed Quantity materials.`,
      );
    }
    const styleKey = [
      material.styleCode.trim().toLowerCase(),
      material.color.trim().toLowerCase(),
      material.brand.trim().toLowerCase(),
    ].join("::");
    const bomKey = [
      styleKey,
      material.materialCategory.trim().toLowerCase(),
      material.materialName.trim().toLowerCase(),
    ].join("::");
    if (seenBomRows.has(bomKey)) {
      throw new HttpError(
        400,
        `Duplicate BOM material in payload: ${material.styleCode} / ${material.materialName}.`,
      );
    }
    seenBomRows.add(bomKey);
    let styleId = styleIds.get(styleKey);
    if (!styleId) {
      const existingStyle = (
        await rows<{ id: string }>(
          db,
          `
            select id
            from styles
            where style_code = $1 and color = $2 and brand = $3
            limit 1
          `,
          [material.styleCode, material.color, material.brand],
        )
      )[0];

      if (existingStyle?.id) {
        styleId = existingStyle.id;
        await db.query(
          `
            update styles
            set style_name = $2, size_range = $3, updated_by = $4
            where id = $1
          `,
          [styleId, material.styleName, material.sizeRange, userId],
        );
      } else {
        const styleResult = await one<{ id: string }>(
          db,
          `
            insert into styles (
              style_code,
              style_name,
              color,
              brand,
              size_range,
              notes,
              created_by,
              updated_by
            )
            values ($1, $2, $3, $4, $5, '', $6, $6)
            returning id
          `,
          [
            material.styleCode,
            material.styleName,
            material.color,
            material.brand,
            material.sizeRange,
            userId,
          ],
        );
        styleId = styleResult.id;
      }

      styleIds.set(styleKey, styleId);
      upsertedStyles += 1;
    }

    const existingBom = (
      await rows<{ id: string }>(
        db,
        `
          select id
          from bom_materials
          where style_id = $1 and category = $2 and material_name = $3
          limit 1
        `,
        [styleId, material.materialCategory, material.materialName],
      )
    )[0];

    const bomPayload = {
      style_id: styleId,
      category: material.materialCategory,
      material_category: material.materialCategory,
      material_name: material.materialName,
      specification: material.specification,
      supplier: material.supplier,
      unit: material.unit,
      consumption_per_pair: material.consumptionPerPair,
      wastage_percent: material.wastagePercent,
      calculation_type: material.calculationType,
      fixed_quantity: material.fixedQuantity,
      criticality: material.criticality,
      critical: boolValue(material.criticality),
      required_qty_manual_override: material.requiredQtyManualOverride,
      calculated_qty_example: material.calculatedQtyExample,
      notes: material.notes,
      updated_by: userId,
    };

    const bomValues = [
      bomPayload.style_id,
      bomPayload.category,
      bomPayload.material_category,
      bomPayload.material_name,
      bomPayload.specification,
      bomPayload.supplier,
      bomPayload.unit,
      bomPayload.consumption_per_pair,
      bomPayload.wastage_percent,
      bomPayload.calculation_type,
      bomPayload.fixed_quantity,
      bomPayload.criticality,
      bomPayload.critical,
      bomPayload.required_qty_manual_override,
      bomPayload.calculated_qty_example,
      bomPayload.notes,
      userId,
    ] as const;

    if (existingBom?.id) {
      await db.query(
        `
          update bom_materials
          set
            style_id = $1,
            category = $2,
            material_category = $3,
            material_name = $4,
            specification = $5,
            supplier = $6,
            unit = $7,
            consumption_per_pair = $8,
            wastage_percent = $9,
            calculation_type = $10,
            fixed_quantity = $11,
            criticality = $12,
            critical = $13,
            required_qty_manual_override = $14,
            calculated_qty_example = $15,
            notes = $16,
            updated_by = $17
          where id = $18
        `,
        [...bomValues, existingBom.id],
      );
    } else {
      await db.query(
        `
          insert into bom_materials (
            style_id,
            category,
            material_category,
            material_name,
            specification,
            supplier,
            unit,
            consumption_per_pair,
            wastage_percent,
            calculation_type,
            fixed_quantity,
            criticality,
            critical,
            required_qty_manual_override,
            calculated_qty_example,
            notes,
            created_by,
            updated_by
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $17)
        `,
        bomValues,
      );
    }
    upsertedBomRows += 1;
  }

  return { upsertedStyles, upsertedBomRows, warnings: [] as string[] };
}
