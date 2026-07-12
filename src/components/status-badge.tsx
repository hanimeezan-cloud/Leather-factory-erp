import { Badge } from "@/components/ui/badge";
import type { POStatus, MaterialStatus, ApprovalStatus, LineStatus } from "@/lib/domain";

type AnyStatus =
  | POStatus
  | MaterialStatus
  | ApprovalStatus
  | LineStatus
  | string
  | null
  | undefined;

const colorMap: Record<string, string> = {
  // Positive
  Approved: "bg-success text-success-foreground",
  Received: "bg-success text-success-foreground",
  Running: "bg-success text-success-foreground",
  Shipped: "bg-success text-success-foreground",
  "Ready To Ship": "bg-success text-success-foreground",
  Sent: "bg-success text-success-foreground",
  Demo: "bg-info text-info-foreground",
  // Neutral / in progress
  Planning: "bg-secondary text-secondary-foreground",
  Ordered: "bg-info text-info-foreground",
  "In Transit": "bg-info text-info-foreground",
  "Production Running": "bg-info text-info-foreground",
  "Per Pair": "bg-info text-info-foreground",
  "Size Wise": "bg-info text-info-foreground",
  Cutting: "bg-info text-info-foreground",
  Upper: "bg-info text-info-foreground",
  Bottom: "bg-info text-info-foreground",
  Stitching: "bg-info text-info-foreground",
  Closing: "bg-info text-info-foreground",
  Lasting: "bg-info text-info-foreground",
  Finishing: "bg-info text-info-foreground",
  Packing: "bg-info text-info-foreground",
  Draft: "bg-secondary text-secondary-foreground",
  Ready: "bg-info text-info-foreground",
  Confirmed: "bg-success text-success-foreground",
  Completed: "bg-success text-success-foreground",
  Resolved: "bg-success text-success-foreground",
  "BOM Linked": "bg-success text-success-foreground",
  Calculated: "bg-success text-success-foreground",
  "Vendor Assigned": "bg-success text-success-foreground",
  "Draft Material PO": "bg-info text-info-foreground",
  "Draft PO Created": "bg-info text-info-foreground",
  "PO Created": "bg-info text-info-foreground",
  "PO Imported": "bg-info text-info-foreground",
  "PO Import Updated": "bg-info text-info-foreground",
  "Material Requirements Generated": "bg-info text-info-foreground",
  "Material PO Drafts Created": "bg-info text-info-foreground",
  "Approval Given": "bg-success text-success-foreground",
  "Approval Cleared": "bg-warning text-warning-foreground",
  "Estimated Completion Updated": "bg-info text-info-foreground",
  "Delivery Date Changed": "bg-warning text-warning-foreground",
  Low: "bg-success text-success-foreground",
  Pending: "bg-warning text-warning-foreground",
  Open: "bg-warning text-warning-foreground",
  Medium: "bg-warning text-warning-foreground",
  "Materials Pending": "bg-warning text-warning-foreground",
  "Needs manual quantity": "bg-warning text-warning-foreground",
  "Needs Manual Quantity": "bg-warning text-warning-foreground",
  "Manual Quantity": "bg-warning text-warning-foreground",
  "Fixed Quantity": "bg-secondary text-secondary-foreground",
  "Unassigned Vendor": "bg-warning text-warning-foreground",
  "Outstanding Balance": "bg-warning text-warning-foreground",
  "Not Ordered": "bg-secondary text-secondary-foreground",
  "BOM Missing": "bg-warning text-warning-foreground",
  "Partially Received": "bg-warning text-warning-foreground",
  Cancelled: "bg-destructive text-destructive-foreground",
  Failed: "bg-destructive text-destructive-foreground",
  // Negative
  Delayed: "bg-destructive text-destructive-foreground",
  High: "bg-destructive text-destructive-foreground",
  "Domino Workflow Warning": "bg-warning text-warning-foreground",
  "Material Shortage Noted": "bg-destructive text-destructive-foreground",
  Rejected: "bg-destructive text-destructive-foreground",
  Stopped: "bg-destructive text-destructive-foreground",
};

export function StatusBadge({ status }: { status: AnyStatus }) {
  const label = status || "Unknown";
  const cls = colorMap[label] ?? "bg-muted text-muted-foreground";
  return <Badge className={`${cls} rounded-md border-0 font-medium`}>{label}</Badge>;
}
