import { PRODUCTION_STAGES, type MaterialPoPreview, type ReportType } from "./domain";
import { getDemoData, getReportRows } from "./demo-data";
import { apiBaseUrl, isDemoMode } from "./app-config";
import { getSupabaseClient } from "./supabase";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export interface TemplateImportPreview {
  kind: "po" | "bom";
  errors: string[];
  warnings: string[];
  rows: Record<string, string | number>[];
  payload: unknown;
}

export interface TemplateImportResult {
  createdCustomers?: number;
  createdPurchaseOrders?: number;
  updatedPurchaseOrders?: number;
  createdSizeRows?: number;
  upsertedStyles?: number;
  upsertedBomRows?: number;
  warnings: string[];
}

async function getAccessToken() {
  const { data } = await getSupabaseClient().auth.getSession();
  return data.session?.access_token;
}

async function parseError(response: Response) {
  try {
    const body = (await response.json()) as { error?: string; message?: string };
    return body.error ?? body.message ?? response.statusText;
  } catch {
    return response.statusText;
  }
}

async function parseDownloadError(response: Response, endpoint: string) {
  const body = await response.text().catch(() => "");
  console.error("Download request failed", {
    endpoint,
    status: response.status,
    body,
  });
  try {
    const parsed = JSON.parse(body) as { error?: string; message?: string };
    return parsed.error ?? parsed.message ?? response.statusText;
  } catch {
    return body || response.statusText;
  }
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (isDemoMode) {
    const demoUrl = new URL(path, "http://demo.local");
    const reportMatch = demoUrl.pathname.match(/^\/reports\/([^/]+)$/);
    if (reportMatch) {
      const type = reportMatch[1] as ReportType;
      if (type === "daily-production") {
        return buildDemoDailyProductionReport(
          demoUrl.searchParams.get("date") ?? undefined,
          demoUrl.searchParams.get("department") ?? undefined,
        ) as T;
      }
      const title = type
        .split("-")
        .map((part) => part[0].toUpperCase() + part.slice(1))
        .join(" ");
      return { title, rows: getReportRows(type) } as T;
    }

    throw new ApiError("Demo mode does not call the backend API.", 404);
  }

  const token = await getAccessToken();
  if (!token) {
    throw new ApiError("You need to sign in again.", 401);
  }

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    throw new ApiError(await parseError(response), response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export async function uploadPoImage(file: File) {
  if (isDemoMode) {
    throw new ApiError("Demo mode stores selected images in local demo data.", 400);
  }

  const token = await getAccessToken();
  if (!token) {
    throw new ApiError("You need to sign in again.", 401);
  }

  const body = new FormData();
  body.append("file", file);

  const response = await fetch(`${apiBaseUrl}/uploads/po-images`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body,
  });

  if (!response.ok) {
    throw new ApiError(await parseError(response), response.status);
  }

  return (await response.json()) as { path: string };
}

export async function previewTemplateImport(kind: "po" | "bom", file: File) {
  const body = new FormData();
  body.append("file", file);
  return apiRequest<TemplateImportPreview>(`/imports/${kind}/preview`, {
    method: "POST",
    body,
  });
}

export async function confirmTemplateImport(kind: "po" | "bom", payload: unknown) {
  return apiRequest<TemplateImportResult>(`/imports/${kind}/confirm`, {
    method: "POST",
    body: toJsonBody({ payload }),
  });
}

export function toJsonBody<T>(value: T) {
  return JSON.stringify(value);
}

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadBlob(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}

function demoReportDate(date?: string) {
  return date || new Date().toISOString().slice(0, 10);
}

function demoProductionRows(date: string) {
  const data = getDemoData();
  const hasDateUpdates = data.dailyUpdates.some((update) => update.date === date);
  const reportDate = hasDateUpdates ? date : "2026-06-06";
  const updateRows = data.dailyUpdates.filter((update) => update.date === reportDate);

  return PRODUCTION_STAGES.flatMap((department) => {
    const lines = data.productionLines.filter((line) => line.department === department);
    const rows = lines.map((line) => {
      const updates = updateRows.filter((update) => update.lineId === line.id);
      const target = updates.length
        ? updates.reduce((sum, update) => sum + update.targetQuantity, 0)
        : line.dailyTarget;
      const produced = updates.length
        ? updates.reduce((sum, update) => sum + update.actualQuantity, 0)
        : line.dailyActual;
      return {
        department,
        line: line.name,
        target,
        produced,
        remaining: Math.max(target - produced, 0),
      };
    });

    const unassigned = updateRows
      .filter((update) => update.stage === department && !update.lineId)
      .map((update) => ({
        department,
        line: update.lineName || `${department} Entry`,
        target: update.targetQuantity,
        produced: update.actualQuantity,
        remaining: Math.max(update.targetQuantity - update.actualQuantity, 0),
      }));

    return [...rows, ...unassigned];
  });
}

function buildDemoDailyProductionReport(date?: string, departmentFilter?: string) {
  const reportDateValue = demoReportDate(date);
  const rows = demoProductionRows(reportDateValue);
  const departments =
    departmentFilter &&
    PRODUCTION_STAGES.includes(departmentFilter as (typeof PRODUCTION_STAGES)[number])
      ? [departmentFilter as (typeof PRODUCTION_STAGES)[number]]
      : PRODUCTION_STAGES;
  const sections = departments.map((department) => {
    const lines = rows.filter((row) => row.department === department);
    const totalTarget = lines.reduce((sum, row) => sum + row.target, 0);
    const totalProduced = lines.reduce((sum, row) => sum + row.produced, 0);
    return {
      department,
      lines: lines.map((row) => ({
        line: row.line,
        target: row.target,
        produced: row.produced,
        remaining: row.remaining,
        purchaseOrders: "",
      })),
      totalTarget,
      totalProduced,
      totalRemaining: Math.max(totalTarget - totalProduced, 0),
    };
  });

  return {
    title: "Production Report",
    date: reportDateValue,
    sections,
    totals: Object.fromEntries(
      sections.map((section) => [section.department, section.totalProduced]),
    ),
    rows: sections.flatMap((section) => [
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
    ]),
  };
}

async function downloadDemoReportExcel(type: ReportType, date?: string, departmentFilter?: string) {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();

  if (type === "daily-production") {
    const reportDateValue = demoReportDate(date);
    const rows = demoProductionRows(reportDateValue);
    const departments =
      departmentFilter &&
      PRODUCTION_STAGES.includes(departmentFilter as (typeof PRODUCTION_STAGES)[number])
        ? [departmentFilter as (typeof PRODUCTION_STAGES)[number]]
        : PRODUCTION_STAGES;
    const worksheet = workbook.addWorksheet("Production Report");
    worksheet.pageSetup = {
      paperSize: 9,
      orientation: "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    };
    worksheet.columns = [{ width: 34 }, { width: 18 }];
    worksheet.mergeCells("A1:B1");
    worksheet.getCell("A1").value = "Production Report";
    worksheet.getCell("A1").font = { bold: true, size: 18 };
    worksheet.getCell("A1").alignment = { horizontal: "center" };
    worksheet.mergeCells("A2:B2");
    worksheet.getCell("A2").value = `Report Date: ${reportDateValue}`;
    worksheet.getCell("A2").font = { bold: true };
    worksheet.getCell("A2").alignment = { horizontal: "center" };

    let rowIndex = 4;
    for (const department of departments) {
      const departmentRows = rows.filter((row) => row.department === department);
      worksheet.mergeCells(rowIndex, 1, rowIndex, 2);
      worksheet.getCell(rowIndex, 1).value = department.toUpperCase();
      worksheet.getCell(rowIndex, 1).font = { bold: true, size: 13 };
      rowIndex += 1;
      worksheet.getRow(rowIndex).values = ["Line/PO", "Produced"];
      worksheet.getRow(rowIndex).font = { bold: true };
      rowIndex += 1;

      for (const row of departmentRows.length
        ? departmentRows
        : [{ department, line: "No production entered", produced: 0, target: 0, remaining: 0 }]) {
        worksheet.getRow(rowIndex).values = [row.line, row.produced];
        rowIndex += 1;
      }

      const totalProduced = departmentRows.reduce((sum, row) => sum + row.produced, 0);
      worksheet.getRow(rowIndex).values = ["Total", totalProduced];
      worksheet.getRow(rowIndex).font = { bold: true };
      rowIndex += 2;
    }

    worksheet.mergeCells(rowIndex, 1, rowIndex, 2);
    worksheet.getCell(rowIndex, 1).value = "Grand Totals";
    worksheet.getCell(rowIndex, 1).font = { bold: true, size: 13 };
    rowIndex += 1;
    for (const department of departments) {
      worksheet.getRow(rowIndex).values = [
        `Total ${department}`,
        rows
          .filter((row) => row.department === department)
          .reduce((sum, row) => sum + row.produced, 0),
      ];
      worksheet.getRow(rowIndex).font = { bold: true };
      rowIndex += 1;
    }
  } else {
    const rows = getReportRows(type);
    const worksheet = workbook.addWorksheet(type);
    const columns = rows[0] ? Object.keys(rows[0]) : ["No Data"];
    worksheet.columns = columns.map((header) => ({ header, key: header, width: 18 }));
    rows.forEach((row) => worksheet.addRow(row));
    worksheet.getRow(1).font = { bold: true };
  }

  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    `${type}-${demoReportDate(date)}.xlsx`,
  );
}

function demoCsvRows(type: ReportType, date?: string, departmentFilter?: string) {
  if (type !== "daily-production") return getReportRows(type);
  const reportDateValue = demoReportDate(date);
  const departments =
    departmentFilter &&
    PRODUCTION_STAGES.includes(departmentFilter as (typeof PRODUCTION_STAGES)[number])
      ? [departmentFilter as (typeof PRODUCTION_STAGES)[number]]
      : PRODUCTION_STAGES;
  return departments.flatMap((department) => {
    const rows = demoProductionRows(reportDateValue).filter((row) => row.department === department);
    const total = rows.reduce((sum, row) => sum + row.produced, 0);
    return [
      { Department: department, Line: "", Produced: "", Target: "", Remaining: "" },
      ...rows.map((row) => ({
        Department: department,
        Line: row.line,
        Produced: row.produced,
        Target: row.target,
        Remaining: row.remaining,
      })),
      { Department: `${department} Total`, Line: "", Produced: total, Target: "", Remaining: "" },
    ];
  });
}

export async function downloadReport(type: ReportType, date?: string, department?: string) {
  if (isDemoMode) {
    await downloadDemoReportExcel(type, date, department);
    return;
  }

  const token = await getAccessToken();
  if (!token) {
    throw new ApiError("You need to sign in again.", 401);
  }

  const params = new URLSearchParams();
  if (date) params.set("date", date);
  if (department) params.set("department", department);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const endpoint = `${apiBaseUrl}/reports/${type}/export.xlsx${suffix}`;
  const response = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new ApiError(await parseDownloadError(response, endpoint), response.status);
  }

  const filename =
    filenameFromDisposition(response.headers.get("Content-Disposition")) ||
    `${type}-${demoReportDate(date)}.xlsx`;
  downloadBlob(await response.blob(), filename);
}

export async function downloadReportCsv(type: ReportType, date?: string, department?: string) {
  if (isDemoMode) {
    const rows = demoCsvRows(type, date, department);
    const columns = rows[0] ? Object.keys(rows[0]) : ["No Data"];
    const csv = [
      columns.map(csvEscape).join(","),
      ...rows.map((row) =>
        columns.map((column) => csvEscape((row as Record<string, unknown>)[column])).join(","),
      ),
    ].join("\n");
    downloadBlob(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
      `${type}-${demoReportDate(date)}.csv`,
    );
    return;
  }

  const token = await getAccessToken();
  if (!token) {
    throw new ApiError("You need to sign in again.", 401);
  }

  const params = new URLSearchParams();
  if (date) params.set("date", date);
  if (department) params.set("department", department);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const endpoint = `${apiBaseUrl}/reports/${type}/export.csv${suffix}`;
  const response = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new ApiError(await parseDownloadError(response, endpoint), response.status);
  }

  const filename =
    filenameFromDisposition(response.headers.get("Content-Disposition")) ||
    `${type}-${demoReportDate(date)}.csv`;
  downloadBlob(await response.blob(), filename);
}

function safeXlsxFilename(value: string) {
  return `${value.replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "") || "material-po"}.xlsx`;
}

function filenameFromDisposition(disposition: string | null) {
  if (!disposition) return "";
  const utfMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utfMatch?.[1]) return decodeURIComponent(utfMatch[1].replace(/"/g, ""));
  const basicMatch = disposition.match(/filename="?([^";]+)"?/i);
  return basicMatch?.[1] ?? "";
}

function buildDemoMaterialPoPreview(materialPoId: string): MaterialPoPreview {
  const data = getDemoData();
  const materialPo = data.materialPurchaseOrders.find((item) => item.id === materialPoId);
  if (!materialPo) throw new ApiError("Material PO was not found.", 404);
  const vendor = data.vendors.find((item) => item.id === materialPo.vendorId);
  const items = data.materialPoItems.filter((item) => item.materialPoId === materialPoId);

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
    items: items.map((item) => ({
      materialName: item.materialName,
      specification: item.specification,
      quantity: item.quantity,
      unit: item.unit,
      expectedDeliveryDate: materialPo.expectedDeliveryDate,
      notes: item.notes,
    })),
  };
}

export async function downloadMaterialPoExcel(
  materialPoId: string,
  demoPreview?: MaterialPoPreview,
) {
  if (isDemoMode) {
    const preview = demoPreview ?? buildDemoMaterialPoPreview(materialPoId);
    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
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
    infoRows.forEach((values, index) => {
      const row = worksheet.getRow(index + 3);
      row.values = values;
      row.getCell(1).font = { bold: true };
      row.getCell(3).font = { bold: true };
    });

    const headers = [
      "Material Name",
      "Specification",
      "Required Quantity",
      "Unit",
      "Expected Delivery",
      "Notes",
    ];
    worksheet.getRow(10).values = headers;
    worksheet.getRow(10).font = { bold: true };
    preview.items.forEach((item, index) => {
      worksheet.getRow(11 + index).values = [
        item.materialName,
        item.specification,
        item.quantity,
        item.unit,
        item.expectedDeliveryDate,
        item.notes,
      ];
    });
    worksheet.columns = [
      { width: 26 },
      { width: 34 },
      { width: 18 },
      { width: 12 },
      { width: 18 },
      { width: 30 },
    ];

    const buffer = await workbook.xlsx.writeBuffer();
    downloadBlob(
      new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
      safeXlsxFilename(preview.materialPoNumber),
    );
    return;
  }

  const token = await getAccessToken();
  if (!token) {
    throw new ApiError("You need to sign in again.", 401);
  }

  const endpoint = `${apiBaseUrl}/material-pos/${materialPoId}/export.xlsx`;
  const response = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new ApiError(await parseDownloadError(response, endpoint), response.status);
  }

  const filename =
    filenameFromDisposition(response.headers.get("Content-Disposition")) ||
    safeXlsxFilename(demoPreview?.materialPoNumber || "material-po");
  downloadBlob(await response.blob(), filename);
}
