import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authLayout/sign-up/")({
  beforeLoad: () => {
    throw redirect({
      to: "/login",
    });
  },
  component: RouteComponent,
});

function RouteComponent() {
  return null;
}
