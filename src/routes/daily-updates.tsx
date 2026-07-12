import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/daily-updates")({
  head: () => ({
    meta: [
      { title: "Daily Logs - Footwear Production Hub" },
      { name: "description", content: "Daily Reports moved to the factory logbook." },
    ],
  }),
  component: () => <Navigate to="/daily-logs" replace />,
});
