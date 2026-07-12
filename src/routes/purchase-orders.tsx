import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleDot,
  ClipboardList,
  History,
  ImageIcon,
  Pencil,
  Plus,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import { EditButton, NewButton, RecordDialog, type FieldDef } from "@/components/record-dialog";
import { ImportTemplateDialog } from "@/components/import-template-dialog";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { uploadPoImage } from "@/lib/api-client";
import { useAuth } from "@/lib/auth";
import { apiBaseUrl, isDemoMode } from "@/lib/app-config";
import { cn } from "@/lib/utils";
import {
  useCreatePurchaseOrder,
  useCreateDailyLog,
  useCustomers,
  useDailyLogs,
  useLinkPurchaseOrderStyle,
  useMaterialPurchaseOrders,
  useMaterialRequirements,
  useMovePurchaseOrderStage,
  useProductionTimeline,
  usePurchaseOrders,
  useRegeneratePurchaseOrderDomino,
  useSetFinalApproval,
  useStyles,
  useUpdateDailyLog,
  useUpdatePurchaseOrder,
} from "@/lib/data-hooks";
import {
  PO_STATUSES,
  PRODUCTION_STAGE_STATUSES,
  PRODUCTION_STAGES,
  canApproveFinal,
  canMoveProductionStage,
  nextProductionStage,
  DAILY_LOG_PRIORITIES,
  type DailyLog,
  type DailyLogPriority,
  type Customer,
  type MaterialPurchaseOrder,
  type MaterialRequirement,
  type POStatus,
  type PurchaseOrder,
  type PurchaseOrderSize,
  type ProductionStageStatus,
  type Role,
  type Style,
} from "@/lib/domain";
import { buildProductionPlan, formatPlanDate } from "@/lib/production-intelligence";

export const Route = createFileRoute("/purchase-orders")({
  head: () => ({
    meta: [
      { title: "Purchase Orders - Footwear Production Hub" },
      { name: "description", content: "Manage customer purchase orders and size breakdowns." },
    ],
  }),
  component: PurchaseOrdersPage,
});

const statusFields: FieldDef[] = [
  { name: "status", label: "Status", type: "select", options: PO_STATUSES },
  { name: "notes", label: "Notes", type: "textarea" },
];

function PurchaseOrdersPage() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const { data: purchaseOrders = [], isLoading, error } = usePurchaseOrders();
  const { data: customers = [] } = useCustomers();
  const createPO = useCreatePurchaseOrder();
  const updatePO = useUpdatePurchaseOrder();
  const [selectedOrder, setSelectedOrder] = useState<PurchaseOrder | null>(null);
  const [search, setSearch] = useState("");

  const canCreate =
    profile?.role === "Owner" || profile?.role === "Planning" || profile?.role === "Sales";
  const canEditAll = profile?.role === "Owner" || profile?.role === "Planning";
  const canEditStatus = canEditAll || profile?.role === "Purchasing";

  const queryParams =
    typeof window === "undefined"
      ? new URLSearchParams()
      : new URLSearchParams(window.location.search);
  const targetPoId = queryParams.get("po") || "";
  const statusFilter = queryParams.get("status") || "";
  const approvalFilter = queryParams.get("approval") || "";
  const materialFilter = queryParams.get("materials") || "";

  useEffect(() => {
    if (!targetPoId || selectedOrder || !purchaseOrders.length) return;
    const target = purchaseOrders.find((order) => order.id === targetPoId);
    if (target) setSelectedOrder(target);
  }, [purchaseOrders, selectedOrder, targetPoId]);

  useEffect(() => {
    if (!selectedOrder) return;
    const refreshed = purchaseOrders.find((order) => order.id === selectedOrder.id);
    if (refreshed && refreshed !== selectedOrder) setSelectedOrder(refreshed);
  }, [purchaseOrders, selectedOrder]);

  const sortedOrders = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filteredByQuery = purchaseOrders.filter((order) => {
      const statusMatches =
        !statusFilter ||
        (statusFilter === "active" && order.status !== "Shipped") ||
        (statusFilter === "delayed" && order.status === "Delayed") ||
        order.status.toLowerCase() === statusFilter.toLowerCase();
      const approvalMatches = !approvalFilter || (approvalFilter === "pending" && !order.approved);
      const materialMatches =
        !materialFilter || (materialFilter === "pending" && order.status === "Materials Pending");
      return statusMatches && approvalMatches && materialMatches;
    });
    const filtered = term
      ? filteredByQuery.filter((order) =>
          [
            order.poNumber,
            order.customerName,
            order.buyer,
            order.styleCode,
            order.styleName,
            order.article,
            order.brand,
            order.color,
            order.status,
          ]
            .join(" ")
            .toLowerCase()
            .includes(term),
        )
      : filteredByQuery;
    return [...filtered].sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate));
  }, [approvalFilter, materialFilter, purchaseOrders, search, statusFilter]);

  const handleImported = () => {
    queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
    queryClient.invalidateQueries({ queryKey: ["customers"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    queryClient.invalidateQueries({ queryKey: ["reports"] });
    queryClient.invalidateQueries({ queryKey: ["material-requirements"] });
    queryClient.invalidateQueries({ queryKey: ["material-pos"] });
    queryClient.invalidateQueries({ queryKey: ["production-timeline"] });
  };

  const activeFilters = [
    statusFilter ? `Status: ${statusFilter}` : "",
    approvalFilter ? `Approval: ${approvalFilter}` : "",
    materialFilter ? `Materials: ${materialFilter}` : "",
  ].filter(Boolean);

  const renderCreateActions = () =>
    canCreate ? (
      <>
        <ImportTemplateDialog
          kind="po"
          title="Import Standard Customer PO Template"
          description="Upload Footwear_Production_Hub_Import_Templates.xlsx with PO_Import and PO_Size_Breakdown sheets."
          buttonLabel="Import Excel"
          onImported={handleImported}
        />
        <PurchaseOrderForm
          title="New Purchase Order"
          customers={customers}
          initial={makeEmptyPurchaseOrder(customers[0])}
          trigger={<NewButton label="New PO" />}
          onSubmit={async (values) => {
            await createPO.mutateAsync(cleanPurchaseOrder(values));
            toast.success("Purchase order saved");
          }}
        />
      </>
    ) : null;

  const closeSelectedOrder = useCallback(() => {
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("po");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }
    setSelectedOrder(null);
  }, []);

  return (
    <div className="purchase-orders-fullscreen">
      <FactoryOfficeScene />
      <PurchaseOrderBoard
        orders={sortedOrders}
        isLoading={isLoading}
        hasPurchaseOrders={purchaseOrders.length > 0}
        error={error as Error | null}
        toolbar={
          <div className="po-board-toolbar">
            <div className="po-board-title-slip">
              <span>Purchase Orders</span>
              <small>Factory order board</small>
            </div>
            <label className="po-board-search-slip">
              <span>Search board</span>
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="PO, customer, style..."
              />
            </label>
            <div className="po-board-action-tags">{renderCreateActions()}</div>
            {activeFilters.length ? (
              <div className="po-board-filter-tags">
                {activeFilters.map((filter) => (
                  <span key={filter}>{filter}</span>
                ))}
              </div>
            ) : null}
          </div>
        }
        emptyActions={<div className="po-board-action-tags">{renderCreateActions()}</div>}
        focusOrderId={selectedOrder?.id || targetPoId}
        renderOrder={(order, registerBundle) => (
          <PurchaseOrderCard
            key={order.id}
            order={order}
            customers={customers}
            canEditAll={canEditAll}
            canEditStatus={canEditStatus}
            onBundleMount={registerBundle}
            onSelect={() => setSelectedOrder(order)}
            onUpdate={async (values) => {
              await updatePO.mutateAsync(cleanPurchaseOrder({ ...values, id: order.id }));
              toast.success("Purchase order updated");
            }}
            onStatusUpdate={async (values) => {
              await updatePO.mutateAsync({
                id: order.id,
                status: values.status,
                notes: values.notes,
              });
              toast.success("Purchase order updated");
            }}
          />
        )}
      />

      {selectedOrder ? (
        <PurchaseOrderDetail order={selectedOrder} onClose={closeSelectedOrder} />
      ) : null}
    </div>
  );
}

function FactoryOfficeScene() {
  return (
    <div className="po-office-scene" aria-hidden="true">
      <div className="po-office-lamp">
        <span className="po-office-lamp-cord" />
        <span className="po-office-lamp-shade" />
        <span className="po-office-lamp-bulb" />
      </div>

      <div className="po-office-poster po-office-poster--quality">
        <strong>Quality</strong>
        <span>is not an act</span>
        <span>it is a habit</span>
      </div>
      <div className="po-office-poster po-office-poster--safety">
        <strong>Safety today</strong>
        <span>Success tomorrow</span>
      </div>
      <div className="po-office-target-note">
        <strong>Daily target</strong>
        <span>Cutting</span>
        <span>Upper</span>
        <span>Bottom</span>
        <span>Packing</span>
      </div>

      <div className="po-office-dust" />

      <div className="po-office-desk">
        <span className="po-desk-notebook" />
        <span className="po-desk-pencil-cup">
          <i />
          <i />
          <i />
        </span>
        <span className="po-desk-form" />
        <span className="po-desk-stamp" />
        <span className="po-desk-paper-stack" />
      </div>
    </div>
  );
}

function PurchaseOrderBoard({
  orders,
  isLoading,
  hasPurchaseOrders,
  error,
  toolbar,
  emptyActions,
  focusOrderId,
  renderOrder,
}: {
  orders: PurchaseOrder[];
  isLoading: boolean;
  hasPurchaseOrders: boolean;
  error: Error | null;
  toolbar: ReactNode;
  emptyActions: ReactNode;
  focusOrderId?: string;
  renderOrder: (
    order: PurchaseOrder,
    registerBundle: (node: HTMLElement | null) => void,
  ) => ReactNode;
}) {
  const boardRef = useRef<HTMLDivElement | null>(null);
  const bundleRefs = useRef<Set<HTMLElement>>(new Set());
  const pointerRef = useRef({ x: 0, y: 0 });
  const frameRef = useRef<number | null>(null);
  const hoverIntentBundleRef = useRef<HTMLElement | null>(null);
  const hoverIntentTimerRef = useRef<number | null>(null);
  const reducedMotionRef = useRef(false);
  const pageSize = useBoardPageSize();
  const [requestedPage, setRequestedPage] = useState(readStoredBoardPage);

  const pages = useMemo(() => {
    const nextPages: PurchaseOrder[][] = [];
    for (let index = 0; index < orders.length; index += pageSize) {
      nextPages.push(orders.slice(index, index + pageSize));
    }
    return nextPages;
  }, [orders, pageSize]);

  const pageCount = Math.max(1, pages.length);
  const activePage = Math.min(requestedPage, pageCount - 1);

  const clearHoverIntent = useCallback(() => {
    if (hoverIntentTimerRef.current !== null) {
      window.clearTimeout(hoverIntentTimerRef.current);
      hoverIntentTimerRef.current = null;
    }
    hoverIntentBundleRef.current?.classList.remove("is-hover-intent");
    hoverIntentBundleRef.current = null;
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem("po-cork-board-page", String(requestedPage));
    }
  }, [requestedPage]);

  useEffect(() => {
    if (!focusOrderId) return;
    const orderIndex = orders.findIndex((order) => order.id === focusOrderId);
    if (orderIndex >= 0) setRequestedPage(Math.floor(orderIndex / pageSize));
  }, [focusOrderId, orders, pageSize]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const setReducedMotion = () => {
      reducedMotionRef.current = media.matches;
      if (media.matches && boardRef.current) resetBoardProximity(boardRef.current);
    };
    setReducedMotion();
    media.addEventListener("change", setReducedMotion);
    return () => {
      media.removeEventListener("change", setReducedMotion);
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      clearHoverIntent();
    };
  }, [clearHoverIntent]);

  useEffect(() => clearHoverIntent, [activePage, clearHoverIntent]);

  const updateProximity = useCallback(() => {
    frameRef.current = null;
    const board = boardRef.current;
    if (!board || reducedMotionRef.current) return;
    updateBoardProximity(board, bundleRefs.current, pointerRef.current);
  }, []);

  const registerBundle = useCallback((node: HTMLElement | null) => {
    if (node) bundleRefs.current.add(node);
  }, []);

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const currentBundle = hoverIntentBundleRef.current;
    const currentRect = currentBundle?.getBoundingClientRect();
    const remainsOnCurrentBundle =
      currentRect &&
      event.clientX >= currentRect.left - 8 &&
      event.clientX <= currentRect.right + 8 &&
      event.clientY >= currentRect.top - 8 &&
      event.clientY <= currentRect.bottom + 8;

    if (currentBundle && !remainsOnCurrentBundle) clearHoverIntent();

    if (!hoverIntentBundleRef.current) {
      const pointerBundle = (event.target as Element).closest<HTMLElement>(".po-bundle");
      clearHoverIntent();
      if (pointerBundle && boardRef.current?.contains(pointerBundle)) {
        hoverIntentBundleRef.current = pointerBundle;
        hoverIntentTimerRef.current = window.setTimeout(() => {
          hoverIntentBundleRef.current?.classList.add("is-hover-intent");
          hoverIntentTimerRef.current = null;
        }, 850);
      }
    }

    if (reducedMotionRef.current) return;
    pointerRef.current = { x: event.clientX, y: event.clientY };
    if (frameRef.current === null) {
      frameRef.current = window.requestAnimationFrame(updateProximity);
    }
  };

  const handlePointerLeave = () => {
    clearHoverIntent();
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    if (boardRef.current) resetBoardProximity(boardRef.current);
  };

  const showPreviousBoard = () => setRequestedPage(Math.max(0, activePage - 1));
  const showNextBoard = () => setRequestedPage(Math.min(pageCount - 1, activePage + 1));

  return (
    <section className="po-board-frame" aria-label="Purchase order cork board">
      <div
        ref={boardRef}
        className="purchase-order-cork-board"
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
      >
        {toolbar}
        {error ? <div className="po-board-error-slip">{error.message}</div> : null}
        <div className="po-board-carousel">
          <div
            className="po-board-track"
            style={{ transform: `translate3d(-${activePage * 100}%, 0, 0)` }}
          >
            {isLoading ? (
              <section
                className="po-board-page"
                data-page-size={pageSize}
                aria-label="Loading board"
              >
                <CorkBoardEnvironment />
                <div className="po-board-grid">
                  {Array.from({ length: pageSize }, (_, index) => (
                    <div
                      key={`purchase-order-board-skeleton-${index}`}
                      className="po-bundle-skeleton"
                      aria-hidden="true"
                    />
                  ))}
                </div>
              </section>
            ) : null}

            {!isLoading && pages.length
              ? pages.map((pageOrders, pageIndex) => (
                  <section
                    key={pageOrders[0]?.id || `purchase-order-board-${pageIndex}`}
                    className="po-board-page"
                    data-page-size={pageSize}
                    aria-label={`Cork board ${pageIndex + 1} of ${pageCount}`}
                    aria-hidden={pageIndex !== activePage}
                    inert={pageIndex !== activePage}
                  >
                    <CorkBoardEnvironment />
                    <div className="po-board-grid">
                      {pageOrders.map((order) => renderOrder(order, registerBundle))}
                    </div>
                  </section>
                ))
              : null}

            {!isLoading && orders.length === 0 ? (
              <section className="po-board-page" data-page-size={pageSize} aria-label="Empty board">
                <CorkBoardEnvironment />
                <div className="po-board-empty">
                  <ClipboardList className="h-8 w-8 text-primary" />
                  <div>
                    <h2 className="font-semibold text-foreground">
                      {hasPurchaseOrders
                        ? "No matching purchase orders."
                        : "No purchase orders pinned yet."}
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {hasPurchaseOrders
                        ? "Adjust the search or page filters to see a different set of orders."
                        : "Create or import a customer purchase order to start the factory planning board."}
                    </p>
                  </div>
                  {!hasPurchaseOrders && emptyActions ? (
                    <div className="flex flex-wrap gap-2">{emptyActions}</div>
                  ) : null}
                </div>
              </section>
            ) : null}
          </div>
        </div>
      </div>

      {pageCount > 1 ? (
        <>
          <button
            type="button"
            className="po-board-page-nav po-board-page-nav--previous"
            onClick={showPreviousBoard}
            disabled={activePage === 0}
            aria-label="Previous cork board"
            title="Previous cork board"
          >
            <ChevronLeft aria-hidden="true" />
          </button>
          <button
            type="button"
            className="po-board-page-nav po-board-page-nav--next"
            onClick={showNextBoard}
            disabled={activePage === pageCount - 1}
            aria-label="Next cork board"
            title="Next cork board"
          >
            <ChevronRight aria-hidden="true" />
          </button>
          <div className="po-board-page-label" aria-live="polite">
            Board {activePage + 1} of {pageCount}
          </div>
        </>
      ) : null}
    </section>
  );
}

function useBoardPageSize() {
  const [pageSize, setPageSize] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(min-width: 1600px)").matches ? 24 : 18,
  );

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const media = window.matchMedia("(min-width: 1600px)");
    const updatePageSize = () => setPageSize(media.matches ? 24 : 18);
    updatePageSize();
    media.addEventListener("change", updatePageSize);
    return () => media.removeEventListener("change", updatePageSize);
  }, []);

  return pageSize;
}

function readStoredBoardPage() {
  if (typeof window === "undefined") return 0;
  const storedPage = Number.parseInt(
    window.sessionStorage.getItem("po-cork-board-page") || "0",
    10,
  );
  return Number.isFinite(storedPage) && storedPage >= 0 ? storedPage : 0;
}

function CorkBoardEnvironment() {
  return (
    <div className="po-board-environment" aria-hidden="true">
      <span className="po-decor-string po-decor-string--one" />
      <span className="po-decor-string po-decor-string--two" />
      <span className="po-decor-string po-decor-string--three" />

      {Array.from({ length: 8 }, (_, index) => (
        <span key={`board-pin-${index}`} className={`po-decor-pin po-decor-pin--${index + 1}`} />
      ))}

      <span className="po-decor-scrap po-decor-scrap--one" />
      <span className="po-decor-scrap po-decor-scrap--two" />
      <span className="po-decor-tape po-decor-tape--one" />
      <span className="po-decor-tape po-decor-tape--two" />
      <span className="po-decor-pinholes po-decor-pinholes--one" />
      <span className="po-decor-pinholes po-decor-pinholes--two" />
    </div>
  );
}

function PurchaseOrderCard({
  order,
  customers,
  canEditAll,
  canEditStatus,
  onBundleMount,
  onSelect,
  onUpdate,
  onStatusUpdate,
}: {
  order: PurchaseOrder;
  customers: Customer[];
  canEditAll: boolean;
  canEditStatus: boolean;
  onBundleMount: (node: HTMLElement | null) => void;
  onSelect: () => void;
  onUpdate: (values: PurchaseOrder) => void | Promise<void>;
  onStatusUpdate: (values: Pick<PurchaseOrder, "status" | "notes">) => void | Promise<void>;
}) {
  const plan = buildProductionPlan({ order });
  const imageSource = resolveImageSource(order.productImageUrl?.trim());
  const bundleVariant = getBundleVariant(order);
  const rotation = getBundleRotation(order);
  const offset = getBundleOffset(order);
  const pin = getPinStyle(order, plan.shipmentRisk);
  const swatch = order.styleId ? getMaterialSwatch(order) : null;
  const boardMarker = getBoardMarker(order, plan.shipmentRisk);
  const cardStyle = {
    "--bundle-rotation": `${rotation}deg`,
    "--bundle-offset-x": `${offset.x}px`,
    "--bundle-offset-y": `${offset.y}px`,
    "--bundle-glide-x": "0px",
    "--bundle-glide-y": "0px",
    "--bundle-glide-r": "0deg",
    "--pin-color": pin.color,
    "--pin-highlight": pin.highlight,
    "--swatch-color": swatch?.color ?? "#a8693e",
  } as CSSProperties;
  const styleLabel = order.styleCode || order.article || order.styleName || "Style pending";

  return (
    <article ref={onBundleMount} className="po-bundle" style={cardStyle}>
      <button
        type="button"
        className="po-bundle-open"
        onClick={onSelect}
        aria-label={`Open purchase order ${order.poNumber}`}
      >
        <span className="po-bundle-paper-layer po-bundle-paper-back" aria-hidden="true" />
        <span className="po-bundle-paper-layer po-bundle-paper-mid" aria-hidden="true" />
        {swatch ? (
          <span
            className="po-material-swatch-layer"
            aria-label={`BOM material swatch for ${swatch.label}`}
            title={`BOM material swatch: ${swatch.label}`}
          >
            <span>{swatch.label}</span>
          </span>
        ) : null}
        <span
          className={cn(
            "po-polaroid-layer",
            imageSource ? "po-polaroid-layer--image" : "po-polaroid-layer--placeholder",
          )}
          aria-hidden="true"
        >
          {imageSource ? (
            <img src={imageSource} alt="" loading="lazy" className="h-full w-full object-cover" />
          ) : (
            <span className="po-polaroid-placeholder-mark">
              <ImageIcon className="h-6 w-6" />
            </span>
          )}
          <span className="po-polaroid-caption">
            {order.article || order.styleCode || "Product reference"}
          </span>
        </span>
        <span className="po-push-pin" aria-hidden="true" />

        <span className={cn("po-front-paper", bundleVariant.className)}>
          <span className="po-sheet-number">{order.poNumber}</span>
          <span className="po-sheet-customer">
            {order.customerName || order.buyer || "Customer"}
          </span>

          <span className="po-sheet-style-block">
            <span className="po-sheet-style">{styleLabel}</span>
            {order.brand || order.color ? (
              <span className="po-sheet-subline">
                {[order.brand, order.color].filter(Boolean).join(" / ")}
              </span>
            ) : null}
          </span>

          <span className="po-sheet-meta">
            <span>{order.quantity.toLocaleString()} pairs</span>
            <span>Due {formatBoardDate(order.deliveryDate)}</span>
          </span>

          <span className="po-sheet-status-row">
            <BoardStatusBadge status={boardMarker} />
          </span>
        </span>
      </button>

      <div className="po-bundle-actions" onClick={(event) => event.stopPropagation()}>
        {canEditAll ? (
          <PurchaseOrderForm
            title="Edit Purchase Order"
            customers={customers}
            initial={order}
            trigger={
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                aria-label="Edit purchase order"
              >
                <Pencil className="h-4 w-4" />
              </Button>
            }
            onSubmit={onUpdate}
          />
        ) : canEditStatus ? (
          <RecordDialog
            title="Update Purchase Order Status"
            fields={statusFields}
            initial={order}
            onSubmit={(values) => onStatusUpdate(values)}
            trigger={<EditButton />}
          />
        ) : null}
      </div>
    </article>
  );
}

function BoardStatusBadge({ status }: { status: string | null | undefined }) {
  const label = status || "Unknown";
  return <span className={cn("po-board-badge", getBoardStatusClass(label))}>{label}</span>;
}

function updateBoardProximity(
  board: HTMLElement,
  bundles: Set<HTMLElement>,
  pointer: { x: number; y: number },
) {
  const influenceRadius = 360;
  const maxShift = 7;
  const maxRotation = 0.8;

  bundles.forEach((bundle) => {
    if (!board.contains(bundle)) {
      bundles.delete(bundle);
      return;
    }
    if (bundle.matches(".is-hover-intent, :focus-within")) {
      setBundleProximity(bundle, 0, 0, 0);
      return;
    }

    const rect = bundle.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const dx = pointer.x - centerX;
    const dy = pointer.y - centerY;
    const distance = Math.hypot(dx, dy);

    if (distance > influenceRadius || distance === 0) {
      setBundleProximity(bundle, 0, 0, 0);
      return;
    }

    const strength = 1 - distance / influenceRadius;
    const easedStrength = strength * strength * (3 - 2 * strength);
    const shift = easedStrength * maxShift;
    const rotation = Math.max(
      -maxRotation,
      Math.min(maxRotation, (dx / influenceRadius) * maxRotation * 1.45),
    );
    setBundleProximity(bundle, (-dx / distance) * shift, (-dy / distance) * shift, rotation);
  });
}

function resetBoardProximity(board: HTMLElement) {
  board
    .querySelectorAll<HTMLElement>(".po-bundle")
    .forEach((bundle) => setBundleProximity(bundle, 0, 0, 0));
}

function setBundleProximity(bundle: HTMLElement, x: number, y: number, rotation: number) {
  bundle.style.setProperty("--bundle-glide-x", `${x.toFixed(2)}px`);
  bundle.style.setProperty("--bundle-glide-y", `${y.toFixed(2)}px`);
  bundle.style.setProperty("--bundle-glide-r", `${rotation.toFixed(2)}deg`);
}

function getBoardMarker(order: PurchaseOrder, risk: PurchaseOrder["shipmentRisk"]) {
  if (order.status === "Delayed" || risk === "High") return "Delayed";
  if (order.status === "Materials Pending" || risk === "Medium") return "Waiting";
  if (order.status === "Production Running" || order.status === "Packing") return "In Production";
  if (order.status === "Shipped") return "Completed";
  if (order.approved || order.status === "Ready To Ship" || risk === "Low") return "Approved";
  return order.status;
}

function getBoardStatusClass(status: string) {
  if (
    status === "Delayed" ||
    status === "High" ||
    status === "BOM Missing" ||
    status === "Rejected"
  ) {
    return "bg-destructive text-destructive-foreground";
  }
  if (
    status === "Materials Pending" ||
    status === "Medium" ||
    status === "Waiting" ||
    status === "Pending" ||
    status === "Open"
  ) {
    return "bg-warning text-warning-foreground";
  }
  if (
    status === "Shipped" ||
    status === "Ready To Ship" ||
    status === "Approved" ||
    status === "Completed" ||
    status === "Low"
  ) {
    return "bg-success text-success-foreground";
  }
  if (
    status === "Production Running" ||
    status === "In Production" ||
    status === "Packing" ||
    status === "Cutting" ||
    status === "Upper" ||
    status === "Bottom"
  ) {
    return "bg-info text-info-foreground";
  }
  return "bg-secondary text-secondary-foreground";
}

const bundleVariants = [
  { className: "po-paper-white" },
  { className: "po-paper-yellow" },
  { className: "po-paper-blue" },
  { className: "po-paper-kraft" },
  { className: "po-paper-graph" },
  { className: "po-paper-urgent" },
] as const;

function getBundleVariant(order: PurchaseOrder) {
  return bundleVariants[stableHash(order.id || order.poNumber) % bundleVariants.length];
}

function getBundleRotation(order: PurchaseOrder) {
  const bucket = stableHash(`${order.id || order.poNumber}-rotation`) % 7;
  return (bucket - 3) * 0.72;
}

function getBundleOffset(order: PurchaseOrder) {
  const xBucket = stableHash(`${order.id || order.poNumber}-offset-x`) % 13;
  const yBucket = stableHash(`${order.id || order.poNumber}-offset-y`) % 11;
  return {
    x: xBucket - 6,
    y: yBucket - 5,
  };
}

function getPinStyle(order: PurchaseOrder, risk: PurchaseOrder["shipmentRisk"]) {
  if (order.status === "Delayed" || risk === "High") {
    return { color: "#bb3031", highlight: "#ef7673" };
  }
  if (order.status === "Materials Pending" || risk === "Medium") {
    return { color: "#c78d15", highlight: "#f0c54f" };
  }
  if (order.status === "Shipped") {
    return { color: "#4a4a49", highlight: "#9d9d9b" };
  }
  if (order.status === "Production Running" || order.status === "Packing") {
    return { color: "#2674a8", highlight: "#72b6de" };
  }
  if (order.approved || risk === "Low" || order.status === "Ready To Ship") {
    return { color: "#38855c", highlight: "#87c99e" };
  }
  return { color: "#6b625b", highlight: "#b8aca0" };
}

function getMaterialSwatch(order: PurchaseOrder) {
  const reference = `${order.color} ${order.styleName} ${order.article}`.toLowerCase();
  const color = reference.includes("black")
    ? "#282622"
    : reference.includes("white") || reference.includes("cream")
      ? "#ded6bf"
      : reference.includes("brown") || reference.includes("tan") || reference.includes("cognac")
        ? "#93603e"
        : reference.includes("blue")
          ? "#456f8c"
          : reference.includes("red") || reference.includes("burgundy")
            ? "#8a3a3b"
            : reference.includes("grey") || reference.includes("gray")
              ? "#85817b"
              : "#a76f43";

  return {
    color,
    label: order.color || "Leather",
  };
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function formatBoardDate(value: string) {
  if (!value) return "-";
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(parsed);
}

function PurchaseOrderForm({
  title,
  customers,
  initial,
  trigger,
  onSubmit,
}: {
  title: string;
  customers: Customer[];
  initial: PurchaseOrder;
  trigger: ReactNode;
  onSubmit: (values: PurchaseOrder) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<PurchaseOrder>(initial);
  const [pendingImageFile, setPendingImageFile] = useState<File | null>(null);
  const [localImagePreview, setLocalImagePreview] = useState("");
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [formError, setFormError] = useState("");
  const formDialogRef = useRef<HTMLDivElement | null>(null);

  const sizes = values.sizes ?? [];
  const sizeTotal = getSizeTotal(sizes);
  const hasSizeWarning = sizes.length > 0 && sizeTotal !== Number(values.quantity || 0);
  const previewReference = localImagePreview || values.productImageUrl;

  const openForm = () => {
    const firstCustomer = customers[0];
    setValues(initial.customerId ? initial : makeEmptyPurchaseOrder(firstCustomer));
    setPendingImageFile(null);
    setLocalImagePreview("");
    setIsUploadingImage(false);
    setFormError("");
    setOpen(true);
  };

  const set = (name: keyof PurchaseOrder, value: string | number | PurchaseOrderSize[]) => {
    setValues((current) => ({ ...current, [name]: value }));
  };

  const selectCustomer = (customerId: string) => {
    const customer = customers.find((item) => item.id === customerId);
    setValues((current) => ({
      ...current,
      customerId,
      customerName: customer?.customerName ?? "",
      buyer: customer?.customerName ?? "",
      brand: customer?.brand ?? current.brand,
    }));
  };

  const updateSize = (index: number, patch: Partial<PurchaseOrderSize>) => {
    setValues((current) => ({
      ...current,
      sizes: (current.sizes ?? []).map((size, itemIndex) =>
        itemIndex === index ? { ...size, ...patch } : size,
      ),
    }));
  };

  const addSize = () => {
    setValues((current) => ({
      ...current,
      sizes: [
        ...(current.sizes ?? []),
        { id: "", purchaseOrderId: current.id, size: "", quantity: 0, notes: "" },
      ],
    }));
  };

  const removeSize = (index: number) => {
    setValues((current) => ({
      ...current,
      sizes: (current.sizes ?? []).filter((_, itemIndex) => itemIndex !== index),
    }));
  };

  const handleImageFile = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file.");
      return;
    }

    if (!isDemoMode) {
      if (localImagePreview.startsWith("blob:")) {
        URL.revokeObjectURL(localImagePreview);
      }
      setPendingImageFile(file);
      setLocalImagePreview(URL.createObjectURL(file));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        set("productImageUrl", reader.result);
        setLocalImagePreview("");
      }
    };
    reader.onerror = () => toast.error("Could not read the selected image.");
    reader.readAsDataURL(file);
  };

  const closeForm = () => {
    if (isUploadingImage) return;
    if (localImagePreview.startsWith("blob:")) {
      URL.revokeObjectURL(localImagePreview);
    }
    setPendingImageFile(null);
    setLocalImagePreview("");
    setFormError("");
    setOpen(false);
  };

  useEffect(() => {
    if (!open || typeof window === "undefined") return undefined;
    const frame = window.requestAnimationFrame(() => formDialogRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  const submit = async () => {
    const validationErrors = validatePurchaseOrder(values);
    if (validationErrors.length) {
      const message = validationErrors.join(" ");
      setFormError(message);
      toast.error(message);
      return;
    }

    try {
      setIsUploadingImage(true);
      let submitValues = values;

      if (!isDemoMode && pendingImageFile) {
        const uploaded = await uploadPoImage(pendingImageFile);
        submitValues = { ...values, productImageUrl: uploaded.path };
      }

      await onSubmit(submitValues);
      setPendingImageFile(null);
      setLocalImagePreview("");
      setOpen(false);
    } catch (error) {
      const message = (error as Error).message;
      setFormError(message);
      toast.error(message);
    } finally {
      setIsUploadingImage(false);
    }
  };

  return (
    <>
      <span className="inline-flex" onClick={openForm}>
        {trigger}
      </span>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div className="po-case-overlay" onClick={closeForm}>
              <div
                ref={formDialogRef}
                className="po-case-file po-case-file--edit"
                role="dialog"
                aria-modal="true"
                aria-label={title}
                tabIndex={-1}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.stopPropagation();
                    closeForm();
                  }
                }}
              >
                <span className="po-case-folder-tab">Factory file</span>
                <span className="po-case-clip" aria-hidden="true" />
                <div className="po-case-header">
                  <div>
                    <p className="po-case-kicker">Purchase order case file</p>
                    <h2 className="po-case-title">{title}</h2>
                    <p className="po-case-subtitle">
                      Customer relationship and size totals are saved with the PO.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    className="po-case-close"
                    onClick={closeForm}
                    disabled={isUploadingImage}
                    aria-label="Close purchase order form"
                  >
                    <X className="h-4 w-4" />
                    Close
                  </Button>
                </div>

                {formError ? <div className="po-case-error">{formError}</div> : null}

                <div className="po-case-edit-grid">
                  <Field label="Customer">
                    <select
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      value={values.customerId}
                      onChange={(event) => selectCustomer(event.target.value)}
                    >
                      <option value="">Select customer</option>
                      {customers.map((customer) => (
                        <option key={customer.id} value={customer.id}>
                          {customer.customerName}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <TextField
                    label="PO Number"
                    value={values.poNumber}
                    onChange={(value) => set("poNumber", value)}
                  />
                  <TextField
                    label="PO Date"
                    type="date"
                    value={values.poDate}
                    onChange={(value) => set("poDate", value)}
                  />
                  <TextField
                    label="Delivery Date"
                    type="date"
                    value={values.deliveryDate}
                    onChange={(value) => set("deliveryDate", value)}
                  />
                  <TextField
                    label="Article"
                    value={values.article}
                    onChange={(value) => set("article", value)}
                  />
                  <TextField
                    label="Brand"
                    value={values.brand}
                    onChange={(value) => set("brand", value)}
                  />
                  <TextField
                    label="Style Code"
                    value={values.styleCode}
                    onChange={(value) => set("styleCode", value)}
                  />
                  <TextField
                    label="Style Name"
                    value={values.styleName}
                    onChange={(value) => set("styleName", value)}
                  />
                  <TextField
                    label="Color"
                    value={values.color}
                    onChange={(value) => set("color", value)}
                  />
                  <TextField
                    label="Quantity"
                    type="number"
                    value={values.quantity}
                    onChange={(value) => set("quantity", Number(value))}
                  />
                  <TextField
                    label="Price"
                    type="number"
                    value={values.price}
                    onChange={(value) => set("price", Number(value))}
                  />
                  <TextField
                    label="Currency"
                    value={values.currency}
                    onChange={(value) => set("currency", value)}
                  />
                  <Field label="Status">
                    <select
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      value={values.status}
                      onChange={(event) => set("status", event.target.value as POStatus)}
                    >
                      {PO_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <TextField
                    label="Product Image URL / Reference"
                    value={values.productImageUrl}
                    onChange={(value) => set("productImageUrl", value)}
                  />
                  <Field label="Browse Product Image">
                    <div className="grid gap-3">
                      <Input
                        type="file"
                        accept="image/*"
                        onChange={(event) => handleImageFile(event.target.files?.[0])}
                      />
                      {!isDemoMode ? (
                        <div className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
                          Images are stored on the local API server. Supabase is used only for
                          authentication.
                        </div>
                      ) : null}
                      <ImagePreview reference={previewReference} />
                    </div>
                  </Field>
                  <Field label="Notes">
                    <textarea
                      className="min-h-[90px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      value={values.notes}
                      onChange={(event) => set("notes", event.target.value)}
                    />
                  </Field>
                </div>

                <div className="po-case-paper-sheet po-case-size-editor">
                  <div className="po-case-sheet-heading">
                    <div>
                      <h3>Size Breakdown</h3>
                      <p>
                        Total {sizeTotal.toLocaleString()} of PO quantity{" "}
                        {Number(values.quantity || 0).toLocaleString()}
                      </p>
                    </div>
                    <Button variant="outline" size="sm" onClick={addSize}>
                      <Plus className="mr-1 h-4 w-4" />
                      Size
                    </Button>
                  </div>
                  <div className="grid gap-3">
                    {sizes.map((size, index) => (
                      <div
                        key={`${index}-${size.id}`}
                        className="grid grid-cols-[1fr_1fr_auto] gap-2"
                      >
                        <Input
                          value={size.size}
                          placeholder="Size"
                          onChange={(event) => updateSize(index, { size: event.target.value })}
                        />
                        <Input
                          type="number"
                          value={size.quantity}
                          placeholder="Quantity"
                          onChange={(event) =>
                            updateSize(index, { quantity: Number(event.target.value) })
                          }
                        />
                        <Button variant="outline" onClick={() => removeSize(index)}>
                          Remove
                        </Button>
                      </div>
                    ))}
                    {!sizes.length ? (
                      <div className="po-case-empty-line">
                        No sizes yet. Add the first size row for this PO.
                      </div>
                    ) : null}
                  </div>
                </div>

                {hasSizeWarning ? (
                  <div className="po-case-warning">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      Size total {sizeTotal.toLocaleString()} does not match PO quantity{" "}
                      {Number(values.quantity || 0).toLocaleString()}. You can still save for the
                      demo.
                    </span>
                  </div>
                ) : null}

                <div className="po-case-footer-actions">
                  <Button variant="outline" onClick={closeForm} disabled={isUploadingImage}>
                    Cancel
                  </Button>
                  <Button onClick={submit} disabled={isUploadingImage}>
                    {isUploadingImage ? "Saving..." : "Save"}
                  </Button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function PurchaseOrderDetail({ order, onClose }: { order: PurchaseOrder; onClose: () => void }) {
  const { profile } = useAuth();
  const { data: customers = [] } = useCustomers();
  const updatePO = useUpdatePurchaseOrder();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const sizeTotal = getSizeTotal(order.sizes);
  const plan = buildProductionPlan({ order });
  const swatch = order.styleId ? getMaterialSwatch(order) : null;
  const styleLabel = order.styleCode || order.article || order.styleName || "Style pending";
  const canEditAll = profile?.role === "Owner" || profile?.role === "Planning";
  const canViewProcurement =
    profile?.role === "Owner" ||
    profile?.role === "Management" ||
    profile?.role === "Planning" ||
    profile?.role === "Purchasing";
  const { data: requirements = [] } = useMaterialRequirements(
    canViewProcurement ? order.id : undefined,
  );
  const { data: materialPos = [] } = useMaterialPurchaseOrders(
    canViewProcurement ? order.id : undefined,
  );

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const frame = window.requestAnimationFrame(() => dialogRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="po-case-overlay" onClick={onClose}>
      <section
        ref={dialogRef}
        className="po-case-file po-case-file--view"
        role="dialog"
        aria-modal="true"
        aria-label={`Purchase order case file ${order.poNumber}`}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
      >
        <span className="po-case-folder-tab">Factory file</span>
        <span className="po-case-clip" aria-hidden="true" />
        <div className="po-case-header">
          <div>
            <p className="po-case-kicker">Purchase order case file</p>
            <h2 className="po-case-title">{order.poNumber}</h2>
            <p className="po-case-subtitle">
              {order.customerName || order.buyer || "Customer"} -{" "}
              {order.article || order.styleName || styleLabel}
            </p>
          </div>
          <div className="po-case-header-actions">
            <span
              className={cn(
                "po-case-status-stamp",
                getBoardStatusClass(getBoardMarker(order, plan.shipmentRisk)),
              )}
            >
              {getBoardMarker(order, plan.shipmentRisk)}
            </span>
            {canEditAll ? (
              <PurchaseOrderForm
                title={`Edit ${order.poNumber}`}
                customers={customers}
                initial={order}
                trigger={
                  <Button variant="outline" className="po-case-action-button">
                    <Pencil className="h-4 w-4" />
                    Edit Case File
                  </Button>
                }
                onSubmit={async (values) => {
                  await updatePO.mutateAsync(cleanPurchaseOrder({ ...values, id: order.id }));
                  toast.success("Purchase order updated");
                }}
              />
            ) : null}
            <Button
              variant="outline"
              className="po-case-close"
              onClick={onClose}
              aria-label="Close purchase order case file"
            >
              <X className="h-4 w-4" />
              Close
            </Button>
          </div>
        </div>

        <div className="po-case-main">
          <aside className="po-case-visual-panel">
            <div className="po-case-photo-frame">
              <ProductImage order={order} />
            </div>
            <div className="po-case-visual-meta">
              <div>
                <span>Style</span>
                <strong>{styleLabel}</strong>
              </div>
              <div>
                <span>Delivery</span>
                <strong>{order.deliveryDate || "-"}</strong>
              </div>
              <div>
                <span>Quantity</span>
                <strong>{order.quantity.toLocaleString()} pairs</strong>
              </div>
            </div>
            {swatch ? (
              <div
                className="po-case-swatch"
                style={{ "--swatch-color": swatch.color } as CSSProperties}
              >
                <span>Material swatch</span>
                <strong>{swatch.label}</strong>
              </div>
            ) : (
              <div className="po-case-swatch po-case-swatch--empty">
                <span>BOM material swatch</span>
                <strong>Not linked yet</strong>
              </div>
            )}
          </aside>

          <div className="po-case-details-panel">
            <section className="po-case-paper-sheet">
              <div className="po-case-sheet-heading">
                <div>
                  <h3>Order Details</h3>
                  <p>Customer, article, delivery and commercial notes.</p>
                </div>
              </div>
              <div className="po-case-detail-grid">
                <InfoTile label="Customer" value={order.customerName || order.buyer || "-"} />
                <InfoTile label="Article" value={order.article || "-"} />
                <InfoTile label="Style Code" value={order.styleCode || "-"} />
                <InfoTile label="Style Name" value={order.styleName || "-"} />
                <InfoTile label="Brand" value={order.brand || "-"} />
                <InfoTile label="Color" value={order.color || "-"} />
                <InfoTile label="Status" value={order.status || "-"} />
                <InfoTile label="Price" value={formatPrice(order)} />
              </div>
              {order.notes ? (
                <div className="po-case-notes-sheet">
                  <span>Notes</span>
                  <p>{order.notes}</p>
                </div>
              ) : null}
            </section>

            <section className="po-case-paper-sheet">
              <div className="po-case-sheet-heading">
                <div>
                  <h3>Size Breakdown</h3>
                  <p>
                    Total {sizeTotal.toLocaleString()} of {order.quantity.toLocaleString()} pairs.
                  </p>
                </div>
              </div>
              <div className="po-case-table-wrap">
                <table className="po-case-table">
                  <thead>
                    <tr>
                      <th>Size</th>
                      <th>Quantity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(order.sizes ?? []).map((size) => (
                      <tr key={size.id || size.size}>
                        <td>{size.size}</td>
                        <td>{size.quantity.toLocaleString()}</td>
                      </tr>
                    ))}
                    {!(order.sizes ?? []).length ? (
                      <tr>
                        <td colSpan={2}>No size breakdown saved.</td>
                      </tr>
                    ) : null}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Total</td>
                      <td>{sizeTotal.toLocaleString()}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>
          </div>
        </div>

        <div className="po-case-related-grid">
          <ProductionIntelligencePanel order={order} />

          <ProductionStageTracker order={order} role={profile?.role} />

          <FinalApprovalPanel order={order} />

          {canViewProcurement ? (
            <DominoSummary
              order={order}
              requirements={requirements}
              materialPos={materialPos}
              role={profile?.role}
            />
          ) : null}

          <RelatedDailyLogsPanel order={order} role={profile?.role} />

          <ProductionTimelinePanel order={order} />
        </div>
      </section>
    </div>
  );
}

function ProductionIntelligencePanel({ order }: { order: PurchaseOrder }) {
  const plan = buildProductionPlan({ order });
  const daysRemaining =
    plan.daysRemaining === null
      ? "-"
      : plan.daysRemaining < 0
        ? `${Math.abs(plan.daysRemaining)} day(s) late`
        : `${plan.daysRemaining} day(s)`;

  return (
    <div className="mt-5 rounded-md border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-foreground">Production Plan</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Current factory position, simple progress and shipment risk.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusBadge status={plan.shipmentRisk} />
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <InfoTile label="Current Department" value={plan.currentStage} />
        <InfoTile label="Progress" value={`${plan.progressPercent}%`} />
        <InfoTile label="Estimated Finish" value={formatPlanDate(plan.estimatedCompletionDate)} />
        <InfoTile label="Days Remaining" value={daysRemaining} />
        <InfoTile label="Shipment Risk" value={plan.shipmentRisk} />
      </div>
    </div>
  );
}

function ProductionTimelinePanel({ order }: { order: PurchaseOrder }) {
  const { data: events = [], isLoading, error } = useProductionTimeline(order.id);

  return (
    <div className="mt-6 rounded-md border border-border p-4">
      <div className="flex items-start gap-2">
        <History className="mt-0.5 h-4 w-4 text-primary" />
        <div>
          <h3 className="font-semibold text-foreground">Production Timeline</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Automatic history for PO imports, BOM links, approvals, department moves and material
            drafts.
          </p>
        </div>
      </div>

      {error ? (
        <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {(error as Error).message}
        </div>
      ) : null}

      <div className="mt-4 grid gap-3">
        {isLoading ? (
          <div className="rounded-md border border-border p-3 text-sm text-muted-foreground">
            Loading timeline...
          </div>
        ) : null}
        {!isLoading && !events.length ? (
          <div className="rounded-md border border-border p-3 text-sm text-muted-foreground">
            No timeline events yet. New PO actions will appear here automatically.
          </div>
        ) : null}
        {events.map((event) => (
          <div key={event.id} className="rounded-md border border-border p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="font-medium text-foreground">{event.eventTitle}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {new Date(event.createdAt).toLocaleString()} - {event.userName || "System"}
                </div>
              </div>
              <StatusBadge status={event.eventTitle} />
            </div>
            {event.eventDescription ? (
              <p className="mt-2 text-sm text-muted-foreground">{event.eventDescription}</p>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function canCreateDailyLogForRole(role: Role | null | undefined) {
  return (
    role === "Owner" ||
    role === "Management" ||
    role === "Planning" ||
    role === "Production" ||
    role === "Warehouse" ||
    role === "Quality"
  );
}

function canResolveDailyLogForRole(role: Role | null | undefined) {
  return role === "Owner" || role === "Management" || role === "Planning";
}

function RelatedDailyLogsPanel({
  order,
  role,
}: {
  order: PurchaseOrder;
  role: Role | null | undefined;
}) {
  const { data: logs = [], isLoading, error } = useDailyLogs(order.id);
  const createLog = useCreateDailyLog();
  const updateLog = useUpdateDailyLog();
  const canCreate = canCreateDailyLogForRole(role);
  const canResolve = canResolveDailyLogForRole(role);
  const today = new Date().toISOString().slice(0, 10);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [priority, setPriority] = useState<DailyLogPriority>("Medium");

  const sortedLogs = useMemo(
    () => [...logs].sort((a, b) => (b.createdAt ?? b.date).localeCompare(a.createdAt ?? a.date)),
    [logs],
  );

  const submit = async () => {
    if (!title.trim()) {
      toast.error("Log title is required.");
      return;
    }
    if (!note.trim()) {
      toast.error("Log note is required.");
      return;
    }
    try {
      await createLog.mutateAsync({
        title,
        note,
        date: today,
        departmentStage: order.currentStage === "Completed" ? "Packing" : order.currentStage,
        purchaseOrderId: order.id,
        priority,
        status: "Open",
      });
      setTitle("");
      setNote("");
      setPriority("Medium");
      setShowForm(false);
      toast.success("Daily log added to this PO");
    } catch (saveError) {
      toast.error((saveError as Error).message);
    }
  };

  const toggleStatus = async (log: DailyLog) => {
    if (!canResolve) {
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
    <div className="mt-6 rounded-md border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-foreground">Related Daily Logs</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Notes, issues and customer changes linked to this purchase order.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={`/daily-logs?search=${encodeURIComponent(order.poNumber)}`}
            className="inline-flex h-9 items-center rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Open Logbook
          </a>
          {canCreate ? (
            <Button size="sm" onClick={() => setShowForm((value) => !value)}>
              {showForm ? "Close Form" : "Add Log"}
            </Button>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {(error as Error).message}
        </div>
      ) : null}

      {showForm ? (
        <div className="mt-4 grid gap-3 rounded-md border border-border bg-muted/20 p-3">
          <div className="grid gap-1.5">
            <Label htmlFor="po-log-title">Title</Label>
            <Input
              id="po-log-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={`Update for ${order.poNumber}`}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="po-log-note">Note</Label>
            <textarea
              id="po-log-note"
              className="min-h-[90px] rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
          <div className="grid gap-1.5 sm:max-w-xs">
            <Label htmlFor="po-log-priority">Priority</Label>
            <select
              id="po-log-priority"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm"
              value={priority}
              onChange={(event) => setPriority(event.target.value as DailyLogPriority)}
            >
              {DAILY_LOG_PRIORITIES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} disabled={createLog.isPending}>
              {createLog.isPending ? "Saving..." : "Save Log"}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="mt-4 grid gap-3">
        {isLoading ? (
          <div className="rounded-md border border-border p-3 text-sm text-muted-foreground">
            Loading related logs...
          </div>
        ) : null}
        {!isLoading && !sortedLogs.length ? (
          <div className="rounded-md border border-border p-3 text-sm text-muted-foreground">
            No daily logs linked to this PO yet.
          </div>
        ) : null}
        {sortedLogs.map((log) => (
          <div key={log.id} className="rounded-md border border-border p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="font-medium text-foreground">{log.title}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {log.date} - {log.authorName || "Unknown author"}
                  {log.departmentStage ? ` - ${log.departmentStage}` : ""}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <StatusBadge status={log.priority} />
                <StatusBadge status={log.status} />
              </div>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{log.note}</p>
            {canResolve ? (
              <Button
                className="mt-3"
                variant="outline"
                size="sm"
                onClick={() => void toggleStatus(log)}
                disabled={updateLog.isPending}
              >
                {log.status === "Open" ? "Resolve" : "Reopen"}
              </Button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function ProductionStageTracker({
  order,
  role,
}: {
  order: PurchaseOrder;
  role: Role | null | undefined;
}) {
  const moveStage = useMovePurchaseOrderStage();
  const canMove = canMoveProductionStage(role);
  const currentStage = order.currentStage || "Cutting";
  const currentIndex = PRODUCTION_STAGE_STATUSES.indexOf(currentStage);
  const nextStage = nextProductionStage(currentStage);

  const moveNext = async () => {
    if (!nextStage) {
      toast.error("This order is already completed.");
      return;
    }
    try {
      await moveStage.mutateAsync({ purchaseOrderId: order.id, currentStage: nextStage });
      toast.success(`${order.poNumber} moved to ${nextStage}`);
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  return (
    <div className="mt-5 rounded-md border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-foreground">Production Department Progress</h3>
          <p className="mt-1 text-sm text-muted-foreground">Current department: {currentStage}</p>
        </div>
        {canMove && nextStage ? (
          <Button size="sm" onClick={moveNext} disabled={moveStage.isPending}>
            {moveStage.isPending ? (
              "Moving..."
            ) : (
              <>
                Move to {nextStage}
                <ArrowRight className="ml-1 h-4 w-4" />
              </>
            )}
          </Button>
        ) : (
          <StatusBadge status={currentStage} />
        )}
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        {PRODUCTION_STAGES.map((stage) => {
          const stageIndex = PRODUCTION_STAGE_STATUSES.indexOf(stage);
          const isDone = currentStage === "Completed" || stageIndex < currentIndex;
          const isCurrent = stage === currentStage;
          return (
            <div
              key={stage}
              className={`rounded-md border p-3 ${
                isCurrent
                  ? "border-primary bg-primary/10"
                  : isDone
                    ? "border-success/40 bg-success/10"
                    : "border-border bg-muted/20"
              }`}
            >
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                {isDone ? (
                  <CheckCircle2 className="h-4 w-4 text-success" />
                ) : isCurrent ? (
                  <CircleDot className="h-4 w-4 text-primary" />
                ) : (
                  <Circle className="h-4 w-4 text-muted-foreground" />
                )}
                {stage}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FinalApprovalPanel({ order }: { order: PurchaseOrder }) {
  const { profile } = useAuth();
  const setFinalApproval = useSetFinalApproval();
  const [approvalError, setApprovalError] = useState("");
  const canApprove = canApproveFinal(profile?.role);

  const toggleApproval = async (approved: boolean) => {
    try {
      setApprovalError("");
      await setFinalApproval.mutateAsync({ purchaseOrderId: order.id, approved });
      toast.success(approved ? "Final approval saved" : "Final approval cleared");
    } catch (error) {
      const message = (error as Error).message;
      setApprovalError(message);
      toast.error(message);
    }
  };

  return (
    <div className="mt-5 rounded-md border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-3 text-sm font-medium text-foreground">
          <input
            type="checkbox"
            checked={Boolean(order.approved)}
            disabled={!canApprove || setFinalApproval.isPending}
            onChange={(event) => void toggleApproval(event.target.checked)}
            className="h-4 w-4 rounded border-border"
          />
          Final Approval
        </label>
        <StatusBadge status={order.approved ? "Approved" : "Pending"} />
      </div>
      {order.approved ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Approved by {order.approvedByName || "approved user"}
          {order.approvedDate ? ` on ${order.approvedDate.slice(0, 10)}` : ""}.
        </p>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          Pending final approval from Owner, Management, or Planning.
        </p>
      )}
      {approvalError ? <p className="mt-2 text-sm text-destructive">{approvalError}</p> : null}
    </div>
  );
}

function DominoSummary({
  order,
  requirements,
  materialPos,
  role,
}: {
  order: PurchaseOrder;
  requirements: MaterialRequirement[];
  materialPos: MaterialPurchaseOrder[];
  role: Role | null | undefined;
}) {
  const regenerateDomino = useRegeneratePurchaseOrderDomino();
  const canRegenerate =
    role === "Owner" || role === "Management" || role === "Planning" || role === "Purchasing";

  const regenerate = async () => {
    try {
      await regenerateDomino.mutateAsync(order.id);
      toast.success("Draft Material POs regenerated");
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  return (
    <div className="mt-6 grid gap-4">
      <div className="rounded-md border border-border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-foreground">Domino Workflow</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {order.styleId
                ? "Matching BOM found and linked to this PO."
                : "BOM is not linked yet."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={order.styleId ? "BOM Linked" : "BOM Missing"} />
            {canRegenerate ? (
              <Button
                size="sm"
                variant="outline"
                onClick={regenerate}
                disabled={regenerateDomino.isPending}
              >
                {regenerateDomino.isPending ? "Regenerating..." : "Regenerate Drafts"}
              </Button>
            ) : null}
          </div>
        </div>
        {order.productionPlanSummary ? (
          <div className="mt-3 rounded-md bg-muted/40 p-3 text-sm text-muted-foreground">
            {order.productionPlanSummary}
            {order.shipmentRisk ? ` Shipment risk: ${order.shipmentRisk}.` : ""}
          </div>
        ) : null}
        {order.dominoWarnings?.length ? (
          <div className="mt-3 grid gap-2">
            {order.dominoWarnings.map((warning) => (
              <div
                key={`${warning.code}-${warning.message}`}
                className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning-foreground"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{warning.message}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <BomLinkPanel order={order} role={role} />

      <div className="overflow-x-auto rounded-md border border-border">
        <div className="border-b border-border p-3">
          <h3 className="font-semibold text-foreground">Material Requirements</h3>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Material</th>
              <th className="px-4 py-3">Size / Spec</th>
              <th className="px-4 py-3">Required</th>
              <th className="px-4 py-3">Balance</th>
              <th className="px-4 py-3">Vendor</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {requirements.map((requirement) => (
              <tr key={requirement.id} className="border-t border-border">
                <td className="px-4 py-3 font-medium">{requirement.materialName}</td>
                <td className="px-4 py-3">
                  {[requirement.sizeLabel, requirement.specification].filter(Boolean).join(" - ") ||
                    "-"}
                </td>
                <td className="px-4 py-3">
                  {requirement.requiredQuantity.toLocaleString()} {requirement.unit}
                </td>
                <td className="px-4 py-3">
                  {requirement.balanceQuantity.toLocaleString()} {requirement.unit}
                </td>
                <td className="px-4 py-3">{requirement.vendorName || "Unassigned Vendor"}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <StatusBadge status={requirement.quantityStatus} />
                    <StatusBadge status={requirement.calculationType || "Per Pair"} />
                  </div>
                </td>
              </tr>
            ))}
            {!requirements.length ? (
              <tr className="border-t border-border">
                <td className="px-4 py-6 text-muted-foreground" colSpan={6}>
                  No material requirements generated yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <div className="border-b border-border p-3">
          <h3 className="font-semibold text-foreground">Draft Material POs</h3>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Material PO</th>
              <th className="px-4 py-3">Vendor</th>
              <th className="px-4 py-3">Items</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {materialPos.map((materialPo) => (
              <tr key={materialPo.id} className="border-t border-border">
                <td className="px-4 py-3 font-medium">{materialPo.materialPoNumber}</td>
                <td className="px-4 py-3">{materialPo.vendorName || "Unassigned Vendor"}</td>
                <td className="px-4 py-3">{materialPo.itemCount}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={materialPo.status} />
                </td>
              </tr>
            ))}
            {!materialPos.length ? (
              <tr className="border-t border-border">
                <td className="px-4 py-6 text-muted-foreground" colSpan={4}>
                  No Draft Material POs generated yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BomLinkPanel({ order, role }: { order: PurchaseOrder; role: Role | null | undefined }) {
  const { data: styles = [] } = useStyles();
  const linkStyle = useLinkPurchaseOrderStyle();
  const canLink =
    role === "Owner" || role === "Management" || role === "Planning" || role === "Purchasing";
  const [styleId, setStyleId] = useState(order.styleId || "");
  const selectedStyle = styles.find((style) => style.id === (styleId || order.styleId));

  useEffect(() => {
    setStyleId(order.styleId || "");
  }, [order.styleId]);

  const submit = async () => {
    if (!styleId) {
      toast.error("Select a BOM/style to link.");
      return;
    }
    try {
      await linkStyle.mutateAsync({ purchaseOrderId: order.id, styleId });
      toast.success("BOM linked and material requirements regenerated");
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  return (
    <div className="rounded-md border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-foreground">
            {order.styleId ? "Change BOM" : "Link BOM"}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Automatic matching uses style code, color, and brand. Use this selector if the imported
            PO text does not match the BOM exactly.
          </p>
        </div>
        {selectedStyle ? <StatusBadge status="BOM Linked" /> : <StatusBadge status="BOM Missing" />}
      </div>
      {canLink ? (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <select
            className="flex h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={styleId}
            onChange={(event) => setStyleId(event.target.value)}
          >
            <option value="">Select BOM/style</option>
            {styles.map((style) => (
              <option key={style.id} value={style.id}>
                {styleOptionLabel(style)}
              </option>
            ))}
          </select>
          <Button onClick={submit} disabled={linkStyle.isPending || !styleId}>
            {linkStyle.isPending ? "Linking..." : order.styleId ? "Change BOM" : "Link BOM"}
          </Button>
        </div>
      ) : selectedStyle ? (
        <div className="mt-3 rounded-md bg-muted/40 p-3 text-sm text-muted-foreground">
          Linked to {styleOptionLabel(selectedStyle)}.
        </div>
      ) : null}
    </div>
  );
}

function styleOptionLabel(style: Style) {
  return [style.styleCode, style.styleName, style.color, style.brand].filter(Boolean).join(" / ");
}

function formatPrice(order: PurchaseOrder) {
  if (!Number(order.price)) return "-";
  return `${order.currency || "USD"} ${Number(order.price).toLocaleString()}`;
}

function ProductImage({ order }: { order: PurchaseOrder }) {
  const reference = order.productImageUrl?.trim();
  const src = resolveImageSource(reference);

  if (src) {
    return (
      <div className="h-44 bg-muted sm:h-full">
        <img
          src={src}
          alt={order.article || order.styleName}
          className="h-full w-full object-cover"
        />
      </div>
    );
  }

  return (
    <div className="flex h-44 flex-col items-center justify-center gap-2 bg-muted text-muted-foreground sm:h-full">
      <ImageIcon className="h-9 w-9" />
      <span className="px-3 text-center text-xs">{reference || "Product image reference"}</span>
    </div>
  );
}

function ImagePreview({ reference }: { reference: string }) {
  const preview = reference.trim();
  const src = resolveImageSource(preview);

  if (src) {
    return (
      <div className="overflow-hidden rounded-md border border-border bg-muted">
        <img src={src} alt="Selected product preview" className="h-36 w-full object-cover" />
      </div>
    );
  }

  return (
    <div className="flex h-36 items-center justify-center rounded-md border border-dashed border-border bg-muted/40 text-sm text-muted-foreground">
      {preview || "No image selected"}
    </div>
  );
}

function resolveImageSource(reference: string | undefined) {
  if (!reference) return null;
  if (
    reference.startsWith("http://") ||
    reference.startsWith("https://") ||
    reference.startsWith("data:image/") ||
    reference.startsWith("blob:")
  ) {
    return reference;
  }
  if (reference.startsWith("/uploads/")) {
    const origin = typeof window === "undefined" ? apiBaseUrl : window.location.origin;
    const base = new URL(apiBaseUrl, origin);
    return `${base.origin}${reference}`;
  }
  return null;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function TextField({
  label,
  type = "text",
  value,
  onChange,
}: {
  label: string;
  type?: "text" | "number" | "date";
  value: string | number;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label}>
      <Input type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </Field>
  );
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 truncate font-medium text-foreground">{value}</div>
    </div>
  );
}

function makeEmptyPurchaseOrder(customer?: Customer): PurchaseOrder {
  return {
    id: "",
    customerId: customer?.id ?? "",
    customerName: customer?.customerName ?? "",
    poNumber: "",
    buyer: customer?.customerName ?? "",
    poDate: new Date().toISOString().slice(0, 10),
    article: "",
    brand: customer?.brand ?? "",
    styleCode: "",
    styleName: "",
    color: "",
    quantity: 0,
    price: 0,
    currency: "USD",
    deliveryDate: "",
    status: "Planning",
    notes: "",
    productImageUrl: "",
    currentStage: "Cutting",
    sizes: [],
  };
}

function getSizeTotal(sizes: PurchaseOrderSize[] | undefined) {
  return (sizes ?? []).reduce((sum, size) => sum + Number(size.quantity || 0), 0);
}

function validatePurchaseOrder(order: PurchaseOrder) {
  const errors: string[] = [];
  if (!order.customerId) errors.push("Select a customer before saving.");
  if (!order.poNumber.trim()) errors.push("Enter a PO number before saving.");
  if (!Number.isFinite(Number(order.quantity)) || Number(order.quantity) <= 0) {
    errors.push("Enter total quantity greater than zero.");
  }
  if (!order.deliveryDate) errors.push("Enter a delivery date before saving.");
  const seenSizes = new Set<string>();
  for (const size of order.sizes ?? []) {
    const sizeLabel = size.size.trim();
    if (!sizeLabel) {
      errors.push("Remove blank size rows or enter a size before saving.");
      break;
    }
    const key = sizeLabel.toLowerCase();
    if (seenSizes.has(key)) {
      errors.push(`Size ${sizeLabel} appears more than once. Combine duplicate size rows.`);
      break;
    }
    seenSizes.add(key);
    if (!Number.isFinite(Number(size.quantity)) || Number(size.quantity) < 0) {
      errors.push(`Size ${sizeLabel} quantity must be zero or greater.`);
      break;
    }
  }
  return errors;
}

function cleanPurchaseOrder(order: PurchaseOrder) {
  const { sizeTotal, sizeTotalWarning, ...payload } = order;
  void sizeTotal;
  void sizeTotalWarning;
  return {
    ...payload,
    customerId: payload.customerId || null,
  } as unknown as PurchaseOrder;
}
