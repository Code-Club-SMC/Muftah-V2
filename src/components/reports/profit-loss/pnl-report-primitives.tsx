import { Link } from "@tanstack/react-router";
import { Image } from "@unpic/react";
import { format, parseISO } from "date-fns";
import {
	ArrowDown,
	ArrowUp,
	CalendarRange,
	CheckCircle2,
	ChevronRight,
	DollarSign,
	FileText,
	Filter,
	Info as InfoIcon,
	Loader2,
	Printer,
	ShoppingBasket,
	ShoppingCart,
} from "lucide-react";
import type { DateRange } from "react-day-picker";
import { DatePickerWithRange } from "@/components/custom/date-range-picker";
import { PnlExportBar } from "@/components/reports/profit-loss/pnl-export-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	HoverCard,
	HoverCardContent,
	HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
	Table,
	TableBody,
	TableCell,
	TableFooter,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { formatNumber, formatPKR } from "@/lib/currency-format";
import { cn } from "@/lib/utils";

export interface BreadcrumbItem {
	label: string;
	to?: string;
	params?: Record<string, string>;
	search?: Record<string, unknown>;
}

export function PnlPrintStyles() {
	return (
		<style>{`
      @media print {
        @page {
          size: A4 landscape;
          margin: 10mm;
        }

        html,
        body {
          background: white !important;
          color: black !important;
          font-size: 10pt;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }

        aside,
        nav,
        header,
        [data-slot="button"],
        .print-hidden {
          display: none !important;
        }

        [data-pnl-report] {
          padding: 0 !important;
        }

        [data-pnl-section] {
          break-inside: avoid;
          page-break-inside: avoid;
          box-shadow: none !important;
        }

        [data-pnl-table] table {
          width: 100% !important;
          table-layout: fixed;
          border-collapse: collapse;
        }

        [data-pnl-table] th,
        [data-pnl-table] td {
          white-space: normal !important;
          border-color: #d4d4d8 !important;
          font-size: 8pt !important;
          padding: 6px !important;
        }

        [data-pnl-chart] {
          min-height: 220px !important;
        }

        a {
          color: inherit !important;
          text-decoration: none !important;
        }
      }
    `}</style>
	);
}

export function PnlBreadcrumbs({ items }: { items: BreadcrumbItem[] }) {
	return (
		<nav className="flex items-center gap-2 text-sm text-muted-foreground print:hidden">
			{items.map((item, index) => (
				<div key={`${item.label}-${index}`} className="flex items-center gap-2">
					{item.to ? (
						<Link
							to={item.to}
							params={item.params}
							search={item.search}
							className="transition-colors hover:text-foreground"
						>
							{item.label}
						</Link>
					) : (
						<span className="font-medium text-foreground">{item.label}</span>
					)}
					{index < items.length - 1 ? (
						<ChevronRight className="size-4" />
					) : null}
				</div>
			))}
		</nav>
	);
}

export function PnlIdentityMark({
	label,
	imageUrl,
}: {
	label: string;
	imageUrl?: string | null;
}) {
	if (imageUrl) {
			return (
				<div className="flex size-14 items-center justify-center overflow-hidden rounded-xl border border-border/60 bg-white shadow-sm">
					<Image
						src={imageUrl}
						alt={label}
						layout="constrained"
						width={56}
						height={56}
						className="h-full w-full object-cover"
					/>
				</div>
			);

	}

	const initials = label
		.split(/\s+/)
		.slice(0, 2)
		.map((part) => part.charAt(0))
		.join("")
		.toUpperCase();

	return (
		<div className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-lg font-semibold text-white shadow-sm">
			{initials || "P"}
		</div>
	);
}

export interface PnlMetaBadge {
	icon: React.ReactNode;
	text: string;
}

export function PnlPageHeader({
	breadcrumbs,
	title,
	subtitle,
	meta,
	metaBadges,
	periodLabel,
	showPeriodBadge = true,
	dateRange,
	onDateRangeChange,
	onApply,
	isPending,
	exportProps,
	onPrint,
	identityLabel,
	identityImageUrl,
	extraAction,
	secondaryActions,
	headerActions,
}: {
	breadcrumbs: BreadcrumbItem[];
	title: string;
	subtitle?: string;
	meta?: Array<{ label: string; value: string | null | undefined }>;
	metaBadges?: PnlMetaBadge[];
	periodLabel: string;
	showPeriodBadge?: boolean;
	dateRange: DateRange | undefined;
	onDateRangeChange: (range: DateRange | undefined) => void;
	onApply: () => void;
	isPending: boolean;
	exportProps: React.ComponentProps<typeof PnlExportBar>;
	onPrint: () => void;
	identityLabel: string;
	identityImageUrl?: string | null;
	extraAction?: React.ReactNode;
	secondaryActions?: React.ReactNode;
	headerActions?: React.ReactNode;
}) {
	return (
		<div className="space-y-4">
			<PnlBreadcrumbs items={breadcrumbs} />

			<div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
				<div className="flex items-start gap-4">
					<PnlIdentityMark label={identityLabel} imageUrl={identityImageUrl} />
					<div className="space-y-2">
						<div>
							<h1 className="text-2xl font-semibold tracking-tight text-foreground">
								{title}
							</h1>
							{subtitle ? (
								<p className="mt-1 max-w-2xl text-sm text-muted-foreground">
									{subtitle}
								</p>
							) : null}
						</div>
						{metaBadges && metaBadges.length > 0 ? (
							<div className="flex flex-wrap items-center gap-2">
								{metaBadges.map((badge, index) => (
									<span
										key={index}
										className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1 text-xs text-muted-foreground"
									>
										<span className="text-muted-foreground/80">
											{badge.icon}
										</span>
										<span className="font-medium text-foreground/90">
											{badge.text}
										</span>
									</span>
								))}
							</div>
						) : meta && meta.length > 0 ? (
							<div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted-foreground">
								{meta
									.filter((item) => item.value)
									.map((item) => (
										<span key={item.label}>
											{item.label}:{" "}
											<span className="font-medium text-foreground">
												{item.value}
											</span>
										</span>
									))}
							</div>
						) : null}
						{extraAction}
					</div>
				</div>

				{headerActions ? (
					<div className="flex flex-col gap-2 print-hidden xl:items-end">
						{headerActions}
					</div>
				) : (
					<div className="flex flex-col gap-3 print-hidden xl:items-end">
						<div className="flex flex-col gap-3 sm:flex-row">
							<div className="flex min-h-11 min-w-[250px] items-center gap-3 rounded-lg border border-border bg-white px-4">
								<CalendarRange className="size-4 text-muted-foreground" />
								<DatePickerWithRange
									date={dateRange}
									onDateChange={onDateRangeChange}
									className="w-full"
								/>
							</div>
							<Button
								onClick={onApply}
								disabled={!dateRange?.from || isPending}
								className="min-w-[140px] bg-blue-600 text-white hover:bg-blue-700"
							>
								{isPending ? (
									<>
										<Loader2 className="size-4 animate-spin" />
										Updating
									</>
								) : (
									<>
										<Filter className="size-4" />
										Apply Range
									</>
								)}
							</Button>
						</div>
						<div className="flex flex-wrap items-center justify-end gap-2">
							{showPeriodBadge ? (
								<Badge
									variant="outline"
									className="gap-1.5 rounded-full border-border bg-white px-3 py-1 text-xs"
								>
									<CheckCircle2 className="size-3.5 text-emerald-500" />
									{periodLabel}
								</Badge>
							) : null}
							<PnlExportBar {...exportProps} />
							{secondaryActions}
							<Button variant="outline" onClick={onPrint}>
								<Printer className="size-4" />
								Print
							</Button>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

function formatDelta(delta: number, suffix = "%") {
	if (!Number.isFinite(delta)) {
		return `0${suffix}`;
	}

	return `${delta >= 0 ? "+" : ""}${delta.toFixed(2)}${suffix}`;
}

export function PnlKpiCard({
	label,
	value,
	delta,
	deltaLabel,
	deltaKind = "percent",
	icon,
	iconClassName,
	labelClassName,
	valueClassName,
	showTrendBadge = false,
}: {
	label: string;
	value: string;
	delta?: number;
	deltaLabel?: string;
	deltaKind?: "percent" | "points";
	icon?: React.ReactNode;
	iconClassName?: string;
	labelClassName?: string;
	valueClassName?: string;
	showTrendBadge?: boolean;
}) {
	const isPositive = (delta ?? 0) >= 0;

	return (
		<Card
			data-pnl-section
			className="relative gap-0 rounded-xl border border-border bg-white py-0 shadow-none"
		>
			{showTrendBadge && delta !== undefined ? (
				<div
					className={cn(
						"absolute top-3 right-3 flex size-6 items-center justify-center rounded-full",
						isPositive
							? "bg-emerald-100 text-emerald-600"
							: "bg-rose-100 text-rose-600",
					)}
				>
					{isPositive ? (
						<ArrowUp className="size-3.5" />
					) : (
						<ArrowDown className="size-3.5" />
					)}
				</div>
			) : null}
			<CardContent className="flex items-center gap-4 px-5 py-4">
				{icon ? (
					<div
						className={cn(
							"flex size-12 shrink-0 items-center justify-center rounded-full",
							iconClassName ?? "bg-muted text-muted-foreground",
						)}
					>
						{icon}
					</div>
				) : null}
				<div className="min-w-0 flex-1 space-y-1.5">
					<div
						className={cn(
							"text-sm font-medium text-muted-foreground",
							labelClassName,
						)}
					>
						{label}
					</div>
					<div
						className={cn(
							"text-xl font-semibold tracking-tight text-foreground",
							valueClassName,
						)}
					>
						{value}
					</div>
					{delta !== undefined && deltaLabel ? (
						<div
							className={cn(
								"text-xs font-medium",
								isPositive ? "text-emerald-600" : "text-rose-600",
							)}
						>
							{formatDelta(delta, deltaKind === "points" ? " pp" : "%")}{" "}
							<span className="font-normal text-muted-foreground">
								{deltaLabel}
							</span>
						</div>
					) : null}
				</div>
			</CardContent>
		</Card>
	);
}

export interface PnlMetricTileItem {
	label: string;
	value: string;
	icon: React.ReactNode;
	iconClassName?: string;
	description?: string;
	delta?: number;
	deltaLabel?: string;
	deltaKind?: "percent" | "points";
}

export function PnlMetricTileRow({ items }: { items: PnlMetricTileItem[] }) {
	return (
		<div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-7">
			{items.map((item, index) => {
				const isPositive = (item.delta ?? 0) >= 0;
				return (
					<div
						key={item.label}
						className={cn(
							"space-y-1.5 lg:pl-4",
							index > 0 && "lg:border-l lg:border-border",
							index === 0 && "lg:pl-0",
						)}
					>
							<div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
								<span className={cn("shrink-0", item.iconClassName)}>
									{item.icon}
								</span>
								{item.label}
								{item.description ? (
									<HoverCard openDelay={120}>
										<HoverCardTrigger asChild>
											<button
												type="button"
												className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
												aria-label={`${item.label} explanation`}
											>
												<InfoIcon className="size-3" />
											</button>
										</HoverCardTrigger>
										<HoverCardContent
											align="start"
											sideOffset={6}
											className="w-72 text-xs leading-relaxed"
										>
											{item.description}
										</HoverCardContent>
									</HoverCard>
								) : null}
							</div>
						<div className="text-base font-semibold tracking-tight text-foreground">
							{item.value}
						</div>
						{item.delta !== undefined && item.deltaLabel ? (
							<div
								className={cn(
									"text-xs font-medium",
									isPositive ? "text-emerald-600" : "text-rose-600",
								)}
							>
								{formatDelta(
									item.delta,
									item.deltaKind === "points" ? " pp" : "%",
								)}{" "}
								<span className="font-normal text-muted-foreground">
									{item.deltaLabel}
								</span>
							</div>
						) : null}
					</div>
				);
			})}
		</div>
	);
}

export function PnlSectionCard({
	title,
	number,
	description,
	info,
	children,
	className,
}: {
	title: string;
	number?: string | number;
	description?: string;
	info?: boolean;
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<Card
			data-pnl-section
			className={cn(
				"rounded-xl border border-border bg-white py-0 shadow-none",
				className,
			)}
		>
			<CardHeader className="space-y-1 px-5 py-4">
				<div className="flex items-start justify-between gap-3">
					<CardTitle className="flex items-baseline gap-2 text-base font-semibold tracking-tight text-foreground">
						{number !== undefined ? (
							<span className="text-base font-semibold text-foreground/80">
								{number}.
							</span>
						) : null}
						<span>{title}</span>
					</CardTitle>
					{info && description ? (
						<HoverCard openDelay={120}>
							<HoverCardTrigger asChild>
								<button
									type="button"
									className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
									aria-label="Section description"
								>
									<InfoIcon className="size-3.5" />
								</button>
							</HoverCardTrigger>
							<HoverCardContent
								align="end"
								sideOffset={6}
								className="w-72 text-xs leading-relaxed"
							>
								{description}
							</HoverCardContent>
						</HoverCard>
					) : null}
				</div>
				{description ? (
					<CardDescription className="text-xs leading-relaxed text-muted-foreground">
						{description}
					</CardDescription>
				) : null}
			</CardHeader>
			<CardContent className="px-5 py-4">{children}</CardContent>
		</Card>
	);
}

export function PnlEmptyState({
	title,
	description,
}: {
	title: string;
	description: string;
}) {
	return (
		<Card
			data-pnl-section
			className="rounded-2xl border border-dashed border-border bg-white/70 py-8 text-center shadow-none"
		>
			<CardContent className="space-y-2">
				<div className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted/60">
					<FileText className="size-5 text-muted-foreground" />
				</div>
				<h2 className="text-base font-semibold text-foreground">{title}</h2>
				<p className="mx-auto max-w-xl text-sm text-muted-foreground">
					{description}
				</p>
			</CardContent>
		</Card>
	);
}

export function PnlBreakdownTable({
	summary,
}: {
	summary: {
		totalRevenue: number;
		totalCogs: number;
		grossProfit: number;
		netProfit: number;
		failedBatchLosses?: number;
		netImpact?: number;
	};
}) {
	const hasFailedBatchLosses = (summary.failedBatchLosses ?? 0) > 0;
	const rows = [
		{
			label: "Collected Revenue",
			value: summary.totalRevenue,
			tone: "default" as const,
		},
		{
			label: "Cost of Goods Sold",
			value: summary.totalCogs,
			tone: "cost" as const,
		},
		{
			label: "Gross Profit",
			value: summary.grossProfit,
			tone: "profit" as const,
		},
		{
			label: "Direct Profit",
			value: summary.netProfit,
			tone: "profit" as const,
		},
		...(hasFailedBatchLosses
			? [
					{
						label: "Failed Batch Loss",
						value: summary.failedBatchLosses ?? 0,
						tone: "cost" as const,
					},
					{
						label: "Net Impact",
						value: summary.netImpact ?? summary.netProfit,
						tone: "profit" as const,
					},
				]
			: []),
	];

	return (
		<div
			data-pnl-table
			className="overflow-hidden rounded-xl border border-border"
		>
			<Table>
				<TableHeader>
					<TableRow className="bg-slate-50 hover:bg-slate-50">
						<TableHead className="font-semibold text-foreground">
							Particulars
						</TableHead>
						<TableHead className="text-right font-semibold text-foreground">
							Amount (PKR)
						</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{rows.map((row) => (
						<TableRow key={row.label} className="hover:bg-transparent">
							<TableCell
								className={cn(
									"font-medium",
									row.tone === "default" && "text-foreground",
									row.tone === "cost" && "font-semibold text-foreground",
									row.tone === "profit" && "font-semibold text-emerald-700",
								)}
							>
								{row.label}
							</TableCell>
							<TableCell
								className={cn(
									"text-right font-mono tabular-nums",
									row.tone === "default" && "text-foreground",
									row.tone === "cost" && "font-semibold text-rose-600",
									row.tone === "profit" && "font-semibold text-emerald-700",
									row.tone === "profit" && row.value < 0 && "text-rose-600",
								)}
							>
								{row.value.toLocaleString("en-PK", {
									minimumFractionDigits: 2,
									maximumFractionDigits: 2,
								})}
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
}

export function PnlStatusBadge({ status }: { status: string }) {
	const normalized = status
		.replace(/_/g, " ")
		.replace(/\b\w/g, (char) => char.toUpperCase());

	return (
		<Badge
			variant="outline"
			className={cn(
				"rounded-md font-medium",
				status === "paid"
					? "border-emerald-300 bg-emerald-50 text-emerald-700"
					: "border-border bg-slate-50 text-muted-foreground",
			)}
		>
			{normalized}
		</Badge>
	);
}

export interface PnlScopedStatus {
	key: "profit" | "loss" | "break_even" | "no_activity";
	label: string;
	description: string;
}

export function PnlScopedStatusCard({
	status,
	directProfit,
	statusAmount,
	collectedRevenue,
	costOfGoodsSold,
	failedBatchLosses,
	realizedUnits,
	invoiceCount,
	inlineLabelUppercase = false,
}: {
	status: PnlScopedStatus;
	directProfit: number;
	statusAmount?: number;
	collectedRevenue: number;
	costOfGoodsSold?: number;
	failedBatchLosses?: number;
	realizedUnits: number;
	invoiceCount: number;
	inlineLabelUppercase?: boolean;
}) {
	const resolvedStatusAmount = statusAmount ?? directProfit;
	const hasFailedBatchLosses = (failedBatchLosses ?? 0) > 0;
	const isProfit = resolvedStatusAmount >= 0;

	const items =
		costOfGoodsSold !== undefined
			? [
					{
						icon: <DollarSign className="size-4" />,
						iconClassName: "bg-blue-100 text-blue-600",
						label: "Collected Revenue",
						value: formatPKR(collectedRevenue, false),
					},
					{
						icon: <ShoppingBasket className="size-4" />,
						iconClassName: "bg-rose-100 text-rose-600",
						label: "Cost of Goods Sold",
						value: formatPKR(costOfGoodsSold, false),
					},
					{
						icon: <FileText className="size-4" />,
						iconClassName: "bg-violet-100 text-violet-600",
						label: "Realized Units / Invoices",
						value: `${formatNumber(realizedUnits)} / ${formatNumber(invoiceCount)}`,
					},
					...(hasFailedBatchLosses
						? [
								{
									icon: <ShoppingCart className="size-4" />,
									iconClassName: "bg-amber-100 text-amber-700",
									label: "Failed Batch Loss",
									value: formatPKR(failedBatchLosses ?? 0, false),
								},
							]
						: []),
				]
			: [
					{
						icon: <DollarSign className="size-4" />,
						iconClassName: "bg-blue-100 text-blue-600",
						label: "Collected Revenue",
						value: formatPKR(collectedRevenue, false),
					},
					{
						icon: <ShoppingCart className="size-4" />,
						iconClassName: "bg-rose-100 text-rose-600",
						label: "Realized Units / Invoices",
						value: `${formatNumber(realizedUnits)} / ${formatNumber(invoiceCount)}`,
					},
					...(hasFailedBatchLosses
						? [
								{
									icon: <FileText className="size-4" />,
									iconClassName: "bg-amber-100 text-amber-700",
									label: "Failed Batch Loss",
									value: formatPKR(failedBatchLosses ?? 0, false),
								},
							]
						: []),
				];

	return (
		<Card
			data-pnl-section
			className="rounded-xl border border-border bg-white py-0 shadow-none"
		>
			<CardHeader className="space-y-1 px-5 py-4">
				<CardTitle className="flex items-center gap-1.5 text-base font-semibold tracking-tight text-foreground">
					Profit / Loss Status
					<InfoIcon className="size-3.5 text-muted-foreground" />
				</CardTitle>
				<CardDescription className="text-xs leading-relaxed text-muted-foreground">
					{hasFailedBatchLosses
						? "Status is based on direct profit after failed-batch chemical losses for this scope."
						: "Status is based on realized collections and actual sold cost only."}
				</CardDescription>
			</CardHeader>
			<CardContent className="px-5 py-4">
				<div className="flex flex-col gap-5 sm:flex-row sm:items-center">
					<div className="flex-1 space-y-1.5">
						<div
							className={cn(
								"inline-flex w-fit items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide",
								status.key === "profit" && "bg-emerald-100 text-emerald-700",
								status.key === "loss" && "bg-rose-100 text-rose-700",
								status.key === "break_even" && "bg-amber-100 text-amber-700",
								status.key === "no_activity" && "bg-slate-100 text-slate-700",
							)}
						>
							{status.label}
						</div>
						<div
							className={cn(
								"text-3xl font-bold tracking-tight",
								isProfit ? "text-emerald-600" : "text-rose-600",
							)}
						>
							{formatPKR(resolvedStatusAmount, false)}
						</div>
						<p className="max-w-xs text-sm text-muted-foreground">
							{status.description}
						</p>
					</div>

					<div className="hidden h-16 w-px shrink-0 bg-border sm:block" />

					<div className="flex flex-wrap items-center gap-6">
						{items.map((item, index) => (
							<div key={item.label} className="flex items-center gap-6">
								{index > 0 ? (
									<div className="hidden h-10 w-px shrink-0 bg-border sm:block" />
								) : null}
								<div className="flex items-center gap-3">
									<div
										className={cn(
											"flex size-10 shrink-0 items-center justify-center rounded-full",
											item.iconClassName,
										)}
									>
										{item.icon}
									</div>
									<div>
										<div
											className={cn(
												"text-xs text-muted-foreground",
												inlineLabelUppercase &&
													"text-[10px] font-semibold uppercase tracking-wide",
											)}
										>
											{item.label}
										</div>
										<div className="text-sm font-semibold text-foreground">
											{item.value}
										</div>
									</div>
								</div>
							</div>
						))}
					</div>
				</div>
			</CardContent>
		</Card>
	);
}

export function PnlPrintHeader({
	title,
	productName,
	recipeName,
	productCode,
	recipeCode,
	category,
	periodLabel,
	generatedAt,
}: {
	title: string;
	productName: string;
	recipeName?: string | null;
	productCode?: string | null;
	recipeCode?: string | null;
	category?: string | null;
	periodLabel: string;
	generatedAt: string;
}) {
	return (
		<div className="hidden print:block">
			<div className="mb-6 flex items-start justify-between border-b border-black/20 pb-4">
				<div className="flex items-center gap-4">
					<Image
						src="/company-logo.svg"
						alt="Company logo"
						layout="constrained"
						width={48}
						height={48}
						className="h-12 w-auto object-contain"
					/>
					<div>
						<div className="text-3xl font-semibold text-[#143f91]">
							CleanPro
						</div>
						<div className="text-sm text-[#143f91]">Detergent ERP</div>
					</div>
				</div>
				<div className="text-right">
					<div className="text-3xl font-semibold text-[#143f91]">{title}</div>
				</div>
			</div>

			<div className="mb-6 grid grid-cols-4 gap-5 border-b border-black/10 pb-4 text-sm">
				<div>
					<div className="font-medium text-muted-foreground">Product</div>
					<div className="font-semibold text-foreground">{productName}</div>
				</div>
				<div>
					<div className="font-medium text-muted-foreground">
						{recipeName ? "Recipe" : "Product Code"}
					</div>
					<div className="font-semibold text-foreground">
						{recipeName ?? productCode ?? "Not assigned"}
					</div>
				</div>
				<div>
					<div className="font-medium text-muted-foreground">
						{recipeName ? "Recipe Code" : "Category"}
					</div>
					<div className="font-semibold text-foreground">
						{recipeName
							? (recipeCode ?? "Not assigned")
							: (category ?? "Unassigned")}
					</div>
				</div>
				<div>
					<div className="font-medium text-muted-foreground">
						Reporting Period
					</div>
					<div className="font-semibold text-foreground">{periodLabel}</div>
				</div>
			</div>

			<div className="mb-5 text-sm">
				<span className="font-medium text-muted-foreground">Generated On:</span>{" "}
				<span className="font-semibold text-foreground">
					{format(parseISO(generatedAt), "dd MMM yyyy hh:mm a")}
				</span>
			</div>
		</div>
	);
}

export function PnlPrintFooter({ generatedAt }: { generatedAt: string }) {
	return (
		<div className="hidden print:flex print:items-center print:justify-between print:border-t print:border-black/10 print:pt-4 print:text-sm">
			<div>All amounts are in PKR</div>
			<div>
				Generated on {format(parseISO(generatedAt), "dd MMM yyyy hh:mm a")}
			</div>
			<div>Page 1 of 1</div>
		</div>
	);
}

export function PnlComparisonTableFooter({
	children,
}: {
	children: React.ReactNode;
}) {
	return <TableFooter>{children}</TableFooter>;
}
