import { useState, useMemo, useCallback } from "react";
import { useParams } from "@tanstack/react-router";
import { MoreHorizontal, Box, Package, Archive, ShieldAlert, Scale, Plus, Layers, Trash2, Copy, Check } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CartonStatusBadge, PackCountBar } from "../components";
import type { CartonStatus } from "@/lib/cartons/carton.types";
import { useBulkCartonOperation } from "../hooks/use-carton-mutations";
import {
  BulkTopUpDialog,
  BulkRemoveDialog,
  BulkOverrideDialog,
  BulkRepackDialog,
  BulkHoldDialog,
  BulkReleaseHoldDialog,
} from "./bulk-action-dialogs";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
  PaginationLink,
  PaginationEllipsis,
} from "@/components/ui/pagination";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { GenericEmpty } from "@/components/custom/empty";
import { GenericLoader } from "@/components/custom/generic-loader";

export type CartonRow = {
  id: string;
  sku: string | null;
  capacity: number;
  currentPacks: number;
  status: CartonStatus;
  zone: string | null;
  weightAmount?: number;
  weightUnit?: string;
  createdAt: string | Date;
  updatedAt: string | Date;
};

type Props = {
  data: CartonRow[];
  isLoading?: boolean;
  page?: number;
  totalPages?: number;
  totalItems?: number;
  onPageChange?: (page: number) => void;
  error?: Error | null;
  onRetry?: () => void;
  onTopUp?: (carton: CartonRow) => void;
  onRemovePacks?: (carton: CartonRow) => void;
  onSetCount?: (carton: CartonRow) => void;
  onRepack?: (carton: CartonRow) => void;
  onRetire?: (carton: CartonRow) => void;
  onHold?: (carton: CartonRow) => void;
  onReleaseHold?: (carton: CartonRow) => void;
  onViewAuditLog?: (carton: CartonRow) => void;
  onTransfer?: (carton: CartonRow) => void;
};

export function CartonGrid({
  data,
  isLoading,
  page = 1,
  totalPages = 1,
  totalItems = 0,
  onPageChange,
  error,
  onRetry,
  onTopUp,
  onRemovePacks,
  onSetCount,
  onRepack,
  onRetire,
  onHold,
  onReleaseHold,
  onViewAuditLog,
  onTransfer,
}: Props) {
  const { runId } = useParams({ strict: false });
  const bulkMutation = useBulkCartonOperation(runId || "");

  const [activeBulkDialog, setActiveBulkDialog] = useState<
    | "TOP_UP"
    | "REMOVE"
    | "OVERRIDE"
    | "REPACK"
    | "QC_HOLD"
    | "RELEASE_HOLD"
    | "RETIRE"
    | null
  >(null);

  const handleBulkConfirm = (payload: any) => {
    if (!activeBulkDialog) return;
    
    let opType = activeBulkDialog as any;

    bulkMutation.mutate(
      {
        operationType: opType,
        cartonIds: Array.from(selectedIds),
        payload,
      },
      {
        onSuccess: () => {
          setActiveBulkDialog(null);
          setSelectedIds(new Set());
        },
      }
    );
  };

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const pageSize = 100;

  const copyCartonId = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    navigator.clipboard.writeText(id).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1800);
    });
  }, []);

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === data.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(data.map((c) => c.id)));
    }
  };

  const selectCount = (count: number) => {
    setSelectedIds(new Set(data.slice(0, count).map(c => c.id)));
  };

  if (error) {
    return (
      <div className="py-20 flex flex-col items-center justify-center gap-4 text-center">
        <div className="size-16 rounded-full bg-destructive/10 flex items-center justify-center">
          <ShieldAlert className="size-8 text-destructive" />
        </div>
        <div className="space-y-1">
          <h3 className="font-bold text-xl">Failed to load cartons</h3>
          <p className="text-muted-foreground text-sm max-w-xs mx-auto">
            {error.message || "An unexpected error occurred while fetching carton data."}
          </p>
        </div>
        {onRetry && (
          <Button onClick={onRetry} variant="outline" size="sm" className="mt-2">
            Try Again
          </Button>
        )}
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between px-1">
          <div className="h-7 w-48 bg-muted animate-pulse rounded" />
          <div className="h-7 w-32 bg-muted animate-pulse rounded" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="h-[260px] rounded-xl border border-border/60 bg-muted/20 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="py-16">
        <GenericEmpty
          icon={Package}
          title="No Cartons Found"
          description="Try adjusting your filters or adding new cartons to this batch."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 relative pb-20">
      <AnimatePresence>
        {selectedIds.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 50, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 flex items-center p-2 bg-[#09090b] text-white rounded-full shadow-2xl border border-white/10 ring-1 ring-white/5"
          >
            <div className="flex items-center pl-4 pr-6">
              <div className="flex items-center justify-center size-6 bg-white/20 rounded-full font-bold text-xs mr-3">
                {selectedIds.size}
              </div>
              <span className="font-semibold text-sm">Cartons Selected</span>
            </div>

            <div className="w-px h-6 bg-white/20 mx-1" />

            <div className="flex items-center gap-1 pl-2 pr-1">
              <Button
                size="sm"
                variant="ghost"
                className="h-9 rounded-full text-xs font-bold text-red-400 hover:text-red-300 hover:bg-red-950/50 px-4"
                onClick={() => setActiveBulkDialog("RETIRE")}
                disabled={bulkMutation.isPending}
              >
                <Trash2 className="size-3.5 mr-2" /> Retire All
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-9 rounded-full text-xs font-bold hover:bg-white/20 hover:text-white px-4"
                    disabled={bulkMutation.isPending}
                  >
                    <Layers className="size-3.5 mr-2" /> More Actions
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="dark bg-[#09090b] border-white/10 text-white">
                  <DropdownMenuItem className="hover:bg-white/10 cursor-pointer" onClick={() => setActiveBulkDialog("TOP_UP")}>Top-Up Packs</DropdownMenuItem>
                  <DropdownMenuItem className="hover:bg-white/10 cursor-pointer" onClick={() => setActiveBulkDialog("REMOVE")}>Remove Packs</DropdownMenuItem>
                  <DropdownMenuItem className="hover:bg-white/10 cursor-pointer" onClick={() => setActiveBulkDialog("OVERRIDE")}>Override Count</DropdownMenuItem>
                  <DropdownMenuItem className="hover:bg-white/10 cursor-pointer" onClick={() => setActiveBulkDialog("REPACK")}>Repack Cartons</DropdownMenuItem>
                  <DropdownMenuSeparator className="bg-white/10" />
                  <DropdownMenuItem className="hover:bg-white/10 cursor-pointer" onClick={() => setActiveBulkDialog("QC_HOLD")}>Apply QC Hold</DropdownMenuItem>
                  <DropdownMenuItem className="hover:bg-white/10 cursor-pointer" onClick={() => setActiveBulkDialog("RELEASE_HOLD")}>Release Hold</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <div className="w-px h-6 bg-white/20 mx-1" />

              <Button size="icon" variant="ghost" className="size-9 rounded-full hover:bg-white/20 hover:text-white ml-1" onClick={() => setSelectedIds(new Set())} title="Clear Selection">
                <Plus className="size-4 rotate-45" />
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Checkbox
              id="select-all"
              checked={data.length > 0 && selectedIds.size === data.length}
              onCheckedChange={toggleAll}
            />
            <label htmlFor="select-all" className="text-sm font-medium text-muted-foreground cursor-pointer">
              Select All on Page
            </label>
          </div>

          <div className="w-px h-4 bg-border" />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 text-xs px-3">
                Quick Select...
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-40">
              <DropdownMenuItem onClick={() => selectCount(10)} disabled={data.length < 10}>
                First 10
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => selectCount(25)} disabled={data.length < 25}>
                First 25
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => selectCount(50)} disabled={data.length < 50}>
                First 50
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={toggleAll}>
                All on Page ({data.length})
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4">
        {data.map((c) => {
          const isMutable = !["DISPATCHED", "RETIRED", "ARCHIVED"].includes(c.status);
          const isOnHold = c.status === "ON_HOLD";
          const shortId = c.id.slice(-6).toUpperCase();
          const isSelected = selectedIds.has(c.id);

          return (
            <div
              key={c.id}
              onClick={() => toggleSelection(c.id)}
              className={`relative group flex flex-col p-4 rounded-xl border transition-all duration-200 select-none cursor-pointer ${isSelected
                ? "border-primary ring-2 ring-primary/20 bg-primary/[0.03] shadow-md"
                : isOnHold
                  ? "border-amber-500/50 bg-amber-500/5"
                  : "border-border/60 hover:border-primary/50 bg-card hover:shadow-md"
                }`}
            >
              {/* Checkbox Overlay */}
              <div className={`absolute top-3 left-3 z-20 transition-all duration-200 ${isSelected ? "opacity-100 scale-100" : "opacity-0 scale-95 group-hover:opacity-100 group-hover:scale-100"}`}>
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => toggleSelection(c.id)}
                  className={`bg-background shadow-sm transition-colors ${isSelected ? "border-primary bg-primary text-primary-foreground" : ""}`}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>

              {/* Header: Status Badge & Actions */}
              <div className="flex justify-between items-start mb-3 pl-8">
                <CartonStatusBadge status={c.status} />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 -mr-2 -mt-2 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <MoreHorizontal className="size-4 text-muted-foreground" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    {isMutable && !isOnHold && onTopUp && (
                      <DropdownMenuItem onClick={() => onTopUp(c)}>Top-Up Packs</DropdownMenuItem>
                    )}
                    {isMutable && !isOnHold && onRemovePacks && (
                      <DropdownMenuItem onClick={() => onRemovePacks(c)}>Remove Packs</DropdownMenuItem>
                    )}
                    {isMutable && !isOnHold && onSetCount && (
                      <DropdownMenuItem onClick={() => onSetCount(c)}>Override Count</DropdownMenuItem>
                    )}
                    {isMutable && !isOnHold && onTransfer && (
                      <DropdownMenuItem onClick={() => onTransfer(c)}>Transfer Packs</DropdownMenuItem>
                    )}
                    {["COMPLETE", "SEALED"].includes(c.status) && onRepack && (
                      <DropdownMenuItem onClick={() => onRepack(c)}>Repack Carton</DropdownMenuItem>
                    )}
                    {isMutable && !isOnHold && onHold && (
                      <DropdownMenuItem onClick={() => onHold(c)}>Apply QC Hold</DropdownMenuItem>
                    )}
                    {isOnHold && onReleaseHold && (
                      <DropdownMenuItem onClick={() => onReleaseHold(c)}>Release Hold</DropdownMenuItem>
                    )}
                    {isMutable && onRetire && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => onRetire(c)}
                        >
                          Retire Carton
                        </DropdownMenuItem>
                      </>
                    )}
                    {onViewAuditLog && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => onViewAuditLog(c)}>
                          View Audit Log
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {/* ID & Icon */}
              <div className="flex flex-col items-center justify-center flex-1 py-3 text-center">
                {isOnHold ? (
                  <ShieldAlert className="size-10 text-amber-500/80 mb-3" />
                ) : c.status === "ARCHIVED" || c.status === "RETIRED" ? (
                  <Archive className="size-10 text-muted-foreground/50 mb-3" />
                ) : (
                  <Box className="size-10 text-primary/80 mb-3" />
                )}

                <span className="text-base font-semibold text-foreground leading-tight px-2">
                  {c.sku || "Unknown SKU"}
                </span>

                <span className="font-mono text-[10px] text-muted-foreground uppercase font-bold tracking-widest mt-1.5 opacity-70">
                  #{shortId}
                </span>

                {/* Copy ID button */}
                <button
                  onClick={(e) => copyCartonId(e, c.id)}
                  title="Copy carton ID"
                  className="mt-2 flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest text-muted-foreground/50 hover:text-primary transition-colors duration-150 group/copy"
                >
                  {copiedId === c.id ? (
                    <>
                      <Check className="size-2.5 text-emerald-500" />
                      <span className="text-emerald-500">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="size-2.5" />
                      <span>Copy ID</span>
                    </>
                  )}
                </button>
              </div>

              {/* Weight & Pack Count Bar */}
              <div className="mt-3 space-y-2">
                {c.weightAmount !== undefined && c.weightAmount > 0 && (
                  <div className="flex justify-between items-center text-[10px] font-bold text-muted-foreground uppercase bg-muted/50 px-2 py-1 rounded-md">
                    <span className="flex items-center gap-1"><Scale className="size-3" /> Est. Weight</span>
                    <span className="text-foreground">{c.weightAmount.toLocaleString()} {c.weightUnit}</span>
                  </div>
                )}
                <PackCountBar
                  current={c.currentPacks}
                  capacity={c.capacity}
                  size="sm"
                />
              </div>
            </div>
          );
        })}
      </div>

      {totalPages > 1 && (
        <div className="pt-4 flex items-center justify-between border-t border-dashed">
          <p className="text-sm text-muted-foreground font-medium">
            Showing {(page - 1) * pageSize + 1} to{" "}
            {Math.min(page * pageSize, totalItems)} of {totalItems} cartons
          </p>
          <Pagination className="justify-end mx-0 w-auto">
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    if (!isLoading && onPageChange) onPageChange(Math.max(1, page - 1));
                  }}
                  className={page === 1 || isLoading ? "pointer-events-none opacity-50" : ""}
                />
              </PaginationItem>

              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum = i + 1;
                if (totalPages > 5 && page > 3) {
                  pageNum = page - 2 + i;
                  if (pageNum > totalPages) pageNum = totalPages - (4 - i);
                }

                if (pageNum > totalPages || pageNum <= 0) return null;

                return (
                  <PaginationItem key={pageNum}>
                    <PaginationLink
                      href="#"
                      isActive={page === pageNum}
                      onClick={(e) => {
                        e.preventDefault();
                        if (!isLoading && onPageChange) onPageChange(pageNum);
                      }}
                      className={isLoading ? "pointer-events-none opacity-50" : ""}
                    >
                      {pageNum}
                    </PaginationLink>
                  </PaginationItem>
                );
              })}

              {totalPages > 5 && page < totalPages - 2 && (
                <PaginationItem>
                  <PaginationEllipsis />
                </PaginationItem>
              )}

              <PaginationItem>
                <PaginationNext
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    if (!isLoading && onPageChange) onPageChange(Math.min(totalPages, page + 1));
                  }}
                  className={page === totalPages || isLoading ? "pointer-events-none opacity-50" : ""}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}

      <BulkTopUpDialog
        open={activeBulkDialog === "TOP_UP"}
        onOpenChange={(open) => !open && setActiveBulkDialog(null)}
        cartonIds={Array.from(selectedIds)}
        onConfirm={handleBulkConfirm}
        isPending={bulkMutation.isPending}
      />

      <BulkRemoveDialog
        open={activeBulkDialog === "REMOVE"}
        onOpenChange={(open) => !open && setActiveBulkDialog(null)}
        cartonIds={Array.from(selectedIds)}
        onConfirm={handleBulkConfirm}
        isPending={bulkMutation.isPending}
      />

      <BulkOverrideDialog
        open={activeBulkDialog === "OVERRIDE"}
        onOpenChange={(open) => !open && setActiveBulkDialog(null)}
        cartonIds={Array.from(selectedIds)}
        onConfirm={handleBulkConfirm}
        isPending={bulkMutation.isPending}
      />

      <BulkRepackDialog
        open={activeBulkDialog === "REPACK"}
        onOpenChange={(open) => !open && setActiveBulkDialog(null)}
        cartonIds={Array.from(selectedIds)}
        onConfirm={handleBulkConfirm}
        isPending={bulkMutation.isPending}
      />

      <BulkHoldDialog
        open={activeBulkDialog === "QC_HOLD"}
        onOpenChange={(open) => !open && setActiveBulkDialog(null)}
        cartonIds={Array.from(selectedIds)}
        onConfirm={handleBulkConfirm}
        isPending={bulkMutation.isPending}
      />

      <AlertDialog
        open={activeBulkDialog === "RETIRE"}
        onOpenChange={(open) => !open && setActiveBulkDialog(null)}
      >
        <AlertDialogContent className="dark bg-[#09090b] border-white/10 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Retire Cartons</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              Are you sure you want to retire {selectedIds.size} cartons? This action is irreversible and will remove them from active inventory.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-transparent border-white/10 hover:bg-white/5">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white border-0"
              onClick={() => {
                bulkMutation.mutate({ operationType: "RETIRE", cartonIds: Array.from(selectedIds) });
                setActiveBulkDialog(null);
                setSelectedIds(new Set());
              }}
            >
              Confirm Retirement
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
