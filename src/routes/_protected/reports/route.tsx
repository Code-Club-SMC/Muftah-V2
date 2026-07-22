import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_protected/reports")({
  component: ReportsLayout,
});

function ReportsLayout() {
  return <Outlet />;
}
