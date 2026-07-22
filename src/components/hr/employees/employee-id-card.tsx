import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CreditCard, Download, FlipHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  EmployeeCard,
  openEmployeeCardPrintWindow,
  type EmployeeCardEmployee,
} from "./employee-card";

interface EmployeeIDCardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: EmployeeCardEmployee;
}

export const EmployeeIDCard = ({
  open,
  onOpenChange,
  employee,
}: EmployeeIDCardProps) => {
  const [side, setSide] = useState<"front" | "back">("front");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-[460px]">
        <DialogHeader className="px-6 pb-2 pt-6">
          <DialogTitle className="flex items-center gap-2 text-base">
            <CreditCard className="size-4 text-muted-foreground" />
            Employee ID Card
          </DialogTitle>
          <DialogDescription>
            CR80 employee card with a Code 128 barcode for attendance scanning.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-3">
          <div className="flex items-center gap-1 rounded-lg bg-muted/50 p-1">
            <button
              type="button"
              onClick={() => setSide("front")}
              className={cn(
                "flex-1 rounded-md px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-all",
                side === "front"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Front
            </button>
            <button
              type="button"
              onClick={() => setSide("back")}
              className={cn(
                "flex-1 rounded-md px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-all",
                side === "back"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Back
            </button>
          </div>
        </div>

        <div className="flex justify-center px-6 pb-4">
          <EmployeeCard employee={employee} side={side} />
        </div>

        <div className="flex gap-2 px-6 pb-6">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => openEmployeeCardPrintWindow(employee)}
          >
            <Download className="mr-2 size-4" />
            Print Card
          </Button>
          <Button
            variant="ghost"
            className="flex-1"
            onClick={() => setSide(side === "front" ? "back" : "front")}
          >
            <FlipHorizontal className="mr-2 size-4" />
            Flip
          </Button>
          <Button variant="ghost" className="flex-1" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
