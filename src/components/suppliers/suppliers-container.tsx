import { getSuppliersFn } from "@/server-functions/suppliers/get-suppliers-fn";
import { AddSupplierDialog } from "./add-supplier-dialog";
import { SuppliersTable } from "./suppliers-table";
import { useSuspenseQuery } from "@tanstack/react-query";
import { GenericEmpty } from "../custom/empty";
import { SupplierEmptyIllustration } from "../illustrations/SupplierEmptyIllustration";
import {
  Plus,
  Search,
  Users,
  Wallet,
  Activity,
  CalendarDays,
} from "lucide-react";
import { useState } from "react";
import { motion, Variants } from "framer-motion";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import {
  isToday,
  isThisMonth,
  subDays,
  isAfter,
  startOfDay,
  subMonths,
} from "date-fns";
import { cn } from "@/lib/utils";

// ── Animation Variants ─────────────────────────────────────────────────────

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.05,
    },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 15 },
  show: {
    opacity: 1,
    y: 0,
    transition: {
      type: "spring",
      stiffness: 300,
      damping: 30,
    },
  },
};

// ── Component ──────────────────────────────────────────────────────────────

export const SupplierContainer = () => {
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFilter, setDateFilter] = useState("all");

  const { data: suppliers } = useSuspenseQuery({
    queryKey: ["suppliers"],
    queryFn: getSuppliersFn,
  });

  const safeSuppliers = Array.isArray(suppliers) ? suppliers : [];

  if (safeSuppliers.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4 }}
      >
        <GenericEmpty
          className="mt"
          icon={SupplierEmptyIllustration}
          title="No Suppliers Found"
          description="You haven't added any suppliers yet. First, define a supplier then you can add transactions for it."
          ctaText="Add Supplier"
          onAddChange={setIsAddOpen}
        />
        <AddSupplierDialog open={isAddOpen} onOpenChange={setIsAddOpen} />
      </motion.div>
    );
  }

  const filteredSuppliers = safeSuppliers.filter((supplier) => {
    const matchesSearch =
      (supplier.supplierName || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
      (supplier.supplierShopName || "")
        .toLowerCase()
        .includes(searchQuery.toLowerCase()) ||
      (supplier.phone || "").toLowerCase().includes(searchQuery.toLowerCase());

    if (!matchesSearch) return false;

    if (dateFilter !== "all") {
      const createdAt = supplier.createdAt ? new Date(supplier.createdAt) : new Date(0);
      if (dateFilter === "today" && !isToday(createdAt)) return false;
      if (dateFilter === "this_month" && !isThisMonth(createdAt)) return false;
      if (
        dateFilter === "last_7_days" &&
        !isAfter(createdAt, startOfDay(subDays(new Date(), 7)))
      )
        return false;
      if (
        dateFilter === "last_30_days" &&
        !isAfter(createdAt, startOfDay(subDays(new Date(), 30)))
      )
        return false;
    }

    return true;
  });

  // KPI Calculations
  const totalOutstanding = filteredSuppliers.reduce(
    (sum, s) => sum + s.balance,
    0,
  );
  const activeSuppliers = filteredSuppliers.filter(
    (s) => s.totalPurchases > 0,
  ).length;
  const recentlyAdded = filteredSuppliers.filter((s) =>
    isAfter(
      s.createdAt ? new Date(s.createdAt) : new Date(0),
      startOfDay(subMonths(new Date(), 1)),
    ),
  ).length;

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="show"
      className="space-y-6"
    >
      {/* Header Actions */}
      <motion.div
        variants={itemVariants}
        className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
      >
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 flex-1 w-full">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, shop, or phone..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 rounded-none shadow-none focus-visible:ring-1 focus-visible:ring-primary border-border"
            />
          </div>
          <div className="flex items-center gap-2">
            <Select value={dateFilter} onValueChange={setDateFilter}>
              <SelectTrigger className="w-full sm:w-[160px] rounded-none shadow-none border-border focus:ring-1 focus:ring-primary">
                <SelectValue placeholder="Date Added" />
              </SelectTrigger>
              <SelectContent className="rounded-none shadow-none border border-border">
                <SelectItem value="all">All Time</SelectItem>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="last_7_days">Last 7 Days</SelectItem>
                <SelectItem value="last_30_days">Last 30 Days</SelectItem>
                <SelectItem value="this_month">This Month</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button onClick={() => setIsAddOpen(true)} className="w-full sm:w-auto">
          <Plus className="size-4 mr-2" />
          Add Supplier
        </Button>
      </motion.div>

      {/* Sharp KPI Cards */}
      <motion.div
        variants={itemVariants}
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
      >
        <SharpKPICard
          label="Total Suppliers"
          value={filteredSuppliers.length.toString()}
          icon={Users}
          theme="blue"
        />
        <SharpKPICard
          label="Total Outstanding"
          value={`₨ ${totalOutstanding.toLocaleString()}`}
          icon={Wallet}
          theme="rose"
        />
        <SharpKPICard
          label="Active Suppliers"
          value={activeSuppliers.toString()}
          icon={Activity}
          theme="emerald"
          subtext="With purchases"
        />
        <SharpKPICard
          label="New This Month"
          value={recentlyAdded.toString()}
          icon={CalendarDays}
          theme="violet"
          subtext="Last 30 days"
        />
      </motion.div>

      {/* Suppliers Table */}
      <motion.div
        variants={itemVariants}
        className="bg-card border border-border rounded-none shadow-none"
      >
        <SuppliersTable data={filteredSuppliers} />
      </motion.div>

      <AddSupplierDialog open={isAddOpen} onOpenChange={setIsAddOpen} />
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
  blue: {
    border: "border-t-blue-500",
    iconBg: "bg-blue-500/10",
    iconText: "text-blue-500",
  },
  rose: {
    border: "border-t-rose-500",
    iconBg: "bg-rose-500/10",
    iconText: "text-rose-500",
  },
  emerald: {
    border: "border-t-emerald-500",
    iconBg: "bg-emerald-500/10",
    iconText: "text-emerald-500",
  },
  violet: {
    border: "border-t-violet-500",
    iconBg: "bg-violet-500/10",
    iconText: "text-violet-500",
  },
};

function SharpKPICard({ label, value, icon: Icon, theme, subtext }: SharpKPICardProps) {
  const styles = sharpThemeStyles[theme];

  return (
    <motion.div
      whileHover={{ y: -2, transition: { duration: 0.2 } }}
      className={cn(
        "relative flex flex-col justify-between p-5 bg-card border border-border rounded-none shadow-none",
        "border-t-2", // Accent top border
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
          <div className="h-4" /> // Spacer for alignment
        )}
      </div>
    </motion.div>
  );
}