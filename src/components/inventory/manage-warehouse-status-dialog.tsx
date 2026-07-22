import { useState } from "react";
import {
  Loader2,
  Archive,
  ArchiveRestore,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Label } from "../ui/label";
import { useToggleWarehouseStatus } from "@/hooks/inventory/use-toggle-warehouse-status";
import { useDeleteWarehouse } from "@/hooks/inventory/use-delete-warehouse";
import { TooltipWrapper } from "../custom/tooltip-wrapper";

type Props = {
  warehouseId: string;
  warehouseName: string;
  isActive: boolean;
  otherWarehouses: { id: string; name: string }[];
};

export const ManageWarehouseStatusDialog = ({
  warehouseId,
  warehouseName,
  isActive,
  otherWarehouses,
}: Props) => {
  const [open, setOpen] = useState(false);
  const [transferToId, setTransferToId] = useState<string | undefined>(
    undefined,
  );
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const { mutate: toggleStatus, isPending: isToggling } =
    useToggleWarehouseStatus();
  const { mutate: deleteWarehouse, isPending: isDeleting } =
    useDeleteWarehouse();

  const isPending = isToggling || isDeleting;

  const handleToggle = () => {
    toggleStatus(
      {
        data: {
          warehouseId,
          isActive: !isActive,
          transferToWarehouseId: isActive ? transferToId : undefined,
        },
      },
      {
        onSuccess: () => {
          setOpen(false);
        },
      },
    );
  };

  const handleDelete = () => {
    deleteWarehouse(
      { data: { warehouseId } },
      {
        onSuccess: () => {
          setOpen(false);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <TooltipWrapper
          tooltipContent={
            isActive ? "Deactivate Warehouse" : "Reactivate Warehouse"
          }
        >
          <Button
            onClick={() => setOpen(true)}
            variant="ghost"
            size="icon"
            className={
              isActive
                ? "text-muted-foreground hover:bg-muted/10 hover:text-foreground"
                : "text-green-600 hover:bg-green-100/10 hover:text-green-500"
            }
          >
            {isActive ? (
              <Archive className="size-4" />
            ) : (
              <ArchiveRestore className="size-4" />
            )}
          </Button>
        </TooltipWrapper>
      </DialogTrigger>
      <DialogContent className="min-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isActive ? (
              <Archive className="size-5" />
            ) : (
              <ArchiveRestore className="size-5" />
            )}
            {isActive ? "Deactivate Warehouse" : "Reactivate Warehouse"}
          </DialogTitle>
          <DialogDescription>
            {isActive ? (
              <span>
                Are you sure you want to deactivate{" "}
                <strong>{warehouseName}</strong>? This will hide it from
                selection menus but preserve data.
              </span>
            ) : (
              <span>
                Are you sure you want to reactivate{" "}
                <strong>{warehouseName}</strong>? This will make it available
                for selection again.
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        {isActive && (
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Transfer Stock To (Optional)</Label>
              <Select value={transferToId} onValueChange={setTransferToId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select warehouse to transfer stock..." />
                </SelectTrigger>
                <SelectContent>
                  {otherWarehouses.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                If you don't select a warehouse, all stock in {warehouseName}{" "}
                will be archived/hidden.
              </p>
            </div>
          </div>
        )}

        <DialogFooter className="flex flex-col sm:flex-row gap-2">
          <div className="flex-1 flex justify-start">
            {!showDeleteConfirm ? (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive px-2"
                onClick={() => setShowDeleteConfirm(true)}
                disabled={isPending}
              >
                <Trash2 className="size-4 mr-2" />
                Delete Permanently
              </Button>
            ) : (
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDelete}
                disabled={isPending}
              >
                {isPending ? (
                  <Loader2 className="size-4 animate-spin mr-2" />
                ) : (
                  <AlertTriangle className="size-4 mr-2" />
                )}
                Confirm Delete
              </Button>
            )}
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setOpen(false);
                setShowDeleteConfirm(false);
              }}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              variant={isActive ? "default" : "outline"}
              className={
                !isActive
                  ? "border-green-600 text-green-400 hover:text-green-500"
                  : ""
              }
              onClick={handleToggle}
              disabled={isPending || showDeleteConfirm}
            >
              {isToggling ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : isActive ? (
                "Deactivate Warehouse"
              ) : (
                "Reactivate Warehouse"
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
