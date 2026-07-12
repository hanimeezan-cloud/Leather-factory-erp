import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Download, FileDown } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { apiRequest, downloadReport, downloadReportCsv } from "@/lib/api-client";
import { PRODUCTION_STAGES, type ReportType } from "@/lib/domain";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Reports - Footwear Production Hub" },
      {
        name: "description",
        content: "Daily, weekly production and order/material status reports.",
      },
    ],
  }),
  component: ReportsPage,
});

interface ReportData {
  title: string;
  rows: Record<string, string | number>[];
}

interface DailyProductionReportLine {
  line: string;
  target: number;
  produced: number;
  remaining: number;
  purchaseOrders?: string;
}

interface DailyProductionReportSection {
  department: string;
  lines: DailyProductionReportLine[];
  totalTarget: number;
  totalProduced: number;
  totalRemaining: number;
}

interface DailyProductionReportData extends ReportData {
  date?: string;
  sections?: DailyProductionReportSection[];
}

const reports: { type: ReportType; title: string }[] = [
  { type: "daily-production", title: "Daily Production Report" },
  { type: "weekly-production", title: "Weekly Production Report" },
  { type: "material-status", title: "Material Status Report" },
  { type: "order-progress", title: "Order Progress Report" },
  { type: "shipment-status", title: "Shipment Status Report" },
];

function ReportsPage() {
  const [search, setSearch] = useState("");
  const [reportDate, setReportDate] = useState(new Date().toISOString().slice(0, 10));
  const [previewDate, setPreviewDate] = useState(reportDate);
  const [department, setDepartment] = useState("All");
  const [previewDepartment, setPreviewDepartment] = useState("All");
  const filteredReports = useMemo(() => {
    const term = search.trim().toLowerCase();
    const statusReports = reports.filter((report) => report.type !== "daily-production");
    if (!term) return statusReports;
    return statusReports.filter((report) =>
      [report.title, report.type].join(" ").toLowerCase().includes(term),
    );
  }, [search]);

  return (
    <div>
      <PageHeader title="Reports" description="Production and status snapshots." />

      <ProductionReportsSection
        reportDate={reportDate}
        previewDate={previewDate}
        department={department}
        previewDepartment={previewDepartment}
        setReportDate={setReportDate}
        setDepartment={setDepartment}
        generatePreview={() => {
          setPreviewDate(reportDate);
          setPreviewDepartment(department);
        }}
      />

      <div className="mb-4 mt-6 max-w-md">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search status reports by name or type..."
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {filteredReports.map((report) => (
          <ReportCard key={report.type} type={report.type} title={report.title} />
        ))}
        {!filteredReports.length ? (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              No reports match your search.
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

function ProductionReportsSection({
  reportDate,
  previewDate,
  department,
  previewDepartment,
  setReportDate,
  setDepartment,
  generatePreview,
}: {
  reportDate: string;
  previewDate: string;
  department: string;
  previewDepartment: string;
  setReportDate: (value: string) => void;
  setDepartment: (value: string) => void;
  generatePreview: () => void;
}) {
  const departmentParam = previewDepartment === "All" ? "" : previewDepartment;
  const query = new URLSearchParams({ date: previewDate });
  if (departmentParam) query.set("department", departmentParam);
  const { data, isLoading, error } = useQuery({
    queryKey: ["reports", "daily-production", previewDate, previewDepartment],
    queryFn: () =>
      apiRequest<DailyProductionReportData>(`/reports/daily-production?${query.toString()}`),
    enabled: Boolean(previewDate),
  });
  const sections = normalizeDailyProductionReport(data, previewDepartment);

  const exportExcel = async () => {
    try {
      await downloadReport("daily-production", previewDate, departmentParam);
      toast.success("Daily production Excel exported");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const exportCsv = async () => {
    try {
      await downloadReportCsv("daily-production", previewDate, departmentParam);
      toast.success("Daily production CSV exported");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const printReport = () => {
    const printWindow = window.open("", "_blank", "width=900,height=700");
    if (!printWindow) {
      toast.error("Allow pop-ups to print the report preview.");
      return;
    }
    printWindow.document.write(buildPrintableDailyProductionHtml(previewDate, sections));
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Production Reports</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          Generate the daily factory production report for Cutting, Upper, Bottom, and Packing.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 md:grid-cols-[180px_180px_auto] md:items-end">
          <div className="grid gap-1.5">
            <label htmlFor="daily-production-report-date" className="text-sm font-medium">
              Select Date
            </label>
            <Input
              id="daily-production-report-date"
              type="date"
              value={reportDate}
              onChange={(event) => setReportDate(event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <label htmlFor="daily-production-report-department" className="text-sm font-medium">
              Department
            </label>
            <select
              id="daily-production-report-department"
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={department}
              onChange={(event) => setDepartment(event.target.value)}
            >
              <option value="All">All Departments</option>
              {PRODUCTION_STAGES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={generatePreview}>Generate Daily Production Report</Button>
            <Button variant="outline" onClick={printReport} disabled={!sections.length}>
              Print
            </Button>
            <Button variant="outline" onClick={exportCsv} disabled={!sections.length}>
              <FileDown className="mr-2 h-4 w-4" />
              Download CSV
            </Button>
            <Button variant="outline" onClick={exportExcel} disabled={!sections.length}>
              <Download className="mr-2 h-4 w-4" />
              Download Excel
            </Button>
          </div>
        </div>

        {error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {(error as Error).message}
          </div>
        ) : null}

        <div className="rounded-md border border-border bg-background p-4">
          <div className="text-center">
            <h2 className="text-xl font-semibold text-foreground">Production Report</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Report Date: {previewDate}
              {previewDepartment === "All" ? "" : ` - ${previewDepartment}`}
            </p>
          </div>
          {isLoading ? (
            <div className="mt-4 rounded-md border border-border p-4 text-sm text-muted-foreground">
              Loading preview...
            </div>
          ) : (
            <DailyProductionPreview sections={sections} />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function DailyProductionPreview({ sections }: { sections: DailyProductionReportSection[] }) {
  return (
    <div className="mt-4 grid gap-4">
      {sections.map((section) => (
        <div key={section.department} className="overflow-hidden rounded-md border border-border">
          <div className="bg-muted/70 px-4 py-2 text-sm font-semibold uppercase tracking-wide text-foreground">
            {section.department}
          </div>
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Line/PO</th>
                <th className="px-4 py-2 text-right">Produced</th>
              </tr>
            </thead>
            <tbody>
              {(section.lines.length
                ? section.lines
                : [{ line: "No production entered", produced: 0, target: 0, remaining: 0 }]
              ).map((line) => (
                <tr key={`${section.department}-${line.line}`} className="border-t border-border">
                  <td className="px-4 py-2">{line.line}</td>
                  <td className="px-4 py-2 text-right">{line.produced.toLocaleString()}</td>
                </tr>
              ))}
              <tr className="border-t border-border bg-muted/30 font-semibold">
                <td className="px-4 py-2">Total</td>
                <td className="px-4 py-2 text-right">{section.totalProduced.toLocaleString()}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ))}
      <div className="rounded-md border border-border bg-muted/20 p-4">
        <div className="font-semibold text-foreground">Grand Totals</div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {sections.map((section) => (
            <div
              key={section.department}
              className="rounded-md border border-border bg-background p-3"
            >
              <div className="text-xs uppercase text-muted-foreground">
                Total {section.department}
              </div>
              <div className="mt-1 text-lg font-semibold text-foreground">
                {section.totalProduced.toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ReportCard({ type, title }: { type: ReportType; title: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["reports", type],
    queryFn: () => apiRequest<ReportData>(`/reports/${type}`),
  });

  const rows = data?.rows ?? [];
  const columns = rows[0] ? Object.keys(rows[0]) : [];

  const exportExcel = async () => {
    try {
      await downloadReport(type);
      toast.success("Excel report exported");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const exportCsv = async () => {
    try {
      await downloadReportCsv(type);
      toast.success("CSV report exported");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle>{title}</CardTitle>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <FileDown className="mr-2 h-4 w-4" />
            CSV
          </Button>
          <Button variant="outline" size="sm" onClick={exportExcel}>
            <Download className="mr-2 h-4 w-4" />
            Excel
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {error ? (
          <div className="p-4 text-sm text-destructive">{(error as Error).message}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  {columns.map((column) => (
                    <th key={column} className="px-4 py-3">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={index} className="border-t border-border">
                    {columns.map((column) => (
                      <td key={column} className="px-4 py-3">
                        {row[column]}
                      </td>
                    ))}
                  </tr>
                ))}
                {!isLoading && rows.length === 0 ? (
                  <tr className="border-t border-border">
                    <td
                      className="px-4 py-6 text-muted-foreground"
                      colSpan={Math.max(columns.length, 1)}
                    >
                      No report data yet.
                    </td>
                  </tr>
                ) : null}
                {isLoading ? (
                  <tr className="border-t border-border">
                    <td
                      className="px-4 py-6 text-muted-foreground"
                      colSpan={Math.max(columns.length, 1)}
                    >
                      Loading report...
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function normalizeDailyProductionReport(
  data: DailyProductionReportData | undefined,
  departmentFilter = "All",
): DailyProductionReportSection[] {
  const departments =
    departmentFilter === "All"
      ? PRODUCTION_STAGES
      : PRODUCTION_STAGES.filter((department) => department === departmentFilter);

  if (data?.sections?.length) {
    return departments.map((department) => {
      const section = data.sections?.find((item) => item.department === department);
      return (
        section ?? {
          department,
          lines: [],
          totalTarget: 0,
          totalProduced: 0,
          totalRemaining: 0,
        }
      );
    });
  }

  const rows = data?.rows ?? [];
  return departments.map((department) => {
    const lines = rows
      .filter((row) => row.Department === department && row.Line)
      .map((row) => ({
        line: String(row.Line ?? ""),
        target: Number(row.Target ?? 0),
        produced: Number(row.Produced ?? row.Actual ?? 0),
        remaining: Number(row.Remaining ?? 0),
        purchaseOrders: String(row["Purchase Orders"] ?? ""),
      }));
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
}

function escapeHtml(value: string | number) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildPrintableDailyProductionHtml(
  reportDate: string,
  sections: DailyProductionReportSection[],
) {
  const sectionHtml = sections
    .map(
      (section) => `
        <h2>${escapeHtml(section.department.toUpperCase())}</h2>
        <table>
          <thead><tr><th>Line/PO</th><th>Produced</th></tr></thead>
          <tbody>
            ${
              section.lines.length
                ? section.lines
                    .map(
                      (line) =>
                        `<tr><td>${escapeHtml(line.line)}</td><td>${escapeHtml(line.produced)}</td></tr>`,
                    )
                    .join("")
                : "<tr><td>No production entered</td><td>0</td></tr>"
            }
            <tr class="total"><td>Total</td><td>${escapeHtml(section.totalProduced)}</td></tr>
          </tbody>
        </table>
      `,
    )
    .join("");
  const totalsHtml = sections
    .map(
      (section) =>
        `<tr><td>Total ${escapeHtml(section.department)}</td><td>${escapeHtml(section.totalProduced)}</td></tr>`,
    )
    .join("");

  return `
    <!doctype html>
    <html>
      <head>
        <title>Production Report ${escapeHtml(reportDate)}</title>
        <style>
          @page { size: A4 portrait; margin: 16mm; }
          body { font-family: Arial, sans-serif; color: #111827; }
          h1 { text-align: center; margin: 0; font-size: 24px; }
          .date { text-align: center; margin: 6px 0 22px; font-weight: 700; }
          h2 { margin: 18px 0 6px; font-size: 16px; background: #e5e7eb; padding: 8px; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
          th, td { border: 1px solid #374151; padding: 8px; text-align: left; }
          th { font-weight: 700; background: #f3f4f6; }
          th:last-child, td:last-child { text-align: right; }
          .total { font-weight: 700; background: #f3f4f6; }
        </style>
      </head>
      <body>
        <h1>Production Report</h1>
        <div class="date">Report Date: ${escapeHtml(reportDate)}</div>
        ${sectionHtml}
        <h2>GRAND TOTALS</h2>
        <table><tbody>${totalsHtml}</tbody></table>
      </body>
    </html>
  `;
}
