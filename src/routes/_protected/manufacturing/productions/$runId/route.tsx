import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute(
  "/_protected/manufacturing/productions/$runId",
)({
  component: () => <Outlet />,
});