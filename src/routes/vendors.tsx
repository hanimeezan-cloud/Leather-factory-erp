import { createFileRoute } from "@tanstack/react-router";
import { Handshake, Mail, Package, Phone, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { EditButton, NewButton, RecordDialog, type FieldDef } from "@/components/record-dialog";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import {
  useBomMaterials,
  useCreateVendor,
  useMaterialPurchaseOrders,
  useUpdateVendor,
  useVendors,
} from "@/lib/data-hooks";
import {
  VENDOR_STATUSES,
  type BomMaterial,
  type MaterialPurchaseOrder,
  type Vendor,
} from "@/lib/domain";

export const Route = createFileRoute("/vendors")({
  head: () => ({
    meta: [
      { title: "Vendors - Footwear Production Hub" },
      {
        name: "description",
        content: "Vendor directory and material assignment visibility.",
      },
    ],
  }),
  component: VendorsPage,
});

type VendorFormValues = Omit<Vendor, "materialCategories"> & {
  materialCategories: string;
};

const emptyVendor: VendorFormValues = {
  id: "",
  vendorName: "",
  contactPerson: "",
  email: "",
  phone: "",
  address: "",
  materialCategories: "",
  notes: "",
  status: "Active",
};

const vendorFields: FieldDef[] = [
  { name: "vendorName", label: "Vendor Name", required: true },
  { name: "contactPerson", label: "Contact Person" },
  { name: "email", label: "Email" },
  { name: "phone", label: "Phone" },
  { name: "address", label: "Address", type: "textarea" },
  { name: "materialCategories", label: "Material Categories (comma-separated)" },
  { name: "status", label: "Status", type: "select", options: VENDOR_STATUSES },
  { name: "notes", label: "Notes", type: "textarea" },
];

function canEditVendors(role: string | null | undefined) {
  return role === "Owner" || role === "Management" || role === "Planning" || role === "Purchasing";
}

function vendorToForm(vendor: Vendor): VendorFormValues {
  return {
    ...vendor,
    materialCategories: vendor.materialCategories.join(", "),
  };
}

function VendorsPage() {
  const { profile } = useAuth();
  const { data: vendors = [], isLoading, error } = useVendors();
  const { data: bomMaterials = [] } = useBomMaterials();
  const { data: materialPos = [] } = useMaterialPurchaseOrders();
  const createVendor = useCreateVendor();
  const updateVendor = useUpdateVendor();
  const [search, setSearch] = useState("");
  const [selectedVendor, setSelectedVendor] = useState<Vendor | null>(null);
  const canEdit = canEditVendors(profile?.role);

  const filteredVendors = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return vendors;
    return vendors.filter((vendor) =>
      [
        vendor.vendorName,
        vendor.contactPerson,
        vendor.email,
        vendor.phone,
        vendor.address,
        vendor.materialCategories.join(" "),
        vendor.status,
      ]
        .join(" ")
        .toLowerCase()
        .includes(term),
    );
  }, [search, vendors]);

  return (
    <div>
      <PageHeader
        title="Vendors"
        description="Vendor directory for style-level material assignments and Draft Material POs."
        actions={
          canEdit ? (
            <RecordDialog
              title="New Vendor"
              fields={vendorFields}
              initial={emptyVendor}
              onSubmit={async (values) => {
                await createVendor.mutateAsync(values);
                toast.success("Vendor saved");
              }}
              trigger={<NewButton label="New Vendor" />}
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
          placeholder="Search vendors, contacts, email, phone, categories..."
          className="border-0 px-0 shadow-none focus-visible:ring-0"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {filteredVendors.map((vendor) => (
          <VendorCard
            key={vendor.id}
            vendor={vendor}
            canEdit={canEdit}
            bomMaterials={bomMaterials.filter((material) => material.defaultVendorId === vendor.id)}
            materialPos={materialPos.filter(
              (materialPo) => materialPo.vendorId === vendor.id && materialPo.status === "Draft",
            )}
            onSelect={() => setSelectedVendor(vendor)}
            onSave={async (values) => {
              await updateVendor.mutateAsync({ ...values, id: vendor.id });
              toast.success("Vendor updated");
            }}
          />
        ))}
        {isLoading ? (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              Loading vendors...
            </CardContent>
          </Card>
        ) : null}
        {!isLoading && !filteredVendors.length ? (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              {vendors.length ? "No vendors match this search." : "No vendors saved yet."}
            </CardContent>
          </Card>
        ) : null}
      </div>

      {selectedVendor ? (
        <VendorDetail
          vendor={selectedVendor}
          bomMaterials={bomMaterials.filter(
            (material) => material.defaultVendorId === selectedVendor.id,
          )}
          materialPos={materialPos.filter(
            (materialPo) =>
              materialPo.vendorId === selectedVendor.id && materialPo.status === "Draft",
          )}
          onClose={() => setSelectedVendor(null)}
        />
      ) : null}
    </div>
  );
}

function VendorCard({
  vendor,
  canEdit,
  bomMaterials,
  materialPos,
  onSelect,
  onSave,
}: {
  vendor: Vendor;
  canEdit: boolean;
  bomMaterials: BomMaterial[];
  materialPos: MaterialPurchaseOrder[];
  onSelect: () => void;
  onSave: (values: VendorFormValues) => void | Promise<void>;
}) {
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
            <Handshake className="h-5 w-5 text-primary" />
            <span className="truncate">{vendor.vendorName}</span>
          </CardTitle>
          <div className="mt-1 text-sm text-muted-foreground">
            {vendor.contactPerson || "No contact person"}
          </div>
        </div>
        <div className="flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
          <StatusBadge status={vendor.status} />
          {canEdit ? (
            <RecordDialog
              title="Edit Vendor"
              fields={vendorFields}
              initial={vendorToForm(vendor)}
              onSubmit={onSave}
              trigger={<EditButton />}
            />
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <Metric label="BOM Materials" value={String(bomMaterials.length)} />
          <Metric label="Draft POs" value={String(materialPos.length)} />
          <Metric label="Categories" value={vendor.materialCategories.length.toString()} />
        </div>
        <div className="grid gap-2 text-sm text-muted-foreground">
          <ContactLine icon={Mail} value={vendor.email || "No email"} />
          <ContactLine icon={Phone} value={vendor.phone || "No phone"} />
          <div className="line-clamp-2">
            {vendor.materialCategories.length
              ? vendor.materialCategories.join(", ")
              : "No material categories set"}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function VendorDetail({
  vendor,
  bomMaterials,
  materialPos,
  onClose,
}: {
  vendor: Vendor;
  bomMaterials: BomMaterial[];
  materialPos: MaterialPurchaseOrder[];
  onClose: () => void;
}) {
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
            <h2 className="text-xl font-semibold text-foreground">{vendor.vendorName}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {vendor.contactPerson || "No contact person"} - {vendor.email || "No email"}
            </p>
          </div>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Status" value={vendor.status} />
          <Metric label="Phone" value={vendor.phone || "-"} />
          <Metric label="BOM Materials" value={String(bomMaterials.length)} />
          <Metric label="Draft POs" value={String(materialPos.length)} />
        </div>

        <div className="mt-5 grid gap-3">
          <InfoBlock label="Address" value={vendor.address || "-"} />
          <InfoBlock
            label="Categories"
            value={vendor.materialCategories.length ? vendor.materialCategories.join(", ") : "-"}
          />
          <InfoBlock label="Notes" value={vendor.notes || "-"} />
        </div>

        <div className="mt-6 overflow-x-auto rounded-md border border-border">
          <div className="border-b border-border p-3">
            <h3 className="font-semibold text-foreground">Linked BOM Materials</h3>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Style</th>
                <th className="px-4 py-3">Material</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Consumption</th>
              </tr>
            </thead>
            <tbody>
              {bomMaterials.map((material) => (
                <tr key={material.id} className="border-t border-border">
                  <td className="px-4 py-3 font-medium">
                    {[material.styleCode, material.color, material.brand]
                      .filter(Boolean)
                      .join(" / ") || "-"}
                  </td>
                  <td className="px-4 py-3">{material.materialName}</td>
                  <td className="px-4 py-3">{material.category || "-"}</td>
                  <td className="px-4 py-3">
                    {Number(material.consumptionPerPair || 0).toLocaleString()}{" "}
                    {material.unit || ""}
                  </td>
                </tr>
              ))}
              {!bomMaterials.length ? (
                <tr className="border-t border-border">
                  <td className="px-4 py-6 text-muted-foreground" colSpan={4}>
                    No BOM materials are assigned to this vendor yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="mt-6 overflow-x-auto rounded-md border border-border">
          <div className="border-b border-border p-3">
            <h3 className="font-semibold text-foreground">Linked Draft Material POs</h3>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Material PO</th>
                <th className="px-4 py-3">Customer PO</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Items</th>
              </tr>
            </thead>
            <tbody>
              {materialPos.map((materialPo) => (
                <tr key={materialPo.id} className="border-t border-border">
                  <td className="px-4 py-3 font-medium">{materialPo.materialPoNumber}</td>
                  <td className="px-4 py-3">
                    <a
                      href={`/purchase-orders?po=${encodeURIComponent(materialPo.purchaseOrderId)}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {materialPo.poNumber || "Open PO"}
                    </a>
                  </td>
                  <td className="px-4 py-3">{materialPo.customerName || "-"}</td>
                  <td className="px-4 py-3">{materialPo.itemCount}</td>
                </tr>
              ))}
              {!materialPos.length ? (
                <tr className="border-t border-border">
                  <td className="px-4 py-6 text-muted-foreground" colSpan={4}>
                    No Draft Material POs are assigned to this vendor yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ContactLine({ icon: Icon, value }: { icon: typeof Mail; value: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="truncate">{value}</span>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 truncate font-medium text-foreground">{value}</div>
    </div>
  );
}

function InfoBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 whitespace-pre-wrap text-foreground">{value}</div>
    </div>
  );
}
