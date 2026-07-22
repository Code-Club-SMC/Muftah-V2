import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import {
  CheckCircle2,
  Info,
  AlertTriangle,
  XCircle,
  Loader2,
} from "lucide-react";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: <CheckCircle2 className="size-4 text-emerald-500" />,
        info: <Info className="size-4 text-blue-500" />,
        warning: <AlertTriangle className="size-4 text-amber-500" />,
        error: <XCircle className="size-4 text-destructive" />,
        loading: <Loader2 className="size-4 text-muted-foreground animate-spin" />,
      }}
      toastOptions={{
        classNames: {
          // The group-[.toaster] selector forces Tailwind to override Sonner's default inline theme variables
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg group-[.toaster]:border",
          title:
            "group-[.toast]:font-semibold group-[.toast]:text-foreground text-sm",
          description:
            "group-[.toast]:text-muted-foreground text-sm",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground group-[.toast]:font-medium group-[.toast]:rounded-md",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground group-[.toast]:font-medium group-[.toast]:rounded-md",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };