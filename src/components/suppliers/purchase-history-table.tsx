import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "../ui/button";
import { packagingUnit } from "@/lib/inventory/material-units";
import type { PackagingKind } from "@/lib/inventory/packaging-kind";
import {
  EyeIcon,
  PencilIcon,
  Trash2Icon,
  BanknoteIcon,
  MoreHorizontal,
  ShoppingCart,
  ChevronRight,
  Search,
  ChevronsUpDown,
  X,
  Package,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMemo, useState, Fragment } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { PurchaseVoidMetadata } from "./purchase-void-audit";

export type PurchaseRecord = PurchaseVoidMetadata & {
  id: string;
  createdAt: string | Date;
  purchaseDate?: string | Date;
  cost: string;
  paidAmount: string;
  quantity: string;
  unitCost: string;
  materialType: string;
  chemicalId?: string | null;
  packagingMaterialId?: string | null;
  paymentMethod?: string | null;
  stockLeft?: number | null;
  chemical?: {
    id: string;
    name: string;
    unit: string;
    minimumStockLevel: string | null;
  } | null;
  packagingMaterial?: {
    id: string;
    name: string;
    type: string;
    capacity: string | null;
    capacityUnit: string | null;
    minimumStockLevel: number | null;
    measuredInKg?: boolean | null;
    packagingKind?: PackagingKind | null;
  } | null;
  paidBy?: string | null;
  notes?: string | null;
  invoiceNumber?: string | null;
  transactionId?: string | null;
  lastPayment?: any;
};

// ── Grouping types & logic ──────────────────────────────────────────────────

export type MaterialGroup = {
  /** Unique key: materialType + materialId */
  key: string;
  materialId: string;
  materialName: string;
  materialType: string;
  unit: string;
  totalQty: number;
  totalCost: number;
  totalPaid: number;
  totalStockLeft: number | null;
  latestDate: Date;
  purchaseCount: number;
  records: PurchaseRecord[];
};

export function groupByMaterial(records: PurchaseRecord[]): MaterialGroup[] {
  const map = new Map<string, MaterialGroup>();

  for (const r of records || []) {
    const rawId =
      r.chemical?.id ??
      r.chemicalId ??
      r.packagingMaterial?.id ??
      r.packagingMaterialId ??
      r.id;
    const materialType = r.materialType || "chemical";
    const key = `${materialType}:${rawId}`;

    let group = map.get(key);
    if (!group) {
      const unit =
        r.chemical?.unit ??
        (materialType === "packaging" || r.packagingMaterial
          ? packagingUnit(r.packagingMaterial)
          : "units");
      const materialName =
        r.chemical?.name ??
        r.packagingMaterial?.name ??
        r.voidSnapshot?.materialName ?? "Unknown Material";

      group = {
        key,
        materialId: rawId,
        materialName,
        materialType,
        unit,
        totalQty: 0,
        totalCost: 0,
        totalPaid: 0,
        totalStockLeft: null,
        latestDate: new Date(0),
        purchaseCount: 0,
        records: [],
      };
      map.set(key, group);
    }

    const qty = parseFloat(r.quantity || "0") || 0;
    const cost = parseFloat(r.cost || "0") || 0;
    const paid = parseFloat(r.paidAmount || "0") || 0;
    const date = new Date(r.purchaseDate ?? r.createdAt);

    if (!r.voidedAt) {
      group.totalQty += qty;
      group.totalCost += cost;
      group.totalPaid += paid;
    }

    if (r.stockLeft !== null && r.stockLeft !== undefined) {
      group.totalStockLeft = (group.totalStockLeft ?? 0) + (r.voidedAt ? 0 : Number(r.stockLeft));
    }

    if (date > group.latestDate) {
      group.latestDate = date;
    }

    group.purchaseCount += 1;
    group.records.push(r);
  }

  // Sort sub-records inside each group newest first
  for (const group of map.values()) {
    group.records.sort((a, b) => {
      const dateA = new Date(a.purchaseDate ?? a.createdAt).getTime();
      const dateB = new Date(b.purchaseDate ?? b.createdAt).getTime();
      return dateB - dateA;
    });
  }

  // Sort groups by latest purchase date desc (most recent activity on top)
  return Array.from(map.values()).sort(
    (a, b) => b.latestDate.getTime() - a.latestDate.getTime(),
  );
}

// ── Payment status badge ────────────────────────────────────────────────────

function PaymentBadge({ cost, paidAmount }: { cost: number; paidAmount: number }) {
  const remaining = cost - paidAmount;
  if (remaining <= 0.1) {
    return (
      <Badge
        variant="default"
        className="bg-green-600 hover:bg-green-700 h-5 px-1.5 text-[10px]"
      >
        Paid
      </Badge>
    );
  }
  if (paidAmount > 0) {
    return (
      <Badge
        variant="secondary"
        className="bg-yellow-100 text-yellow-800 hover:bg-yellow-200 h-5 px-1.5 text-[10px]"
      >
        Partial
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="text-red-500 border-red-200 bg-red-50 h-5 px-1.5 text-[10px]"
    >
      Unpaid
    </Badge>
  );
}

// ── Props ───────────────────────────────────────────────────────────────────

type Props = {
  data: PurchaseRecord[];
  setSelectedItem: (item: PurchaseRecord) => void;
  setDetailsOpen: (open: boolean) => void;
  setEditDialogOpen: (open: boolean) => void;
  setDeleteDialogOpen: (open: boolean) => void;
  onRecordPayment: (item: PurchaseRecord) => void;
  onRestock?: (item: PurchaseRecord) => void;
  onCreateReport?: (item: PurchaseRecord) => void;
  isLoading?: boolean;
  manualPagination?: boolean;
  pageCount?: number;
  pagination?: { pageIndex: number; pageSize: number };
  onPaginationChange?: (updater: any) => void;
  totalRecords?: number;
};

// ── Component ───────────────────────────────────────────────────────────────

export const PurchaseHistoryTable = ({
  data,
  setSelectedItem,
  setDetailsOpen,
  setEditDialogOpen,
  setDeleteDialogOpen,
  onRecordPayment,
  onRestock,
  onCreateReport,
  isLoading = false,
  manualPagination = false,
  pageCount,
  pagination,
  onPaginationChange,
  totalRecords,
}: Props) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  // Group the incoming purchase records by material
  const allGroups = useMemo(() => groupByMaterial(data), [data]);

  // Client-side search filter by material name or material type
  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return allGroups;
    const q = searchQuery.toLowerCase().trim();
    return allGroups.filter(
      (g) =>
        g.materialName.toLowerCase().includes(q) ||
        g.materialType.toLowerCase().includes(q) ||
        g.records.some(
          (r) =>
            r.invoiceNumber?.toLowerCase().includes(q) ||
            r.notes?.toLowerCase().includes(q),
        ),
    );
  }, [allGroups, searchQuery]);

  const toggleGroup = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const allExpanded =
    filteredGroups.length > 0 &&
    filteredGroups.every((g) => expandedKeys.has(g.key));

  const toggleExpandAll = () => {
    if (allExpanded) {
      setExpandedKeys(new Set());
    } else {
      setExpandedKeys(new Set(filteredGroups.map((g) => g.key)));
    }
  };

  return (
    <div className="w-full border border-border/60 bg-card rounded-xl overflow-hidden shadow-xs">
      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 px-4 py-3 border-b border-border/50 bg-muted/10">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            placeholder="Search material, invoice, notes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-8 pl-8 pr-7 bg-background border-border/60 rounded-md text-[13px] shadow-none"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto">
          {filteredGroups.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={toggleExpandAll}
              className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground border-border/60 gap-1.5"
            >
              <ChevronsUpDown className="size-3.5" />
              {allExpanded ? "Collapse All" : "Expand All"}
            </Button>
          )}

          <span className="text-xs text-muted-foreground font-medium pl-1">
            {filteredGroups.length} material{filteredGroups.length !== 1 ? "s" : ""}
            <span className="opacity-40 mx-1.5">•</span>
            {filteredGroups.reduce((acc, g) => acc + g.purchaseCount, 0)} purchase{filteredGroups.reduce((acc, g) => acc + g.purchaseCount, 0) !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {/* ── Table ───────────────────────────────────────────────────────── */}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader className="bg-muted/20">
            <TableRow className="hover:bg-transparent border-b border-border/50">
              <TableHead className="w-9 pl-4 pr-1 text-center py-3 h-auto" />
              <TableHead className="text-[12px] font-medium text-muted-foreground py-3 h-auto min-w-[200px]">
                Material & Type
              </TableHead>
              <TableHead className="text-[12px] font-medium text-muted-foreground py-3 h-auto text-right min-w-[110px]">
                Total Purchased
              </TableHead>
              <TableHead className="text-[12px] font-medium text-muted-foreground py-3 h-auto text-right min-w-[100px]">
                Left in Stock
              </TableHead>
              <TableHead className="text-[12px] font-medium text-muted-foreground py-3 h-auto min-w-[90px]">
                Status
              </TableHead>
              <TableHead className="text-[12px] font-medium text-muted-foreground py-3 h-auto text-right min-w-[110px]">
                Total Paid
              </TableHead>
              <TableHead className="text-[12px] font-medium text-muted-foreground py-3 h-auto text-right min-w-[110px]">
                Total Due
              </TableHead>
              <TableHead className="text-[12px] font-medium text-muted-foreground py-3 h-auto pr-4 text-right min-w-[120px]">
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={8} className="h-32 text-center p-0">
                  <div className="flex flex-col items-center justify-center gap-2 py-10">
                    <div className="size-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    <p className="text-xs text-muted-foreground">Loading purchases...</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : filteredGroups.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-32 text-center p-0">
                  <div className="flex flex-col items-center justify-center gap-1.5 py-10">
                    <Package className="size-8 text-muted-foreground/40 stroke-1 mb-1" />
                    <p className="text-sm font-medium text-muted-foreground">
                      {searchQuery ? "No matching materials found" : "No purchase records available"}
                    </p>
                    <p className="text-xs text-muted-foreground/70">
                      {searchQuery
                        ? "Try adjusting your search terms"
                        : "Use 'Add Chemical' or 'Add Packaging' above to record the first purchase."}
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filteredGroups.map((group) => {
                const isExpanded = expandedKeys.has(group.key);
                const totalDue = group.totalCost - group.totalPaid;

                return (
                  <Fragment key={group.key}>
                    {/* ── Summary Row (Material Group) ── */}
                    <TableRow
                      onClick={() => toggleGroup(group.key)}
                      className={cn(
                        "group/row cursor-pointer transition-colors border-b border-border/40 hover:bg-muted/40",
                        isExpanded ? "bg-muted/30" : "bg-card",
                      )}
                    >
                      {/* Expand / Collapse Chevron */}
                      <TableCell className="w-9 pl-4 pr-1 py-3 text-center">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleGroup(group.key);
                          }}
                          className="size-6 inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted/80 transition-colors"
                          aria-label={isExpanded ? "Collapse group" : "Expand group"}
                        >
                          <ChevronRight
                            className={cn(
                              "size-4 transition-transform duration-200 text-muted-foreground",
                              isExpanded && "rotate-90 text-foreground",
                            )}
                          />
                        </button>
                      </TableCell>

                      {/* Material Name & Badge */}
                      <TableCell className="py-3">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm text-foreground">
                              {group.materialName}
                            </span>
                            <Badge
                              variant="secondary"
                              className="text-[10px] h-5 px-1.5 font-mono text-muted-foreground bg-muted font-normal"
                            >
                              {group.purchaseCount} purchase{group.purchaseCount !== 1 ? "s" : ""}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                            <Badge
                              variant="outline"
                              className="text-[10px] h-4.5 px-1.5 capitalize border-border/70"
                            >
                              {group.materialType}
                            </Badge>
                            <span>
                              Latest: {format(group.latestDate, "MMM d, yyyy")}
                            </span>
                          </div>
                        </div>
                      </TableCell>

                      {/* Total Quantity */}
                      <TableCell className="py-3 text-right">
                        <span className="font-mono text-xs font-semibold text-foreground">
                          {group.totalQty.toLocaleString(undefined, {
                            maximumFractionDigits: 3,
                          })}{" "}
                          <span className="text-muted-foreground font-normal">
                            {group.unit}
                          </span>
                        </span>
                      </TableCell>

                      {/* Stock Left */}
                      <TableCell className="py-3 text-right">
                        {group.totalStockLeft !== null ? (
                          <span
                            className={cn(
                              "font-mono font-medium text-xs whitespace-nowrap",
                              group.totalStockLeft <= 0
                                ? "text-muted-foreground"
                                : "text-foreground",
                            )}
                          >
                            {group.totalStockLeft.toLocaleString(undefined, {
                              maximumFractionDigits: 3,
                            })}
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs font-mono">-</span>
                        )}
                      </TableCell>

                      {/* Payment Status Badge */}
                      <TableCell className="py-3">
                        {group.records.every(r => r.voidedAt) ? <Badge variant="secondary">Voided</Badge> : <PaymentBadge
                          cost={group.totalCost}
                          paidAmount={group.totalPaid}
                        />}
                      </TableCell>

                      {/* Total Paid */}
                      <TableCell className="py-3 text-right">
                        <span className="text-emerald-600 dark:text-emerald-400 font-semibold font-mono text-xs whitespace-nowrap">
                          {group.totalPaid.toLocaleString(undefined, {
                            minimumFractionDigits: 0,
                            maximumFractionDigits: 0,
                          })}
                        </span>
                      </TableCell>

                      {/* Total Due */}
                      <TableCell className="py-3 text-right">
                        <span
                          className={cn(
                            "font-mono text-xs whitespace-nowrap",
                            totalDue > 0
                              ? "text-red-500 dark:text-red-400 font-bold"
                              : "text-muted-foreground",
                          )}
                        >
                          {totalDue.toLocaleString(undefined, {
                            minimumFractionDigits: 0,
                            maximumFractionDigits: 0,
                          })}
                        </span>
                      </TableCell>

                      {/* Action: Buy Again on summary row */}
                      <TableCell className="py-3 pr-4 text-right">
                        <div
                          className="flex justify-end items-center gap-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {onRestock && group.records.some(r => !r.voidedAt) && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 gap-1.5 text-xs font-medium border-dashed hover:border-primary/50 hover:bg-primary/5"
                              onClick={() => {
                                // Default to the most recent purchase of this material as template
                                const active = group.records.find(r => !r.voidedAt);
                                if (active) {
                                  onRestock(active);
                                }
                              }}
                            >
                              <ShoppingCart className="size-3.5 text-primary" />
                              Buy Again
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>

                    {/* ── Sub-Rows (Individual Purchases Breakdown) ── */}
                    {isExpanded &&
                      group.records.map((record) => {
                        const recCost = parseFloat(record.cost || "0");
                        const recPaid = parseFloat(record.paidAmount || "0");
                        const recDue = record.voidedAt ? 0 : recCost - recPaid;
                        const recUnit =
                          record.chemical?.unit ||
                          (record.materialType === "packaging" || record.packagingMaterial
                            ? packagingUnit(record.packagingMaterial)
                            : group.unit);

                        return (
                          <TableRow
                            key={record.id}
                            className="bg-muted/15 hover:bg-muted/25 border-b border-border/25 transition-colors text-xs"
                          >
                            {/* Branch connector visual */}
                            <TableCell className="w-9 pl-4 pr-1 py-2.5 text-center">
                              <div className="w-3.5 h-3.5 border-l-2 border-b-2 border-border/60 rounded-bl-sm ml-2.5 -mt-1.5" />
                            </TableCell>

                            {/* Purchase Date & Invoice */}
                            <TableCell className="py-2.5">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium text-foreground">
                                  {format(
                                    new Date(record.purchaseDate ?? record.createdAt),
                                    "MMM d, yyyy",
                                  )}
                                </span>
                                {record.invoiceNumber && (
                                  <span className="font-mono text-[11px] text-muted-foreground/80 bg-background/80 px-1.5 py-0.5 rounded border border-border/50">
                                    INV: {record.invoiceNumber}
                                  </span>
                                )}
                                {record.unitCost && (
                                  <span className="text-[11px] text-muted-foreground font-mono">
                                    @ PKR {parseFloat(record.unitCost).toLocaleString(undefined, {
                                      minimumFractionDigits: 0,
                                      maximumFractionDigits: 2,
                                    })}/{recUnit}
                                  </span>
                                )}
                              </div>
                            </TableCell>

                            {/* Quantity for this purchase */}
                            <TableCell className="py-2.5 text-right font-mono text-muted-foreground">
                              {parseFloat(record.quantity).toLocaleString(undefined, {
                                maximumFractionDigits: 3,
                              })}{" "}
                              {recUnit}
                            </TableCell>

                            {/* Stock left for this purchase */}
                            <TableCell className="py-2.5 text-right font-mono">
                              {record.stockLeft !== null && record.stockLeft !== undefined ? (
                                <span
                                  className={
                                    record.stockLeft <= 0
                                      ? "text-muted-foreground/60"
                                      : "text-foreground font-medium"
                                  }
                                >
                                  {record.stockLeft.toLocaleString(undefined, {
                                    maximumFractionDigits: 3,
                                  })}
                                </span>
                              ) : (
                                <span className="text-muted-foreground/50">-</span>
                              )}
                            </TableCell>

                            {/* Status */}
                            <TableCell className="py-2.5">
                              {record.voidedAt ? <Badge variant="secondary">Voided</Badge> : <PaymentBadge cost={recCost} paidAmount={recPaid} />}
                            </TableCell>

                            {/* Paid amount */}
                            <TableCell className="py-2.5 text-right font-mono text-emerald-600/90 dark:text-emerald-400/90">
                              {recPaid.toLocaleString(undefined, {
                                minimumFractionDigits: 0,
                                maximumFractionDigits: 0,
                              })}
                            </TableCell>

                            {/* Due amount */}
                            <TableCell className="py-2.5 text-right font-mono">
                              <span
                                className={
                                  recDue > 0
                                    ? "text-red-500 font-semibold"
                                    : "text-muted-foreground/60"
                                }
                              >
                                {recDue.toLocaleString(undefined, {
                                  minimumFractionDigits: 0,
                                  maximumFractionDigits: 0,
                                })}
                              </span>
                            </TableCell>

                            {/* Action menu for individual purchase */}
                            <TableCell className="py-2.5 pr-4 text-right">
                              <div className="flex justify-end items-center gap-1.5">
                                {onRestock && !record.voidedAt && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 px-2 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
                                    onClick={() => onRestock(record)}
                                    title="Buy Again using this purchase's price"
                                  >
                                    <ShoppingCart className="size-3" />
                                    <span className="hidden lg:inline">Restock</span>
                                  </Button>
                                )}

                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      className="size-7 p-0 text-muted-foreground hover:text-foreground"
                                      aria-label="Actions menu"
                                    >
                                      <MoreHorizontal className="size-3.5" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end" className="w-44">
                                    <DropdownMenuLabel className="text-xs">
                                      Purchase Record
                                    </DropdownMenuLabel>
                                    <DropdownMenuGroup>
                                    <DropdownMenuItem
                                      onClick={() => {
                                        setSelectedItem(record);
                                        setDetailsOpen(true);
                                      }}
                                    >
                                      <EyeIcon className="mr-2 size-3.5" />
                                      View Details
                                    </DropdownMenuItem>

                                    {onCreateReport && !record.voidedAt && record.materialType === "chemical" && record.chemical && <DropdownMenuItem onClick={() => onCreateReport(record)}>
                                      Create report
                                    </DropdownMenuItem>}

                                    {!record.voidedAt && recDue > 0 && (
                                      <DropdownMenuItem
                                        onClick={() => onRecordPayment(record)}
                                      >
                                        <BanknoteIcon className="mr-2 size-3.5 text-emerald-600" />
                                        Record Payment
                                      </DropdownMenuItem>
                                    )}

                                    {!record.voidedAt && <>
                                    <DropdownMenuSeparator />

                                    <DropdownMenuItem
                                      onClick={() => {
                                        setSelectedItem(record);
                                        setEditDialogOpen(true);
                                      }}
                                    >
                                      <PencilIcon className="mr-2 size-3.5" />
                                      Edit Record
                                    </DropdownMenuItem>

                                    <DropdownMenuItem
                                      className="text-red-600 focus:text-red-600"
                                      onClick={() => {
                                        setSelectedItem(record);
                                        setDeleteDialogOpen(true);
                                      }}
                                    >
                                      <Trash2Icon className="mr-2 size-3.5" />
                                      Void purchase
                                    </DropdownMenuItem>
                                    </>}
                                    </DropdownMenuGroup>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                  </Fragment>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* ── Pagination Footer ───────────────────────────────────────────── */}
      {manualPagination && pagination && onPaginationChange && (
        <PaginationFooter
          pagination={pagination}
          pageCount={pageCount ?? 1}
          totalRecords={totalRecords ?? data.length}
          onPaginationChange={onPaginationChange}
        />
      )}
    </div>
  );
};

// ── Pagination Footer Subcomponent ─────────────────────────────────────────

function PaginationFooter({
  pagination,
  pageCount,
  totalRecords,
  onPaginationChange,
}: {
  pagination: { pageIndex: number; pageSize: number };
  pageCount: number;
  totalRecords: number;
  onPaginationChange: (updater: any) => void;
}) {
  const currentPage = pagination.pageIndex;
  const totalPages = Math.max(1, pageCount);
  const canPrev = currentPage > 0;
  const canNext = currentPage < totalPages - 1;

  return (
    <div className="flex items-center justify-between px-5 py-3 border-t border-border/50 bg-muted/10">
      <div className="text-[13px] text-muted-foreground">
        Page{" "}
        <span className="font-medium text-foreground">{currentPage + 1}</span>{" "}
        of{" "}
        <span className="font-medium text-foreground">{totalPages}</span>
        <span className="mx-2 opacity-50">•</span>
        <span className="font-medium text-foreground">{totalRecords}</span>{" "}
        records
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            onPaginationChange((prev: any) => ({
              ...prev,
              pageIndex: prev.pageIndex - 1,
            }))
          }
          disabled={!canPrev}
          className="h-8 px-3 rounded-md border-border/60 text-[13px] font-medium hover:bg-muted/50 disabled:opacity-50 transition-all shadow-none"
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            onPaginationChange((prev: any) => ({
              ...prev,
              pageIndex: prev.pageIndex + 1,
            }))
          }
          disabled={!canNext}
          className="h-8 px-3 rounded-md border-border/60 text-[13px] font-medium hover:bg-muted/50 disabled:opacity-50 transition-all shadow-none"
        >
          Next
        </Button>
      </div>
    </div>
  );
}
