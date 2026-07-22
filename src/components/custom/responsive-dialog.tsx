import type { ReactNode } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "../ui/drawer";
import { LucideIcon } from "lucide-react";

type ResponsiveDialogProps = {
  title: string;
  description: string;
  children: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  className?: string;
  icon?: LucideIcon;
  noScroll?: boolean;
};

export const ResponsiveDialog = ({
  description,
  title,
  children,
  open,
  onOpenChange,
  className,
  icon,
  noScroll,
}: ResponsiveDialogProps) => {
  const isMobile = useIsMobile();
  const Icon = icon;

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="rounded-none shadow-none">
          <DrawerHeader>
            <DrawerTitle className="flex items-center gap-2 text-primary">
              {Icon && <Icon className="size-6 text-primary" />}
              {title}
            </DrawerTitle>
            <DrawerDescription>{description}</DrawerDescription>
          </DrawerHeader>
          <div className="p-4">{children}</div>
        </DrawerContent>
      </Drawer>
    );
  }

  // Determine if consumer wants full bleed by checking if they passed p-0
  const isFullBleed = className?.includes("p-0");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "flex flex-col gap-0 max-h-[90vh] overflow-hidden rounded-none shadow-none",
          className,
        )}
      >
        <DialogHeader
          className={cn("shrink-0", isFullBleed ? "p-6 pb-4" : "pb-4")}
        >
          <DialogTitle className="flex items-center gap-2">
            {Icon && <Icon className="size-6 text-primary" />}
            {title}
          </DialogTitle>
          <DialogDescription className="font-medium">
            {description}
          </DialogDescription>
        </DialogHeader>
        <div
          className={cn(
            "flex flex-col min-h-0 flex-1 relative",
            noScroll ? "overflow-hidden" : "overflow-y-auto",
          )}
        >
          {children}
        </div>
      </DialogContent>
    </Dialog>
  );
};
