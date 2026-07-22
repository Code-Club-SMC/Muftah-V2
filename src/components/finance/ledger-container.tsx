import { useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { motion, Variants } from "framer-motion";
import { getWalletsListFn } from "@/server-functions/finance-fn";
import { useTransactions } from "@/hooks/finance/use-finance";
import { GenericEmpty } from "@/components/custom/empty";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FinanceEmptyIllustration } from "@/components/illustrations/FinanceEmptyIllustration";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Building2,
  BanknoteIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  TrendingUpIcon,
  TrendingDownIcon,
  ActivityIcon,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { GenericLoader } from "../custom/generic-loader";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FilterIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";


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

const LIMIT = 20;

export const LedgerContainer = () => {
  const [page, setPage] = useState(1);
  const [walletFilter, setWalletFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<"all" | "credit" | "debit">(
    "all",
  );
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [isFilterDialogOpen, setIsFilterDialogOpen] = useState(false);

  // Temporary state for the dialog form
  const [tempWallet, setTempWallet] = useState("all");
  const [tempType, setTempType] = useState<"all" | "credit" | "debit">("all");
  const [tempSource, setTempSource] = useState("all");
  const [tempDateFrom, setTempDateFrom] = useState("");
  const [tempDateTo, setTempDateTo] = useState("");

  const activeFilterCount =
    (walletFilter !== "all" ? 1 : 0) +
    (typeFilter !== "all" ? 1 : 0) +
    (sourceFilter !== "all" ? 1 : 0) +
    (dateFrom ? 1 : 0) +
    (dateTo ? 1 : 0);

  // Server-side paginated fetch
  const { data, isFetching } = useTransactions({
    walletId: walletFilter === "all" ? undefined : walletFilter,
    source: sourceFilter === "all" ? undefined : sourceFilter,
    type: typeFilter === "all" ? undefined : typeFilter,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    page,
    limit: LIMIT,
  });

  const { data: wallets } = useSuspenseQuery({
    queryKey: ["wallets"],
    queryFn: getWalletsListFn,
  });

  const transactions = data?.data ?? [];
  const total = data?.total ?? 0;
  const pageCount = data?.pageCount ?? 1;

  // KPIs: run against the current page only
  const totalCredits = transactions
    .filter((t) => t.type === "credit")
    .reduce((s, t) => s + parseFloat(t.amount || "0"), 0);
  const totalDebits = transactions
    .filter((t) => t.type === "debit")
    .reduce((s, t) => s + parseFloat(t.amount || "0"), 0);
  const netFlow = totalCredits - totalDebits;

  const handleApplyFilters = () => {
    setWalletFilter(tempWallet);
    setTypeFilter(tempType);
    setSourceFilter(tempSource);
    setDateFrom(tempDateFrom);
    setDateTo(tempDateTo);
    setPage(1);
    setIsFilterDialogOpen(false);
  };

  const handleClearFilters = () => {
    setTempWallet("all");
    setTempType("all");
    setTempSource("all");
    setTempDateFrom("");
    setTempDateTo("");
    setWalletFilter("all");
    setTypeFilter("all");
    setSourceFilter("all");
    setDateFrom("");
    setDateTo("");
    setPage(1);
    setIsFilterDialogOpen(false);
  };

  const handleOpenFilterDialog = () => {
    // Sync current filters to temp state when opening
    setTempWallet(walletFilter);
    setTempType(typeFilter);
    setTempSource(sourceFilter);
    setTempDateFrom(dateFrom);
    setTempDateTo(dateTo);
    setIsFilterDialogOpen(true);
  };



  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="show"
      className="space-y-6 font-sans antialiased"
    >
      {/* ── Sharp KPI Cards ───────────────────────────────────────────── */}
      <motion.div
        variants={itemVariants}
        className="grid grid-cols-1 sm:grid-cols-3 gap-4"
      >
        <SharpKPICard
          title="Credits (this page)"
          value={`+ ₨ ${Math.round(totalCredits).toLocaleString()}`}
          subtext={`${transactions.filter((t) => t.type === "credit").length} entries shown`}
          icon={TrendingUpIcon}
          theme="emerald"
        />
        <SharpKPICard
          title="Debits (this page)"
          value={`− ₨ ${Math.round(totalDebits).toLocaleString()}`}
          subtext={`${transactions.filter((t) => t.type === "debit").length} entries shown`}
          icon={TrendingDownIcon}
          theme="rose"
        />
        <SharpKPICard
          title="Net Flow (this page)"
          value={`${netFlow >= 0 ? "+" : "−"} ₨ ${Math.abs(Math.round(netFlow)).toLocaleString()}`}
          subtext={netFlow >= 0 ? "Positive" : "Negative"}
          icon={ActivityIcon}
          theme={netFlow >= 0 ? "blue" : "amber"}
        />
      </motion.div>

      {/* ── Table & Filters ───────────────────────────────────────────── */}
      <motion.div
        variants={itemVariants}
        className="bg-card border border-border rounded-none shadow-none"
      >
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-3">
            <Dialog open={isFilterDialogOpen} onOpenChange={setIsFilterDialogOpen}>
              <DialogTrigger asChild>
                <Button
                  variant="outline"
                  onClick={handleOpenFilterDialog}
                  className="h-10 px-4 rounded-none shadow-none border-border relative"
                >
                  <FilterIcon className="size-4 mr-2" />
                  Filters
                  {activeFilterCount > 0 && (
                    <Badge className="ml-2 bg-primary text-primary-foreground rounded-none h-5 px-1.5 text-[10px]">
                      {activeFilterCount}
                    </Badge>
                  )}
                </Button>
              </DialogTrigger>
              <DialogContent className="rounded-none border-border shadow-2xl sm:max-w-[425px]">
                <DialogHeader>
                  <DialogTitle className="text-xl uppercase tracking-tighter">
                    Filter Ledger
                  </DialogTitle>
                  <DialogDescription>
                    Apply filters to narrow down transactions.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-5 py-4">
                  <div className="space-y-2">
                    <Label className="text-[11px] font-bold uppercase  text-muted-foreground">Account</Label>
                    <Select value={tempWallet} onValueChange={setTempWallet}>
                      <SelectTrigger className="w-full h-11 text-[13px] border-border rounded-none shadow-none focus:ring-1 focus:ring-primary">
                        <SelectValue placeholder="All accounts" />
                      </SelectTrigger>
                      <SelectContent className="rounded-none shadow-none border-border">
                        <SelectItem value="all" className="rounded-none">All Accounts</SelectItem>
                        {wallets.map((w) => (
                          <SelectItem key={w.id} value={w.id} className="rounded-none">
                            <div className="flex items-center gap-2">
                              {w.type === "bank" ? (
                                <Building2 className="size-3.5 text-blue-500" />
                              ) : (
                                <BanknoteIcon className="size-3.5 text-violet-500" />
                              )}
                              <span className="font-semibold">{w.name}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-[11px] font-bold uppercase  text-muted-foreground">From Date</Label>
                      <Input
                        type="date"
                        value={tempDateFrom}
                        onChange={(e) => setTempDateFrom(e.target.value)}
                        className="h-11 rounded-none shadow-none border-border"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-[11px] font-bold uppercase  text-muted-foreground">To Date</Label>
                      <Input
                        type="date"
                        value={tempDateTo}
                        onChange={(e) => setTempDateTo(e.target.value)}
                        className="h-11 rounded-none shadow-none border-border"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-[11px] font-bold uppercase  text-muted-foreground">Source</Label>
                    <Select value={tempSource} onValueChange={setTempSource}>
                      <SelectTrigger className="w-full h-11 text-[13px] border-border rounded-none shadow-none focus:ring-1 focus:ring-primary">
                        <SelectValue placeholder="All sources" />
                      </SelectTrigger>
                      <SelectContent className="rounded-none shadow-none border-border">
                        <SelectItem value="all" className="rounded-none">All Sources</SelectItem>
                        <SelectItem value="Sale" className="rounded-none">Sale</SelectItem>
                        <SelectItem value="Payroll" className="rounded-none">Payroll</SelectItem>
                        <SelectItem value="Expense" className="rounded-none">Expense</SelectItem>
                        <SelectItem value="Opening Balance" className="rounded-none">Opening Balance</SelectItem>
                        <SelectItem value="Manual Adjustment" className="rounded-none">Manual Adjustment</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-[11px] font-bold uppercase  text-muted-foreground">Type</Label>
                    <Select value={tempType} onValueChange={(v: any) => setTempType(v)}>
                      <SelectTrigger className="w-full h-11 text-[13px] border-border rounded-none shadow-none focus:ring-1 focus:ring-primary">
                        <SelectValue placeholder="All types" />
                      </SelectTrigger>
                      <SelectContent className="rounded-none shadow-none border-border">
                        <SelectItem value="all" className="rounded-none">All Types</SelectItem>
                        <SelectItem value="credit" className="rounded-none">
                          <span className="flex items-center gap-2 text-emerald-600 font-bold">
                            <ArrowDownIcon className="size-3" /> Credits
                          </span>
                        </SelectItem>
                        <SelectItem value="debit" className="rounded-none">
                          <span className="flex items-center gap-2 text-rose-500 font-bold">
                            <ArrowUpIcon className="size-3" /> Debits
                          </span>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <DialogFooter className="gap-2 sm:gap-0">
                  <Button variant="outline" onClick={handleClearFilters} className="rounded-none shadow-none border-border">
                    Clear
                  </Button>
                  <Button onClick={handleApplyFilters} className="rounded-none shadow-none">
                    Apply Filters
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Badge
              variant="outline"
              className="h-10 px-3 text-[11px] font-bold uppercase  whitespace-nowrap rounded-none border-border"
            >
              {total} total
            </Badge>
          </div>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/20">
              <TableRow className="hover:bg-transparent border-b border-border/50">
                <TableHead className="text-[12px] font-medium text-muted-foreground py-3 h-auto pl-5 whitespace-nowrap w-12"></TableHead>
                <TableHead className="text-[12px] font-medium text-muted-foreground py-3 h-auto whitespace-nowrap">Date & Time</TableHead>
                <TableHead className="text-[12px] font-medium text-muted-foreground py-3 h-auto whitespace-nowrap">Source</TableHead>
                <TableHead className="text-[12px] font-medium text-muted-foreground py-3 h-auto whitespace-nowrap">Account</TableHead>
                <TableHead className="text-[12px] font-medium text-muted-foreground py-3 h-auto whitespace-nowrap">Performed By</TableHead>
                <TableHead className="text-[12px] font-medium text-muted-foreground py-3 h-auto pr-5 whitespace-nowrap text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isFetching ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center">
                    <GenericLoader title="Loading Transactions" description="Please wait while we load the transactions." />
                  </TableCell>
                </TableRow>
              ) : transactions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center p-0">
                    <GenericEmpty icon={FinanceEmptyIllustration} title="No Transactions Found" description="No transactions match your current filters." />
                  </TableCell>
                </TableRow>
              ) : (
                transactions.map((txn) => {
                  const isCredit = txn.type === "credit";
                  return (
                    <TableRow key={txn.id} className="hover:bg-muted/30 border-b border-border/30 transition-colors last:border-0 data-[state=selected]:bg-muted">
                      <TableCell className="py-2.5 pl-5">
                        <div className={cn("p-1.5 rounded-none border w-fit", isCredit ? "bg-emerald-500/10 border-emerald-500/20" : "bg-rose-500/10 border-rose-500/20")}>
                          {isCredit ? <ArrowDownIcon className="size-3.5 text-emerald-600" /> : <ArrowUpIcon className="size-3.5 text-rose-500" />}
                        </div>
                      </TableCell>
                      <TableCell className="py-2.5">
                        <div className="flex flex-col">
                          <span className="text-sm font-bold tabular-nums text-foreground">{format(new Date(txn.createdAt), "dd MMM yyyy")}</span>
                          <span className="text-[10px] text-muted-foreground tabular-nums uppercase  font-semibold">{format(new Date(txn.createdAt), "hh:mm a")}</span>
                        </div>
                      </TableCell>
                      <TableCell className="py-2.5">
                        <span className="font-bold text-sm text-foreground">{txn.source}</span>
                      </TableCell>
                      <TableCell className="py-2.5">
                        <div className="flex items-center gap-2">
                          {txn.wallet?.type === "bank" ? <Building2 className="size-3.5 text-blue-600 shrink-0" /> : <BanknoteIcon className="size-3.5 text-violet-600 shrink-0" />}
                          <span className="text-sm font-medium">{txn.wallet?.name || "—"}</span>
                        </div>
                      </TableCell>
                      <TableCell className="py-2.5">
                        <span className="text-sm text-muted-foreground">{txn.performer?.name || "—"}</span>
                      </TableCell>
                      <TableCell className="py-2.5 pr-5">
                        <span className={cn("font-black text-sm tabular-nums text-right block", isCredit ? "text-emerald-600" : "text-rose-500")}>
                          {isCredit ? "+" : "−"} ₨ {parseFloat(txn.amount || "0").toLocaleString()}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </motion.div>

      {/* ── Pagination ────────────────────────────────────────────────── */}
      <motion.div
        variants={itemVariants}
        className="flex flex-col sm:flex-row items-center justify-between px-1 gap-4"
      >
        <span className="text-xs text-muted-foreground tabular-nums uppercase font-semibold">
          Page <span className="text-foreground">{page}</span> of{" "}
          <span className="text-foreground">{pageCount}</span> · {total} total
        </span>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Button
            variant="outline"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="h-10 px-4 rounded-none shadow-none border-border flex-1 sm:flex-none"
          >
            <ChevronLeft className="size-3.5 mr-1" /> Prev
          </Button>
          <Button
            variant="outline"
            disabled={page >= pageCount}
            onClick={() => setPage((p) => p + 1)}
            className="h-10 px-4 rounded-none shadow-none border-border flex-1 sm:flex-none"
          >
            Next <ChevronRight className="size-3.5 ml-1" />
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
};

// ── Sharp Pixel-Perfect KPI Component ───────────────────────────────────────

type KPITheme = "blue" | "rose" | "emerald" | "violet" | "amber";

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
  amber: {
    border: "border-t-amber-500",
    iconBg: "bg-amber-500/10",
    iconText: "text-amber-500",
  },
};

function SharpKPICard({
  title,
  value,
  subtext,
  icon: Icon,
  theme,
}: {
  title: string;
  value: string;
  subtext: string;
  icon: any;
  theme: KPITheme;
}) {
  const styles = sharpThemeStyles[theme];

  return (
    <motion.div
      whileHover={{ y: -2, transition: { duration: 0.2 } }}
      className={cn(
        "relative flex flex-col justify-between p-5 bg-card border border-border rounded-none shadow-none",
        "border-t-2",
        styles.border,
      )}
    >
      {/* Technical Grid Pattern */}
      <div
        className="absolute inset-0 opacity-[0.02] dark:opacity-[0.04] pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px)`,
          backgroundSize: "8px 8px",
        }}
      />

      <div className="relative z-10 flex items-start justify-between mb-8">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {title}
        </p>
        <div className={cn("p-1.5 rounded-none", styles.iconBg)}>
          <Icon className={cn("size-4", styles.iconText)} />
        </div>
      </div>

      <div className="relative z-10 space-y-1">
        <h3 className="text-3xl font-bold tracking-tight text-foreground tabular-nums">
          {value}
        </h3>
        <p className="text-xs font-medium text-muted-foreground/70">
          {subtext}
        </p>
      </div>
    </motion.div>
  );
}
