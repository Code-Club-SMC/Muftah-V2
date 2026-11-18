import { createFileRoute, redirect } from "@tanstack/react-router";

// Old address of the By-Products page.
export const Route = createFileRoute("/_protected/finance/other-income/")({
  beforeLoad: () => {
    throw redirect({ to: "/finance/by-products", replace: true });
  },
});
