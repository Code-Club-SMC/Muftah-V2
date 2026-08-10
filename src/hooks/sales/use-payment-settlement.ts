import {
	queryOptions,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import {
	cancelBankTransferFn,
	clearChequeFn,
	confirmBankTransferFn,
	getPendingPaymentVerificationFn,
	returnChequeFn,
	reversePaymentFn,
} from "@/server-functions/sales/payment-settlement-fn";

export type PaymentSettlementView = "pending" | "history";
export type PaymentSettlementResult = Awaited<
	ReturnType<typeof getPendingPaymentVerificationFn>
>;
export type PaymentSettlementRow = PaymentSettlementResult["data"][number];

export type PaymentSettlementFilters = {
	view: PaymentSettlementView;
	page: number;
	limit: number;
};

export const paymentSettlementKeys = {
	all: ["payment-settlement"] as const,
	lists: () => [...paymentSettlementKeys.all, "list"] as const,
	list: (filters: PaymentSettlementFilters) =>
		[...paymentSettlementKeys.lists(), filters] as const,
};

export const paymentSettlementQueries = {
	list: (filters: PaymentSettlementFilters) =>
		queryOptions({
			queryKey: paymentSettlementKeys.list(filters),
			queryFn: () => getPendingPaymentVerificationFn({ data: filters }),
			staleTime: 15_000,
		}),
};

export function usePaymentSettlements(filters: PaymentSettlementFilters) {
	return useQuery(paymentSettlementQueries.list(filters));
}

const relatedQueryKeys = [
	["invoices"],
	["customers"],
	["payments"],
	["credit-recovery"],
	["reconciliation"],
	["wallets"],
	["transactions"],
] as const;

function useSettlementInvalidation() {
	const queryClient = useQueryClient();

	return () =>
		Promise.all([
			queryClient.invalidateQueries({ queryKey: paymentSettlementKeys.all }),
			...relatedQueryKeys.map((queryKey) =>
				queryClient.invalidateQueries({ queryKey }),
			),
		]);
}

function errorMessage(error: unknown, fallback: string) {
	return error instanceof Error && error.message ? error.message : fallback;
}

export function useConfirmBankTransfer() {
	const invalidate = useSettlementInvalidation();
	return useMutation({
		mutationKey: ["payment-settlement", "confirm-bank-transfer"],
		mutationFn: (data: { paymentId: string; effectiveDate: Date }) =>
			confirmBankTransferFn({ data }),
		onSuccess: async () => {
			toast.success("Bank transfer confirmed");
			await invalidate();
		},
		onError: (error) =>
			toast.error(errorMessage(error, "Could not confirm bank transfer")),
	});
}

export function useClearCheque() {
	const invalidate = useSettlementInvalidation();
	return useMutation({
		mutationKey: ["payment-settlement", "clear-cheque"],
		mutationFn: (data: { paymentId: string; effectiveDate: Date }) =>
			clearChequeFn({ data }),
		onSuccess: async () => {
			toast.success("Cheque cleared");
			await invalidate();
		},
		onError: (error) =>
			toast.error(errorMessage(error, "Could not clear cheque")),
	});
}

export function useReturnCheque() {
	const invalidate = useSettlementInvalidation();
	return useMutation({
		mutationKey: ["payment-settlement", "return-cheque"],
		mutationFn: (data: {
			paymentId: string;
			reason: string;
			paymentDueDate?: Date;
		}) => returnChequeFn({ data }),
		onSuccess: async () => {
			toast.success("Cheque marked as returned");
			await invalidate();
		},
		onError: (error) =>
			toast.error(errorMessage(error, "Could not return cheque")),
	});
}

export function useCancelBankTransfer() {
	const invalidate = useSettlementInvalidation();
	return useMutation({
		mutationKey: ["payment-settlement", "cancel-bank-transfer"],
		mutationFn: (data: {
			paymentId: string;
			reason: string;
			paymentDueDate?: Date;
		}) => cancelBankTransferFn({ data }),
		onSuccess: async () => {
			toast.success("Bank transfer cancelled");
			await invalidate();
		},
		onError: (error) =>
			toast.error(errorMessage(error, "Could not cancel bank transfer")),
	});
}

export function useReversePayment() {
	const invalidate = useSettlementInvalidation();
	return useMutation({
		mutationKey: ["payment-settlement", "reverse-payment"],
		mutationFn: (data: {
			paymentId: string;
			effectiveDate: Date;
			reason: string;
			paymentDueDate?: Date;
		}) => reversePaymentFn({ data }),
		onSuccess: async () => {
			toast.success("Payment reversed");
			await invalidate();
		},
		onError: (error) =>
			toast.error(errorMessage(error, "Could not reverse payment")),
	});
}
