import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  BarChart3,
  Check,
  ClipboardCheck,
  Factory,
  Phone,
  Search,
  TrendingUp,
  X,
} from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";

import { useAuth } from "@/lib/auth";
import { useDashboard } from "@/lib/data-hooks";
import { canAccessPath } from "@/lib/domain";
import { workspaceNavItems } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import "@/dashboard-desk.css";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Executive Desk - Footwear Production Hub" },
      {
        name: "description",
        content: "Factory orders, materials, approvals and production from the manager's desk.",
      },
    ],
  }),
  component: ExecutiveDeskDashboard,
});

function ExecutiveDeskDashboard() {
  const { data, isLoading, error } = useDashboard();
  const [isBookOpen, setIsBookOpen] = useState(false);
  const [activeDeskTool, setActiveDeskTool] = useState<"communication" | "search" | null>(null);

  const tasks = useMemo(() => {
    const pending = [
      { label: "Review delayed orders", count: data?.delayedOrders ?? 0 },
      { label: "Final approvals", count: data?.pendingApprovals ?? 0 },
      { label: "Check material shortages", count: data?.materialPending ?? 0 },
      { label: "Resolve priority issues", count: data?.highPriorityDailyLogs ?? 0 },
    ].filter((task) => task.count > 0);

    return pending.length
      ? pending.slice(0, 4)
      : [
          { label: "Morning factory review", count: 0 },
          { label: "Confirm today's line plan", count: 0 },
          { label: "Review delivery schedule", count: 0 },
        ];
  }, [data]);

  const loadingValue = (value: number | undefined, suffix = "") =>
    isLoading ? "..." : `${value ?? 0}${suffix}`;

  return (
    <div className="executive-desk-scene" aria-label="Factory manager executive desk dashboard">
      <div className="executive-desk-floor" aria-hidden="true" />
      <div className="executive-desk-surface">
        <div className="desk-brass-corner desk-brass-corner--one" aria-hidden="true" />
        <div className="desk-brass-corner desk-brass-corner--two" aria-hidden="true" />
        <div className="desk-brass-corner desk-brass-corner--three" aria-hidden="true" />
        <div className="desk-brass-corner desk-brass-corner--four" aria-hidden="true" />

        <DeskMagnifier
          data={data}
          isOpen={activeDeskTool === "search"}
          onToggle={() => setActiveDeskTool((tool) => (tool === "search" ? null : "search"))}
          onClose={() => setActiveDeskTool(null)}
        />
        <DeskPhone
          data={data}
          isOpen={activeDeskTool === "communication"}
          onToggle={() =>
            setActiveDeskTool((tool) => (tool === "communication" ? null : "communication"))
          }
          onClose={() => setActiveDeskTool(null)}
        />
        <PenHolder />
        <TeaCup />

        <div className="desk-stationery-set" aria-label="Factory reference files">
          <Link to="/customers" className="desk-stationery-pad">
            <span>Customers</span>
          </Link>
          <Link to="/materials" className="desk-stationery-case">
            <span className="desk-stationery-pen desk-stationery-pen--one" />
            <span className="desk-stationery-pen desk-stationery-pen--two" />
            <strong>Materials</strong>
          </Link>
          <Link to="/vendors" className="desk-stationery-pad desk-stationery-pad--right">
            <span>Vendors</span>
          </Link>
        </div>

        {error ? (
          <div className="desk-error-slip" role="alert">
            <AlertTriangle aria-hidden="true" />
            <span>{(error as Error).message}</span>
          </div>
        ) : null}

        <ReportStack
          isLoading={isLoading}
          orders={data?.recentPurchaseOrders ?? []}
          delayedOrders={data?.delayedOrders ?? 0}
        />

        <DailyNotebook tasks={tasks} logs={data?.recentDailyLogs ?? []} />

        <DashboardBook
          data={data}
          isLoading={isLoading}
          isOpen={isBookOpen}
          onToggle={() => setIsBookOpen((open) => !open)}
          onClose={() => setIsBookOpen(false)}
        />

        <ApprovalsTray count={data?.pendingApprovals ?? 0} isLoading={isLoading} />

        <Link to="/purchase-orders" className="desk-order-folio" aria-label="Open purchase orders">
          <span className="desk-order-folio-spine">Orders</span>
          <span className="desk-order-folio-title">Purchase Orders</span>
          <span className="desk-order-folio-count">{loadingValue(data?.activeOrders)} active</span>
        </Link>

        <Link to="/daily-logs" className="desk-alert-slips" aria-label="Open factory daily logs">
          {(data?.recentAlerts ?? []).slice(0, 2).map((alert, index) => (
            <span
              key={alert.id}
              className={cn("desk-alert-slip", index === 1 && "desk-alert-slip--second")}
            >
              {alert.message}
            </span>
          ))}
          {!isLoading && !(data?.recentAlerts ?? []).length ? (
            <span className="desk-alert-slip">Quality first. No new alerts.</span>
          ) : null}
        </Link>

        <DeskDrawerMenu />
        <div className="desk-chair-edge" aria-hidden="true" />
      </div>
      <div className="executive-desk-vignette" aria-hidden="true" />
    </div>
  );
}

function DashboardBook({
  data,
  isLoading,
  isOpen,
  onToggle,
  onClose,
}: {
  data: ReturnType<typeof useDashboard>["data"];
  isLoading: boolean;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const value = (metric: number | undefined, suffix = "") =>
    isLoading ? "..." : `${metric ?? 0}${suffix}`;

  return (
    <section className={cn("desk-dashboard-book", isOpen && "is-open")} aria-label="Dashboard book">
      <div className="desk-book-shadow" aria-hidden="true" />
      <div className="desk-book-pages">
        <div className="desk-book-page desk-book-page--left">
          <div className="desk-book-page-heading">
            <Factory aria-hidden="true" />
            Today&apos;s Production
          </div>
          <div className="desk-book-production-total">
            <strong>{value(data?.todayProductionActual)}</strong>
            <span>of {value(data?.todayProductionTarget)} pairs</span>
          </div>
          <div className="desk-book-progress" aria-label="Production achievement">
            <span
              style={{
                width: `${Math.min(100, Math.max(0, data?.productionAchievementPercent ?? 0))}%`,
              }}
            />
          </div>
          <div className="desk-book-stage-list">
            {(data?.productionBreakdown ?? []).slice(0, 4).map((stage) => (
              <a
                key={stage.stage}
                href={`/production-lines?department=${encodeURIComponent(stage.stage)}`}
                className="desk-book-stage-row"
              >
                <span>{stage.label}</span>
                <span>
                  {stage.actual.toLocaleString()} / {stage.target.toLocaleString()}
                </span>
                <i>
                  <b style={{ width: `${Math.min(100, stage.achievementPercent)}%` }} />
                </i>
              </a>
            ))}
            {!isLoading && !(data?.productionBreakdown ?? []).length ? (
              <p className="desk-book-empty">No production entries today.</p>
            ) : null}
          </div>
          <a href="/production-lines" className="desk-book-page-link">
            Open production ledger
          </a>
        </div>

        <div className="desk-book-rings" aria-hidden="true">
          {Array.from({ length: 6 }, (_, index) => (
            <span key={index} />
          ))}
        </div>

        <div className="desk-book-page desk-book-page--right">
          <div className="desk-book-page-heading">
            <BarChart3 aria-hidden="true" />
            Factory Overview
          </div>
          <div className="desk-book-metric-grid">
            <DeskMetric
              label="Active orders"
              value={value(data?.activeOrders)}
              href="/purchase-orders?status=active"
            />
            <DeskMetric
              label="Delayed"
              value={value(data?.delayedOrders)}
              href="/purchase-orders?status=delayed"
              urgent={(data?.delayedOrders ?? 0) > 0}
            />
            <DeskMetric
              label="At risk"
              value={value(data?.ordersAtRisk)}
              href="/purchase-orders?status=active"
            />
            <DeskMetric
              label="Approvals"
              value={value(data?.pendingApprovals)}
              href="/approvals?status=pending"
            />
            <DeskMetric
              label="Material pending"
              value={value(data?.materialPending)}
              href="/materials"
            />
            <DeskMetric
              label="Draft material POs"
              value={value(data?.draftMaterialPos)}
              href="/material-pos?status=Draft"
            />
            <DeskMetric
              label="Shipments"
              value={value(data?.pendingShipments)}
              href="/purchase-orders?status=Ready%20To%20Ship"
            />
            <DeskMetric
              label="Open issues"
              value={value(data?.openDailyLogs)}
              href="/daily-logs?status=Open"
            />
          </div>
          <div className="desk-book-achievement">
            <TrendingUp aria-hidden="true" />
            <span>Achievement</span>
            <strong>{value(data?.productionAchievementPercent, "%")}</strong>
          </div>
          <button type="button" className="desk-book-close" onClick={onClose}>
            Close ledger
          </button>
        </div>
      </div>

      <span className="desk-book-turning-page desk-book-turning-page--one" aria-hidden="true" />
      <span className="desk-book-turning-page desk-book-turning-page--two" aria-hidden="true" />

      <button
        type="button"
        className="desk-book-cover"
        onPointerDown={onToggle}
        onClick={(event) => {
          if (event.detail === 0) onToggle();
        }}
        aria-expanded={isOpen}
        aria-label={isOpen ? "Close dashboard book" : "Open dashboard book"}
      >
        <span className="desk-book-cover-rule" />
        <BarChart3 aria-hidden="true" />
        <strong>Dashboard</strong>
        <small>Factory Executive Ledger</small>
        <span className="desk-book-cover-corner desk-book-cover-corner--one" />
        <span className="desk-book-cover-corner desk-book-cover-corner--two" />
      </button>
      <span className="desk-book-ribbon" aria-hidden="true" />
    </section>
  );
}

function DeskMetric({
  label,
  value,
  href,
  urgent = false,
}: {
  label: string;
  value: string;
  href: string;
  urgent?: boolean;
}) {
  return (
    <a href={href} className={cn("desk-book-metric", urgent && "is-urgent")}>
      <span>{label}</span>
      <strong>{value}</strong>
    </a>
  );
}

function DailyNotebook({
  tasks,
  logs,
}: {
  tasks: Array<{ label: string; count: number }>;
  logs: Array<{ id: string; title: string }>;
}) {
  return (
    <Link to="/daily-logs" className="desk-notebook" aria-label="Open daily planner">
      <span className="desk-notebook-cover" aria-hidden="true" />
      <span className="desk-notebook-page desk-notebook-page--left">
        <strong>Notes</strong>
        {(logs.length ? logs.slice(0, 3).map((log) => log.title) : ["Factory floor review"]).map(
          (note, index) => (
            <span key={`${note}-${index}`}>- {note}</span>
          ),
        )}
      </span>
      <span className="desk-notebook-page desk-notebook-page--right">
        <strong>Today&apos;s Plan</strong>
        {tasks.map((task) => (
          <span key={task.label}>
            <i>{task.count === 0 ? <Check aria-hidden="true" /> : null}</i>
            {task.label}
            {task.count > 0 ? <b>{task.count}</b> : null}
          </span>
        ))}
      </span>
      <span className="desk-notebook-rings" aria-hidden="true" />
      <span className="desk-notebook-pen" aria-hidden="true" />
    </Link>
  );
}

function ReportStack({
  isLoading,
  orders,
  delayedOrders,
}: {
  isLoading: boolean;
  orders: Array<{ id: string; poNumber: string; styleCode: string; quantity: number }>;
  delayedOrders: number;
}) {
  return (
    <Link to="/reports" className="desk-report-stack" aria-label="Open reports">
      <span className="desk-report-sheet desk-report-sheet--back" aria-hidden="true" />
      <span className="desk-report-sheet desk-report-sheet--middle" aria-hidden="true" />
      <span className="desk-report-sheet desk-report-sheet--front">
        <strong>Factory Report</strong>
        <small>Current order register</small>
        <span className="desk-report-rule" />
        {orders.slice(0, 4).map((order) => (
          <span className="desk-report-order" key={order.id}>
            <b>{order.poNumber}</b>
            <i>{order.styleCode || "Style pending"}</i>
            <em>{order.quantity.toLocaleString()}</em>
          </span>
        ))}
        {!isLoading && !orders.length ? (
          <span className="desk-report-empty">No orders filed.</span>
        ) : null}
      </span>
      <span className="desk-report-tab">Reports</span>
      <span className="desk-report-sticky">
        {isLoading ? "Reviewing..." : `${delayedOrders} delayed to review`}
      </span>
    </Link>
  );
}

function ApprovalsTray({ count, isLoading }: { count: number; isLoading: boolean }) {
  return (
    <Link to="/approvals" className="desk-approval-tray" aria-label="Open pending approvals">
      <span className="desk-approval-tray-back" aria-hidden="true" />
      {Array.from({ length: 5 }, (_, index) => (
        <span
          key={index}
          className="desk-approval-folder"
          style={{ "--folder": index } as CSSProperties}
        >
          {index === 0 ? "Final approval" : index === 1 ? "Quality" : "Pending"}
        </span>
      ))}
      <span className="desk-approval-tray-front">
        <ClipboardCheck aria-hidden="true" />
        <strong>{isLoading ? "..." : count}</strong>
        <small>Pending approvals</small>
      </span>
    </Link>
  );
}

function DeskDrawerMenu() {
  const [isOpen, setIsOpen] = useState(false);
  const { profile, signOut, isDemoMode } = useAuth();
  const visibleItems = workspaceNavItems.filter((item) => canAccessPath(profile?.role, item.url));

  return (
    <nav className={cn("desk-office-drawer", isOpen && "is-open")} aria-label="Office files">
      <div className="desk-office-drawer-panel">
        <div className="desk-office-drawer-heading">
          <span>
            <strong>{profile?.fullName || profile?.email || "Factory office"}</strong>
            <small>{isDemoMode ? "Demo desk" : profile?.role}</small>
          </span>
          <button type="button" onClick={signOut}>
            Sign out
          </button>
        </div>
        <div className="desk-office-folder-grid">
          {visibleItems.map((item) => {
            const Icon = item.icon;
            return (
              <Link key={item.url} to={item.url} onClick={() => setIsOpen(false)}>
                <Icon aria-hidden="true" />
                <span>{item.title}</span>
              </Link>
            );
          })}
        </div>
      </div>
      <button
        type="button"
        className="desk-office-drawer-front"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
      >
        <span />
        <strong>Office Files</strong>
      </button>
    </nav>
  );
}

function DeskMagnifier({
  data,
  isOpen,
  onToggle,
  onClose,
}: {
  data: ReturnType<typeof useDashboard>["data"];
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const searchItems = useMemo(
    () => [
      ...(data?.recentPurchaseOrders ?? []).map((order) => ({
        id: `po-${order.id}`,
        label: order.poNumber,
        detail: `${order.customerName || order.buyer || "Customer"} - ${order.styleCode || "Style pending"}`,
        href: "/purchase-orders",
      })),
      ...(data?.recentDailyLogs ?? []).map((log) => ({
        id: `log-${log.id}`,
        label: log.title,
        detail: `${log.departmentOrStage || "Factory"} - ${log.status}`,
        href: "/daily-logs",
      })),
      ...workspaceNavItems.map((item) => ({
        id: `route-${item.url}`,
        label: item.title,
        detail: "Workspace file",
        href: item.url,
      })),
    ],
    [data],
  );
  const normalizedQuery = query.trim().toLowerCase();
  const results = searchItems
    .filter((item) =>
      normalizedQuery
        ? `${item.label} ${item.detail}`.toLowerCase().includes(normalizedQuery)
        : true,
    )
    .slice(0, 6);

  return (
    <div className={cn("desk-search-tool", isOpen && "is-open")}>
      <button
        type="button"
        className="desk-magnifier"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-label="Desk search magnifier"
      >
        <span className="desk-magnifier-lens">
          <Search aria-hidden="true" />
        </span>
        <span className="desk-magnifier-collar" />
        <span className="desk-magnifier-handle" />
      </button>
      <section className="desk-search-sheet" aria-label="Desk search results" aria-hidden={!isOpen}>
        <header>
          <Search aria-hidden="true" />
          <strong>Search the desk</strong>
          <button type="button" onClick={onClose} aria-label="Close desk search">
            <X aria-hidden="true" />
          </button>
        </header>
        <label>
          <span>PO, customer, style or workspace</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search records..."
          />
        </label>
        <div className="desk-search-results">
          {results.map((item) => (
            <a key={item.id} href={item.href}>
              <strong>{item.label}</strong>
              <span>{item.detail}</span>
            </a>
          ))}
          {!results.length ? <p>No matching desk records.</p> : null}
        </div>
      </section>
    </div>
  );
}

function DeskPhone({
  data,
  isOpen,
  onToggle,
  onClose,
}: {
  data: ReturnType<typeof useDashboard>["data"];
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  return (
    <div className={cn("desk-communication-tool", isOpen && "is-open")}>
      <button
        type="button"
        className="desk-phone"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-label="Factory telephone"
      >
        <span className="desk-phone-handset" />
        <span className="desk-phone-screen">Factory office</span>
        <span className="desk-phone-keypad">
          {Array.from({ length: 12 }, (_, index) => (
            <i key={index} />
          ))}
        </span>
        <span className="desk-phone-cord" />
      </button>
      <section
        className="desk-communication-slip"
        aria-label="Factory communications"
        aria-hidden={!isOpen}
      >
        <header>
          <Phone aria-hidden="true" />
          <strong>Communication</strong>
          <button type="button" onClick={onClose} aria-label="Close factory communications">
            <X aria-hidden="true" />
          </button>
        </header>
        <p>{data?.openDailyLogs ?? 0} open factory notes need attention.</p>
        <div>
          <Link to="/customers">Customer directory</Link>
          <Link to="/vendors">Vendor directory</Link>
          <Link to="/daily-logs">Factory logbook</Link>
        </div>
        {(data?.recentDailyLogs ?? []).slice(0, 2).map((log) => (
          <small key={log.id}>{log.title}</small>
        ))}
      </section>
    </div>
  );
}

function PenHolder() {
  return (
    <div className="desk-pen-holder" aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
    </div>
  );
}

function TeaCup() {
  return (
    <div className="desk-tea-set" aria-label="Tea cup">
      <span className="desk-tea-saucer" />
      <span className="desk-tea-cup">
        <i />
      </span>
      <span className="desk-tea-steam desk-tea-steam--one" />
      <span className="desk-tea-steam desk-tea-steam--two" />
    </div>
  );
}
