import { FileSpreadsheet, Upload } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  confirmTemplateImport,
  previewTemplateImport,
  type TemplateImportPreview,
  type TemplateImportResult,
} from "@/lib/api-client";
import { isDemoMode } from "@/lib/app-config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ImportTemplateDialog({
  kind,
  title,
  description,
  buttonLabel,
  onImported,
}: {
  kind: "po" | "bom";
  title: string;
  description: string;
  buttonLabel: string;
  onImported?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<TemplateImportPreview | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const previewFile = async () => {
    if (!file) {
      toast.error("Choose an Excel template first.");
      return;
    }

    try {
      setIsBusy(true);
      setPreview(
        isDemoMode
          ? await import("@/lib/demo-imports").then((module) =>
              module.previewDemoTemplateImport(kind, file),
            )
          : await previewTemplateImport(kind, file),
      );
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setIsBusy(false);
    }
  };

  const confirmImport = async () => {
    if (!preview || preview.errors.length) return;

    try {
      setIsBusy(true);
      const result = isDemoMode
        ? await import("@/lib/demo-imports").then((module) =>
            module.confirmDemoTemplateImport(kind, preview.payload),
          )
        : await confirmTemplateImport(kind, preview.payload);
      toast.success(importResultMessage(kind, result));
      onImported?.();
      setOpen(false);
      setFile(null);
      setPreview(null);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setIsBusy(false);
    }
  };

  const columns = preview?.rows[0] ? Object.keys(preview.rows[0]) : [];

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <FileSpreadsheet className="mr-2 h-4 w-4" />
        {buttonLabel}
      </Button>
      {open ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 px-4 py-6"
          onClick={() => setOpen(false)}
        >
          <div
            className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-md border border-border bg-background p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-foreground">{title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{description}</p>
              </div>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Close
              </Button>
            </div>

            <div className="grid gap-3">
              {isDemoMode ? (
                <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning-foreground">
                  Demo mode imports this standardized template into local sample data only.
                </div>
              ) : null}
              <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                <Input
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={(event) => {
                    setFile(event.target.files?.[0] ?? null);
                    setPreview(null);
                  }}
                />
                <Button onClick={previewFile} disabled={isBusy || !file}>
                  <Upload className="mr-2 h-4 w-4" />
                  Preview
                </Button>
              </div>

              {preview ? (
                <div className="grid gap-4">
                  <MessageList title="Errors" tone="destructive" items={preview.errors} />
                  <MessageList title="Warnings" tone="warning" items={preview.warnings} />

                  <div className="overflow-x-auto rounded-md border border-border">
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
                        {preview.rows.map((row, index) => (
                          <tr key={index} className="border-t border-border">
                            {columns.map((column) => (
                              <td key={column} className="px-4 py-3">
                                {row[column]}
                              </td>
                            ))}
                          </tr>
                        ))}
                        {!preview.rows.length ? (
                          <tr className="border-t border-border">
                            <td
                              className="px-4 py-6 text-muted-foreground"
                              colSpan={Math.max(columns.length, 1)}
                            >
                              No rows found.
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setPreview(null)} disabled={isBusy}>
                      Clear Preview
                    </Button>
                    <Button onClick={confirmImport} disabled={isBusy || preview.errors.length > 0}>
                      Confirm Import
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function MessageList({
  title,
  tone,
  items,
}: {
  title: string;
  tone: "destructive" | "warning";
  items: string[];
}) {
  if (!items.length) return null;
  const className =
    tone === "destructive"
      ? "border-destructive/30 bg-destructive/10 text-destructive"
      : "border-warning/40 bg-warning/10 text-warning-foreground";

  return (
    <div className={`rounded-md border p-3 text-sm ${className}`}>
      <div className="font-medium">{title}</div>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function importResultMessage(kind: "po" | "bom", result: TemplateImportResult) {
  if (kind === "po") {
    const created = result.createdPurchaseOrders ?? 0;
    const updated = result.updatedPurchaseOrders ?? 0;
    return `Imported ${created} and updated ${updated} purchase orders.`;
  }
  return `Imported ${result.upsertedBomRows ?? 0} BOM material rows.`;
}
