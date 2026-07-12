import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { usePurchaseOrders, useSetFinalApproval } from "@/lib/data-hooks";
import { canApproveFinal } from "@/lib/domain";

export const Route = createFileRoute("/approvals")({
  head: () => ({
    meta: [
      { title: "Approvals - Footwear Production Hub" },
      { name: "description", content: "Final purchase order approval." },
    ],
  }),
  component: ApprovalsPage,
});

function ApprovalsPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const { data: purchaseOrders = [], isLoading, error } = usePurchaseOrders();
  const setFinalApproval = useSetFinalApproval();
  const [search, setSearch] = useState("");
  const [approvalError, setApprovalError] = useState("");
  const canApprove = canApproveFinal(profile?.role);
  const statusFilter =
    typeof window === "undefined"
      ? ""
      : new URLSearchParams(window.location.search).get("status") || "";

  const filteredOrders = useMemo(() => {
    const term = search.trim().toLowerCase();
    const statusFiltered =
      statusFilter === "pending"
        ? purchaseOrders.filter((order) => !order.approved)
        : purchaseOrders;
    const orders = [...statusFiltered].sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate));
    if (!term) return orders;
    return orders.filter((order) =>
      [
        order.poNumber,
        order.customerName,
        order.buyer,
        order.styleCode,
        order.article,
        order.brand,
        order.color,
        order.approved ? "approved" : "pending",
      ]
        .join(" ")
        .toLowerCase()
        .includes(term),
    );
  }, [purchaseOrders, search, statusFilter]);

  const toggleApproval = async (purchaseOrderId: string, approved: boolean) => {
    try {
      setApprovalError("");
      await setFinalApproval.mutateAsync({ purchaseOrderId, approved });
      toast.success(approved ? "Final approval saved" : "Final approval cleared");
    } catch (toggleError) {
      const message = (toggleError as Error).message;
      setApprovalError(message);
      toast.error(message);
    }
  };

  return (
    <div>
      <PageHeader title="Approvals" description="Final approval for customer purchase orders." />
      {error ? (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {(error as Error).message}
        </div>
      ) : null}
      {approvalError ? (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {approvalError}
        </div>
      ) : null}
      <div className="mb-4 max-w-md">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search approvals by PO, customer, style..."
        />
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Final Approval</th>
                  <th className="px-4 py-3">PO Number</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Style</th>
                  <th className="px-4 py-3">Delivery</th>
                  <th className="px-4 py-3">Approved By</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map((order) => (
                  <tr key={order.id} className="border-t border-border hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={Boolean(order.approved)}
                          disabled={!canApprove || setFinalApproval.isPending}
                          onChange={(event) => void toggleApproval(order.id, event.target.checked)}
                          className="h-4 w-4 rounded border-border"
                        />
                        <span>{order.approved ? "Approved" : "Pending"}</span>
                      </label>
                    </td>
                    <td
                      className="cursor-pointer px-4 py-3 font-medium text-primary"
                      onClick={() =>
                        void navigate({ to: "/purchase-orders", search: { po: order.id } })
                      }
                    >
                      {order.poNumber}
                    </td>
                    <td className="px-4 py-3">{order.customerName || order.buyer}</td>
                    <td className="px-4 py-3">{order.styleCode || order.article || "-"}</td>
                    <td className="px-4 py-3">{order.deliveryDate}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {order.approved
                        ? `${order.approvedByName || "Approved user"}${
                            order.approvedDate ? `, ${order.approvedDate.slice(0, 10)}` : ""
                          }`
                        : "-"}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={order.approved ? "Approved" : "Pending"} />
                    </td>
                  </tr>
                ))}
                {!isLoading && !filteredOrders.length ? (
                  <tr className="border-t border-border">
                    <td className="px-4 py-6 text-muted-foreground" colSpan={7}>
                      {purchaseOrders.length
                        ? "No approval records match your search."
                        : "No purchase orders need approval yet."}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
