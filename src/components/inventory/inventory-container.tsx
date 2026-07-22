import { useSuspenseQuery } from "@tanstack/react-query";
import {
  ArrowRightLeft,
  PlusIcon,
  Pencil,
  Eye,
  Warehouse,
  Package,
  TrendingUp,
} from "lucide-react";
import { useEffect, useState } from "react";
import { motion, Variants } from "framer-motion";

import { getInventoryFn } from "@/server-functions/inventory/get-inventory-fn";
import { GenericEmpty } from "../custom/empty";
import { InventoryEmptyIllustration } from "@/components/illustrations/InventoryEmptyIllustration";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { AddWarehouseDialog } from "./add-warehouse-dialog";
import { ManageWarehouseStatusDialog } from "./manage-warehouse-status-dialog";
import { EditWarehouseDialog } from "./edit-warehouse-dialog";
import { WarehouseDetailsDialog } from "./warehouse-details-dialog";
import { FinishedGoodsTable } from "./finished-goods-table";
import { TransferStockDialog } from "./transfer-stock-dialog";
import { TooltipWrapper } from "../custom/tooltip-wrapper";
import { cn } from "@/lib/utils";

// ── Animation Variants ─────────────────────────────────────────────────────

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.1, delayChildren: 0.05 },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 15 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: "spring", stiffness: 300, damping: 30 },
  },
};

// ── Component ──────────────────────────────────────────────────────────────

export const InventoryContainer = () => {
  const [selectedWarehouse, setSelectedWarehouse] = useState<string>("all");
  const [isAddWarehouseOpen, setAddWarehouseOpen] = useState(false);
  const [isTransferOpen, setTransferOpen] = useState(false);
  const [isEditWarehouseOpen, setEditWarehouseOpen] = useState(false);
  const [isDetailsWarehouseOpen, setDetailsWarehouseOpen] = useState(false);

  const { data: warehouses } = useSuspenseQuery({
    queryKey: ["inventory"],
    queryFn: getInventoryFn,
    refetchInterval: 1000,
  });

  useEffect(() => {
    if (
      selectedWarehouse !== "all" &&
      !warehouses.find((w) => w.id === selectedWarehouse)
    ) {
      setSelectedWarehouse("all");
    }
  }, [warehouses, selectedWarehouse]);

  if (warehouses.length === 0) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
        <GenericEmpty
          icon={InventoryEmptyIllustration}
          title="Ready to store Stock?"
          description="Add a warehouse facility to start managing your finished goods inventory."
          ctaText="Add Warehouse"
          onAddChange={setAddWarehouseOpen}
        />
        <AddWarehouseDialog
          onOpenChange={setAddWarehouseOpen}
          open={isAddWarehouseOpen}
          forcedType="storage"
        />
      </motion.div>
    );
  }

  const storageWarehouses = warehouses.filter((w) => w.type === "storage");
  const activeWarehouseCount = storageWarehouses.filter((w) => w.isActive).length;

  const finishedGoods = storageWarehouses.flatMap((w) =>
    (selectedWarehouse === "all" || w.id === selectedWarehouse
      ? w.finishedGoodsStock || []
      : []
    ).map((fg) => ({
      ...fg,
      warehouse: { id: w.id, name: w.name, isActive: w.isActive },
    })),
  );

  const selectedWarehouseData =
    selectedWarehouse !== "all"
      ? warehouses.find((w) => w.id === selectedWarehouse)
      : null;

  return (
    <motion.div variants={containerVariants} initial="hidden" animate="show" className="space-y-6">

      {/* ── Toolbar ───────────────────────────────────────────────────── */}
      <motion.div variants={itemVariants} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 border border-border bg-card rounded-none shadow-none">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          {/* Warehouse Selector */}
          <Select value={selectedWarehouse} onValueChange={setSelectedWarehouse}>
            <SelectTrigger className="w-full sm:w-[240px] h-10 bg-background border-border text-[13px] font-medium rounded-none shadow-none focus:ring-1 focus:ring-primary">
              <SelectValue placeholder="Select warehouse" />
            </SelectTrigger>
            <SelectContent className="rounded-none shadow-none border-border">
              <SelectItem value="all" className="text-[13px] rounded-none">
                <div className="flex items-center gap-2">
                  <Warehouse className="size-3.5 text-muted-foreground" />
                  All Warehouses
                </div>
              </SelectItem>
              {storageWarehouses.map((w) => (
                <SelectItem key={w.id} value={w.id} className="text-[13px] rounded-none">
                  <div className="flex items-center gap-2">
                    <div
                      className={cn(
                        "size-1.5 rounded-none shrink-0",
                        w.isActive ? "bg-emerald-500" : "bg-slate-400",
                      )}
                    />
                    {w.name}
                    {!w.isActive && (
                      <Badge
                        variant="outline"
                        className="text-[9px] h-4 px-1 rounded-none text-muted-foreground ml-1"
                      >
                        Inactive
                      </Badge>
                    )}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Per-warehouse actions */}
          {selectedWarehouse !== "all" && storageWarehouses.length > 0 && (
            <div className="flex items-center gap-1 sm:border-l border-border sm:pl-4">
              <TooltipWrapper tooltipContent="View Details">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setDetailsWarehouseOpen(true)}
                  className="size-9 rounded-none text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                >
                  <Eye className="size-4" />
                </Button>
              </TooltipWrapper>
              <TooltipWrapper tooltipContent="Edit Warehouse">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setEditWarehouseOpen(true)}
                  className="size-9 rounded-none text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  <Pencil className="size-4" />
                </Button>
              </TooltipWrapper>
              <ManageWarehouseStatusDialog
                warehouseId={selectedWarehouse}
                warehouseName={selectedWarehouseData?.name || ""}
                isActive={selectedWarehouseData?.isActive ?? true}
                otherWarehouses={warehouses.filter(
                  (w) => w.id !== selectedWarehouse && w.isActive,
                )}
              />
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          <Button
            variant="outline"
            onClick={() => setTransferOpen(true)}
            className="h-10 flex-1 sm:flex-none gap-2 text-[13px] font-medium rounded-none border-border hover:bg-muted transition-colors shadow-none"
          >
            <ArrowRightLeft className="size-3.5" />
            Transfer Stock
          </Button>
          <Button
            onClick={() => setAddWarehouseOpen(true)}
            className="h-10 flex-1 sm:flex-none gap-2 text-[13px] font-medium rounded-none shadow-none"
          >
            <PlusIcon className="size-3.5" />
            Add Warehouse
          </Button>
        </div>
      </motion.div>

      {/* ── Sharp KPI Cards ───────────────────────────────────────────── */}
      <motion.div variants={itemVariants} className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <SharpKPICard
          icon={Warehouse}
          label="Total Warehouses"
          value={storageWarehouses.length.toString()}
          subtext={`${activeWarehouseCount} active`}
          theme="blue"
        />
        <SharpKPICard
          icon={Package}
          label="Finished Goods"
          value={finishedGoods.length.toString()}
          subtext={
            selectedWarehouse === "all"
              ? "Across all warehouses"
              : `In ${selectedWarehouseData?.name || "selected warehouse"}`
          }
          theme="emerald"
        />
        <SharpKPICard
          icon={TrendingUp}
          label="Active Locations"
          value={activeWarehouseCount.toString()}
          subtext={`${storageWarehouses.length - activeWarehouseCount} inactive`}
          theme="violet"
        />
      </motion.div>

      {/* ── Stock Tables ───────────────────────────────────────────────── */}
      <motion.div variants={itemVariants}>
        <Tabs defaultValue="finished" className="w-full">
          <div className="flex items-center justify-between mb-4 border-b border-border pb-px">
            <TabsList className="bg-transparent p-0 h-10 rounded-none w-full justify-start space-x-2">
              <TabsTrigger
                value="finished"
              // className="gap-2 px-4 h-10 text-[13px] rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none font-medium"
              >
                <Package className="size-3.5" />
                Finished Goods
                {finishedGoods.length > 0 && (
                  <span className="ml-1 text-[10px] font-bold bg-muted text-muted-foreground px-1.5 py-0.5 rounded-none">
                    {finishedGoods.length}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="finished" className="mt-0 focus-visible:outline-none border border-border bg-card rounded-none shadow-none">
            <FinishedGoodsTable
              data={finishedGoods as any}
              warehouses={warehouses}
              preselectedWarehouse={
                selectedWarehouse === "all" ? undefined : selectedWarehouse
              }
            />
          </TabsContent>
        </Tabs>
      </motion.div>

      {/* ── Dialogs ─────────────────────────────────────────────────────── */}
      <AddWarehouseDialog
        open={isAddWarehouseOpen}
        onOpenChange={setAddWarehouseOpen}
        forcedType="storage"
      />
      <TransferStockDialog
        open={isTransferOpen}
        onOpenChange={setTransferOpen}
        warehouses={warehouses}
      />

      {selectedWarehouse !== "all" &&
        (() => {
          const activeWarehouse = warehouses.find(
            (w) => w.id === selectedWarehouse,
          );
          if (!activeWarehouse) return null;
          return (
            <>
              <EditWarehouseDialog
                open={isEditWarehouseOpen}
                onOpenChange={setEditWarehouseOpen}
                warehouse={activeWarehouse as any}
              />
              <WarehouseDetailsDialog
                open={isDetailsWarehouseOpen}
                onOpenChange={setDetailsWarehouseOpen}
                warehouse={activeWarehouse as any}
              />
            </>
          );
        })()}
    </motion.div>
  );
};

// ── Sharp Pixel-Perfect KPI Component ───────────────────────────────────────

interface SharpKPICardProps {
  label: string;
  value: string;
  icon: any;
  theme: "blue" | "rose" | "emerald" | "violet";
  subtext?: string;
}

const sharpThemeStyles = {
  blue: { border: "border-t-blue-500", iconBg: "bg-blue-500/10", iconText: "text-blue-500" },
  rose: { border: "border-t-rose-500", iconBg: "bg-rose-500/10", iconText: "text-rose-500" },
  emerald: { border: "border-t-emerald-500", iconBg: "bg-emerald-500/10", iconText: "text-emerald-500" },
  violet: { border: "border-t-violet-500", iconBg: "bg-violet-500/10", iconText: "text-violet-500" },
};

function SharpKPICard({ label, value, icon: Icon, theme, subtext }: SharpKPICardProps) {
  const styles = sharpThemeStyles[theme];

  return (
    <motion.div
      whileHover={{ y: -2, transition: { duration: 0.2 } }}
      className={cn(
        "relative flex flex-col justify-between p-5 bg-card border border-border rounded-none shadow-none",
        "border-t-2",
        styles.border
      )}
    >
      {/* Technical Grid Pattern */}
      <div
        className="absolute inset-0 opacity-[0.02] dark:opacity-[0.04] pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px)`,
          backgroundSize: "8px 8px"
        }}
      />

      <div className="relative z-10 flex items-start justify-between mb-8">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {label}
        </p>
        <div className={cn("p-1.5 rounded-none", styles.iconBg)}>
          <Icon className={cn("size-4", styles.iconText)} />
        </div>
      </div>

      <div className="relative z-10 space-y-1">
        <h3 className="text-3xl font-bold tracking-tight text-foreground">
          {value}
        </h3>
        {subtext ? (
          <p className="text-xs font-medium text-muted-foreground/70">
            {subtext}
          </p>
        ) : (
          <div className="h-4" /> // Spacer for vertical alignment
        )}
      </div>
    </motion.div>
  );
}