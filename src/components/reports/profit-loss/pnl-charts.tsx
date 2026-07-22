import {
	Bar,
	BarChart,
	CartesianGrid,
	Cell,
	LabelList,
	Legend,
	Line,
	LineChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { formatPKR } from "@/lib/currency-format";

export interface PnlTrendChartPoint {
	monthKey?: string;
	monthLabel: string;
	totalRevenue: number;
	totalCogs: number;
	grossProfit: number;
	netProfit: number;
	grossMarginPercent?: number;
	netMarginPercent?: number;
}

function formatCompactCurrency(value: number) {
	if (Math.abs(value) >= 1_000_000) {
		return `${(value / 1_000_000).toFixed(1)}M`;
	}

	if (Math.abs(value) >= 1_000) {
		return `${(value / 1_000).toFixed(1)}K`;
	}

	return value.toFixed(0);
}

function BaseTooltip({
	active,
	payload,
	label,
}: {
	active?: boolean;
	payload?: Array<{
		value?: number;
		name?: string;
		color?: string;
	}>;
	label?: string;
}) {
	if (!active || !payload?.length) {
		return null;
	}

	return (
		<div className="rounded-xl border border-border/70 bg-white/95 p-3 text-xs shadow-lg">
			<div className="mb-2 font-medium text-foreground">{label}</div>
			<div className="space-y-1.5">
				{payload.map((item) => (
					<div
						key={`${item.name}-${item.color}`}
						className="flex items-center justify-between gap-6"
					>
						<div className="flex items-center gap-2 text-muted-foreground">
							<span
								className="size-2.5 rounded-full"
								style={{ backgroundColor: item.color }}
							/>
							<span>{item.name}</span>
						</div>
						<div className="font-mono text-foreground">
							{formatPKR(Number(item.value ?? 0), false)}
						</div>
					</div>
				))}
			</div>
		</div>
	);
}

const CHART_HEIGHT = "h-[260px]";

export function PnlTrendChart({
	data,
	profitLabel = "Net Profit",
}: {
	data: PnlTrendChartPoint[];
	profitLabel?: string;
}) {
	return (
		<div data-pnl-chart className={`${CHART_HEIGHT} print:h-[240px]`}>
			<ResponsiveContainer width="100%" height="100%">
				<LineChart
					data={data}
					margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
				>
					<CartesianGrid strokeDasharray="4 4" stroke="hsl(var(--border))" />
					<XAxis
						dataKey="monthLabel"
						tickLine={false}
						axisLine={false}
						tick={{ fontSize: 10 }}
					/>
					<YAxis
						tickLine={false}
						axisLine={false}
						tickFormatter={formatCompactCurrency}
						tick={{ fontSize: 10 }}
						width={42}
					/>
					<Tooltip content={<BaseTooltip />} />
					<Legend
						verticalAlign="top"
						align="left"
						height={28}
						iconType="square"
						wrapperStyle={{ fontSize: "11px", paddingTop: 0 }}
					/>
					<Line
						type="monotone"
						dataKey="totalRevenue"
						stroke="#2563eb"
						strokeWidth={2.25}
						dot={false}
						name="Revenue"
					/>
					<Line
						type="monotone"
						dataKey="totalCogs"
						stroke="#ef4444"
						strokeWidth={2.25}
						dot={false}
						name="COGS"
					/>
					<Line
						type="monotone"
						dataKey="grossProfit"
						stroke="#16a34a"
						strokeWidth={2.25}
						dot={false}
						name="Gross Profit"
					/>
					<Line
						type="monotone"
						dataKey="netProfit"
						stroke="#7c3aed"
						strokeWidth={2.25}
						dot={false}
						name={profitLabel}
					/>
				</LineChart>
			</ResponsiveContainer>
		</div>
	);
}

export function MarginTrendChart({
	data,
	marginLabel = "Net Margin",
}: {
	data: PnlTrendChartPoint[];
	marginLabel?: string;
}) {
	return (
		<div data-pnl-chart className={`${CHART_HEIGHT} print:h-[240px]`}>
			<ResponsiveContainer width="100%" height="100%">
				<LineChart
					data={data}
					margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
				>
					<CartesianGrid strokeDasharray="4 4" stroke="hsl(var(--border))" />
					<XAxis
						dataKey="monthLabel"
						tickLine={false}
						axisLine={false}
						tick={{ fontSize: 10 }}
					/>
					<YAxis
						tickLine={false}
						axisLine={false}
						tickFormatter={(value) => `${value}%`}
						tick={{ fontSize: 10 }}
						width={42}
					/>
					<Tooltip
						formatter={(value, name) => [
							`${Number(value ?? 0).toFixed(2)}%`,
							name,
						]}
					/>
					<Legend
						verticalAlign="top"
						align="left"
						height={28}
						iconType="square"
						wrapperStyle={{ fontSize: "11px", paddingTop: 0 }}
					/>
					<Line
						type="monotone"
						dataKey="grossMarginPercent"
						stroke="#16a34a"
						strokeWidth={2.25}
						dot={{ r: 2.5, fill: "#16a34a" }}
						name="Gross Margin"
					/>
					<Line
						type="monotone"
						dataKey="netMarginPercent"
						stroke="#7c3aed"
						strokeWidth={2.25}
						dot={{ r: 2.5, fill: "#7c3aed" }}
						name={marginLabel}
					/>
				</LineChart>
			</ResponsiveContainer>
		</div>
	);
}

export function ProfitabilityChart({
	data,
	profitLabel = "Net Profit",
}: {
	data: PnlTrendChartPoint[];
	profitLabel?: string;
}) {
	return (
		<div data-pnl-chart className={`${CHART_HEIGHT} print:h-[240px]`}>
			<ResponsiveContainer width="100%" height="100%">
				<BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
					<CartesianGrid strokeDasharray="4 4" stroke="hsl(var(--border))" />
					<XAxis
						dataKey="monthLabel"
						tickLine={false}
						axisLine={false}
						tick={{ fontSize: 10 }}
					/>
					<YAxis
						tickLine={false}
						axisLine={false}
						tickFormatter={formatCompactCurrency}
						tick={{ fontSize: 10 }}
						width={42}
					/>
					<Tooltip content={<BaseTooltip />} />
					<Legend
						verticalAlign="top"
						align="left"
						height={28}
						iconType="square"
						wrapperStyle={{ fontSize: "11px", paddingTop: 0 }}
					/>
					<Bar
						dataKey="grossProfit"
						fill="#16a34a"
						name="Gross Profit"
						radius={[6, 6, 0, 0]}
					/>
					<Bar
						dataKey="netProfit"
						fill="#7c3aed"
						name={profitLabel}
						radius={[6, 6, 0, 0]}
					/>
				</BarChart>
			</ResponsiveContainer>
		</div>
	);
}

export function RevenueCostSnapshotChart({
	revenue,
	totalCogs,
	grossProfit,
	netProfit,
	profitLabel = "Net Profit",
}: {
	revenue: number;
	totalCogs: number;
	grossProfit: number;
	netProfit: number;
	profitLabel?: string;
}) {
	const chartData = [
		{ label: "Revenue", value: revenue, fill: "#2563eb" },
		{ label: "COGS", value: totalCogs, fill: "#ef4444" },
		{ label: "Gross Profit", value: grossProfit, fill: "#16a34a" },
		{ label: profitLabel, value: netProfit, fill: "#7c3aed" },
	];

	return (
		<div data-pnl-chart className={`${CHART_HEIGHT} print:h-[240px]`}>
			<ResponsiveContainer width="100%" height="100%">
				<BarChart
					data={chartData}
					margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
				>
					<CartesianGrid strokeDasharray="4 4" stroke="hsl(var(--border))" />
					<XAxis
						dataKey="label"
						tickLine={false}
						axisLine={false}
						tick={{ fontSize: 10 }}
						interval={0}
					/>
					<YAxis
						tickLine={false}
						axisLine={false}
						tickFormatter={formatCompactCurrency}
						tick={{ fontSize: 10 }}
						width={42}
					/>
					<Tooltip content={<BaseTooltip />} />
					<Bar dataKey="value" radius={[8, 8, 0, 0]} name="Amount">
						{chartData.map((entry) => (
							<Cell key={entry.label} fill={entry.fill} />
						))}
					</Bar>
				</BarChart>
			</ResponsiveContainer>
		</div>
	);
}

export function TopGrossProfitBar({
	data,
	metricLabel = "Gross Profit",
	color = "#7c3aed",
	showValueLabel = true,
}: {
	data: Array<{ name: string; value: number }>;
	metricLabel?: string;
	color?: string;
	showValueLabel?: boolean;
}) {
	return (
		<div data-pnl-chart className={`${CHART_HEIGHT} print:h-[240px]`}>
			<ResponsiveContainer width="100%" height="100%">
				<BarChart
					data={data}
					layout="vertical"
					margin={{ top: 4, right: 28, left: 0, bottom: 0 }}
				>
					<CartesianGrid
						strokeDasharray="4 4"
						stroke="hsl(var(--border))"
						horizontal={false}
					/>
					<XAxis
						type="number"
						tickLine={false}
						axisLine={false}
						tickFormatter={formatCompactCurrency}
						tick={{ fontSize: 10 }}
					/>
					<YAxis
						dataKey="name"
						type="category"
						tickLine={false}
						axisLine={false}
						width={130}
						tick={{ fontSize: 11 }}
					/>
					<Tooltip content={<BaseTooltip />} />
					<Bar
						dataKey="value"
						fill={color}
						radius={[4, 4, 4, 4]}
						name={metricLabel}
					>
						{data.map((entry) => (
							<Cell key={entry.name} fill={color} />
						))}
						{showValueLabel ? (
							<LabelList
								dataKey="value"
								position="right"
								formatter={(value) => {
									const n = Number(value ?? 0);
									return formatPKR(n, false);
								}}
								style={{ fontSize: 11, fill: "#374151" }}
							/>
						) : null}
					</Bar>
				</BarChart>
			</ResponsiveContainer>
		</div>
	);
}

export function RecipePerformanceChart({
	data,
	metricLabel,
}: {
	data: Array<{
		recipeName: string;
		value: number;
	}>;
	metricLabel: string;
}) {
	return (
		<div data-pnl-chart className="h-[300px] print:h-[240px]">
			<ResponsiveContainer width="100%" height="100%">
				<BarChart
					data={data}
					margin={{ top: 8, right: 12, left: 0, bottom: 40 }}
				>
					<CartesianGrid strokeDasharray="4 4" stroke="hsl(var(--border))" />
					<XAxis
						dataKey="recipeName"
						tickLine={false}
						axisLine={false}
						angle={-18}
						textAnchor="end"
						interval={0}
						height={70}
					/>
					<YAxis
						tickLine={false}
						axisLine={false}
						tickFormatter={formatCompactCurrency}
					/>
					<Tooltip content={<BaseTooltip />} />
					<Bar
						dataKey="value"
						fill="#2563eb"
						radius={[10, 10, 0, 0]}
						name={metricLabel}
					/>
				</BarChart>
			</ResponsiveContainer>
		</div>
	);
}
