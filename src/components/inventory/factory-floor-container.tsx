import { Package, Beaker, Box, Wrench } from "lucide-react";
import { useState } from "react";
import { motion, AnimatePresence, Variants } from "framer-motion";
import { useSuspenseQuery, useQuery, keepPreviousData } from "@tanstack/react-query";

import { getFactoryFloorStockFn } from "@/server-functions/inventory/factory-floor/get-factory-floor-stocks-fn";
import { getConsumptionHistoryFn } from "@/server-functions/inventory/factory-floor/get-consumption-history-fn";
import { getWarehousesFn } from "@/server-functions/inventory/get-warehouses-fn";
import { useViewerAccess } from "@/hooks/use-viewer-access";
import { hasPermission } from "@/lib/rbac";

import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
import { GenericEmpty } from "../custom/empty";
import { AddWarehouseDialog } from "./add-warehouse-dialog";
import { StockTable } from "./stock-table";
import { FinishedGoodsTable } from "./finished-goods-table";
import { LowStockAlerts } from "./low-stocks-alert";
import { ConsumptionTable } from "./consumption-table";
import { AdjustStockDialog } from "./adjust-stock-dialog";
import { Button } from "../ui/button";
import { FactoryFloorProductionIllustration } from "../illustrations/FactoryFloorProductionIllustration";
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

const tabContentVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: "easeOut" } },
  exit: { opacity: 0, y: -10, transition: { duration: 0.2, ease: "easeIn" } }
};

// ── Component ──────────────────────────────────────────────────────────────

export const FactoryFloorContainer = () => {
  const { data: viewerAccess } = useViewerAccess();
  const { data: factoryFloor } = useSuspenseQuery({
    queryKey: ["factory-floor"],
    queryFn: getFactoryFloorStockFn,
    refetchInterval: 50000,
  });

  const { data: allWarehouses } = useSuspenseQuery({
    queryKey: ["warehouses"],
    queryFn: getWarehousesFn,
  });

  const [consumptionSearch, setConsumptionSearch] = useState("");
  const [consumptionPagination, setConsumptionPagination] = useState({ pageIndex: 0, pageSize: 5 });

  const { data: consumptionData, isFetching: isConsumptionFetching } = useQuery({
    queryKey: ["consumption-history", consumptionSearch, consumptionPagination],
    queryFn: () => getConsumptionHistoryFn({
      data: {
        search: consumptionSearch,
        pageIndex: consumptionPagination.pageIndex,
        pageSize: consumptionPagination.pageSize,
      }
    }),
    placeholderData: keepPreviousData,
    refetchInterval: 50000,
  });

  const [activeTab, setActiveTab] = useState("raw");
  const [isAddFactoryOpen, setAddFactoryOpen] = useState(false);
  const [adjustDialogOpen, setAdjustDialogOpen] = useState(false);
  const [adjustTarget, setAdjustTarget] = useState<{
    materialType: "chemical" | "packaging";
    materialId: string;
    materialName: string;
    currentStock: number;
    unit: string;
  } | null>(null);

  const canManageInventory = viewerAccess
    ? hasPermission(viewerAccess.permissions, "inventory.manage")
    : false;
  const canRecoverFailedBatch = viewerAccess
    ? canManageInventory ||
      hasPermission(viewerAccess.permissions, "operator.run.fail")
    : false;
  const canOpenInventoryDetail = viewerAccess
    ? hasPermission(viewerAccess.permissions, "inventory.view")
    : false;

  if (!factoryFloor) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
        <GenericEmpty
          icon={FactoryFloorProductionIllustration}
          title="No Factory Floor Configured"
          description="You haven't set up a Factory Floor warehouse yet. Create a production facility to start tracking chemicals and packaging."
          ctaText="Add Factory Floor"
          onAddChange={setAddFactoryOpen}
        />
        <AddWarehouseDialog open={isAddFactoryOpen} onOpenChange={setAddFactoryOpen} forcedType="factory_floor" />
      </motion.div>
    );
  }

  const rawMaterials = factoryFloor.materialStock
    .filter((s) => s.chemicalId !== null)
    .map((s) => ({ ...s, warehouse: { name: factoryFloor.name, isActive: factoryFloor.isActive } }));

  const packagingMaterials = factoryFloor.materialStock
    .filter((s) => s.packagingMaterialId !== null && s.packagingMaterial?.type !== "sticker")
    .map((s) => ({ ...s, warehouse: { name: factoryFloor.name, isActive: factoryFloor.isActive } }));

  const stickers = factoryFloor.materialStock
    .filter((s) => s.packagingMaterialId !== null && s.packagingMaterial?.type === "sticker")
    .map((s) => ({ ...s, warehouse: { name: factoryFloor.name, isActive: factoryFloor.isActive } }));

  const finishedGoods = factoryFloor.finishedGoodsStock.map((fg) => ({
    ...fg,
    warehouse: { id: factoryFloor.id, name: factoryFloor.name, isActive: factoryFloor.isActive },
  }));
  const totalFinishedCartons = finishedGoods.reduce(
    (sum, fg) => sum + Number(fg.cartonStats?.total ?? fg.quantityCartons ?? 0),
    0,
  );
  const totalFinishedLooseUnits = finishedGoods.reduce(
    (sum, fg) => sum + Number(fg.quantityContainers ?? 0),
    0,
  );

  const handleAdjustStock = (item: any, type: "chemical" | "packaging") => {
    const material = type === "chemical" ? item.chemical : item.packagingMaterial;
    if (!material) return;
    setAdjustTarget({
      materialType: type,
      materialId: material.id,
      materialName: material.name,
      currentStock: parseFloat(item.quantity),
      unit: type === "chemical" ? material.unit || "kg" : "pcs",
    });
    setAdjustDialogOpen(true);
  };

  return (
    <motion.div variants={containerVariants} initial="hidden" animate="show" className="space-y-6">

      {/* ── Sharp KPI Cards ───────────────────────────────────────────────── */}
      <motion.div variants={itemVariants} className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <SharpKPICard
          label="Chemicals"
          value={rawMaterials.length.toString()}
          icon={Beaker}
          theme="blue"
          subtext="Chemicals & Ingredients"
        />
        <SharpKPICard
          label="Packaging"
          value={packagingMaterials.length.toString()}
          icon={Package}
          theme="violet"
          subtext="Bottles, Caps, Cartons"
        />
        <SharpKPICard
          label="Finished Goods"
          value={`${totalFinishedCartons} Cartons`}
          icon={Box}
          theme="emerald"
          subtext={`+ ${totalFinishedLooseUnits} Loose Units`}
        />
      </motion.div>

      {/* ── Filter Tabs and Header Actions ────────────────────────────────── */}
      <motion.div variants={itemVariants} className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b pb-4">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-fit">
          <TabsList className="bg-muted/50 rounded-none border border-border">
            <TabsTrigger className="rounded-none" value="raw">Chemicals</TabsTrigger>
            <TabsTrigger className="rounded-none" value="packaging">Packaging</TabsTrigger>
            <TabsTrigger className="rounded-none" value="stickers">Stickers</TabsTrigger>
            <TabsTrigger className="rounded-none" value="finished">Finished Goods</TabsTrigger>
            <TabsTrigger className="rounded-none" value="consumption">Consumption</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-2">
          <LowStockAlerts />
        </div>
      </motion.div>

      {/* ── Dynamic Tab Content ───────────────────────────────────────────── */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          variants={tabContentVariants}
          initial="hidden"
          animate="show"
          exit="exit"
          className="pt-2"
        >
          {activeTab === "finished" && (
            <FinishedGoodsTable
              data={finishedGoods as any}
              warehouses={allWarehouses as any}
              preselectedWarehouse={factoryFloor.id}
              canTransfer={canManageInventory}
              canManageCartons={canManageInventory}
              canViewDetails={canOpenInventoryDetail}
            />
          )}

          {activeTab === "raw" && (
            <div className="space-y-4">
              <div className="flex justify-end">
                <Button variant="outline" size="sm" className="rounded-none" disabled>
                  <Wrench className="size-3 mr-1.5" />
                  {canManageInventory
                    ? "Use row actions to adjust stock"
                    : "Use row actions to recover failed batches"}
                </Button>
              </div>
              <StockTable
                data={rawMaterials as any}
                type="chemical"
                warehouses={allWarehouses as any}
                preselectedWarehouse={factoryFloor.id}
                hideAddButton={true}
                hideActions={true}
                showViewAction={canOpenInventoryDetail}
                onAdjustStock={
                  canRecoverFailedBatch
                    ? (item) => handleAdjustStock(item, "chemical")
                    : undefined
                }
              />
            </div>
          )}

          {activeTab === "packaging" && (
            <StockTable
              data={packagingMaterials as any}
              type="packaging"
              warehouses={allWarehouses as any}
              preselectedWarehouse={factoryFloor.id}
              hideAddButton={true}
              hideActions={true}
              showViewAction={canOpenInventoryDetail}
              onAdjustStock={
                canManageInventory
                  ? (item) => handleAdjustStock(item, "packaging")
                  : undefined
              }
            />
          )}

          {activeTab === "stickers" && (
            <StockTable
              data={stickers as any}
              type="packaging"
              warehouses={allWarehouses as any}
              preselectedWarehouse={factoryFloor.id}
              hideAddButton={true}
              hideActions={true}
              showViewAction={canOpenInventoryDetail}
              onAdjustStock={
                canManageInventory
                  ? (item) => handleAdjustStock(item, "packaging")
                  : undefined
              }
            />
          )}

          {activeTab === "consumption" && (
            <ConsumptionTable data={consumptionData?.data as any} totalCount={consumptionData?.totalCount} searchQuery={consumptionSearch} isPending={isConsumptionFetching} onSearchChange={(val) => { setConsumptionSearch(val); setConsumptionPagination((prev) => ({ ...prev, pageIndex: 0 })); }} pagination={consumptionPagination} onPaginationChange={setConsumptionPagination} />
          )}
        </motion.div>
      </AnimatePresence>

      {/* ── Adjust Stock Dialog ───────────────────────────────────────────── */}
      {adjustTarget && (
        <AdjustStockDialog open={adjustDialogOpen} onOpenChange={(open) => { setAdjustDialogOpen(open); if (!open) setAdjustTarget(null); }} materialType={adjustTarget.materialType} materialId={adjustTarget.materialId} materialName={adjustTarget.materialName} currentStock={adjustTarget.currentStock} unit={adjustTarget.unit} />
      )}
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
      <div
        className="absolute inset-0 opacity-[0.02] dark:opacity-[0.04] pointer-events-none"
        style={{ backgroundImage: `linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px)`, backgroundSize: "8px 8px" }}
      />
      <div className="relative z-10 flex items-start justify-between mb-8">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{label}</p>
        <div className={cn("p-1.5 rounded-none", styles.iconBg)}>
          <Icon className={cn("size-4", styles.iconText)} />
        </div>
      </div>
      <div className="relative z-10 space-y-1">
        <h3 className="text-3xl font-bold tracking-tight text-foreground">{value}</h3>
        {subtext ? <p className="text-xs font-medium text-muted-foreground/70">{subtext}</p> : <div className="h-4" />}
      </div>
    </motion.div>
  );
}
