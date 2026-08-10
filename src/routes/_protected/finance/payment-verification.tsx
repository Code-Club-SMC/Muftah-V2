import { createFileRoute } from "@tanstack/react-router";
import { PaymentVerificationPage } from "@/components/finance/payment-verification-page";
import { paymentSettlementQueries } from "@/hooks/sales/use-payment-settlement";

export const Route = createFileRoute(
	"/_protected/finance/payment-verification",
)({
	loader: ({ context }) =>
		context.queryClient.ensureQueryData(
			paymentSettlementQueries.list({
				view: "pending",
				page: 1,
				limit: 25,
			}),
		),
	component: RouteComponent,
});

function RouteComponent() {
	return (
		<main className="flex-1 overflow-y-auto">
			<div className="min-h-full p-4 md:p-8">
				<PaymentVerificationPage />
			</div>
		</main>
	);
}
