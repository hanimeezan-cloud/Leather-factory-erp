import {
  BarChart3,
  Building2,
  CheckSquare,
  ClipboardList,
  Factory,
  FileText,
  Handshake,
  LayoutDashboard,
  Package,
  PencilLine,
  Shield,
  Users,
} from "lucide-react";

export const workspaceNavItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Customers", url: "/customers", icon: Building2 },
  { title: "Purchase Orders", url: "/purchase-orders", icon: ClipboardList },
  { title: "Vendors", url: "/vendors", icon: Handshake },
  { title: "Materials", url: "/materials", icon: Package },
  { title: "Material POs", url: "/material-pos", icon: FileText },
  { title: "Approvals", url: "/approvals", icon: CheckSquare },
  { title: "Production Pipeline", url: "/production-lines", icon: Factory },
  { title: "Daily Logs", url: "/daily-logs", icon: PencilLine },
  { title: "Reports", url: "/reports", icon: BarChart3 },
  { title: "Users", url: "/users", icon: Users },
  { title: "Admin Tools", url: "/admin-tools", icon: Shield },
];
