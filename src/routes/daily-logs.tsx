import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, CalendarDays, ChevronDown, ChevronUp, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import {
  useCreateDailyLog,
  useDailyLogs,
  usePurchaseOrders,
  useUpdateDailyLog,
} from "@/lib/data-hooks";
import {
  DAILY_LOG_PRIORITIES,
  DAILY_LOG_STATUSES,
  PRODUCTION_STAGES,
  type DailyLog,
  type DailyLogPriority,
  type DailyLogStatus,
  type PurchaseOrder,
  type Role,
} from "@/lib/domain";

export const Route = createFileRoute("/daily-logs")({
  head: () => ({
    meta: [
      { title: "Daily Logs - Footwear Production Hub" },
      { name: "description", content: "Factory logbook for updates, issues and notes." },
    ],
  }),
  component: DailyLogsPage,
});

const defaultDepartmentOptions = [
  "Materials",
  "Maintenance",
  "Customer",
  "General",
  ...PRODUCTION_STAGES,
];

function canCreateLog(role: Role | null | undefined) {
  return (
    role === "Owner" ||
    role === "Management" ||
    role === "Planning" ||
    role === "Production" ||
    role === "Warehouse" ||
    role === "Quality"
  );
}

function canResolveLog(role: Role | null | undefined) {
  return role === "Owner" || role === "Management" || role === "Planning";
}

function DailyLogsPage() {
  const { profile } = useAuth();
  const role = profile?.role;
  const { data: logs = [], isLoading, error } = useDailyLogs();
  const canViewPurchaseOrders =
    role === "Owner" ||
    role === "Management" ||
    role === "Planning" ||
    role === "Sales" ||
    role === "Purchasing" ||
    role === "Production";
  const { data: purchaseOrders = [] } = usePurchaseOrders(canViewPurchaseOrders);
  const createLog = useCreateDailyLog();
  const updateLog = useUpdateDailyLog();
  const queryParams =
    typeof window === "undefined"
      ? new URLSearchParams()
      : new URLSearchParams(window.location.search);
  const requestedPriority = queryParams.get("priority") || "All";
  const requestedStatus = queryParams.get("status") || "All";
  const [search, setSearch] = useState(queryParams.get("search") || "");
  const [date, setDate] = useState(queryParams.get("date") || "");
  const [departmentStage, setDepartmentStage] = useState(queryParams.get("stage") || "All");
  const [priority, setPriority] = useState<DailyLogPriority | "All">(
    DAILY_LOG_PRIORITIES.includes(requestedPriority as DailyLogPriority)
      ? (requestedPriority as DailyLogPriority)
      : "All",
  );
  const [status, setStatus] = useState<DailyLogStatus | "All">(
    DAILY_LOG_STATUSES.includes(requestedStatus as DailyLogStatus)
      ? (requestedStatus as DailyLogStatus)
      : "All",
  );
  const [author, setAuthor] = useState("All");
  const [showForm, setShowForm] = useState(false);
  const [editingLog, setEditingLog] = useState<DailyLog | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const authorOptions = useMemo(
    () => [...new Set(logs.map((log) => log.authorName).filter(Boolean))].sort(),
    [logs],
  );

  const departmentOptions = useMemo(
    () =>
      [
        ...new Set([
          ...defaultDepartmentOptions,
          ...logs.map((log) => log.departmentStage).filter(Boolean),
        ]),
      ].sort(),
    [logs],
  );

  const filteredLogs = useMemo(() => {
    const term = search.trim().toLowerCase();
    return logs
      .filter((log) => {
        const searchText = [
          log.title,
          log.note,
          log.authorName,
          log.departmentStage,
          log.poNumber,
          log.customerName,
          log.priority,
          log.status,
        ]
          .join(" ")
          .toLowerCase();
        return (
          (!term || searchText.includes(term)) &&
          (!date || log.date === date) &&
          (departmentStage === "All" || log.departmentStage === departmentStage) &&
          (priority === "All" || log.priority === priority) &&
          (status === "All" || log.status === status) &&
          (author === "All" || log.authorName === author)
        );
      })
      .sort((a, b) => (b.createdAt ?? b.date).localeCompare(a.createdAt ?? a.date));
  }, [author, date, departmentStage, logs, priority, search, status]);

  const openLogForm = (log?: DailyLog) => {
    setEditingLog(log ?? null);
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingLog(null);
  };

  const toggleStatus = async (log: DailyLog) => {
    if (!canResolveLog(role)) {
      toast.error("Only Owner, Management, or Planning can change log status.");
      return;
    }
    try {
      await updateLog.mutateAsync({
        id: log.id,
        status: log.status === "Open" ? "Resolved" : "Open",
      });
      toast.success(log.status === "Open" ? "Log resolved" : "Log reopened");
    } catch (updateError) {
      toast.error((updateError as Error).message);
    }
  };

  return (
    <div>
      <PageHeader
        title="Daily Logs"
        description="Factory logbook for production updates, issues, shortages, customer changes and department notes."
        actions={
          canCreateLog(role) ? (
            <Button onClick={() => openLogForm()}>
              <Plus className="mr-2 h-4 w-4" />
              New Log
            </Button>
          ) : undefined
        }
      />

      {error ? (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {(error as Error).message}
        </div>
      ) : null}

      <div className="mb-5 grid gap-3 rounded-md border border-border bg-muted/20 p-4 md:grid-cols-2 xl:grid-cols-6">
        <div className="grid gap-1.5 md:col-span-2">
          <Label htmlFor="log-search">Search</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              id="log-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search title, note, PO, author..."
              className="pl-9"
            />
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="log-date">Date</Label>
          <Input
            id="log-date"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </div>
        <SelectField
          id="log-stage-filter"
          label="Department"
          value={departmentStage}
          onChange={setDepartmentStage}
          options={["All", ...departmentOptions]}
        />
        <SelectField
          id="log-priority-filter"
          label="Priority"
          value={priority}
          onChange={(value) => setPriority(value as DailyLogPriority | "All")}
          options={["All", ...DAILY_LOG_PRIORITIES]}
        />
        <SelectField
          id="log-status-filter"
          label="Status"
          value={status}
          onChange={(value) => setStatus(value as DailyLogStatus | "All")}
          options={["All", ...DAILY_LOG_STATUSES]}
        />
        <SelectField
          id="log-author-filter"
          label="Author"
          value={author}
          onChange={setAuthor}
          options={["All", ...authorOptions]}
        />
      </div>

      <div className="mb-3 text-sm text-muted-foreground">
        Showing {filteredLogs.length} of {logs.length} log entries.
      </div>

      <div className="grid gap-4">
        {isLoading ? (
          <Card>
            <CardContent className="p-5 text-sm text-muted-foreground">
              Loading daily logs...
            </CardContent>
          </Card>
        ) : null}

        {!isLoading && !filteredLogs.length ? (
          <Card>
            <CardContent className="flex items-start gap-3 p-5 text-sm text-muted-foreground">
              <AlertTriangle className="mt-0.5 h-4 w-4" />
              No daily logs match the current filters.
            </CardContent>
          </Card>
        ) : null}

        {filteredLogs.map((log) => {
          const isExpanded = expandedId === log.id;
          const preview =
            log.note.length > 160 && !isExpanded ? `${log.note.slice(0, 160)}...` : log.note;
          return (
            <Card key={log.id}>
              <CardHeader className="gap-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="break-words text-base">{log.title}</CardTitle>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>{log.date}</span>
                      <span>{log.authorName || "Unknown author"}</span>
                      {log.departmentStage ? <span>{log.departmentStage}</span> : null}
                      {log.poNumber ? (
                        <a
                          href={`/purchase-orders?po=${encodeURIComponent(log.purchaseOrderId)}`}
                          className="text-primary hover:underline"
                        >
                          {log.poNumber}
                        </a>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <StatusBadge status={log.priority} />
                    <StatusBadge status={log.status} />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
                  {preview}
                </p>
                {isExpanded ? (
                  <div className="mt-4 grid gap-2 rounded-md border border-border bg-muted/20 p-3 text-sm">
                    <InfoRow label="Linked PO" value={log.poNumber || "None"} />
                    <InfoRow label="Customer" value={log.customerName || "None"} />
                    <InfoRow label="Department" value={log.departmentStage || "None"} />
                  </div>
                ) : null}
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setExpandedId(isExpanded ? null : log.id)}
                  >
                    {isExpanded ? (
                      <>
                        <ChevronUp className="mr-1 h-4 w-4" />
                        Collapse
                      </>
                    ) : (
                      <>
                        <ChevronDown className="mr-1 h-4 w-4" />
                        Expand
                      </>
                    )}
                  </Button>
                  {canCreateLog(role) ? (
                    <Button variant="outline" size="sm" onClick={() => openLogForm(log)}>
                      Edit
                    </Button>
                  ) : null}
                  {canResolveLog(role) ? (
                    <Button variant="outline" size="sm" onClick={() => void toggleStatus(log)}>
                      {log.status === "Open" ? "Resolve" : "Reopen"}
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {showForm ? (
        <DailyLogForm
          log={editingLog}
          purchaseOrders={purchaseOrders}
          canResolve={canResolveLog(role)}
          onClose={closeForm}
          onSubmit={async (values) => {
            try {
              if (editingLog) {
                await updateLog.mutateAsync({ ...values, id: editingLog.id });
                toast.success("Daily log updated");
              } else {
                await createLog.mutateAsync(values);
                toast.success("Daily log created");
              }
              closeForm();
            } catch (saveError) {
              toast.error((saveError as Error).message);
            }
          }}
          isSaving={createLog.isPending || updateLog.isPending}
        />
      ) : null}
    </div>
  );
}

function DailyLogForm({
  log,
  purchaseOrders,
  canResolve,
  onClose,
  onSubmit,
  isSaving,
}: {
  log: DailyLog | null;
  purchaseOrders: PurchaseOrder[];
  canResolve: boolean;
  onClose: () => void;
  onSubmit: (values: Partial<DailyLog>) => Promise<void>;
  isSaving: boolean;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [values, setValues] = useState({
    title: log?.title ?? "",
    note: log?.note ?? "",
    date: log?.date ?? today,
    departmentStage: log?.departmentStage ?? "",
    purchaseOrderId: log?.purchaseOrderId ?? "",
    priority: log?.priority ?? "Medium",
    status: log?.status ?? "Open",
  });

  const setValue = (field: keyof typeof values, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
  };

  const submit = async () => {
    if (!values.title.trim()) {
      toast.error("Log title is required.");
      return;
    }
    if (!values.note.trim()) {
      toast.error("Log note is required.");
      return;
    }
    await onSubmit(values as Partial<DailyLog>);
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 px-4 py-6"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-md border border-border bg-background p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              {log ? "Edit Daily Log" : "New Daily Log"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Record factory notes, issues, updates, shortages or customer changes.
            </p>
          </div>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>

        <div className="mt-5 grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="daily-log-title">Title</Label>
            <Input
              id="daily-log-title"
              value={values.title}
              onChange={(event) => setValue("title", event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="daily-log-note">Note</Label>
            <textarea
              id="daily-log-note"
              className="min-h-[120px] rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={values.note}
              onChange={(event) => setValue("note", event.target.value)}
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="daily-log-date">Date</Label>
              <Input
                id="daily-log-date"
                type="date"
                value={values.date}
                onChange={(event) => setValue("date", event.target.value)}
              />
            </div>
            <SelectField
              id="daily-log-priority"
              label="Priority"
              value={values.priority}
              onChange={(value) => setValue("priority", value)}
              options={[...DAILY_LOG_PRIORITIES]}
            />
            <SelectField
              id="daily-log-stage"
              label="Department"
              value={values.departmentStage}
              onChange={(value) => setValue("departmentStage", value)}
              options={["", ...defaultDepartmentOptions]}
            />
            <div className="grid gap-1.5">
              <Label htmlFor="daily-log-po">Related PO</Label>
              <select
                id="daily-log-po"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm"
                value={values.purchaseOrderId}
                onChange={(event) => setValue("purchaseOrderId", event.target.value)}
              >
                <option value="">No related PO</option>
                {purchaseOrders.map((order) => (
                  <option key={order.id} value={order.id}>
                    {order.poNumber} - {order.customerName || order.buyer}
                  </option>
                ))}
              </select>
            </div>
            {canResolve ? (
              <SelectField
                id="daily-log-status"
                label="Status"
                value={values.status}
                onChange={(value) => setValue("status", value)}
                options={[...DAILY_LOG_STATUSES]}
              />
            ) : null}
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={isSaving}>
            {isSaving ? "Saving..." : "Save Log"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function SelectField({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option || "none"} value={option}>
            {option || "None"}
          </option>
        ))}
      </select>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}
