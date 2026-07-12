import { createFileRoute } from "@tanstack/react-router";
import { ArrowRight, ClipboardEdit, Factory, Search } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import {
  useCreateDailyUpdate,
  useDailyUpdates,
  useMovePurchaseOrderStage,
  usePurchaseOrders,
  useUpdateDailyUpdate,
} from "@/lib/data-hooks";
import {
  canMoveProductionStage,
  nextProductionStage,
  PRODUCTION_DEPARTMENTS,
  PRODUCTION_STAGE_STATUSES,
  type DailyUpdate,
  type ProductionDepartment,
  type ProductionStageStatus,
  type PurchaseOrder,
} from "@/lib/domain";

export const Route = createFileRoute("/production-lines")({
  head: () => ({
    meta: [
      { title: "Production Pipeline - Footwear Production Hub" },
      {
        name: "description",
        content: "PO-by-department production workflow for Cutting, Upper, Bottom and Packing.",
      },
    ],
  }),
  component: ProductionPipelinePage,
});

const PRODUCTION_COLUMNS = [...PRODUCTION_DEPARTMENTS, "Completed"] as const;

type ProductionColumn = (typeof PRODUCTION_COLUMNS)[number];

type RecordDraft = {
  order: PurchaseOrder;
  department: ProductionDepartment;
  date: string;
  producedPairs: string;
  targetPairs: string;
  notes: string;
  existingUpdate?: DailyUpdate;
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function initialDepartment(): ProductionColumn | "All" {
  if (typeof window === "undefined") return "All";
  const value = new URLSearchParams(window.location.search).get("department");
  return PRODUCTION_COLUMNS.includes(value as ProductionColumn)
    ? (value as ProductionColumn)
    : "All";
}

function ProductionPipelinePage() {
  const { profile } = useAuth();
  const canEdit = canMoveProductionStage(profile?.role);
  const [selectedDate, setSelectedDate] = useState(today());
  const [selectedDepartment, setSelectedDepartment] = useState<ProductionColumn | "All">(
    initialDepartment,
  );
  const [search, setSearch] = useState("");
  const [recordDraft, setRecordDraft] = useState<RecordDraft | null>(null);
  const [departmentSelections, setDepartmentSelections] = useState<Record<string, string>>({});
  const { data: purchaseOrders = [], isLoading, error } = usePurchaseOrders();
  const { data: dailyUpdates = [] } = useDailyUpdates();
  const createDailyUpdate = useCreateDailyUpdate();
  const updateDailyUpdate = useUpdateDailyUpdate();
  const moveStage = useMovePurchaseOrderStage();

  const visibleColumns = useMemo(
    () =>
      selectedDepartment === "All"
        ? PRODUCTION_COLUMNS
        : PRODUCTION_COLUMNS.filter((department) => department === selectedDepartment),
    [selectedDepartment],
  );

  const searchableOrders = useMemo(() => {
    const term = search.trim().toLowerCase();
    const productionOrders = purchaseOrders.filter((order) => order.status !== "Shipped");
    if (!term) return productionOrders;
    return productionOrders.filter((order) =>
      [
        order.poNumber,
        order.customerName,
        order.buyer,
        order.styleCode,
        order.article,
        order.brand,
        order.color,
        order.currentStage,
      ]
        .join(" ")
        .toLowerCase()
        .includes(term),
    );
  }, [purchaseOrders, search]);

  const updatesByOrder = useMemo(() => {
    const map = new Map<string, DailyUpdate[]>();
    for (const update of dailyUpdates) {
      if (!update.poNumber) continue;
      const current = map.get(update.poNumber) ?? [];
      current.push(update);
      map.set(update.poNumber, current);
    }
    return map;
  }, [dailyUpdates]);

  const groupedOrders = useMemo(
    () =>
      Object.fromEntries(
        PRODUCTION_COLUMNS.map((department) => [
          department,
          searchableOrders.filter((order) => (order.currentStage || "Cutting") === department),
        ]),
      ) as Record<ProductionColumn, PurchaseOrder[]>,
    [searchableOrders],
  );

  const openRecordDialog = (order: PurchaseOrder, department: ProductionColumn) => {
    if (department === "Completed") return;
    const existingUpdate = findUpdateForDate(
      updatesByOrder.get(order.poNumber) ?? [],
      selectedDate,
      department,
    );
    setRecordDraft({
      order,
      department,
      date: selectedDate,
      producedPairs: String(existingUpdate?.actualQuantity ?? ""),
      targetPairs: String(existingUpdate?.targetQuantity ?? order.quantity),
      notes: existingUpdate?.notes ?? "",
      existingUpdate,
    });
  };

  const saveProductionRecord = async () => {
    if (!recordDraft) return;
    const producedPairs = Number(recordDraft.producedPairs || 0);
    const targetPairs = Number(recordDraft.targetPairs || 0);
    if (producedPairs < 0 || targetPairs < 0) {
      toast.error("Production quantities cannot be negative.");
      return;
    }
    try {
      const payload = {
        date: recordDraft.date,
        stage: recordDraft.department,
        lineId: "",
        poNumber: recordDraft.order.poNumber,
        targetQuantity: targetPairs,
        actualQuantity: producedPairs,
        notes: recordDraft.notes,
      };
      if (recordDraft.existingUpdate) {
        await updateDailyUpdate.mutateAsync({ id: recordDraft.existingUpdate.id, ...payload });
      } else {
        await createDailyUpdate.mutateAsync(payload);
      }
      toast.success("Production recorded");
      setRecordDraft(null);
    } catch (saveError) {
      toast.error((saveError as Error).message);
    }
  };

  const moveOrderTo = async (order: PurchaseOrder, department: ProductionStageStatus) => {
    try {
      await moveStage.mutateAsync({ purchaseOrderId: order.id, currentStage: department });
      toast.success(`${order.poNumber} moved to ${department}`);
    } catch (moveError) {
      toast.error((moveError as Error).message);
    }
  };

  return (
    <div>
      <PageHeader
        title="Production Pipeline"
        description="Track where each PO is now, record completed pairs by department, and move orders forward deliberately."
      />

      {error ? (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {(error as Error).message}
        </div>
      ) : null}

      <div className="mb-5 grid gap-3 rounded-md border border-border bg-muted/20 p-4 lg:grid-cols-[180px_minmax(0,1fr)_180px]">
        <div className="grid gap-1.5">
          <Label htmlFor="production-date">Production Date</Label>
          <Input
            id="production-date"
            type="date"
            value={selectedDate}
            onChange={(event) => setSelectedDate(event.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="production-search">Search</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              id="production-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search PO, customer, style, brand..."
              className="pl-9"
            />
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label>View</Label>
          <select
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            value={selectedDepartment}
            onChange={(event) => {
              const value = event.target.value as ProductionColumn | "All";
              setSelectedDepartment(value);
              const suffix = value === "All" ? "" : `?department=${encodeURIComponent(value)}`;
              window.history.replaceState(null, "", `/production-lines${suffix}`);
            }}
          >
            <option value="All">All Departments</option>
            {PRODUCTION_COLUMNS.map((department) => (
              <option key={department} value={department}>
                {department}
              </option>
            ))}
          </select>
        </div>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="p-5 text-sm text-muted-foreground">
            Loading production pipeline...
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-5">
        {visibleColumns.map((department) => (
          <DepartmentColumn
            key={department}
            department={department}
            orders={groupedOrders[department] ?? []}
            selectedDate={selectedDate}
            updatesByOrder={updatesByOrder}
            canEdit={canEdit}
            selectedCorrection={departmentSelections}
            setSelectedCorrection={setDepartmentSelections}
            onRecord={openRecordDialog}
            onMove={moveOrderTo}
          />
        ))}
      </div>

      <RecordProductionDialog
        draft={recordDraft}
        setDraft={setRecordDraft}
        isSaving={createDailyUpdate.isPending || updateDailyUpdate.isPending}
        onSave={saveProductionRecord}
      />
    </div>
  );
}

function DepartmentColumn({
  department,
  orders,
  selectedDate,
  updatesByOrder,
  canEdit,
  selectedCorrection,
  setSelectedCorrection,
  onRecord,
  onMove,
}: {
  department: ProductionColumn;
  orders: PurchaseOrder[];
  selectedDate: string;
  updatesByOrder: Map<string, DailyUpdate[]>;
  canEdit: boolean;
  selectedCorrection: Record<string, string>;
  setSelectedCorrection: Dispatch<SetStateAction<Record<string, string>>>;
  onRecord: (order: PurchaseOrder, department: ProductionColumn) => void;
  onMove: (order: PurchaseOrder, department: ProductionStageStatus) => void;
}) {
  const totalPairs = orders.reduce((sum, order) => sum + order.quantity, 0);
  return (
    <section className="rounded-md border border-border bg-muted/10">
      <div className="border-b border-border bg-background p-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">
            {department}
          </h2>
          <StatusBadge status={department} />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
          <MiniMetric label="POs" value={orders.length.toLocaleString()} />
          <MiniMetric label="Pairs" value={totalPairs.toLocaleString()} />
        </div>
      </div>
      <div className="grid gap-3 p-3">
        {orders.map((order) => {
          const updates = updatesByOrder.get(order.poNumber) ?? [];
          const todayUpdate =
            department === "Completed"
              ? undefined
              : findUpdateForDate(updates, selectedDate, department);
          const totalCompleted =
            department === "Completed"
              ? order.quantity
              : updates
                  .filter((update) => update.stage === department)
                  .reduce((sum, update) => sum + update.actualQuantity, 0);
          const remaining = Math.max(order.quantity - totalCompleted, 0);
          const nextStage = nextProductionStage(order.currentStage || "Cutting");
          const correctionValue = selectedCorrection[order.id] ?? order.currentStage ?? "Cutting";

          return (
            <Card key={order.id} className="bg-background">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-start justify-between gap-2 text-base">
                  <span className="min-w-0 truncate">{order.poNumber}</span>
                  <StatusBadge status={order.status} />
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  {order.customerName || order.buyer || "Unknown customer"}
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-1 text-sm">
                  <InfoLine label="Style" value={order.styleCode || "-"} />
                  <InfoLine label="Quantity" value={`${order.quantity.toLocaleString()} pairs`} />
                  <InfoLine label="Current" value={order.currentStage || "Cutting"} />
                  <InfoLine
                    label="Today"
                    value={
                      todayUpdate ? `${todayUpdate.actualQuantity.toLocaleString()} pairs` : "-"
                    }
                  />
                  <InfoLine
                    label="Dept. Total"
                    value={`${totalCompleted.toLocaleString()} pairs`}
                  />
                  <InfoLine label="Remaining" value={`${remaining.toLocaleString()} pairs`} />
                </div>

                {canEdit ? (
                  <div className="grid gap-2">
                    {department !== "Completed" ? (
                      <Button size="sm" onClick={() => onRecord(order, department)}>
                        <ClipboardEdit className="mr-2 h-4 w-4" />
                        Record Production
                      </Button>
                    ) : null}
                    {nextStage ? (
                      <Button size="sm" variant="outline" onClick={() => onMove(order, nextStage)}>
                        Move Next
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Button>
                    ) : null}
                    <div className="grid gap-1.5">
                      <Label htmlFor={`change-${order.id}`} className="text-xs">
                        Change Department
                      </Label>
                      <div className="flex gap-2">
                        <select
                          id={`change-${order.id}`}
                          className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                          value={correctionValue}
                          onChange={(event) =>
                            setSelectedCorrection((current) => ({
                              ...current,
                              [order.id]: event.target.value,
                            }))
                          }
                        >
                          {PRODUCTION_STAGE_STATUSES.map((item) => (
                            <option key={item} value={item}>
                              {item}
                            </option>
                          ))}
                        </select>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onMove(order, correctionValue as ProductionStageStatus)}
                          disabled={correctionValue === order.currentStage}
                        >
                          Save
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
        {!orders.length ? (
          <div className="rounded-md border border-border bg-background p-4 text-sm text-muted-foreground">
            No POs in {department}.
          </div>
        ) : null}
      </div>
    </section>
  );
}

function RecordProductionDialog({
  draft,
  setDraft,
  isSaving,
  onSave,
}: {
  draft: RecordDraft | null;
  setDraft: (value: RecordDraft | null) => void;
  isSaving: boolean;
  onSave: () => void;
}) {
  return (
    <Dialog open={Boolean(draft)} onOpenChange={(open) => !open && setDraft(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record Production</DialogTitle>
          <DialogDescription>
            Save completed pairs for a specific PO, department, and date. This does not move the PO.
          </DialogDescription>
        </DialogHeader>
        {draft ? (
          <div className="grid gap-3">
            <div className="rounded-md border border-border bg-muted/20 p-3 text-sm">
              <div className="font-medium text-foreground">{draft.order.poNumber}</div>
              <div className="mt-1 text-muted-foreground">
                {draft.order.customerName || draft.order.buyer} - {draft.order.styleCode || "-"}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="record-date">Date</Label>
                <Input
                  id="record-date"
                  type="date"
                  value={draft.date}
                  onChange={(event) => setDraft({ ...draft, date: event.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="record-department">Department</Label>
                <select
                  id="record-department"
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={draft.department}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      department: event.target.value as ProductionDepartment,
                      existingUpdate: undefined,
                    })
                  }
                >
                  {PRODUCTION_DEPARTMENTS.map((department) => (
                    <option key={department} value={department}>
                      {department}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="record-target">Target Pairs</Label>
                <Input
                  id="record-target"
                  type="number"
                  min="0"
                  value={draft.targetPairs}
                  onChange={(event) => setDraft({ ...draft, targetPairs: event.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="record-produced">Produced Pairs</Label>
                <Input
                  id="record-produced"
                  type="number"
                  min="0"
                  value={draft.producedPairs}
                  onChange={(event) => setDraft({ ...draft, producedPairs: event.target.value })}
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="record-notes">Notes</Label>
              <Input
                id="record-notes"
                value={draft.notes}
                onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
                placeholder="Optional production note"
              />
            </div>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => setDraft(null)}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={isSaving}>
            {isSaving ? "Saving..." : "Save Production"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function findUpdateForDate(
  updates: DailyUpdate[],
  date: string,
  department: ProductionDepartment | ProductionColumn,
) {
  if (department === "Completed") return undefined;
  return updates.find((update) => update.date === date && update.stage === department);
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-semibold text-foreground">{value}</div>
    </div>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate font-medium text-foreground">{value}</span>
    </div>
  );
}
