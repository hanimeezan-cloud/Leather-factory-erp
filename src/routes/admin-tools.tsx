import { createFileRoute } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth";
import {
  useArchiveAdminEntity,
  useClearTestData,
  useHardDeleteAdminEntity,
  useRestoreAdminEntity,
  useRunRetention,
  type AdminEntity,
  type ClearTestDataMode,
  type ClearTestDataScope,
} from "@/lib/data-hooks";

export const Route = createFileRoute("/admin-tools")({
  head: () => ({
    meta: [
      { title: "Admin Tools - Footwear Production Hub" },
      { name: "description", content: "Owner-only cleanup and retention controls." },
    ],
  }),
  component: AdminToolsPage,
});

const entityOptions: Array<{ value: AdminEntity; label: string }> = [
  { value: "customers", label: "Customers" },
  { value: "purchase-orders", label: "Purchase Orders" },
  { value: "styles", label: "Styles" },
  { value: "bom-materials", label: "BOM Materials" },
  { value: "material-requirements", label: "Material Requirements" },
  { value: "material-pos", label: "Material POs" },
  { value: "material-po-items", label: "Material PO Items" },
  { value: "materials", label: "Materials" },
  { value: "vendors", label: "Vendors" },
  { value: "approvals", label: "Approvals" },
  { value: "production-lines", label: "Production Lines" },
  { value: "daily-logs", label: "Daily Logs" },
  { value: "daily-updates", label: "Daily Updates" },
  { value: "reports", label: "Reports" },
];

const clearScopes: Array<{ value: ClearTestDataScope; label: string }> = [
  { value: "all-demo-local", label: "Demo localStorage reset" },
  { value: "purchase-orders", label: "Purchase Orders only" },
  { value: "customers-purchase-orders", label: "Customers + Purchase Orders" },
  { value: "materials-bom-material-pos", label: "Materials, BOM, Material POs" },
  { value: "vendors", label: "Vendors" },
  { value: "production-daily-logs", label: "Production + Daily Logs" },
  { value: "everything-except-users", label: "Everything except users" },
];

function AdminToolsPage() {
  const { isDemoMode } = useAuth();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Admin Tools"
        description="Archive records, clear pilot test data, and run retention safely."
      />

      <Alert>
        <ShieldAlert className="h-4 w-4" />
        <AlertTitle>Cleanup guardrails</AlertTitle>
        <AlertDescription>
          Archive is the default. Permanent delete is Owner-only and requires
          ALLOW_DESTRUCTIVE_ADMIN_ACTIONS=true on the API server.
          {isDemoMode ? " Demo mode only changes browser sample data." : ""}
        </AlertDescription>
      </Alert>

      <div className="grid gap-6 xl:grid-cols-2">
        <ManualArchiveCard />
        <ClearTestDataCard />
      </div>
      <RetentionCard />
    </div>
  );
}

function ManualArchiveCard() {
  const archiveRecord = useArchiveAdminEntity();
  const restoreRecord = useRestoreAdminEntity();
  const deleteRecord = useHardDeleteAdminEntity();
  const [entity, setEntity] = useState<AdminEntity>("purchase-orders");
  const [recordId, setRecordId] = useState("");
  const [reason, setReason] = useState("Pilot cleanup");
  const [confirmation, setConfirmation] = useState("");

  const id = recordId.trim();
  const busy = archiveRecord.isPending || restoreRecord.isPending || deleteRecord.isPending;

  async function runArchive() {
    try {
      const result = await archiveRecord.mutateAsync({ entity, id, reason });
      toast.success(
        result.warnings.length
          ? `Archived with warning: ${result.warnings.join(" ")}`
          : "Record archived",
      );
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  async function runRestore() {
    try {
      await restoreRecord.mutateAsync({ entity, id });
      toast.success("Record restored");
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  async function runHardDelete() {
    try {
      await deleteRecord.mutateAsync({ entity, id, confirmation });
      toast.success("Archived record permanently deleted");
      setConfirmation("");
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Manual Archive Or Delete</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Record Type</Label>
            <Select value={entity} onValueChange={(value) => setEntity(value as AdminEntity)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {entityOptions.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Record ID</Label>
            <Input value={recordId} onChange={(event) => setRecordId(event.target.value)} />
          </div>
        </div>
        <div className="space-y-2">
          <Label>Archive Reason</Label>
          <Textarea value={reason} onChange={(event) => setReason(event.target.value)} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={runArchive} disabled={!id || busy}>
            Archive
          </Button>
          <Button variant="outline" onClick={runRestore} disabled={!id || busy}>
            Restore
          </Button>
        </div>
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
          <Label>Type DELETE PERMANENTLY to hard-delete an archived record</Label>
          <div className="mt-2 flex flex-wrap gap-2">
            <Input
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              placeholder="DELETE PERMANENTLY"
              className="min-w-64 flex-1"
            />
            <Button
              variant="destructive"
              onClick={runHardDelete}
              disabled={!id || confirmation !== "DELETE PERMANENTLY" || busy}
            >
              Delete Permanently
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ClearTestDataCard() {
  const clearTestData = useClearTestData();
  const [scope, setScope] = useState<ClearTestDataScope>("purchase-orders");
  const [mode, setMode] = useState<ClearTestDataMode>("archive");
  const [confirmation, setConfirmation] = useState("");
  const expected = mode === "hard-delete" ? "DELETE PERMANENTLY" : "CLEAR TEST DATA";

  async function runClear() {
    try {
      const result = await clearTestData.mutateAsync({ scope, mode, confirmation });
      toast.success(
        mode === "hard-delete"
          ? `Deleted ${result.deleted} test record(s)`
          : `Archived ${result.archived} test record(s)`,
      );
      if (result.warnings.length) toast.message(result.warnings.join(" "));
      setConfirmation("");
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Clear Test Data</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Scope</Label>
            <Select value={scope} onValueChange={(value) => setScope(value as ClearTestDataScope)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {clearScopes.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Mode</Label>
            <Select value={mode} onValueChange={(value) => setMode(value as ClearTestDataMode)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="archive">Archive</SelectItem>
                <SelectItem value="hard-delete">Hard delete</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-2">
          <Label>Type {expected}</Label>
          <Input
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            placeholder={expected}
          />
        </div>
        <Button
          variant={mode === "hard-delete" ? "destructive" : "default"}
          onClick={runClear}
          disabled={confirmation !== expected || clearTestData.isPending}
        >
          {mode === "hard-delete" ? "Delete Test Data" : "Archive Test Data"}
        </Button>
      </CardContent>
    </Card>
  );
}

function RetentionCard() {
  const runRetention = useRunRetention();
  const [archiveYears, setArchiveYears] = useState("2");
  const [deleteYears, setDeleteYears] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const needsDeleteConfirmation = Boolean(deleteYears.trim());

  async function runRetentionNow() {
    try {
      const result = await runRetention.mutateAsync({
        archiveOlderThanYears: Number(archiveYears || 2),
        deleteArchivedOlderThanYears: deleteYears.trim() ? Number(deleteYears) : undefined,
        confirmation: needsDeleteConfirmation ? confirmation : undefined,
      });
      toast.success(`Retention complete: ${result.archived} archived, ${result.deleted} deleted.`);
      if (result.warnings.length) toast.message(result.warnings.join(" "));
      setConfirmation("");
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Retention</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label>Auto-archive completed records older than years</Label>
            <Input
              type="number"
              min="1"
              value={archiveYears}
              onChange={(event) => setArchiveYears(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Optional hard-delete archived older than years</Label>
            <Input
              type="number"
              min="1"
              value={deleteYears}
              onChange={(event) => setDeleteYears(event.target.value)}
              placeholder="Leave blank"
            />
          </div>
          <div className="space-y-2">
            <Label>Delete Confirmation</Label>
            <Input
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              placeholder="DELETE PERMANENTLY"
              disabled={!needsDeleteConfirmation}
            />
          </div>
        </div>
        <Button
          onClick={runRetentionNow}
          disabled={
            runRetention.isPending ||
            !archiveYears.trim() ||
            (needsDeleteConfirmation && confirmation !== "DELETE PERMANENTLY")
          }
        >
          Run Retention
        </Button>
      </CardContent>
    </Card>
  );
}
