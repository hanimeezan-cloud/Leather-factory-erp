import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard")({
  component: DashboardAlias,
});

function DashboardAlias() {
  return <Navigate to="/" replace />;
}
