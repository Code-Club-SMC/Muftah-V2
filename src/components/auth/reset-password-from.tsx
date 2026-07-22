import { useForm } from "@tanstack/react-form";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { KeyRound, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { authClient } from "@/lib/auth-client";
import { resetPasswordSchema } from "@/lib/validators";
import { FormWrapper } from "../custom/form-wrapper";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "../ui/field";
import { PasswordInput } from "../custom/password-input";

export const ResetPasswordForm = () => {
  const navigate = useNavigate();
  // Preserved exactly how you are fetching the token from the router
  const { token } = useSearch({ from: "/_authLayout/reset-password/" });

  const form = useForm({
    defaultValues: {
      password: "",
      confirmPassword: "",
    },
    validators: {
      onSubmit: resetPasswordSchema,
    },
    onSubmit: async ({ value }) => {
      await authClient.resetPassword(
        {
          newPassword: value.password,
          token: token,
        },
        {
          onSuccess: () => {
            toast.success("Password reset successfully. You can now log in.");
            navigate({ to: "/login" });
          },
          onError: (ctx) => {
            toast.error(ctx.error.message || "Failed to reset password.");
          },
        },
      );
    },
  });

  return (
    <FormWrapper>
      <Card className="border-border/60 ">
        <CardHeader className="text-center pb-2">
          <CardTitle className="text-2xl font-bold">Reset Password</CardTitle>
          <CardDescription>
            Please establish a new, secure password for your account.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              form.handleSubmit();
            }}
            className="space-y-6"
          >
            <FieldGroup className="space-y-4">
              <form.Field name="password">
                {(field) => {
                  const errors = field.state.meta.errors;
                  const isInvalid = errors && errors.length > 0;
                  return (
                    <Field>
                      <FieldLabel className="flex items-center gap-2 mb-1.5">
                        <KeyRound className="size-4 text-muted-foreground" />
                        <span className="text-sm font-semibold">
                          New Password
                        </span>
                      </FieldLabel>
                      <PasswordInput
                        name={field.name}
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(e.target.value)}
                        aria-invalid={isInvalid}
                        placeholder="••••••••"
                        autoComplete="new-password"
                        autoFocus
                      />
                      {isInvalid && <FieldError errors={errors} />}
                    </Field>
                  );
                }}
              </form.Field>

              <form.Field name="confirmPassword">
                {(field) => {
                  const errors = field.state.meta.errors;
                  const isInvalid = errors && errors.length > 0;
                  return (
                    <Field>
                      <FieldLabel className="flex items-center gap-2 mb-1.5">
                        <ShieldCheck className="size-4 text-muted-foreground" />
                        <span className="text-sm font-semibold">
                          Confirm New Password
                        </span>
                      </FieldLabel>
                      <PasswordInput
                        name={field.name}
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(e.target.value)}
                        aria-invalid={isInvalid}
                        placeholder="••••••••"
                        autoComplete="new-password"
                      />
                      {isInvalid && <FieldError errors={errors} />}
                    </Field>
                  );
                }}
              </form.Field>

              <div className="pt-2">
                <form.Subscribe selector={(s: any) => s.isSubmitting}>
                  {(isSubmitting: boolean) => (
                    <Button
                      disabled={isSubmitting}
                      type="submit"
                      className="w-full"
                    >
                      {isSubmitting
                        ? "Resetting Password..."
                        : "Update Password"}
                    </Button>
                  )}
                </form.Subscribe>
              </div>

              <div className="text-center pt-2">
                <FieldDescription>
                  Remembered your password?{" "}
                  <Link
                    to="/login"
                    className="font-semibold text-foreground hover:underline underline-offset-4 transition-all"
                  >
                    Log in
                  </Link>
                </FieldDescription>
              </div>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </FormWrapper>
  );
};
