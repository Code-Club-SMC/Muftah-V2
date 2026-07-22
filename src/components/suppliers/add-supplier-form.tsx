import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
	AlignLeft,
	Building2,
	IdCard,
	Mail,
	MapIcon,
	MapPin,
	Phone,
	Store,
	UserCircle,
} from "lucide-react";
import { toast } from "sonner";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import {
	Field,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { supplierSchema } from "@/lib/validators";
import { addSupplierFn } from "@/server-functions/suppliers/add-supplier-fn";
import type { getSuppliersFn } from "@/server-functions/suppliers/get-suppliers-fn";
import { Textarea } from "../ui/textarea";

type Props = {
	onSuccess: () => void;
};

type SuppliersList = Awaited<ReturnType<typeof getSuppliersFn>>;
type SupplierListItem = SuppliersList[number];
type NewSupplier = Awaited<ReturnType<typeof addSupplierFn>>;

export const AddSupplierForm = ({ onSuccess }: Props) => {
	const queryClient = useQueryClient();

	const mutate = useMutation({
		mutationFn: addSupplierFn,
		onSuccess: async (newSupplier, variables) => {
			const submitted = (
				variables as { data?: Record<string, unknown> } | undefined
			)?.data;
			const nowIso = new Date().toISOString();
			const supplier = newSupplier as NewSupplier | undefined;
			const emailValue = supplier?.email ?? String(submitted?.email ?? "");
			const nationalIdValue =
				supplier?.nationalId ?? String(submitted?.nationalId ?? "");

			const optimisticSupplier = {
				id: supplier?.id ?? `temp-supplier-${Date.now()}`,
				supplierName:
					supplier?.supplierName ??
					String(submitted?.supplierName ?? "New Supplier"),
				supplierShopName:
					supplier?.supplierShopName ??
					String(submitted?.supplierShopName ?? ""),
				email: emailValue || null,
				phone: supplier?.phone ?? String(submitted?.phone ?? ""),
				nationalId: nationalIdValue || null,
				address: supplier?.address ?? String(submitted?.address ?? ""),
				city: supplier?.city ?? String(submitted?.city ?? ""),
				state: supplier?.state ?? String(submitted?.state ?? ""),
				notes: supplier?.notes ?? String(submitted?.notes ?? ""),
				createdAt: supplier?.createdAt ?? nowIso,
				updatedAt: supplier?.updatedAt ?? nowIso,
				purchases: [],
				payments: [],
				totalPurchases: 0,
				totalPayments: 0,
				balance: 0,
			} as SupplierListItem;

			queryClient.setQueryData<SuppliersList>(["suppliers"], (current) => {
				if (!current) return [optimisticSupplier];
				return [
					optimisticSupplier,
					...current.filter(
						(supplier) => supplier.id !== optimisticSupplier.id,
					),
				];
			});

			// Invalidate the suppliers query so the active observer refetches in the
			// background and picks up computed fields (totalPurchases, balance, etc.).
			queryClient.invalidateQueries({ queryKey: ["suppliers"] });
			toast.success("Supplier added successfully");
			onSuccess();
		},
		onError: (error) => {
			toast.error(error.message || "Failed to add supplier");
		},
	});

	const form = useForm({
		defaultValues: {
			supplierName: "",
			supplierShopName: "",
			email: "",
			nationalId: "",
			phone: "",
			address: "",
			city: "",
			state: "",
			notes: "",
		} as z.input<typeof supplierSchema>,
		validators: {
			onSubmit: supplierSchema,
		},
		onSubmit: async ({ value }) => {
			await mutate.mutateAsync({ data: value });
		},
	});

	return (
		<form
			className="space-y-6 pt-2"
			onSubmit={(e) => {
				e.preventDefault();
				e.stopPropagation();
				form.handleSubmit();
			}}
		>
			<FieldGroup className="space-y-0">
				<div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-6">
					<form.Field name="supplierName">
						{(field) => (
							<Field>
								<FieldLabel className="flex items-center gap-2 mb-1.5">
									<UserCircle className="size-4 text-muted-foreground" />
									<span className="text-sm font-semibold">Contact Name</span>
								</FieldLabel>
								<Input
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(e) => field.handleChange(e.target.value)}
									placeholder="e.g. Ali Hassan"
									className="bg-background"
									autoFocus
								/>
								<p className="text-[13px] text-muted-foreground mt-1.5">
									Primary point of contact for this supplier.
								</p>
								<FieldError errors={field.state.meta.errors} />
							</Field>
						)}
					</form.Field>

					<form.Field name="supplierShopName">
						{(field) => (
							<Field>
								<FieldLabel className="flex items-center gap-2 mb-1.5">
									<Store className="size-4 text-muted-foreground" />
									<span className="text-sm font-semibold">
										Business / Shop Name
									</span>
								</FieldLabel>
								<Input
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(e) => field.handleChange(e.target.value)}
									placeholder="e.g. Hassan Traders"
									className="bg-background"
								/>
								<p className="text-[13px] text-muted-foreground mt-1.5">
									Official registered business name.
								</p>
								<FieldError errors={field.state.meta.errors} />
							</Field>
						)}
					</form.Field>

					<form.Field name="email">
						{(field) => (
							<Field>
								<FieldLabel className="flex items-center gap-2 mb-1.5">
									<Mail className="size-4 text-muted-foreground" />
									<span className="text-sm font-semibold">
										Email Address{" "}
										<span className="text-muted-foreground font-normal ml-1">
											(Optional)
										</span>
									</span>
								</FieldLabel>
								<Input
									type="email"
									value={field.state.value || ""}
									onBlur={field.handleBlur}
									onChange={(e) => field.handleChange(e.target.value)}
									placeholder="contact@supplier.com"
									className="bg-background"
								/>
								<FieldError errors={field.state.meta.errors} />
							</Field>
						)}
					</form.Field>

					<form.Field name="phone">
						{(field) => (
							<Field>
								<FieldLabel className="flex items-center gap-2 mb-1.5">
									<Phone className="size-4 text-muted-foreground" />
									<span className="text-sm font-semibold">Phone Number</span>
								</FieldLabel>
								<Input
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(e) => field.handleChange(e.target.value)}
									placeholder="e.g. 0300 1234567"
									className="bg-background"
								/>
								<FieldError errors={field.state.meta.errors} />
							</Field>
						)}
					</form.Field>

					<form.Field name="nationalId">
						{(field) => (
							<Field className="md:col-span-2">
								<FieldLabel className="flex items-center gap-2 mb-1.5">
									<IdCard className="size-4 text-muted-foreground" />
									<span className="text-sm font-semibold">
										National ID / CNIC{" "}
										<span className="text-muted-foreground font-normal ml-1">
											(Optional)
										</span>
									</span>
								</FieldLabel>
								<Input
									type="text"
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(e) => field.handleChange(e.target.value)}
									placeholder="e.g. 37293-7217300-1"
									className="bg-background"
								/>
								<FieldError errors={field.state.meta.errors} />
							</Field>
						)}
					</form.Field>

					<form.Field name="address">
						{(field) => (
							<Field className="md:col-span-2">
								<FieldLabel className="flex items-center gap-2 mb-1.5">
									<MapPin className="size-4 text-muted-foreground" />
									<span className="text-sm font-semibold">Street Address</span>
								</FieldLabel>
								<Input
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(e) => field.handleChange(e.target.value)}
									placeholder="Shop #12, Main Market..."
									className="bg-background"
								/>
								<FieldError errors={field.state.meta.errors} />
							</Field>
						)}
					</form.Field>

					<form.Field name="city">
						{(field) => (
							<Field>
								<FieldLabel className="flex items-center gap-2 mb-1.5">
									<Building2 className="size-4 text-muted-foreground" />
									<span className="text-sm font-semibold">
										City{" "}
										<span className="text-muted-foreground font-normal ml-1">
											(Optional)
										</span>
									</span>
								</FieldLabel>
								<Input
									value={field.state.value || ""}
									onBlur={field.handleBlur}
									onChange={(e) => field.handleChange(e.target.value)}
									placeholder="e.g. Lahore"
									className="bg-background"
								/>
								<FieldError errors={field.state.meta.errors} />
							</Field>
						)}
					</form.Field>

					<form.Field name="state">
						{(field) => (
							<Field>
								<FieldLabel className="flex items-center gap-2 mb-1.5">
									<MapIcon className="size-4 text-muted-foreground" />
									<span className="text-sm font-semibold">
										State / Province{" "}
										<span className="text-muted-foreground font-normal ml-1">
											(Optional)
										</span>
									</span>
								</FieldLabel>
								<Input
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(e) => field.handleChange(e.target.value)}
									placeholder="e.g. Punjab"
									className="bg-background"
								/>
								<FieldError errors={field.state.meta.errors} />
							</Field>
						)}
					</form.Field>

					<form.Field name="notes">
						{(field) => (
							<Field className="md:col-span-2">
								<FieldLabel className="flex items-center gap-2 mb-1.5">
									<AlignLeft className="size-4 text-muted-foreground" />
									<span className="text-sm font-semibold">
										Internal Notes{" "}
										<span className="text-muted-foreground font-normal ml-1">
											(Optional)
										</span>
									</span>
								</FieldLabel>
								<Textarea
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(e) => field.handleChange(e.target.value)}
									placeholder="Add any specific payment terms, delivery schedules, or internal observations..."
									className="bg-background min-h-[100px] resize-none"
								/>
								<FieldError errors={field.state.meta.errors} />
							</Field>
						)}
					</form.Field>
				</div>

				<div className="flex justify-end pt-6 mt-6 border-t border-border/60">
					<form.Subscribe
						selector={(s: { isSubmitting: boolean }) => s.isSubmitting}
					>
						{(isSubmitting: boolean) => (
							<Button
								type="submit"
								disabled={isSubmitting}
								className="w-full md:w-auto md:min-w-[140px]"
							>
								{isSubmitting ? "Adding Supplier..." : "Add Supplier"}
							</Button>
						)}
					</form.Subscribe>
				</div>
			</FieldGroup>
		</form>
	);
};
