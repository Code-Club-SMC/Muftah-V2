import { useForm } from "@tanstack/react-form";
import { Link } from "@tanstack/react-router";
import { Loader2, Mail, ArrowLeft, CheckCircle2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { getAbsoluteAuthUrl } from "@/lib/auth-url";
import { forgotPasswordSchema } from "@/lib/validators";
import { FormWrapper } from "../custom/form-wrapper";
import { Field, FieldError, FieldGroup, FieldLabel } from "../ui/field";

export const ForgotPasswordForm = () => {
  const [isSent, setIsSent] = useState(false);
  const [isPending, startTransition] = useTransition();

  const form = useForm({
    defaultValues: {
      email: "",
    },
    validators: {
      onSubmit: forgotPasswordSchema,
    },
    onSubmit: async ({ value }) => {
      startTransition(async () => {
        await authClient.requestPasswordReset(
          {
            email: value.email,
            redirectTo: getAbsoluteAuthUrl("/reset-password"),
          },
          {
            onSuccess: () => {
              setIsSent(true);
            },
            onError: (ctx) => {
              toast.error(ctx.error.message || "Failed to send reset link");
            },
          },
        );
      });
    },
  });

  return (
    <FormWrapper>
      <div className="w-full max-w-[400px] mx-auto animate-in fade-in slide-in-from-bottom-4 duration-700 ease-out">
        <Card className="relative border-0 sm:border sm:border-border/40 shadow-none sm:shadow-[0_8px_30px_rgb(0,0,0,0.04)] dark:sm:shadow-[0_8px_30px_rgb(0,0,0,0.1)] sm:rounded-2xl bg-transparent sm:bg-card overflow-hidden">
          <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-primary/30 to-transparent hidden sm:block" />

          <CardHeader className="space-y-2 pt-8 pb-6 text-center">
            <CardTitle className="text-[22px] font-semibold tracking-tight text-foreground">
              Reset password
            </CardTitle>
            <CardDescription className="text-[14px]">
              {isSent
                ? "Check your email for a recovery link."
                : "Enter your email address to receive a link."}
            </CardDescription>
          </CardHeader>

          <CardContent className="px-4 sm:px-8 pb-8">
            {!isSent ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  form.handleSubmit();
                }}
                className="space-y-6"
              >
                <FieldGroup className="space-y-4">
                  <form.Field name="email">
                    {(field) => {
                      const errors = field.state.meta.errors;
                      const isInvalid = errors && errors.length > 0;
                      return (
                        <Field className="space-y-1.5">
                          <FieldLabel className="text-[13px] font-medium text-foreground/90 flex items-center gap-2">
                            <Mail className="size-3.5 text-muted-foreground/70" />
                            Email Address
                          </FieldLabel>
                          <Input
                            type="email"
                            name={field.name}
                            value={field.state.value}
                            onBlur={field.handleBlur}
                            onChange={(e) => field.handleChange(e.target.value)}
                            aria-invalid={isInvalid}
                            placeholder="name@company.com"
                            className="h-10 bg-muted/30 border-border/50 focus-visible:bg-background focus-visible:ring-4 focus-visible:ring-primary/10 transition-all rounded-lg text-[14px]"
                            autoFocus
                          />
                          {isInvalid && <FieldError errors={errors} />}
                        </Field>
                      );
                    }}
                  </form.Field>

                  <div className="pt-2">
                    <Button
                      variant="default"
                      disabled={isPending}
                      type="submit"
                      className="w-full h-10 font-medium text-[14px] rounded-lg  active:scale-[0.98] transition-all"
                    >
                      {isPending ? (
                        <>
                          <Loader2 className="mr-2 size-4 animate-spin" />
                          Sending link...
                        </>
                      ) : (
                        "Send reset link"
                      )}
                    </Button>
                  </div>

                  <div className="text-center pt-4">
                    <Link
                      to="/login"
                      className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <ArrowLeft className="size-3.5" />
                      Back to sign in
                    </Link>
                  </div>
                </FieldGroup>
              </form>
            ) : (
              <div className="space-y-6 animate-in fade-in zoom-in-95 duration-500">
                <div className="flex justify-center mb-6">
                  <div className="size-14 rounded-full bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center ring-8 ring-emerald-50/50 dark:ring-emerald-500/5">
                    <CheckCircle2 className="size-7 text-emerald-600 dark:text-emerald-500" />
                  </div>
                </div>

                <Link
                  className={buttonVariants({
                    variant: "default",
                    className:
                      "w-full h-10 font-medium text-[14px] rounded-lg ",
                  })}
                  to="/login"
                >
                  Return to sign in
                </Link>

                <div className="text-center text-[13px] text-muted-foreground">
                  Didn't receive an email?{" "}
                  <button
                    type="button"
                    onClick={() => setIsSent(false)}
                    className="font-medium text-foreground hover:text-primary transition-colors"
                  >
                    Try again
                  </button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </FormWrapper>
  );
};
