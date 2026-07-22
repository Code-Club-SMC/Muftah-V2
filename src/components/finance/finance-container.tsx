import { useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { motion, Variants } from "framer-motion";
import {
  getWalletsListFn,
  getTransactionsFn,
} from "@/server-functions/finance-fn";
import {
  getExpenseListQueryOptions,
  useCreateWallet,
  useUpdateWallet,
  useDeleteWallet,
  useDepositToWallet,
} from "@/hooks/finance/use-finance";
import { authClient } from "@/lib/auth-client";
import { GenericEmpty } from "@/components/custom/empty";
import { Button } from "@/components/ui/button";
import { FinanceEmptyIllustration } from "@/components/illustrations/FinanceEmptyIllustration";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ResponsiveSheet } from "@/components/custom/responsive-sheet";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  WalletIcon,
  BanknoteIcon,
  PlusIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  ReceiptIcon,
  TrendingUpIcon,
  AlertTriangleIcon,
  CheckCircle2Icon,
  Loader2,
  Building2,
  ClockIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ExpenseRecordSheet } from "./expense-record-sheet";

const MAX_BALANCE = 999999999999.99;

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

type WalletType = Awaited<ReturnType<typeof getWalletsListFn>>[number];

export const FinanceContainer = () => {
  const { data: wallets } = useSuspenseQuery({
    queryKey: ["wallets"],
    queryFn: getWalletsListFn,
  });

  const { data: session } = authClient.useSession();
  const isSuperAdmin = session?.user?.role === "super-admin";

  const today = new Date();
  const dateFrom = startOfMonth(today).toISOString();
  const dateTo = endOfMonth(today).toISOString();

  const { data: recentTransactions, isFetching: isTransactionsFetching } =
    useSuspenseQuery({
      queryKey: ["transactions-recent", { limit: 20, dateFrom, dateTo }],
      queryFn: () => getTransactionsFn({ data: { limit: 20, dateFrom, dateTo } }),
    });

  const { data: expenses, isFetching: isExpensesFetching } = useSuspenseQuery({
    ...getExpenseListQueryOptions({ page: 1, limit: 20, dateFrom, dateTo }),
  });

  const [isCreateWalletOpen, setIsCreateWalletOpen] = useState(false);
  const [isEditWalletOpen, setIsEditWalletOpen] = useState(false);
  const [isDepositOpen, setIsDepositOpen] = useState(false);
  const [isExpenseOpen, setIsExpenseOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedWalletId, setSelectedWalletId] = useState<string | null>(null);
  const [walletToEdit, setWalletToEdit] = useState<WalletType | null>(null);
  const [walletToDelete, setWalletToDelete] = useState<WalletType | null>(null);

  const totalBalance = wallets.reduce(
    (sum, w) => sum + parseFloat(w.balance || "0"),
    0,
  );
  const cashBalance = wallets
    .filter((w) => w.type === "cash")
    .reduce((sum, w) => sum + parseFloat(w.balance || "0"), 0);
  const bankBalance = wallets
    .filter((w) => w.type === "bank")
    .reduce((sum, w) => sum + parseFloat(w.balance || "0"), 0);
  const totalExpenses = expenses.data.reduce(
    (sum: number, e) => sum + parseFloat(e.amount || "0"),
    0,
  );

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="show"
      className="space-y-6 font-sans antialiased"
    >
      <motion.div
        variants={itemVariants}
        className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
      >
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            className="h-10 px-4 rounded-none shadow-none border-border hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-200 transition-colors gap-2 font-bold"
            onClick={() => setIsDepositOpen(true)}
            disabled={wallets.length === 0}
          >
            <ArrowDownIcon className="size-3.5 text-emerald-600" /> Deposit
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-10 px-4 rounded-none shadow-none border-border hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200 transition-colors gap-2 font-bold"
            onClick={() => setIsExpenseOpen(true)}
            disabled={wallets.length === 0}
          >
            <ReceiptIcon className="size-3.5 text-rose-600" /> Record Expense
          </Button>
        </div>
        <Button
          size="sm"
          className="h-10 px-4 rounded-none shadow-none gap-2 font-bold"
          onClick={() => setIsCreateWalletOpen(true)}
        >
          <PlusIcon className="size-3.5" /> New Account
        </Button>
      </motion.div>

      <motion.div
        variants={itemVariants}
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
      >
        <SharpKPICard
          label="Total Balance"
          value={`₨ ${totalBalance.toLocaleString()}`}
          icon={TrendingUpIcon}
          theme="emerald"
        />
        <SharpKPICard
          label="Cash Balance"
          value={`₨ ${cashBalance.toLocaleString()}`}
          icon={BanknoteIcon}
          theme="violet"
          subtext={`${wallets.filter((w) => w.type === "cash").length} cash account(s)`}
        />
        <SharpKPICard
          label="Bank Balance"
          value={`₨ ${bankBalance.toLocaleString()}`}
          icon={Building2}
          theme="blue"
          subtext={`${wallets.filter((w) => w.type === "bank").length} bank account(s)`}
        />
        <SharpKPICard
          label="Total Expenses"
          value={
            isExpensesFetching ? "—" : `₨ ${totalExpenses.toLocaleString()}`
          }
          icon={ReceiptIcon}
          theme="rose"
          subtext={`${expenses.total} recorded`}
        />
      </motion.div>

      <motion.div variants={itemVariants}>
        {wallets.length === 0 ? (
          <div className="border border-dashed border-border bg-muted/10">
            <div className="py-16">
              <GenericEmpty
                icon={FinanceEmptyIllustration}
                title="No Accounts Yet"
                description='Create your first account (Cash Box or Bank Account) to start tracking finances. Click "New Account" above.'
              />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {wallets.map((wallet) => (
              <WalletCard
                key={wallet.id}
                wallet={wallet}
                onDeposit={() => {
                  setSelectedWalletId(wallet.id);
                  setIsDepositOpen(true);
                }}
                onExpense={() => {
                  setSelectedWalletId(wallet.id);
                  setIsExpenseOpen(true);
                }}
                onEdit={() => {
                  setWalletToEdit(wallet);
                  setIsEditWalletOpen(true);
                }}
                onDelete={() => {
                  setWalletToDelete(wallet);
                  setIsDeleteDialogOpen(true);
                }}
                isSuperAdmin={isSuperAdmin}
              />
            ))}
          </div>
        )}
      </motion.div>

      <motion.div variants={itemVariants}>
        <div className="flex items-center justify-between mb-4 border-b border-border pb-2">
          <h2 className="text-sm font-bold  uppercase flex items-center gap-2 text-muted-foreground">
            <ClockIcon className="size-4" />
            Recent Activity
            {isTransactionsFetching && (
              <Loader2 className="size-3.5 animate-spin" />
            )}
          </h2>
          <Badge
            variant="outline"
            className="font-bold text-[10px] rounded-none border-border  uppercase"
          >
            {isTransactionsFetching
              ? "—"
              : `${recentTransactions.data.length} entries`}
          </Badge>
        </div>
        {recentTransactions.data.length === 0 ? (
          <div className="border border-dashed border-border bg-muted/10">
            <div className="py-8">
              <GenericEmpty
                icon={FinanceEmptyIllustration}
                title="No Transactions"
                description="Transactions will appear here when you deposit, withdraw, or record expenses."
              />
            </div>
          </div>
        ) : (
          <div className="border border-border bg-card shadow-none">
            <div className="divide-y divide-border">
              {recentTransactions.data.map((txn) => (
                <TransactionRow key={txn.id} txn={txn} />
              ))}
            </div>
          </div>
        )}
      </motion.div>

      <CreateWalletSheet
        open={isCreateWalletOpen}
        onOpenChange={setIsCreateWalletOpen}
      />
      {walletToEdit && (
        <EditWalletSheet
          open={isEditWalletOpen}
          onOpenChange={(open) => {
            setIsEditWalletOpen(open);
            if (!open) setWalletToEdit(null);
          }}
          wallet={walletToEdit}
        />
      )}
      <DepositSheet
        open={isDepositOpen}
        onOpenChange={(open) => {
          setIsDepositOpen(open);
          if (!open) setSelectedWalletId(null);
        }}
        wallets={wallets}
        preselectedWalletId={selectedWalletId}
      />
      <ExpenseSheet
        open={isExpenseOpen}
        onOpenChange={(open) => {
          setIsExpenseOpen(open);
          if (!open) setSelectedWalletId(null);
        }}
        wallets={wallets}
        preselectedWalletId={selectedWalletId}
      />
      {walletToDelete && (
        <DeleteWalletDialog
          open={isDeleteDialogOpen}
          onOpenChange={(open) => {
            setIsDeleteDialogOpen(open);
            if (!open) setWalletToDelete(null);
          }}
          wallet={walletToDelete}
        />
      )}
    </motion.div>
  );
};

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
  label,
  value,
  subtext,
  icon: Icon,
  theme,
}: {
  label: string;
  value: string;
  subtext?: string;
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
      <div
        className="absolute inset-0 opacity-[0.02] dark:opacity-[0.04] pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px)`,
          backgroundSize: "8px 8px",
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
          <div className="h-4" />
        )}
      </div>
    </motion.div>
  );
}

function WalletCard({
  wallet,
  onDeposit,
  onExpense,
  onEdit,
  onDelete,
  isSuperAdmin,
}: {
  wallet: WalletType;
  onDeposit: () => void;
  onExpense: () => void;
  onEdit: () => void;
  onDelete: () => void;
  isSuperAdmin: boolean;
}) {
  const balance = parseFloat(wallet.balance || "0");
  const isLowBalance = balance < 5000;
  const isBank = wallet.type === "bank";

  return (
    <motion.div
      whileHover={{ y: -2, transition: { duration: 0.2 } }}
      className={cn(
        "relative flex flex-col p-5 bg-card border rounded-none shadow-none border-t-2",
        isLowBalance
          ? "border-t-amber-500 border-x-amber-500/20 border-b-amber-500/20"
          : isBank
            ? "border-t-blue-500 border-border"
            : "border-t-violet-500 border-border",
      )}
    >
      <div
        className="absolute inset-0 opacity-[0.02] dark:opacity-[0.04] pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px)`,
          backgroundSize: "8px 8px",
        }}
      />

      <div className="relative z-10 flex items-start justify-between mb-6">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "p-2 rounded-none",
              isBank ? "bg-blue-500/10" : "bg-violet-500/10",
            )}
          >
            {isBank ? (
              <Building2 className="size-5 text-blue-500" />
            ) : (
              <BanknoteIcon className="size-5 text-violet-500" />
            )}
          </div>
          <div>
            <h3 className="font-bold text-sm leading-tight text-foreground">
              {wallet.name}
            </h3>
            <Badge
              variant="outline"
              className="text-[9px] font-bold uppercase  mt-1 px-1.5 rounded-none border-border"
            >
              {isBank ? "Bank Account" : "Cash Box"}
            </Badge>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {isLowBalance && (
            <div className="flex items-center gap-1 text-amber-500">
              <AlertTriangleIcon className="size-4" />
            </div>
          )}
          <button
            type="button"
            onClick={onEdit}
            className="p-1.5 rounded-none text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            title="Edit account"
          >
            <PencilIcon className="size-3.5" />
          </button>
          {isSuperAdmin && (
            <button
              type="button"
              onClick={onDelete}
              className="p-1.5 rounded-none text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10 transition-colors"
              title="Delete account"
            >
              <Trash2Icon className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="relative z-10 mb-6">
        <p className="text-[10px] font-bold text-muted-foreground uppercase ">
          Current Balance
        </p>
        <p
          className={cn(
            "text-3xl font-black tracking-tight mt-1 tabular-nums",
            isLowBalance ? "text-amber-500" : "text-foreground",
          )}
        >
          ₨ {balance.toLocaleString()}
        </p>
        {isLowBalance ? (
          <p className="text-[10px] text-amber-500 font-bold mt-1.5 flex items-center gap-1 uppercase tracking-wider">
            <AlertTriangleIcon className="size-3" /> Low balance warning
          </p>
        ) : (
          <div className="h-5" />
        )}
      </div>

      <div className="relative z-10 flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1 h-9 rounded-none shadow-none text-xs font-bold gap-1.5 border-border hover:bg-emerald-50 hover:border-emerald-200 hover:text-emerald-700 transition-colors"
          onClick={onDeposit}
        >
          <ArrowDownIcon className="size-3.5 text-emerald-600" /> Deposit
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="flex-1 h-9 rounded-none shadow-none text-xs font-bold gap-1.5 border-border hover:bg-rose-50 hover:border-rose-200 hover:text-rose-700 transition-colors"
          onClick={onExpense}
        >
          <ArrowUpIcon className="size-3.5 text-rose-500" /> Expense
        </Button>
      </div>
    </motion.div>
  );
}

function TransactionRow({ txn }: { txn: any }) {
  const isCredit = txn.type === "credit";
  const amount = parseFloat(txn.amount || "0");

  return (
    <div className="flex items-center justify-between px-5 py-4 bg-card hover:bg-muted/30 transition-colors group">
      <div className="flex items-center gap-4">
        <div
          className={cn(
            "p-2 rounded-none transition-colors border",
            isCredit
              ? "bg-emerald-500/10 border-emerald-500/20 group-hover:bg-emerald-500/20"
              : "bg-rose-500/10 border-rose-500/20 group-hover:bg-rose-500/20",
          )}
        >
          {isCredit ? (
            <ArrowDownIcon className="size-4 text-emerald-600" />
          ) : (
            <ArrowUpIcon className="size-4 text-rose-500" />
          )}
        </div>
        <div>
          <p className="text-sm font-bold leading-tight text-foreground">
            {txn.source}
          </p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[10px] text-muted-foreground font-bold uppercase  flex items-center gap-1">
              {txn.wallet?.type === "bank" ? (
                <Building2 className="size-3" />
              ) : (
                <BanknoteIcon className="size-3" />
              )}{" "}
              {txn.wallet?.name}
            </span>
            <span className="text-muted-foreground/30">•</span>
            <span className="text-[10px] text-muted-foreground font-bold uppercase ">
              {format(new Date(txn.createdAt), "dd MMM yyyy")}
            </span>
          </div>
        </div>
      </div>
      <span
        className={cn(
          "font-black text-sm tabular-nums",
          isCredit ? "text-emerald-600" : "text-rose-500",
        )}
      >
        {isCredit ? "+" : "−"} ₨ {amount.toLocaleString()}
      </span>
    </div>
  );
}

function BankFieldsSection({
  bankName,
  setBankName,
  accountNumber,
  setAccountNumber,
  branchName,
  setBranchName,
  iban,
  setIban,
  swiftCode,
  setSwiftCode,
  accountTitle,
  setAccountTitle,
}: {
  bankName: string;
  setBankName: (v: string) => void;
  accountNumber: string;
  setAccountNumber: (v: string) => void;
  branchName: string;
  setBranchName: (v: string) => void;
  iban: string;
  setIban: (v: string) => void;
  swiftCode: string;
  setSwiftCode: (v: string) => void;
  accountTitle: string;
  setAccountTitle: (v: string) => void;
}) {
  return (
    <div className="space-y-4 pt-2 border-t border-border">
      <p className="text-[11px] font-bold uppercase  text-blue-500 flex items-center gap-1.5">
        <Building2 className="size-3.5" /> Bank Details
      </p>
      <div className="space-y-3">
        <Label className="text-[11px] font-bold uppercase  text-muted-foreground">
          Bank Name <span className="text-rose-500">*</span>
        </Label>
        <Input
          placeholder="e.g., Habib Bank Limited"
          value={bankName}
          onChange={(e) => setBankName(e.target.value)}
          className="h-11 rounded-none shadow-none border-border focus-visible:ring-1 focus-visible:ring-primary"
        />
      </div>
      <div className="space-y-3">
        <Label className="text-[11px] font-bold uppercase  text-muted-foreground">
          Account Number <span className="text-rose-500">*</span>
        </Label>
        <Input
          placeholder="e.g., 0123456789012345"
          value={accountNumber}
          onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ""))}
          className="h-11 rounded-none shadow-none border-border focus-visible:ring-1 focus-visible:ring-primary"
        />
      </div>
      <div className="space-y-3">
        <Label className="text-[11px] font-bold uppercase  text-muted-foreground">
          Account Title
        </Label>
        <Input
          placeholder="e.g., Titan Enterprises Pvt Ltd"
          value={accountTitle}
          onChange={(e) => setAccountTitle(e.target.value)}
          className="h-11 rounded-none shadow-none border-border focus-visible:ring-1 focus-visible:ring-primary"
        />
      </div>
      <div className="space-y-3">
        <Label className="text-[11px] font-bold uppercase  text-muted-foreground">
          Branch Name
        </Label>
        <Input
          placeholder="e.g., Main Branch, Karachi"
          value={branchName}
          onChange={(e) => setBranchName(e.target.value)}
          className="h-11 rounded-none shadow-none border-border focus-visible:ring-1 focus-visible:ring-primary"
        />
      </div>
      <div className="space-y-3">
        <Label className="text-[11px] font-bold uppercase  text-muted-foreground">
          IBAN
        </Label>
        <Input
          placeholder="e.g., PK36HABB0000001234567890"
          value={iban}
          onChange={(e) => setIban(e.target.value.toUpperCase())}
          className="h-11 rounded-none shadow-none border-border focus-visible:ring-1 focus-visible:ring-primary"
        />
        {iban && !/^PK\d{22}$/i.test(iban.replace(/\s/g, "")) && (
          <p className="text-[10px] text-rose-500 font-bold flex items-center gap-1">
            <AlertTriangleIcon className="size-3" />
            Invalid IBAN format. Expected PK followed by 22 characters.
          </p>
        )}
      </div>
      <div className="space-y-3">
        <Label className="text-[11px] font-bold uppercase  text-muted-foreground">
          SWIFT Code
        </Label>
        <Input
          placeholder="e.g., HABBPKKA"
          value={swiftCode}
          onChange={(e) => setSwiftCode(e.target.value.toUpperCase())}
          className="h-11 rounded-none shadow-none border-border focus-visible:ring-1 focus-visible:ring-primary"
        />
      </div>
    </div>
  );
}

function CreateWalletSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<"cash" | "bank">("cash");
  const [initialBalance, setInitialBalance] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [branchName, setBranchName] = useState("");
  const [iban, setIban] = useState("");
  const [swiftCode, setSwiftCode] = useState("");
  const [accountTitle, setAccountTitle] = useState("");
  const mutation = useCreateWallet();

  const resetForm = () => {
    setName("");
    setType("cash");
    setInitialBalance("");
    setBankName("");
    setAccountNumber("");
    setBranchName("");
    setIban("");
    setSwiftCode("");
    setAccountTitle("");
  };

  const handleSubmit = () => {
    if (!name.trim()) return toast.error("Please provide an account name");

    const parsedBalance = parseFloat(initialBalance) || 0;
    if (parsedBalance < 0) return toast.error("Balance cannot be negative");
    if (parsedBalance > MAX_BALANCE)
      return toast.error(
        `Balance cannot exceed PKR ${MAX_BALANCE.toLocaleString()}`,
      );

    if (type === "bank") {
      if (!bankName.trim()) return toast.error("Bank name is required for bank accounts");
      if (!accountNumber.trim()) return toast.error("Account number is required for bank accounts");
      if (iban && !/^PK\d{22}$/i.test(iban.replace(/\s/g, "")))
        return toast.error("Invalid IBAN format. Expected PK followed by 22 characters.");
    }

    mutation.mutate(
      {
        data: {
          name: name.trim(),
          type,
          initialBalance: parsedBalance,
          bankName: type === "bank" ? bankName.trim() : undefined,
          accountNumber: type === "bank" ? accountNumber.trim() : undefined,
          branchName: branchName.trim() || undefined,
          iban: iban.trim() || undefined,
          swiftCode: swiftCode.trim() || undefined,
          accountTitle: accountTitle.trim() || undefined,
        },
      },
      {
        onSuccess: () => {
          onOpenChange(false);
          resetForm();
        },
      },
    );
  };

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Create New Account"
      description="Add a cash box or bank account to track your finances."
      icon={WalletIcon}
    >
      <div className="space-y-6 py-4">
        <div className="space-y-3">
          <Label className="text-[11px] font-bold uppercase  text-muted-foreground">
            Account Type
          </Label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setType("cash")}
              className={cn(
                "flex flex-col items-center gap-2 p-4 rounded-none border-2 transition-all duration-200 cursor-pointer",
                type === "cash"
                  ? "border-violet-500 bg-violet-500/5 shadow-none"
                  : "border-border hover:border-muted-foreground/30 bg-transparent",
              )}
            >
              <BanknoteIcon
                className={cn(
                  "size-6",
                  type === "cash" ? "text-violet-500" : "text-muted-foreground",
                )}
              />
              <span
                className={cn(
                  "text-xs font-bold uppercase ",
                  type === "cash" ? "text-violet-600" : "text-muted-foreground",
                )}
              >
                Cash Box
              </span>
            </button>
            <button
              type="button"
              onClick={() => setType("bank")}
              className={cn(
                "flex flex-col items-center gap-2 p-4 rounded-none border-2 transition-all duration-200 cursor-pointer",
                type === "bank"
                  ? "border-blue-500 bg-blue-500/5 shadow-none"
                  : "border-border hover:border-muted-foreground/30 bg-transparent",
              )}
            >
              <Building2
                className={cn(
                  "size-6",
                  type === "bank" ? "text-blue-500" : "text-muted-foreground",
                )}
              />
              <span
                className={cn(
                  "text-xs font-bold uppercase ",
                  type === "bank" ? "text-blue-600" : "text-muted-foreground",
                )}
              >
                Bank Account
              </span>
            </button>
          </div>
        </div>

        <div className="space-y-3">
          <Label className="text-[11px] font-bold uppercase  text-muted-foreground">
            Account Name
          </Label>
          <Input
            placeholder={
              type === "bank"
                ? "e.g., HBL Business Account"
                : "e.g., Main Cash Drawer"
            }
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-11 rounded-none shadow-none border-border focus-visible:ring-1 focus-visible:ring-primary"
          />
        </div>

        <div className="space-y-3">
          <Label className="text-[11px] font-bold uppercase  text-muted-foreground">
            Opening Balance (PKR)
          </Label>
          <Input
            type="number"
            min="0"
            max={MAX_BALANCE}
            placeholder="0"
            value={initialBalance}
            onChange={(e) => setInitialBalance(e.target.value)}
            className="h-11 text-lg font-mono rounded-none shadow-none border-border focus-visible:ring-1 focus-visible:ring-primary"
          />
          <p className="text-[10px] text-muted-foreground font-bold">
            Maximum: PKR {MAX_BALANCE.toLocaleString()}
          </p>
        </div>

        {type === "bank" && (
          <BankFieldsSection
            bankName={bankName}
            setBankName={setBankName}
            accountNumber={accountNumber}
            setAccountNumber={setAccountNumber}
            branchName={branchName}
            setBranchName={setBranchName}
            iban={iban}
            setIban={setIban}
            swiftCode={swiftCode}
            setSwiftCode={setSwiftCode}
            accountTitle={accountTitle}
            setAccountTitle={setAccountTitle}
          />
        )}

        <div className="flex justify-end gap-3 pt-6 border-t border-border">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="rounded-none shadow-none border-border"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={mutation.isPending}
            className="rounded-none shadow-none"
          >
            {mutation.isPending && (
              <Loader2 className="size-4 mr-2 animate-spin" />
            )}
            Create Account
          </Button>
        </div>
      </div>
    </ResponsiveSheet>
  );
}

function EditWalletSheet({
  open,
  onOpenChange,
  wallet,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wallet: WalletType;
}) {
  const [name, setName] = useState(wallet.name);
  const [type, setType] = useState<"cash" | "bank">(wallet.type as "cash" | "bank");
  const [initialBalance, setInitialBalance] = useState(wallet.balance || "0");
  const [bankName, setBankName] = useState(wallet.bankName || "");
  const [accountNumber, setAccountNumber] = useState(wallet.accountNumber || "");
  const [branchName, setBranchName] = useState(wallet.branchName || "");
  const [iban, setIban] = useState(wallet.iban || "");
  const [swiftCode, setSwiftCode] = useState(wallet.swiftCode || "");
  const [accountTitle, setAccountTitle] = useState(wallet.accountTitle || "");
  const mutation = useUpdateWallet();

  const handleSubmit = () => {
    if (!name.trim()) return toast.error("Please provide an account name");

    const parsedBalance = parseFloat(initialBalance) || 0;
    if (parsedBalance < 0) return toast.error("Balance cannot be negative");
    if (parsedBalance > MAX_BALANCE)
      return toast.error(
        `Balance cannot exceed PKR ${MAX_BALANCE.toLocaleString()}`,
      );

    if (type === "bank") {
      if (!bankName.trim()) return toast.error("Bank name is required for bank accounts");
      if (!accountNumber.trim()) return toast.error("Account number is required for bank accounts");
      if (iban && !/^PK\d{22}$/i.test(iban.replace(/\s/g, "")))
        return toast.error("Invalid IBAN format. Expected PK followed by 22 characters.");
    }

    mutation.mutate(
      {
        data: {
          walletId: wallet.id,
          name: name.trim(),
          type,
          initialBalance: parsedBalance,
          bankName: type === "bank" ? bankName.trim() : undefined,
          accountNumber: type === "bank" ? accountNumber.trim() : undefined,
          branchName: branchName.trim() || undefined,
          iban: iban.trim() || undefined,
          swiftCode: swiftCode.trim() || undefined,
          accountTitle: accountTitle.trim() || undefined,
        },
      },
      {
        onSuccess: () => {
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Edit Account"
      description="Update account details and bank information."
      icon={PencilIcon}
    >
      <div className="space-y-6 py-4">
        <div className="space-y-3">
          <Label className="text-[11px] font-bold uppercase  text-muted-foreground">
            Account Type
          </Label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setType("cash")}
              className={cn(
                "flex flex-col items-center gap-2 p-4 rounded-none border-2 transition-all duration-200 cursor-pointer",
                type === "cash"
                  ? "border-violet-500 bg-violet-500/5 shadow-none"
                  : "border-border hover:border-muted-foreground/30 bg-transparent",
              )}
            >
              <BanknoteIcon
                className={cn(
                  "size-6",
                  type === "cash" ? "text-violet-500" : "text-muted-foreground",
                )}
              />
              <span
                className={cn(
                  "text-xs font-bold uppercase ",
                  type === "cash" ? "text-violet-600" : "text-muted-foreground",
                )}
              >
                Cash Box
              </span>
            </button>
            <button
              type="button"
              onClick={() => setType("bank")}
              className={cn(
                "flex flex-col items-center gap-2 p-4 rounded-none border-2 transition-all duration-200 cursor-pointer",
                type === "bank"
                  ? "border-blue-500 bg-blue-500/5 shadow-none"
                  : "border-border hover:border-muted-foreground/30 bg-transparent",
              )}
            >
              <Building2
                className={cn(
                  "size-6",
                  type === "bank" ? "text-blue-500" : "text-muted-foreground",
                )}
              />
              <span
                className={cn(
                  "text-xs font-bold uppercase ",
                  type === "bank" ? "text-blue-600" : "text-muted-foreground",
                )}
              >
                Bank Account
              </span>
            </button>
          </div>
        </div>

        <div className="space-y-3">
          <Label className="text-[11px] font-bold uppercase  text-muted-foreground">
            Account Name
          </Label>
          <Input
            placeholder={
              type === "bank"
                ? "e.g., HBL Business Account"
                : "e.g., Main Cash Drawer"
            }
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-11 rounded-none shadow-none border-border focus-visible:ring-1 focus-visible:ring-primary"
          />
        </div>

        <div className="space-y-3">
          <Label className="text-[11px] font-bold uppercase  text-muted-foreground">
            Balance (PKR)
          </Label>
          <Input
            type="number"
            min="0"
            max={MAX_BALANCE}
            placeholder="0"
            value={initialBalance}
            onChange={(e) => setInitialBalance(e.target.value)}
            className="h-11 text-lg font-mono rounded-none shadow-none border-border focus-visible:ring-1 focus-visible:ring-primary"
          />
          <p className="text-[10px] text-muted-foreground font-bold">
            Maximum: PKR {MAX_BALANCE.toLocaleString()}
          </p>
        </div>

        {type === "bank" && (
          <BankFieldsSection
            bankName={bankName}
            setBankName={setBankName}
            accountNumber={accountNumber}
            setAccountNumber={setAccountNumber}
            branchName={branchName}
            setBranchName={setBranchName}
            iban={iban}
            setIban={setIban}
            swiftCode={swiftCode}
            setSwiftCode={setSwiftCode}
            accountTitle={accountTitle}
            setAccountTitle={setAccountTitle}
          />
        )}

        <div className="flex justify-end gap-3 pt-6 border-t border-border">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="rounded-none shadow-none border-border"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={mutation.isPending}
            className="rounded-none shadow-none"
          >
            {mutation.isPending && (
              <Loader2 className="size-4 mr-2 animate-spin" />
            )}
            Save Changes
          </Button>
        </div>
      </div>
    </ResponsiveSheet>
  );
}

function DeleteWalletDialog({
  open,
  onOpenChange,
  wallet,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wallet: WalletType;
}) {
  const [confirmationName, setConfirmationName] = useState("");
  const mutation = useDeleteWallet();

  const handleDelete = () => {
    if (confirmationName.trim() !== wallet.name) {
      return toast.error(
        `Please type "${wallet.name}" exactly to confirm deletion.`,
      );
    }
    mutation.mutate(
      {
        data: {
          walletId: wallet.id,
          confirmationName: confirmationName.trim(),
        },
      },
      {
        onSuccess: () => {
          onOpenChange(false);
          setConfirmationName("");
        },
      },
    );
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="rounded-none">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-rose-500">
            <Trash2Icon className="size-5" />
            Delete Account
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-3">
            <p>
              Are you sure you want to permanently delete{" "}
              <span className="font-bold text-foreground">{wallet.name}</span>?
            </p>
            <p className="text-amber-500 font-bold text-xs uppercase flex items-center gap-1">
              <AlertTriangleIcon className="size-3.5" />
              This action cannot be undone. Related transactions and expenses will be preserved.
            </p>
            <div className="space-y-2 pt-2">
              <Label className="text-[11px] font-bold uppercase  text-muted-foreground">
                Type <span className="text-foreground font-black">{wallet.name}</span> to confirm
              </Label>
              <Input
                value={confirmationName}
                onChange={(e) => setConfirmationName(e.target.value)}
                placeholder="Type account name..."
                className="h-11 rounded-none shadow-none border-border focus-visible:ring-1 focus-visible:ring-rose-500"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleDelete();
                }}
              />
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="rounded-none">Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={
              mutation.isPending || confirmationName.trim() !== wallet.name
            }
            className="rounded-none bg-rose-600 hover:bg-rose-700 text-white disabled:opacity-50"
          >
            {mutation.isPending && (
              <Loader2 className="size-4 mr-2 animate-spin" />
            )}
            Delete Account
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DepositSheet({
  open,
  onOpenChange,
  wallets,
  preselectedWalletId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wallets: WalletType[];
  preselectedWalletId: string | null;
}) {
  const [walletId, setWalletId] = useState(preselectedWalletId || "");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const mutation = useDepositToWallet();

  const effectiveWalletId = walletId || preselectedWalletId || "";
  const selectedWallet = wallets.find((w) => w.id === effectiveWalletId);

  const handleSubmit = () => {
    const parsedAmount = parseFloat(amount);
    if (!effectiveWalletId) return toast.error("Please select an account");
    if (!parsedAmount || parsedAmount <= 0)
      return toast.error("Please enter a valid amount");

    mutation.mutate(
      {
        data: {
          walletId: effectiveWalletId,
          amount: parsedAmount,
          description: description.trim() || "Manual Deposit",
          source: "Manual Deposit",
        },
      },
      {
        onSuccess: () => {
          onOpenChange(false);
          setAmount("");
          setDescription("");
          setWalletId("");
        },
      },
    );
  };

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Deposit Money"
      description="Add funds to a cash box or bank account."
      icon={ArrowDownIcon}
    >
      <div className="space-y-6 py-4">
        <div className="space-y-3">
          <Label className="text-[11px] font-bold uppercase  text-muted-foreground">
            Deposit Into
          </Label>
          <Select value={effectiveWalletId} onValueChange={setWalletId}>
            <SelectTrigger className="h-11 rounded-none shadow-none border-border focus:ring-1 focus:ring-primary">
              <SelectValue placeholder="Select account..." />
            </SelectTrigger>
            <SelectContent className="rounded-none shadow-none border-border">
              {wallets.map((w) => (
                <SelectItem key={w.id} value={w.id} className="rounded-none">
                  <div className="flex items-center gap-2">
                    {w.type === "bank" ? (
                      <Building2 className="size-3.5 text-blue-500" />
                    ) : (
                      <BanknoteIcon className="size-3.5 text-violet-500" />
                    )}
                    <span className="font-bold">{w.name}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedWallet && (
            <div className="flex items-center justify-between p-3 bg-muted/20 border border-border">
              <span className="text-[11px] font-bold uppercase  text-muted-foreground">
                Current Balance
              </span>
              <span className="text-sm font-black tabular-nums">
                 {parseFloat(selectedWallet.balance || "0").toLocaleString()}
              </span>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <Label className="text-[11px] font-bold uppercase  text-muted-foreground">
            Amount (PKR)
          </Label>
          <Input
            type="number"
            min="1"
            placeholder="Enter amount..."
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="h-11 text-lg font-mono rounded-none shadow-none border-border focus-visible:ring-1 focus-visible:ring-primary"
          />
          {selectedWallet && parseFloat(amount) > 0 && (
            <p className="text-[10px] text-emerald-600 font-bold uppercase  flex items-center gap-1">
              <CheckCircle2Icon className="size-3" />
              New balance: {" "}
              {(
                parseFloat(selectedWallet.balance || "0") + parseFloat(amount)
              ).toLocaleString()}
            </p>
          )}
        </div>

        <div className="space-y-3">
          <Label className="text-[11px] font-bold uppercase  text-muted-foreground">
            Description (Optional)
          </Label>
          <Input
            placeholder="e.g., Sales revenue, Bank deposit..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="h-11 rounded-none shadow-none border-border focus-visible:ring-1 focus-visible:ring-primary"
          />
        </div>

        <div className="flex justify-end gap-3 pt-6 border-t border-border">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="rounded-none shadow-none border-border"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={mutation.isPending}
            className="rounded-none shadow-none bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {mutation.isPending && (
              <Loader2 className="size-4 mr-2 animate-spin" />
            )}
            Confirm Deposit
          </Button>
        </div>
      </div>
    </ResponsiveSheet>
  );
}

function ExpenseSheet({
  open,
  onOpenChange,
  wallets,
  preselectedWalletId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wallets: Awaited<ReturnType<typeof getWalletsListFn>>;
  preselectedWalletId: string | null;
}) {
  return (
    <ExpenseRecordSheet
      open={open}
      onOpenChange={onOpenChange}
      wallets={wallets}
      preselectedWalletId={preselectedWalletId}
    />
  );
}
