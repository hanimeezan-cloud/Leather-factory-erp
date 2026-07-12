import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  FileText,
  Layers,
  Package,
  Search,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { ImportTemplateDialog } from "@/components/import-template-dialog";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import {
  useAllMaterialRequirements,
  useBomMaterials,
  useMaterialPurchaseOrders,
  usePurchaseOrders,
  useUpdateBomMaterialVendor,
  useVendors,
} from "@/lib/data-hooks";
import {
  PRODUCTION_STAGE_STATUSES,
  type BomMaterial,
  type MaterialPurchaseOrder,
  type MaterialRequirement,
  type ProductionStageStatus,
  type PurchaseOrder,
  type Vendor,
} from "@/lib/domain";

export const Route = createFileRoute("/materials")({
  head: () => ({
    meta: [
      { title: "Materials - Footwear Production Hub" },
      {
        name: "description",
        content: "Order-first and inventory-first views of generated material requirements.",
      },
    ],
  }),
  component: MaterialsPage,
});

type ViewMode = "orders" | "inventory";
type VendorFilter = "All" | "Assigned" | "Unassigned";
type MaterialFilter = "All" | "Complete" | "Outstanding" | "Needs Manual Quantity";
type DeliveryFilter = "All" | "On Track" | "Due Soon" | "Delayed";
type InventoryBalanceFilter = "All" | "Outstanding Balance" | "Complete" | "Unassigned Vendor";

type OrderMaterialGroup = {
  order: PurchaseOrder;
  requirements: MaterialRequirement[];
  materialCount: number;
  materialStatus: string;
  vendorStatus: string;
  draftCount: number;
  outstandingCount: number;
  needsManualCount: number;
  unassignedVendorCount: number;
  deliveryState: DeliveryFilter;
};

type InventoryGroup = {
  key: string;
  materialName: string;
  category: string;
  vendorId: string;
  vendorName: string;
  unit: string;
  requiredQuantity: number;
  orderedQuantity: number;
  receivedQuantity: number;
  balanceQuantity: number;
  requirements: MaterialRequirement[];
  purchaseOrderIds: string[];
};

function canManageMaterials(role: string | null | undefined) {
  return role === "Owner" || role === "Management" || role === "Planning" || role === "Purchasing";
}

function canViewMaterialPos(role: string | null | undefined) {
  return role === "Owner" || role === "Management" || role === "Planning" || role === "Purchasing";
}

function MaterialsPage() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const { data: bomMaterials = [], isLoading: isLoadingBom, error: bomError } = useBomMaterials();
  const canViewPurchaseOrders =
    profile?.role === "Owner" ||
    profile?.role === "Management" ||
    profile?.role === "Planning" ||
    profile?.role === "Sales" ||
    profile?.role === "Purchasing" ||
    profile?.role === "Production";
  const { data: purchaseOrders = [], isLoading: isLoadingOrders } =
    usePurchaseOrders(canViewPurchaseOrders);
  const { data: requirements = [], isLoading: isLoadingRequirements } =
    useAllMaterialRequirements();
  const { data: materialPos = [], isLoading: isLoadingMaterialPos } = useMaterialPurchaseOrders(
    undefined,
    canViewMaterialPos(profile?.role),
  );
  const canImport =
    profile?.role === "Owner" || profile?.role === "Planning" || profile?.role === "Purchasing";
  const canAssignVendor = canManageMaterials(profile?.role);
  const { data: vendors = [] } = useVendors(canAssignVendor);

  const [viewMode, setViewMode] = useState<ViewMode>("orders");
  const [orderSearch, setOrderSearch] = useState("");
  const [inventorySearch, setInventorySearch] = useState("");
  const [stageFilter, setStageFilter] = useState<ProductionStageStatus | "All">("All");
  const [customerFilter, setCustomerFilter] = useState("All");
  const [deliveryFilter, setDeliveryFilter] = useState<DeliveryFilter>("All");
  const [vendorFilter, setVendorFilter] = useState<VendorFilter>("All");
  const [materialFilter, setMaterialFilter] = useState<MaterialFilter>("All");
  const [inventoryVendorFilter, setInventoryVendorFilter] = useState("All");
  const [inventoryCategoryFilter, setInventoryCategoryFilter] = useState("All");
  const [inventoryBalanceFilter, setInventoryBalanceFilter] =
    useState<InventoryBalanceFilter>("All");
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(() => new Set());
  const [expandedInventory, setExpandedInventory] = useState<Set<string>>(() => new Set());

  const orderById = useMemo(
    () => new Map(purchaseOrders.map((order) => [order.id, order])),
    [purchaseOrders],
  );
  const bomById = useMemo(
    () => new Map(bomMaterials.map((material) => [material.id, material])),
    [bomMaterials],
  );
  const requirementsByOrder = useMemo(
    () => groupBy(requirements, "purchaseOrderId"),
    [requirements],
  );
  const draftPoKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const materialPo of materialPos) {
      if (materialPo.status === "Draft") {
        keys.add(`${materialPo.purchaseOrderId}::${materialPo.vendorId || ""}`);
      }
    }
    return keys;
  }, [materialPos]);

  const orderGroups = useMemo<OrderMaterialGroup[]>(() => {
    return purchaseOrders
      .filter((order) => order.status !== "Shipped")
      .map((order) => {
        const orderRequirements = requirementsByOrder.get(order.id) ?? [];
        const unassignedVendorCount = orderRequirements.filter((item) => !item.vendorId).length;
        const needsManualCount = orderRequirements.filter(
          (item) => item.quantityStatus === "Needs manual quantity",
        ).length;
        const outstandingCount = orderRequirements.filter(
          (item) => item.balanceQuantity > 0,
        ).length;
        const draftCount = materialPos.filter(
          (item) => item.purchaseOrderId === order.id && item.status === "Draft",
        ).length;
        return {
          order,
          requirements: orderRequirements,
          materialCount: orderRequirements.length,
          materialStatus: materialStatus(orderRequirements),
          vendorStatus: vendorStatus(orderRequirements),
          draftCount,
          outstandingCount,
          needsManualCount,
          unassignedVendorCount,
          deliveryState: deliveryState(order),
        };
      })
      .sort((a, b) => a.order.deliveryDate.localeCompare(b.order.deliveryDate));
  }, [materialPos, purchaseOrders, requirementsByOrder]);

  const summary = useMemo(() => {
    return {
      activeOrders: orderGroups.length,
      totalRequirements: requirements.length,
      pendingVendorAssignments: requirements.filter((item) => !item.vendorId).length,
      draftMaterialPos: materialPos.filter((item) => item.status === "Draft").length,
      outstandingMaterials: requirements.filter((item) => item.balanceQuantity > 0).length,
    };
  }, [materialPos, orderGroups.length, requirements]);

  const customerOptions = useMemo(
    () => [...new Set(orderGroups.map((group) => group.order.customerName).filter(Boolean))].sort(),
    [orderGroups],
  );
  const inventoryGroups = useMemo(
    () => buildInventoryGroups(requirements, orderById, bomById),
    [bomById, orderById, requirements],
  );
  const inventoryVendorOptions = useMemo(
    () => [...new Set(inventoryGroups.map((group) => group.vendorName).filter(Boolean))].sort(),
    [inventoryGroups],
  );
  const inventoryCategoryOptions = useMemo(
    () => [...new Set(inventoryGroups.map((group) => group.category).filter(Boolean))].sort(),
    [inventoryGroups],
  );

  const filteredOrderGroups = useMemo(() => {
    const term = orderSearch.trim().toLowerCase();
    return orderGroups.filter((group) => {
      const order = group.order;
      const matchesSearch =
        !term ||
        [order.poNumber, order.customerName, order.buyer, order.brand, order.styleCode, order.color]
          .join(" ")
          .toLowerCase()
          .includes(term);
      const matchesStage = stageFilter === "All" || order.currentStage === stageFilter;
      const matchesCustomer = customerFilter === "All" || order.customerName === customerFilter;
      const matchesDelivery = deliveryFilter === "All" || group.deliveryState === deliveryFilter;
      const matchesVendor =
        vendorFilter === "All" ||
        (vendorFilter === "Assigned" &&
          group.unassignedVendorCount === 0 &&
          group.materialCount > 0) ||
        (vendorFilter === "Unassigned" && group.unassignedVendorCount > 0);
      const matchesMaterial =
        materialFilter === "All" ||
        (materialFilter === "Complete" &&
          group.outstandingCount === 0 &&
          group.materialCount > 0) ||
        (materialFilter === "Outstanding" && group.outstandingCount > 0) ||
        (materialFilter === "Needs Manual Quantity" && group.needsManualCount > 0);
      return (
        matchesSearch &&
        matchesStage &&
        matchesCustomer &&
        matchesDelivery &&
        matchesVendor &&
        matchesMaterial
      );
    });
  }, [
    customerFilter,
    deliveryFilter,
    materialFilter,
    orderGroups,
    orderSearch,
    stageFilter,
    vendorFilter,
  ]);

  const filteredInventoryGroups = useMemo(() => {
    const term = inventorySearch.trim().toLowerCase();
    return inventoryGroups.filter((group) => {
      const matchesSearch =
        !term ||
        [group.materialName, group.category, group.vendorName, group.unit]
          .join(" ")
          .toLowerCase()
          .includes(term);
      const matchesVendor =
        inventoryVendorFilter === "All" || group.vendorName === inventoryVendorFilter;
      const matchesCategory =
        inventoryCategoryFilter === "All" || group.category === inventoryCategoryFilter;
      const matchesBalance =
        inventoryBalanceFilter === "All" ||
        (inventoryBalanceFilter === "Outstanding Balance" && group.balanceQuantity > 0) ||
        (inventoryBalanceFilter === "Complete" && group.balanceQuantity <= 0) ||
        (inventoryBalanceFilter === "Unassigned Vendor" && !group.vendorId);
      return matchesSearch && matchesVendor && matchesCategory && matchesBalance;
    });
  }, [
    inventoryBalanceFilter,
    inventoryCategoryFilter,
    inventoryGroups,
    inventorySearch,
    inventoryVendorFilter,
  ]);

  const toggleOrder = (id: string) => {
    setExpandedOrders((current) => toggleSetValue(current, id));
  };
  const toggleInventory = (id: string) => {
    setExpandedInventory((current) => toggleSetValue(current, id));
  };

  const isLoading =
    isLoadingBom || isLoadingOrders || isLoadingRequirements || isLoadingMaterialPos;

  return (
    <div>
      <PageHeader
        title="Materials"
        description="Plan by purchase order or buy by material without rendering thousands of rows at once."
        actions={
          canImport ? (
            <ImportTemplateDialog
              kind="bom"
              title="Import Standard BOM / Material Template"
              description="Upload Footwear_Production_Hub_Import_Templates.xlsx with the BOM_Materials sheet."
              buttonLabel="Import BOM Excel"
              onImported={() => {
                queryClient.invalidateQueries({ queryKey: ["bom-materials"] });
                queryClient.invalidateQueries({ queryKey: ["styles"] });
                queryClient.invalidateQueries({ queryKey: ["material-requirements"] });
                queryClient.invalidateQueries({ queryKey: ["material-pos"] });
                queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
                queryClient.invalidateQueries({ queryKey: ["dashboard"] });
                queryClient.invalidateQueries({ queryKey: ["reports"] });
              }}
            />
          ) : null
        }
      />

      <div className="mb-4 rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
        Planning asks what one PO needs. Purchasing asks how much of one material is needed across
        all POs. Use the two views below for those separate workflows.
      </div>

      {bomError ? (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {(bomError as Error).message}
        </div>
      ) : null}

      <div className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
        <SummaryCard label="Active Purchase Orders" value={summary.activeOrders} />
        <SummaryCard label="Material Requirements" value={summary.totalRequirements} />
        <SummaryCard label="Pending Vendor Assignments" value={summary.pendingVendorAssignments} />
        <SummaryCard label="Draft Material POs" value={summary.draftMaterialPos} />
        <SummaryCard label="Outstanding Materials" value={summary.outstandingMaterials} />
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        <Button
          variant={viewMode === "orders" ? "default" : "outline"}
          onClick={() => setViewMode("orders")}
        >
          Orders View
        </Button>
        <Button
          variant={viewMode === "inventory" ? "default" : "outline"}
          onClick={() => setViewMode("inventory")}
        >
          Inventory View
        </Button>
      </div>

      {viewMode === "orders" ? (
        <OrdersView
          groups={filteredOrderGroups}
          totalCount={orderGroups.length}
          isLoading={isLoading}
          search={orderSearch}
          setSearch={setOrderSearch}
          stageFilter={stageFilter}
          setStageFilter={setStageFilter}
          customerFilter={customerFilter}
          setCustomerFilter={setCustomerFilter}
          customerOptions={customerOptions}
          deliveryFilter={deliveryFilter}
          setDeliveryFilter={setDeliveryFilter}
          vendorFilter={vendorFilter}
          setVendorFilter={setVendorFilter}
          materialFilter={materialFilter}
          setMaterialFilter={setMaterialFilter}
          expandedOrders={expandedOrders}
          toggleOrder={toggleOrder}
          bomById={bomById}
          draftPoKeys={draftPoKeys}
          vendors={vendors}
          canAssignVendor={canAssignVendor}
        />
      ) : (
        <InventoryView
          groups={filteredInventoryGroups}
          totalCount={inventoryGroups.length}
          isLoading={isLoading}
          search={inventorySearch}
          setSearch={setInventorySearch}
          vendorFilter={inventoryVendorFilter}
          setVendorFilter={setInventoryVendorFilter}
          vendorOptions={inventoryVendorOptions}
          categoryFilter={inventoryCategoryFilter}
          setCategoryFilter={setInventoryCategoryFilter}
          categoryOptions={inventoryCategoryOptions}
          balanceFilter={inventoryBalanceFilter}
          setBalanceFilter={setInventoryBalanceFilter}
          expandedInventory={expandedInventory}
          toggleInventory={toggleInventory}
          orderById={orderById}
          bomById={bomById}
          draftPoKeys={draftPoKeys}
        />
      )}
    </div>
  );
}

function OrdersView({
  groups,
  totalCount,
  isLoading,
  search,
  setSearch,
  stageFilter,
  setStageFilter,
  customerFilter,
  setCustomerFilter,
  customerOptions,
  deliveryFilter,
  setDeliveryFilter,
  vendorFilter,
  setVendorFilter,
  materialFilter,
  setMaterialFilter,
  expandedOrders,
  toggleOrder,
  bomById,
  draftPoKeys,
  vendors,
  canAssignVendor,
}: {
  groups: OrderMaterialGroup[];
  totalCount: number;
  isLoading: boolean;
  search: string;
  setSearch: (value: string) => void;
  stageFilter: ProductionStageStatus | "All";
  setStageFilter: (value: ProductionStageStatus | "All") => void;
  customerFilter: string;
  setCustomerFilter: (value: string) => void;
  customerOptions: string[];
  deliveryFilter: DeliveryFilter;
  setDeliveryFilter: (value: DeliveryFilter) => void;
  vendorFilter: VendorFilter;
  setVendorFilter: (value: VendorFilter) => void;
  materialFilter: MaterialFilter;
  setMaterialFilter: (value: MaterialFilter) => void;
  expandedOrders: Set<string>;
  toggleOrder: (id: string) => void;
  bomById: Map<string, BomMaterial>;
  draftPoKeys: Set<string>;
  vendors: Vendor[];
  canAssignVendor: boolean;
}) {
  return (
    <section>
      <FilterPanel>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search PO number, customer, brand, style code, color..."
        />
        <SelectField
          label="Department"
          value={stageFilter}
          onChange={(value) => setStageFilter(value as ProductionStageStatus | "All")}
          options={["All", ...PRODUCTION_STAGE_STATUSES]}
        />
        <SelectField
          label="Customer"
          value={customerFilter}
          onChange={setCustomerFilter}
          options={["All", ...customerOptions]}
        />
        <SelectField
          label="Delivery"
          value={deliveryFilter}
          onChange={(value) => setDeliveryFilter(value as DeliveryFilter)}
          options={["All", "On Track", "Due Soon", "Delayed"]}
        />
        <SelectField
          label="Vendor"
          value={vendorFilter}
          onChange={(value) => setVendorFilter(value as VendorFilter)}
          options={["All", "Assigned", "Unassigned"]}
        />
        <SelectField
          label="Materials"
          value={materialFilter}
          onChange={(value) => setMaterialFilter(value as MaterialFilter)}
          options={["All", "Complete", "Outstanding", "Needs Manual Quantity"]}
        />
      </FilterPanel>

      <div className="mb-3 text-sm text-muted-foreground">
        Showing {groups.length} of {totalCount} active purchase orders. Expand an order to render
        its material rows.
      </div>

      <div className="grid gap-4">
        {groups.map((group) => {
          const expanded = expandedOrders.has(group.order.id);
          return (
            <OrderMaterialCard
              key={group.order.id}
              group={group}
              expanded={expanded}
              onToggle={() => toggleOrder(group.order.id)}
              bomById={bomById}
              draftPoKeys={draftPoKeys}
              vendors={vendors}
              canAssignVendor={canAssignVendor}
            />
          );
        })}
        {isLoading ? <EmptyCard text="Loading material planning view..." /> : null}
        {!isLoading && !groups.length ? (
          <EmptyCard
            text={
              totalCount
                ? "No purchase orders match the current filters."
                : "No active purchase orders have material requirements yet."
            }
          />
        ) : null}
      </div>
    </section>
  );
}

function InventoryView({
  groups,
  totalCount,
  isLoading,
  search,
  setSearch,
  vendorFilter,
  setVendorFilter,
  vendorOptions,
  categoryFilter,
  setCategoryFilter,
  categoryOptions,
  balanceFilter,
  setBalanceFilter,
  expandedInventory,
  toggleInventory,
  orderById,
  bomById,
  draftPoKeys,
}: {
  groups: InventoryGroup[];
  totalCount: number;
  isLoading: boolean;
  search: string;
  setSearch: (value: string) => void;
  vendorFilter: string;
  setVendorFilter: (value: string) => void;
  vendorOptions: string[];
  categoryFilter: string;
  setCategoryFilter: (value: string) => void;
  categoryOptions: string[];
  balanceFilter: InventoryBalanceFilter;
  setBalanceFilter: (value: InventoryBalanceFilter) => void;
  expandedInventory: Set<string>;
  toggleInventory: (id: string) => void;
  orderById: Map<string, PurchaseOrder>;
  bomById: Map<string, BomMaterial>;
  draftPoKeys: Set<string>;
}) {
  return (
    <section>
      <FilterPanel>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search material name, category, vendor..."
        />
        <SelectField
          label="Vendor"
          value={vendorFilter}
          onChange={setVendorFilter}
          options={["All", ...vendorOptions]}
        />
        <SelectField
          label="Category"
          value={categoryFilter}
          onChange={setCategoryFilter}
          options={["All", ...categoryOptions]}
        />
        <SelectField
          label="Balance"
          value={balanceFilter}
          onChange={(value) => setBalanceFilter(value as InventoryBalanceFilter)}
          options={["All", "Outstanding Balance", "Complete", "Unassigned Vendor"]}
        />
      </FilterPanel>

      <div className="mb-3 text-sm text-muted-foreground">
        Showing {groups.length} of {totalCount} material groups. Expand a material to see the POs
        using it.
      </div>

      <div className="grid gap-4">
        {groups.map((group) => {
          const expanded = expandedInventory.has(group.key);
          return (
            <InventoryMaterialCard
              key={group.key}
              group={group}
              expanded={expanded}
              onToggle={() => toggleInventory(group.key)}
              orderById={orderById}
              bomById={bomById}
              draftPoKeys={draftPoKeys}
            />
          );
        })}
        {isLoading ? <EmptyCard text="Loading inventory view..." /> : null}
        {!isLoading && !groups.length ? (
          <EmptyCard
            text={
              totalCount
                ? "No material groups match the current filters."
                : "No generated material requirements yet."
            }
          />
        ) : null}
      </div>
    </section>
  );
}

function OrderMaterialCard({
  group,
  expanded,
  onToggle,
  bomById,
  draftPoKeys,
  vendors,
  canAssignVendor,
}: {
  group: OrderMaterialGroup;
  expanded: boolean;
  onToggle: () => void;
  bomById: Map<string, BomMaterial>;
  draftPoKeys: Set<string>;
  vendors: Vendor[];
  canAssignVendor: boolean;
}) {
  const { order } = group;
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <button
            type="button"
            onClick={onToggle}
            className="flex min-w-0 flex-1 items-start gap-3 text-left"
          >
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted/30">
              {expanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </span>
            <span className="min-w-0">
              <CardTitle className="break-words text-lg">{order.poNumber}</CardTitle>
              <span className="mt-1 block text-sm text-muted-foreground">
                {order.customerName || order.buyer} - {order.styleCode || "No style"} -{" "}
                {order.quantity.toLocaleString()} pairs
              </span>
            </span>
          </button>
          <div className="flex flex-wrap justify-end gap-2">
            <StatusBadge status={group.materialStatus} />
            <StatusBadge status={group.vendorStatus} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
          <Metric label="Customer" value={order.customerName || order.buyer || "-"} />
          <Metric label="Brand" value={order.brand || "-"} />
          <Metric label="Style" value={order.styleCode || "-"} />
          <Metric label="Color" value={order.color || "-"} />
          <Metric label="Delivery" value={order.deliveryDate || "-"} />
          <Metric label="Department" value={order.currentStage || "-"} />
          <Metric label="Materials" value={String(group.materialCount)} />
          <Metric label="Draft POs" value={String(group.draftCount)} />
        </div>

        <div className="flex flex-wrap gap-2">
          <a
            href={`/purchase-orders?po=${encodeURIComponent(order.id)}`}
            className="inline-flex h-9 items-center rounded-md border border-input bg-background px-3 text-sm font-medium text-primary hover:bg-muted"
          >
            Open Purchase Order
          </a>
          {group.draftCount ? (
            <a
              href={`/material-pos?search=${encodeURIComponent(order.poNumber)}`}
              className="inline-flex h-9 items-center rounded-md border border-input bg-background px-3 text-sm font-medium text-primary hover:bg-muted"
            >
              Open Material POs
            </a>
          ) : null}
        </div>

        {expanded ? (
          <div className="grid gap-3">
            {group.requirements.map((requirement) => (
              <RequirementRow
                key={requirement.id}
                requirement={requirement}
                order={order}
                bomMaterial={bomById.get(requirement.bomMaterialId)}
                draftCreated={draftPoKeys.has(
                  `${requirement.purchaseOrderId}::${requirement.vendorId || ""}`,
                )}
                vendors={vendors}
                canAssignVendor={canAssignVendor}
              />
            ))}
            {!group.requirements.length ? (
              <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning-foreground">
                No generated material requirements yet. Link this PO to a BOM to generate them.
              </div>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function RequirementRow({
  requirement,
  order,
  bomMaterial,
  draftCreated,
  vendors,
  canAssignVendor,
}: {
  requirement: MaterialRequirement;
  order: PurchaseOrder;
  bomMaterial: BomMaterial | undefined;
  draftCreated: boolean;
  vendors: Vendor[];
  canAssignVendor: boolean;
}) {
  return (
    <div className="rounded-md border border-border bg-muted/20 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="break-words font-medium text-foreground">{requirement.materialName}</div>
          <div className="mt-1 text-sm text-muted-foreground">
            {[bomMaterial?.category, requirement.specification].filter(Boolean).join(" - ") ||
              "No specification"}
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <StatusBadge status={requirement.quantityStatus} />
          <StatusBadge
            status={requirement.calculationType || bomMaterial?.calculationType || "Per Pair"}
          />
          {requirement.sizeLabel ? <StatusBadge status={requirement.sizeLabel} /> : null}
          <StatusBadge status={requirement.vendorId ? "Vendor Assigned" : "Unassigned Vendor"} />
          {draftCreated ? <StatusBadge status="Draft Material PO" /> : null}
          {requirement.balanceQuantity <= 0 ? (
            <StatusBadge status="Received" />
          ) : (
            <StatusBadge status="Outstanding Balance" />
          )}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Metric
          label="Required"
          value={`${formatQty(requirement.requiredQuantity)} ${requirement.unit}`}
        />
        <Metric
          label="Ordered"
          value={`${formatQty(requirement.orderedQuantity)} ${requirement.unit}`}
        />
        <Metric
          label="Balance"
          value={`${formatQty(requirement.balanceQuantity)} ${requirement.unit}`}
        />
        <Metric label="Unit" value={requirement.unit || "-"} />
        <Metric label="Vendor" value={requirement.vendorName || "Unassigned"} />
        <Metric label="Size" value={requirement.sizeLabel || "-"} />
        <Metric
          label="Calculation"
          value={requirement.calculationType || bomMaterial?.calculationType || "Per Pair"}
        />
        <Metric label="Wastage" value={`${Number(bomMaterial?.wastagePercent ?? 0)}%`} />
      </div>
      {canAssignVendor && bomMaterial ? (
        <div className="mt-3">
          <VendorAssignmentCell material={bomMaterial} vendors={vendors} />
        </div>
      ) : null}
    </div>
  );
}

function InventoryMaterialCard({
  group,
  expanded,
  onToggle,
  orderById,
  bomById,
  draftPoKeys,
}: {
  group: InventoryGroup;
  expanded: boolean;
  onToggle: () => void;
  orderById: Map<string, PurchaseOrder>;
  bomById: Map<string, BomMaterial>;
  draftPoKeys: Set<string>;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <button
            type="button"
            className="flex min-w-0 flex-1 items-start gap-3 text-left"
            onClick={onToggle}
          >
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted/30">
              {expanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </span>
            <span className="min-w-0">
              <CardTitle className="break-words text-lg">{group.materialName}</CardTitle>
              <span className="mt-1 block text-sm text-muted-foreground">
                {group.category || "No category"} - {group.vendorName || "Unassigned Vendor"} - used
                by {group.purchaseOrderIds.length} PO(s)
              </span>
            </span>
          </button>
          <div className="flex flex-wrap justify-end gap-2">
            {!group.vendorId ? <StatusBadge status="Unassigned Vendor" /> : null}
            {group.balanceQuantity > 0 ? (
              <StatusBadge status="Outstanding Balance" />
            ) : (
              <StatusBadge status="Received" />
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-5">
          <Metric label="Required" value={`${formatQty(group.requiredQuantity)} ${group.unit}`} />
          <Metric label="Ordered" value={`${formatQty(group.orderedQuantity)} ${group.unit}`} />
          <Metric label="Received" value={`${formatQty(group.receivedQuantity)} ${group.unit}`} />
          <Metric label="Balance" value={`${formatQty(group.balanceQuantity)} ${group.unit}`} />
          <Metric label="Purchase Orders" value={String(group.purchaseOrderIds.length)} />
        </div>

        {expanded ? (
          <div className="mt-4 grid gap-3">
            {group.requirements.map((requirement) => {
              const order = orderById.get(requirement.purchaseOrderId);
              const bomMaterial = bomById.get(requirement.bomMaterialId);
              return (
                <div
                  key={requirement.id}
                  className="rounded-md border border-border bg-muted/20 p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <a
                        href={`/purchase-orders?po=${encodeURIComponent(requirement.purchaseOrderId)}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {order?.poNumber || "Open PO"}
                      </a>
                      <div className="mt-1 text-sm text-muted-foreground">
                        {order?.customerName || "-"} - {order?.styleCode || "-"} -{" "}
                        {order?.color || "-"}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <StatusBadge status={requirement.quantityStatus} />
                      {requirement.sizeLabel ? (
                        <StatusBadge status={requirement.sizeLabel} />
                      ) : null}
                      {draftPoKeys.has(
                        `${requirement.purchaseOrderId}::${requirement.vendorId || ""}`,
                      ) ? (
                        <StatusBadge status="Draft Material PO" />
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
                    <Metric
                      label="Required"
                      value={`${formatQty(requirement.requiredQuantity)} ${requirement.unit}`}
                    />
                    <Metric
                      label="Ordered"
                      value={`${formatQty(requirement.orderedQuantity)} ${requirement.unit}`}
                    />
                    <Metric
                      label="Balance"
                      value={`${formatQty(requirement.balanceQuantity)} ${requirement.unit}`}
                    />
                    <Metric label="Vendor" value={requirement.vendorName || "Unassigned"} />
                    <Metric label="Size" value={requirement.sizeLabel || "-"} />
                    <Metric
                      label="Calculation"
                      value={
                        requirement.calculationType || bomMaterial?.calculationType || "Per Pair"
                      }
                    />
                    <Metric
                      label="Wastage"
                      value={`${Number(bomMaterial?.wastagePercent ?? 0)}%`}
                    />
                    <Metric label="Delivery" value={order?.deliveryDate || "-"} />
                    <Metric label="Department" value={order?.currentStage || "-"} />
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function VendorAssignmentCell({ material, vendors }: { material: BomMaterial; vendors: Vendor[] }) {
  const updateVendor = useUpdateBomMaterialVendor();
  const [vendorId, setVendorId] = useState(material.defaultVendorId ?? "");

  const save = async (regenerateDrafts: boolean) => {
    try {
      const result = await updateVendor.mutateAsync({
        bomMaterialId: material.id,
        vendorId,
        regenerateDrafts,
      });
      const regenerated = result.regeneratedPurchaseOrderIds.length;
      toast.success(
        regenerated
          ? `Vendor assigned and ${regenerated} linked PO draft group(s) regenerated`
          : "Vendor assignment saved",
      );
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  return (
    <div className="grid gap-2 rounded-md border border-border bg-background p-3">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <span>Default Vendor</span>
        {!material.defaultVendorName ? (
          <AlertTriangle className="h-3.5 w-3.5 text-warning" />
        ) : null}
      </div>
      <select
        className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        value={vendorId}
        onChange={(event) => setVendorId(event.target.value)}
      >
        <option value="">Unassigned Vendor</option>
        {vendors
          .filter((vendor) => vendor.status === "Active")
          .map((vendor) => (
            <option key={vendor.id} value={vendor.id}>
              {vendor.vendorName}
            </option>
          ))}
      </select>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => void save(false)}
          disabled={updateVendor.isPending}
        >
          Save
        </Button>
        <Button size="sm" onClick={() => void save(true)} disabled={updateVendor.isPending}>
          Save + Regenerate
        </Button>
      </div>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-muted/20 p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-foreground">{value.toLocaleString()}</div>
    </div>
  );
}

function FilterPanel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-5 grid gap-3 rounded-md border border-border bg-muted/20 p-4 md:grid-cols-2 xl:grid-cols-6">
      {children}
    </div>
  );
}

function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="grid gap-1.5 md:col-span-2">
      <label className="text-sm font-medium text-foreground">Search</label>
      <div className="flex items-center gap-2 rounded-md border border-input bg-background px-3">
        <Search className="h-4 w-4 text-muted-foreground" />
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="border-0 px-0 shadow-none focus-visible:ring-0"
        />
      </div>
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly string[];
}) {
  return (
    <div className="grid gap-1.5">
      <label className="text-sm font-medium text-foreground">{label}</label>
      <select
        className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}

function EmptyCard({ text }: { text: string }) {
  return (
    <Card>
      <CardContent className="p-6 text-sm text-muted-foreground">{text}</CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-background/70 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 truncate font-medium text-foreground">{value}</div>
    </div>
  );
}

function groupBy<T extends Record<K, string>, K extends keyof T>(items: T[], key: K) {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const values = map.get(item[key]) ?? [];
    values.push(item);
    map.set(item[key], values);
  }
  return map;
}

function toggleSetValue(current: Set<string>, value: string) {
  const next = new Set(current);
  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }
  return next;
}

function materialStatus(requirements: MaterialRequirement[]) {
  if (!requirements.length) return "BOM Missing";
  if (requirements.some((item) => item.quantityStatus === "Needs manual quantity")) {
    return "Needs Manual Quantity";
  }
  if (requirements.every((item) => item.balanceQuantity <= 0)) return "Received";
  return "Calculated";
}

function vendorStatus(requirements: MaterialRequirement[]) {
  if (!requirements.length) return "BOM Missing";
  return requirements.some((item) => !item.vendorId) ? "Unassigned Vendor" : "Vendor Assigned";
}

function deliveryState(order: PurchaseOrder): DeliveryFilter {
  if (order.status === "Delayed") return "Delayed";
  const today = new Date().toISOString().slice(0, 10);
  if (order.deliveryDate < today && !["Ready To Ship", "Shipped"].includes(order.status)) {
    return "Delayed";
  }
  const soon = new Date();
  soon.setDate(soon.getDate() + 7);
  if (order.deliveryDate <= soon.toISOString().slice(0, 10)) return "Due Soon";
  return "On Track";
}

function buildInventoryGroups(
  requirements: MaterialRequirement[],
  orderById: Map<string, PurchaseOrder>,
  bomById: Map<string, BomMaterial>,
) {
  const groups = new Map<string, InventoryGroup>();
  for (const requirement of requirements) {
    const bomMaterial = bomById.get(requirement.bomMaterialId);
    const order = orderById.get(requirement.purchaseOrderId);
    const category = bomMaterial?.category ?? "";
    const vendorName = requirement.vendorName || "Unassigned Vendor";
    const key = [
      requirement.materialName.trim().toLowerCase(),
      category.trim().toLowerCase(),
      requirement.unit.trim().toLowerCase(),
      requirement.vendorId || "unassigned",
    ].join("::");
    const group =
      groups.get(key) ??
      ({
        key,
        materialName: requirement.materialName,
        category,
        vendorId: requirement.vendorId,
        vendorName,
        unit: requirement.unit,
        requiredQuantity: 0,
        orderedQuantity: 0,
        receivedQuantity: 0,
        balanceQuantity: 0,
        requirements: [],
        purchaseOrderIds: [],
      } satisfies InventoryGroup);
    group.requiredQuantity += Number(requirement.requiredQuantity || 0);
    group.orderedQuantity += Number(requirement.orderedQuantity || 0);
    group.receivedQuantity += Number(requirement.receivedQuantity || 0);
    group.balanceQuantity += Number(requirement.balanceQuantity || 0);
    group.requirements.push(requirement);
    if (order && !group.purchaseOrderIds.includes(order.id)) {
      group.purchaseOrderIds.push(order.id);
    }
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => a.materialName.localeCompare(b.materialName));
}

function formatQty(value: number) {
  return Number(value || 0).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });
}
