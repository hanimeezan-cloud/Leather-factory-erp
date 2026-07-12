import { createFileRoute, type NavigateFn, useNavigate } from "@tanstack/react-router";
import { Building2, CalendarDays, ClipboardList, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { EditButton, NewButton, RecordDialog, type FieldDef } from "@/components/record-dialog";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import {
  useCreateCustomer,
  useCustomers,
  useProductionTimeline,
  usePurchaseOrders,
  useUpdateCustomer,
} from "@/lib/data-hooks";
import { CUSTOMER_STATUSES, type Customer, type PurchaseOrder, type Role } from "@/lib/domain";
import { buildProductionPlan, formatPlanDate } from "@/lib/production-intelligence";

export const Route = createFileRoute("/customers")({
  head: () => ({
    meta: [
      { title: "Customers - Footwear Production Hub" },
      {
        name: "description",
        content: "Customer master records and purchase order history.",
      },
    ],
  }),
  component: CustomersPage,
});

const emptyCustomer: Customer = {
  id: "",
  customerName: "",
  brand: "",
  contactPerson: "",
  email: "",
  phone: "",
  country: "",
  notes: "",
  status: "Active",
};

const customerFields: FieldDef[] = [
  { name: "customerName", label: "Customer Name", required: true },
  { name: "brand", label: "Brand" },
  { name: "contactPerson", label: "Contact Person" },
  { name: "email", label: "Email" },
  { name: "phone", label: "Phone" },
  { name: "country", label: "Country" },
  { name: "status", label: "Status", type: "select", options: CUSTOMER_STATUSES },
  { name: "notes", label: "Notes / History", type: "textarea" },
];

function canEditCustomers(role: Role | null | undefined) {
  return role === "Owner" || role === "Planning" || role === "Sales";
}

function CustomersPage() {
  const { profile } = useAuth();
  const [search, setSearch] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const { data: customers = [], isLoading, error } = useCustomers();
  const { data: purchaseOrders = [] } = usePurchaseOrders();
  const createCustomer = useCreateCustomer();
  const updateCustomer = useUpdateCustomer();
  const canEdit = canEditCustomers(profile?.role);

  const ordersByCustomer = useMemo(() => {
    const map = new Map<string, PurchaseOrder[]>();
    for (const order of purchaseOrders) {
      const orders = map.get(order.customerId) ?? [];
      orders.push(order);
      map.set(order.customerId, orders);
    }
    return map;
  }, [purchaseOrders]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return customers
      .map((customer) => ({
        customer,
        orders: ordersByCustomer.get(customer.id) ?? [],
      }))
      .filter(({ customer }) => {
        if (!query) return true;
        return [
          customer.customerName,
          customer.brand,
          customer.country,
          customer.contactPerson,
          customer.email,
        ]
          .join(" ")
          .toLowerCase()
          .includes(query);
      });
  }, [customers, ordersByCustomer, search]);

  const saveNewCustomer = async (customer: Customer) => {
    const { id, createdAt, updatedAt, ...payload } = customer;
    void id;
    void createdAt;
    void updatedAt;
    await createCustomer.mutateAsync(payload);
  };

  return (
    <div>
      <PageHeader
        title="Customers"
        description="Search customers, review order history, and keep customer master data current."
        actions={
          canEdit ? (
            <RecordDialog
              title="New Customer"
              fields={customerFields}
              initial={emptyCustomer}
              onSubmit={saveNewCustomer}
              trigger={<NewButton label="New Customer" />}
            />
          ) : null
        }
      />

      {error ? (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {(error as Error).message}
        </div>
      ) : null}

      <div className="mb-5 flex max-w-xl items-center gap-2 rounded-md border border-input bg-background px-3">
        <Search className="h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search customers, brands, contacts, email..."
          className="border-0 px-0 shadow-none focus-visible:ring-0"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {filtered.map(({ customer, orders }) => (
          <CustomerCard
            key={customer.id}
            customer={customer}
            orders={orders}
            canEdit={canEdit}
            onSelect={() => setSelectedCustomer(customer)}
            onSave={async (values) => {
              await updateCustomer.mutateAsync(values);
            }}
          />
        ))}
        {!isLoading && filtered.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              No customers match this search.
            </CardContent>
          </Card>
        ) : null}
      </div>

      {selectedCustomer ? (
        <CustomerDetail
          customer={selectedCustomer}
          orders={ordersByCustomer.get(selectedCustomer.id) ?? []}
          onClose={() => setSelectedCustomer(null)}
        />
      ) : null}
    </div>
  );
}

function CustomerCard({
  customer,
  orders,
  canEdit,
  onSelect,
  onSave,
}: {
  customer: Customer;
  orders: PurchaseOrder[];
  canEdit: boolean;
  onSelect: () => void;
  onSave: (values: Customer) => void | Promise<void>;
}) {
  const activeOrders = orders.filter((order) => order.status !== "Shipped");
  const completedOrders = orders.filter((order) => order.status === "Shipped");
  const delayedOrders = orders.filter((order) => order.status === "Delayed");
  const nextActiveOrder = activeOrders
    .filter((order) => order.status !== "Shipped")
    .sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate))[0];
  const plan = nextActiveOrder ? buildProductionPlan({ order: nextActiveOrder }) : null;
  const lastOrderDate = orders
    .map((order) => order.poDate || order.deliveryDate)
    .sort((a, b) => b.localeCompare(a))[0];

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onSelect();
      }}
      className="cursor-pointer transition-colors hover:border-primary/50"
    >
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Building2 className="h-5 w-5 text-primary" />
            <span className="truncate">{customer.customerName}</span>
          </CardTitle>
          <div className="mt-1 text-sm text-muted-foreground">
            {customer.brand || "No brand set"} {customer.country ? `- ${customer.country}` : ""}
          </div>
        </div>
        <div className="flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
          <StatusBadge status={customer.status} />
          {canEdit ? (
            <RecordDialog
              title="Edit Customer"
              fields={customerFields}
              initial={customer}
              onSubmit={onSave}
              trigger={<EditButton />}
            />
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <Metric label="Active" value={activeOrders.length} />
          <Metric label="Previous" value={completedOrders.length} />
          <Metric
            label="Delayed"
            value={delayedOrders.length}
            tone={delayedOrders.length ? "danger" : "default"}
          />
        </div>
        <div className="grid gap-2 text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <ClipboardList className="h-4 w-4" />
            {orders.length ? `${orders.length} total purchase orders` : "No purchase orders yet"}
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <CalendarDays className="h-4 w-4" />
            {lastOrderDate ? `Last order ${lastOrderDate}` : "No order history yet"}
          </div>
        </div>
        {customer.notes ? (
          <p className="line-clamp-2 text-sm text-muted-foreground">{customer.notes}</p>
        ) : null}
        {nextActiveOrder && plan ? (
          <div className="rounded-md border border-border bg-background p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-medium text-foreground">
                {nextActiveOrder.poNumber} - {plan.currentStage}
              </div>
              <div className="flex flex-wrap gap-2">
                <StatusBadge status={plan.shipmentRisk} />
                <StatusBadge status={`${plan.progressPercent}%`} />
              </div>
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              Estimated finish {formatPlanDate(plan.estimatedCompletionDate)}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Metric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "danger";
}) {
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={
          tone === "danger" ? "text-xl font-semibold text-destructive" : "text-xl font-semibold"
        }
      >
        {value}
      </div>
    </div>
  );
}

function CustomerDetail({
  customer,
  orders,
  onClose,
}: {
  customer: Customer;
  orders: PurchaseOrder[];
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const activeOrders = useMemo(
    () =>
      orders
        .filter((order) => order.status !== "Shipped")
        .sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate)),
    [orders],
  );
  const primaryOrder = activeOrders[0] ?? orders[0];
  const { data: timelinePreview = [] } = useProductionTimeline(primaryOrder?.id);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 px-4 py-6"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-md border border-border bg-background p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-foreground">{customer.customerName}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {customer.brand || "No brand set"} {customer.country ? `- ${customer.country}` : ""}
            </p>
          </div>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>

        <div className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
          <InfoLine label="Contact" value={customer.contactPerson || "-"} />
          <InfoLine label="Email" value={customer.email || "-"} />
          <InfoLine label="Phone" value={customer.phone || "-"} />
          <InfoLine label="Status" value={customer.status} />
        </div>

        {customer.notes ? (
          <div className="mt-5 rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
            {customer.notes}
          </div>
        ) : null}

        {primaryOrder ? (
          <div className="mt-6 rounded-md border border-border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-foreground">Current Order Snapshot</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Quick answer for customer status calls.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => openPurchaseOrder(navigate, onClose, primaryOrder.id)}
              >
                Open PO
              </Button>
            </div>
            <CustomerOrderPlan order={primaryOrder} />
            <div className="mt-4">
              <div className="text-sm font-medium text-foreground">Timeline Preview</div>
              <div className="mt-2 grid gap-2">
                {timelinePreview.slice(0, 3).map((event) => (
                  <div key={event.id} className="rounded-md bg-muted/40 p-2 text-sm">
                    <div className="font-medium text-foreground">{event.eventTitle}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {new Date(event.createdAt).toLocaleString()}
                    </div>
                  </div>
                ))}
                {!timelinePreview.length ? (
                  <div className="rounded-md bg-muted/40 p-2 text-sm text-muted-foreground">
                    No timeline events yet.
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        <div className="mt-6">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Purchase Orders
          </h3>
          <div className="mt-3 overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">PO Number</th>
                  <th className="px-4 py-3">Article</th>
                  <th className="px-4 py-3">Qty</th>
                  <th className="px-4 py-3">Department</th>
                  <th className="px-4 py-3">Progress</th>
                  <th className="px-4 py-3">Risk</th>
                  <th className="px-4 py-3">Delivery</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr
                    key={order.id}
                    role="button"
                    tabIndex={0}
                    className="cursor-pointer border-t border-border hover:bg-muted/40"
                    onClick={() => openPurchaseOrder(navigate, onClose, order.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        openPurchaseOrder(navigate, onClose, order.id);
                      }
                    }}
                  >
                    <td className="px-4 py-3 font-medium">{order.poNumber}</td>
                    <td className="px-4 py-3">{order.article || order.styleCode}</td>
                    <td className="px-4 py-3">{order.quantity.toLocaleString()}</td>
                    <td className="px-4 py-3">{order.currentStage || "Cutting"}</td>
                    <td className="px-4 py-3">{buildProductionPlan({ order }).progressPercent}%</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={buildProductionPlan({ order }).shipmentRisk} />
                    </td>
                    <td className="px-4 py-3">{order.deliveryDate}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={order.status} />
                    </td>
                  </tr>
                ))}
                {!orders.length ? (
                  <tr className="border-t border-border">
                    <td className="px-4 py-6 text-muted-foreground" colSpan={8}>
                      No purchase orders yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function CustomerOrderPlan({ order }: { order: PurchaseOrder }) {
  const plan = buildProductionPlan({ order });
  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <InfoLine label="Department" value={plan.currentStage} />
      <InfoLine label="Progress" value={`${plan.progressPercent}%`} />
      <InfoLine label="Estimated Finish" value={formatPlanDate(plan.estimatedCompletionDate)} />
      <div className="rounded-md border border-border p-3">
        <div className="text-xs text-muted-foreground">Shipment Risk</div>
        <div className="mt-2">
          <StatusBadge status={plan.shipmentRisk} />
        </div>
      </div>
    </div>
  );
}

function openPurchaseOrder(navigate: NavigateFn, onClose: () => void, orderId: string) {
  onClose();
  void navigate({ to: "/purchase-orders", search: { po: orderId } });
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-medium text-foreground">{value}</div>
    </div>
  );
}
