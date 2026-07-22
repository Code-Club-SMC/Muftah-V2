import { createFileRoute } from "@tanstack/react-router";
import { LoginForm } from "@/components/auth/login-form";
import { z } from "zod";

export const Route = createFileRoute("/_authLayout/login/")({
  validateSearch: z.object({
    redirect: z.string().optional(),
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { redirect } = Route.useSearch();

  return <LoginForm redirectTo={redirect} />;
}
