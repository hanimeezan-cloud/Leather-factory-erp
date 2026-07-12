import { createFileRoute } from "@tanstack/react-router";
import { Download, Eye, Mail, Package, Search, Send } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { downloadMaterialPoExcel } from "@/lib/api-client";
import {
  useMaterialPoPreview,
  useMaterialPurchaseOrders,
  useSendMaterialPoEmail,
} from "@/lib/data-hooks";
import type { MaterialPoPreview, MaterialPurchaseOrder } from "@/lib/domain";

export const Route = createFileRoute("/material-pos")({
  head: () => ({
    meta: [
      { title: "Material POs - Footwear Production Hub" },
      { name: "description", content: "Review generated vendor-wise Material PO drafts." },
    ],
  }),
  component: MaterialPosPage,
});

function MaterialPosPage() {
  const { data: materialPos = [], isLoading, error } = useMaterialPurchaseOrders();
  const queryParams =
    typeof window === "undefined"
      ? new URLSearchParams()
      : new URLSearchParams(window.location.search);
  const [search, setSearch] = useState(queryParams.get("search") || "");
  const [statusFilter, setStatusFilter] = useState(queryParams.get("status") || "");
  const [vendorFilter, setVendorFilter] = useState(queryParams.get("vendor") || "");
  const [previewMaterialPoId, setPreviewMaterialPoId] = useState("");
  const [emailMaterialPoId, setEmailMaterialPoId] = useState("");
  const [downloadingId, setDownloadingId] = useState("");

  const vendorOptions = useMemo(
    () =>
      [
        ...new Map(
          materialPos.map((item) => [item.vendorId || "unassigned", item.vendorName]),
        ).entries(),
      ]
        .map(([id, name]) => ({ id, name: name || "Unassigned Vendor" }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [materialPos],
  );

  const statusOptions = useMemo(
    () => [...new Set(materialPos.map((item) => item.status))].sort(),
    [materialPos],
  );

  const filteredMaterialPos = useMemo(() => {
    const term = search.trim().toLowerCase();
    return materialPos.filter((item) => {
      const vendorMatches = !vendorFilter || (item.vendorId || "unassigned") === vendorFilter;
      const statusMatches = !statusFilter || item.status === statusFilter;
      const searchText = [
        item.materialPoNumber,
        item.vendorName,
        item.poNumber,
        item.customerName,
        item.styleCode,
        item.status,
      ]
        .join(" ")
        .toLowerCase();
      return vendorMatches && statusMatches && (!term || searchText.includes(term));
    });
  }, [materialPos, search, statusFilter, vendorFilter]);

  const download = async (materialPo: MaterialPurchaseOrder) => {
    setDownloadingId(materialPo.id);
    try {
      await downloadMaterialPoExcel(materialPo.id);
      toast.success("Material PO Excel downloaded");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setDownloadingId("");
    }
  };

  return (
    <div>
      <PageHeader
        title="Material POs"
        description="Review, download, and send vendor-wise Material POs."
      />

      {error ? (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {(error as Error).message}
        </div>
      ) : null}

      <div className="mb-5 grid gap-3 rounded-md border border-border bg-muted/20 p-4 lg:grid-cols-[minmax(0,1fr)_220px_220px]">
        <div className="flex items-center gap-2 rounded-md border border-input bg-background px-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search Material PO, vendor, customer, PO number, style..."
            className="border-0 px-0 shadow-none focus-visible:ring-0"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground"
        >
          <option value="">All statuses</option>
          {statusOptions.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
        <select
          value={vendorFilter}
          onChange={(event) => setVendorFilter(event.target.value)}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground"
        >
          <option value="">All vendors</option>
          {vendorOptions.map((vendor) => (
            <option key={vendor.id} value={vendor.id}>
              {vendor.name}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-3">
        {filteredMaterialPos.map((materialPo) => (
          <MaterialPoCard
            key={materialPo.id}
            materialPo={materialPo}
            isDownloading={downloadingId === materialPo.id}
            onPreview={() => setPreviewMaterialPoId(materialPo.id)}
            onDownload={() => download(materialPo)}
            onEmail={() => setEmailMaterialPoId(materialPo.id)}
          />
        ))}

        {isLoading ? (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              Loading Material POs...
            </CardContent>
          </Card>
        ) : null}

        {!isLoading && !filteredMaterialPos.length ? (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              {materialPos.length
                ? "No Material POs match your filters."
                : "No Material POs yet. Create or import a PO with BOM materials to generate drafts."}
            </CardContent>
          </Card>
        ) : null}
      </div>

      <MaterialPoPreviewDialog
        materialPoId={previewMaterialPoId || undefined}
        open={Boolean(previewMaterialPoId)}
        onOpenChange={(open) => {
          if (!open) setPreviewMaterialPoId("");
        }}
        onEmail={() => {
          setEmailMaterialPoId(previewMaterialPoId);
          setPreviewMaterialPoId("");
        }}
      />

      <MaterialPoEmailDialog
        materialPoId={emailMaterialPoId || undefined}
        open={Boolean(emailMaterialPoId)}
        onOpenChange={(open) => {
          if (!open) setEmailMaterialPoId("");
        }}
      />
    </div>
  );
}

function MaterialPoCard({
  materialPo,
  isDownloading,
  onPreview,
  onDownload,
  onEmail,
}: {
  materialPo: MaterialPurchaseOrder;
  isDownloading: boolean;
  onPreview: () => void;
  onDownload: () => void;
  onEmail: () => void;
}) {
  const totalQuantity = (materialPo.items ?? []).reduce(
    (sum, item) => sum + Number(item.quantity || 0),
    0,
  );
  const canEmail =
    Boolean(materialPo.vendorEmail) &&
    (materialPo.status === "Draft" || materialPo.status === "Ready");

  return (
    <Card>
      <CardContent className="p-4">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Package className="h-4 w-4 text-muted-foreground" />
              <h2 className="break-words text-lg font-semibold text-foreground">
                {materialPo.materialPoNumber}
              </h2>
              <StatusBadge status={materialPo.status} />
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Summary label="Vendor" value={materialPo.vendorName || "Unassigned Vendor"} />
              <Summary label="Customer PO" value={materialPo.poNumber || "-"} />
              <Summary label="Customer" value={materialPo.customerName || "-"} />
              <Summary label="Style" value={materialPo.styleCode || "-"} />
              <Summary label="Items" value={String(materialPo.itemCount || 0)} />
              <Summary label="Total Qty" value={formatQty(totalQuantity)} />
              <Summary label="Last Sent" value={formatDateTime(materialPo.lastSentAt || "")} />
              <Summary
                label="Vendor Email"
                value={materialPo.vendorEmail || "Vendor email missing"}
                warning={!materialPo.vendorEmail}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 xl:justify-end">
            <Button variant="outline" onClick={onPreview}>
              <Eye className="mr-2 h-4 w-4" />
              Preview
            </Button>
            <Button variant="outline" onClick={onDownload} disabled={isDownloading}>
              <Download className="mr-2 h-4 w-4" />
              {isDownloading ? "Preparing..." : "Download Excel"}
            </Button>
            {canEmail ? (
              <Button onClick={onEmail}>
                <Mail className="mr-2 h-4 w-4" />
                Send Email
              </Button>
            ) : !materialPo.vendorEmail ? (
              <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm font-medium text-warning-foreground">
                Vendor email missing
              </div>
            ) : (
              <Button variant="outline" onClick={onEmail}>
                <Mail className="mr-2 h-4 w-4" />
                Email Details
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function MaterialPoPreviewDialog({
  materialPoId,
  open,
  onOpenChange,
  onEmail,
}: {
  materialPoId: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEmail: () => void;
}) {
  const { data: preview, isLoading, error } = useMaterialPoPreview(materialPoId);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");

  const download = async () => {
    if (!materialPoId || !preview) return;
    setIsDownloading(true);
    setDownloadError("");
    try {
      await downloadMaterialPoExcel(materialPoId, preview);
      toast.success("Material PO Excel downloaded");
    } catch (error) {
      const message = (error as Error).message;
      setDownloadError(message);
      toast.error(message);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Material PO Preview</DialogTitle>
          <DialogDescription>Review the document before downloading or emailing.</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="rounded-md border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
            Loading Material PO preview...
          </div>
        ) : null}

        {error ? <InlineError message={(error as Error).message} /> : null}

        {preview ? (
          <div className="grid gap-4">
            <MaterialPoDocumentPreview preview={preview} />

            {downloadError ? <InlineError message={downloadError} /> : null}

            <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
              <Button variant="outline" onClick={download} disabled={isDownloading}>
                <Download className="mr-2 h-4 w-4" />
                {isDownloading ? "Preparing..." : "Download Excel"}
              </Button>
              <Button onClick={onEmail}>
                <Mail className="mr-2 h-4 w-4" />
                Send Email
              </Button>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function MaterialPoEmailDialog({
  materialPoId,
  open,
  onOpenChange,
}: {
  materialPoId: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: preview, isLoading, error } = useMaterialPoPreview(materialPoId);
  const sendEmail = useSendMaterialPoEmail();
  const [recipientEmail, setRecipientEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sendError, setSendError] = useState("");

  useEffect(() => {
    if (!preview || !open) return;
    setRecipientEmail(preview.vendorEmail);
    setSubject(defaultMaterialPoSubject(preview));
    setBody(defaultMaterialPoBody(preview));
    setSendError("");
  }, [open, preview]);

  const submitEmail = async () => {
    if (!materialPoId || !preview) return;
    setSendError("");
    if (!recipientEmail.trim()) {
      setSendError("Recipient email is required before sending.");
      return;
    }

    try {
      const result = await sendEmail.mutateAsync({
        materialPoId,
        recipientEmail,
        subject,
        body,
      });
      toast.success(result.message || "Material PO email sent");
      onOpenChange(false);
    } catch (error) {
      const message = (error as Error).message;
      setSendError(message);
      toast.error(message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Confirm Vendor Email</DialogTitle>
          <DialogDescription>
            Review the recipient, subject, body, and fixed attachment before sending.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="rounded-md border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
            Loading email details...
          </div>
        ) : null}

        {error ? <InlineError message={(error as Error).message} /> : null}

        {preview ? (
          <div className="grid gap-4">
            {!preview.vendorEmail ? (
              <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning-foreground">
                This vendor has no saved email. Enter the recipient before sending.
              </div>
            ) : null}

            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="material-po-recipient">To</Label>
                <Input
                  id="material-po-recipient"
                  value={recipientEmail}
                  onChange={(event) => setRecipientEmail(event.target.value)}
                  placeholder="vendor@example.com"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="material-po-attachment">Attachment</Label>
                <Input
                  id="material-po-attachment"
                  value={`${preview.materialPoNumber}.xlsx`}
                  readOnly
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="material-po-subject">Subject</Label>
              <Input
                id="material-po-subject"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="material-po-body">Body</Label>
              <Textarea
                id="material-po-body"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                rows={8}
              />
            </div>

            {sendError ? <InlineError message={sendError} /> : null}

            <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={submitEmail} disabled={sendEmail.isPending}>
                <Send className="mr-2 h-4 w-4" />
                {sendEmail.isPending ? "Sending..." : "Confirm Send"}
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function MaterialPoDocumentPreview({ preview }: { preview: MaterialPoPreview }) {
  return (
    <div className="rounded-md border border-border bg-background p-5">
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        <PreviewField label="Vendor" value={preview.vendorName} />
        <PreviewField label="Vendor Email" value={preview.vendorEmail || "-"} />
        <PreviewField label="Material PO Number" value={preview.materialPoNumber} />
        <PreviewField label="Customer" value={preview.customerName || "-"} />
        <PreviewField label="Customer PO" value={preview.customerPoNumber || "-"} />
        <PreviewField label="Style Code" value={preview.styleCode || "-"} />
      </div>

      <div className="mt-5 overflow-x-auto rounded-md border border-border">
        <table className="min-w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Material</th>
              <th className="px-3 py-2 font-medium">Specification</th>
              <th className="px-3 py-2 text-right font-medium">Quantity</th>
              <th className="px-3 py-2 font-medium">Unit</th>
              <th className="px-3 py-2 font-medium">Notes</th>
            </tr>
          </thead>
          <tbody>
            {preview.items.map((item, index) => (
              <tr key={`${item.materialName}-${index}`} className="border-t border-border">
                <td className="px-3 py-2 font-medium text-foreground">{item.materialName}</td>
                <td className="px-3 py-2 text-muted-foreground">{item.specification || "-"}</td>
                <td className="px-3 py-2 text-right">{formatQty(item.quantity)}</td>
                <td className="px-3 py-2">{item.unit || "-"}</td>
                <td className="px-3 py-2 text-muted-foreground">{item.notes || "-"}</td>
              </tr>
            ))}
            {!preview.items.length ? (
              <tr>
                <td className="px-3 py-4 text-sm text-muted-foreground" colSpan={5}>
                  No material items are attached to this Material PO.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Summary({ label, value, warning }: { label: string; value: string; warning?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={`mt-1 truncate text-sm font-medium ${
          warning ? "text-warning-foreground" : "text-foreground"
        }`}
      >
        {value || "-"}
      </div>
    </div>
  );
}

function PreviewField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/20 p-3">
      <div className="text-xs font-medium uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 break-words text-sm text-foreground">{value || "-"}</div>
    </div>
  );
}

function InlineError({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
      {message}
    </div>
  );
}

function formatQty(value: number) {
  return Number(value || 0).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });
}

function formatDateTime(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
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
