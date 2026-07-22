import { createFileRoute } from "@tanstack/react-router";
import z from "zod";
import { ResetPasswordForm } from "@/components/auth/reset-password-from";
import { ResetPasswordError } from "@/components/errors/reset-password-error";

const searchParamsValidator = z.object({
  token: z.string({ error: "token is missing!" }).min(10).readonly(),
});

export const Route = createFileRoute("/_authLayout/reset-password/")({
  validateSearch: searchParamsValidator,
  errorComponent: () => <ResetPasswordError />,
  component: RouteComponent,
});

function RouteComponent() {
  return <ResetPasswordForm />;
}
