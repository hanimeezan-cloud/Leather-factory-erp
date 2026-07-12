import { Link, useRouterState } from "@tanstack/react-router";
import { useState, type CSSProperties } from "react";

import { useAuth } from "@/lib/auth";
import { canAccessPath } from "@/lib/domain";
import { workspaceNavItems } from "@/lib/navigation";
import { cn } from "@/lib/utils";

const cabinetItems = [
  { title: "Dashboard", url: "/" },
  { title: "Customers", url: "/customers" },
  { title: "Purchase Orders", url: "/purchase-orders" },
  { title: "Styles / BOM", url: "/materials" },
  { title: "Materials", url: "/materials" },
  { title: "Vendors", url: "/vendors" },
  { title: "Material POs", url: "/material-pos" },
  { title: "Production", url: "/production-lines" },
  { title: "Reports", url: "/reports" },
  { title: "Daily Logs", url: "/daily-logs" },
  { title: "Approvals", url: "/approvals" },
  { title: "Users", url: "/users" },
];

export function FilingCabinetNav() {
  const [isOpen, setIsOpen] = useState(false);
  const currentPath = useRouterState({ select: (state) => state.location.pathname });
  const { profile } = useAuth();
  const sidebarUrls = new Set(workspaceNavItems.map((item) => item.url));
  const visibleItems = cabinetItems.filter(
    (item) => sidebarUrls.has(item.url) && canAccessPath(profile?.role, item.url),
  );

  if (!visibleItems.length) return null;

  const isActive = (path: string) =>
    path === "/" ? currentPath === "/" : currentPath.startsWith(path);
  const isPurchaseOrdersView = currentPath.startsWith("/purchase-orders");

  return (
    <nav
      className={cn("filing-cabinet-nav", isOpen && "filing-cabinet-nav--open")}
      aria-label="Filing cabinet navigation"
      onMouseEnter={() => setIsOpen(true)}
      onMouseLeave={() => setIsOpen(false)}
      onFocus={() => setIsOpen(true)}
    >
      <span className="filing-cabinet-tower" aria-hidden="true">
        <span className="filing-cabinet-paper-stack" />
        <span className="filing-cabinet-static-drawer filing-cabinet-static-drawer--one">
          Suppliers
        </span>
        <span className="filing-cabinet-static-drawer filing-cabinet-static-drawer--two">
          Materials
        </span>
        <span className="filing-cabinet-static-drawer filing-cabinet-static-drawer--three">
          Archive
        </span>
      </span>
      <button
        type="button"
        className="filing-cabinet-body"
        aria-expanded={isOpen}
        aria-controls="filing-cabinet-drawer"
        onClick={() => setIsOpen((open) => !open)}
      >
        <span className="filing-cabinet-handle" />
        <span className="filing-cabinet-label">
          {isPurchaseOrdersView ? "Purchase Orders" : "Files"}
        </span>
      </button>
      <div id="filing-cabinet-drawer" className="filing-cabinet-drawer">
        <div className="filing-cabinet-folder-stack">
          {visibleItems.map((item, index) => (
            <Link
              key={`${item.title}-${item.url}`}
              to={item.url}
              className={cn("filing-cabinet-folder", isActive(item.url) && "is-active")}
              style={{ "--folder-index": index } as CSSProperties}
              onClick={() => setIsOpen(false)}
            >
              <span>{item.title}</span>
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
