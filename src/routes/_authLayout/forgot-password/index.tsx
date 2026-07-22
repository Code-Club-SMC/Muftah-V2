import { createFileRoute } from "@tanstack/react-router";
import { ForgotPasswordForm } from "@/components/auth/forgot-pasword-form";

export const Route = createFileRoute("/_authLayout/forgot-password/")({
  component: RouteComponent,
});

function RouteComponent() {
  return <ForgotPasswordForm />;
}
