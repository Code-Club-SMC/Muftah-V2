import { HelpCircle } from "lucide-react";
import { useState } from "react";
import { ResponsiveDialog } from "@/components/custom/responsive-dialog";
import { Button } from "@/components/ui/button";

interface TerminologyEntry {
	term: string;
	definition: string;
}

const TERMINOLOGY: readonly TerminologyEntry[] = [
	{
		term: "Collected Revenue",
		definition:
			"Money the company has actually received or settled from invoices in the selected period.",
	},
	{
		term: "Total COGS",
		definition:
			"What the sold products actually cost the company to make, based on the cost saved on the invoice lines.",
	},
	{
		term: "Gross Profit",
		definition: "Collected revenue minus the cost of the products sold.",
	},
	{
		term: "Gross Margin",
		definition:
			"The gross profit shown as a percentage of collected revenue.",
	},
	{
		term: "Operating Expenses",
		definition:
			"Business spending outside sold product cost, such as payroll, commissions, TA/DA, utilities, finance expenses, and failed-batch losses.",
	},
	{
		term: "Invoice Expenses",
		definition:
			"Extra invoice-linked costs that are spread into the report only for the collected portion of each invoice.",
	},
	{
		term: "Net Profit",
		definition: "What is left after gross profit minus operating expenses.",
	},
	{
		term: "Net Margin",
		definition:
			"The net profit shown as a percentage of collected revenue.",
	},
	{
		term: "Direct Profit",
		definition:
			"Product or recipe profit before shared company overhead is allocated.",
	},
	{
		term: "Direct Margin",
		definition:
			"The direct profit shown as a percentage of collected revenue for one product or one recipe.",
	},
	{
		term: "Failed Batch Loss",
		definition:
			"Chemical cost lost on a failed batch that produced no sellable output and was not recovered back into stock.",
	},
	{
		term: "Net Impact",
		definition:
			"Product or recipe result after direct profit minus failed-batch chemical losses for that same scope.",
	},
	{
		term: "Impact Margin",
		definition:
			"The net impact shown as a percentage of collected revenue.",
	},
	{
		term: "Payroll",
		definition: "Salary and wages paid to employees for the selected period.",
	},
	{
		term: "Commissions",
		definition: "Sales payout earned by staff for orders or sales.",
	},
	{
		term: "TA/DA",
		definition: "Travel and daily-allowance payments made for business trips.",
	},
	{
		term: "General Expenses",
		definition:
			"Other approved business spending, including finance-recorded expenses and failed-batch chemical write-offs.",
	},
	{
		term: "Reconciliation",
		definition:
			"The explanation of why profit and finance account balance movement do or do not match exactly.",
	},
];

export function PnlTerminologyDialog({
	triggerLabel = "Terminology",
	triggerSize = "sm",
}: {
	triggerLabel?: string;
	triggerSize?: "sm" | "default" | "lg" | "icon";
}) {
	const [open, setOpen] = useState(false);

	return (
		<>
			<Button
				type="button"
				variant="outline"
				size={triggerSize}
				onClick={() => setOpen(true)}
				className="gap-1.5 print:hidden"
				aria-label="Open terminology help dialog"
			>
				<HelpCircle className="size-4" />
				{triggerSize === "icon" ? null : triggerLabel}
			</Button>
			<ResponsiveDialog
				open={open}
				className="min-w-2xl"
				onOpenChange={setOpen}
				title="Report Terminology"
				description="Plain-language definitions for the terms used across these profitability reports."
				icon={HelpCircle}
			>
				<dl className="space-y-4 px-1 pb-2">
					{TERMINOLOGY.map((entry) => (
						<div
							key={entry.term}
							className="space-y-1 border-b border-border/50 pb-3 last:border-b-0 last:pb-0"
						>
							<dt className="text-sm font-semibold text-foreground">
								{entry.term}
							</dt>
							<dd className="text-sm leading-relaxed text-muted-foreground">
								{entry.definition}
							</dd>
						</div>
					))}
				</dl>
			</ResponsiveDialog>
		</>
	);
}
