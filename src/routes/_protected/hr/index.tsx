import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_protected/hr/")({
  component: RouteComponent,
});

function RouteComponent() {
  return <div>Hello "/hr/"!</div>;
}

// import { zodResolver } from "@hookform/resolvers/zod";
// import { useForm } from "@tanstack/react-form";
// import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
// import { createFileRoute } from "@tanstack/react-router";
// import { Banknote, Calendar, Loader2, PlusCircle, Users } from "lucide-react";
// import { toast } from "sonner";
// import { z } from "zod";
// import { Badge } from "@/components/ui/badge";
// import { Button } from "@/components/ui/button";
// import {
// 	Card,
// 	CardContent,
// 	CardDescription,
// 	CardHeader,
// 	CardTitle,
// } from "@/components/ui/card";
// import { Field, FieldError, FieldLabel } from "@/components/ui/field";
// import { Input } from "@/components/ui/input";
// import {
// 	Select,
// 	SelectContent,
// 	SelectItem,
// 	SelectTrigger,
// 	SelectValue,
// } from "@/components/ui/select";
// import { Separator } from "@/components/ui/separator";
// import {
// 	Table,
// 	TableBody,
// 	TableCell,
// 	TableHead,
// 	TableHeader,
// 	TableRow,
// } from "@/components/ui/table";

// export const Route = createFileRoute("/hr/")({
// 	component: PayrollPage,
// });

// const payrollFormSchema = z.object({
// 	employeeId: z.string().min(1, "Select Employee"),
// 	month: z.coerce.number().min(1).max(12),
// 	year: z.coerce.number().min(2024),
// 	baseSalary: z.coerce.number().min(0),
// 	overtimePay: z.coerce.number().min(0),
// 	deductions: z.coerce.number().min(0),
// 	walletId: z.string().min(1, "Select Account"),
// });

// function PayrollPage() {
// 	const queryClient = useQueryClient();

// 	const { data: setup, isLoading } = useQuery({
// 		queryKey: ["payroll-setup"],
// 		queryFn: async () => {
// 			const [employees, wallets, history] = await Promise.all([
// 				fetch(`${BACKEND_URL}/hr/employees`).then((r) => r.json()),
// 				fetch(`${BACKEND_URL}/finance/wallets`).then((r) => r.json()),
// 				fetch(`${BACKEND_URL}/hr/payroll-history`).then((r) => r.json()),
// 			]);
// 			return { employees, wallets, history };
// 		},
// 	});

// 	const { mutate: processPayroll, isPending } = useMutation({
// 		mutationFn: async (values: z.infer<typeof payrollFormSchema>) => {
// 			const res = await fetch(`${BACKEND_URL}/hr/process-payroll`, {
// 				method: "POST",
// 				headers: { "Content-Type": "application/json" },
// 				body: JSON.stringify(values),
// 			});
// 			if (!res.ok) {
// 				const err = await res.json();
// 				throw new Error(err.error || "Payroll failed");
// 			}
// 		},
// 		onSuccess: () => {
// 			toast.success("Payroll processed successfully!");
// 			queryClient.invalidateQueries({ queryKey: ["payroll-setup"] });
// 			queryClient.invalidateQueries({ queryKey: ["finance-overview"] });
// 			form.reset();
// 		},
// 		onError: (e) => toast.error(e.message),
// 	});

// 	const form = useForm<z.infer<typeof payrollFormSchema>>({
// 		resolver: zodResolver(payrollFormSchema) as any,
// 		defaultValues: {
// 			employeeId: "",
// 			month: new Date().getMonth() + 1,
// 			year: new Date().getFullYear(),
// 			baseSalary: 0,
// 			overtimePay: 0,
// 			deductions: 0,
// 			walletId: "",
// 		},
// 	});

// 	if (isLoading)
// 		return (
// 			<div className="flex justify-center p-20">
// 				<Loader2 className="animate-spin" />
// 			</div>
// 		);

// 	const watchBase = form.watch("baseSalary");
// 	const watchOT = form.watch("overtimePay");
// 	const watchDeductions = form.watch("deductions");
// 	const netPay = Number(watchBase) + Number(watchOT) - Number(watchDeductions);

// 	return (
// 		<div className="container mx-auto p-6 space-y-8">
// 			<div className="flex justify-between items-center">
// 				<div>
// 					<h1 className="text-2xl font-bold tracking-tight">HR & Payroll</h1>
// 					<p className="text-muted-foreground">
// 						Manage employee salaries and professional payroll cycles.
// 					</p>
// 				</div>
// 			</div>

// 			<div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
// 				{/* Left: Employee List & History */}
// 				<div className="lg:col-span-8 space-y-6">
// 					<Card>
// 						<CardHeader>
// 							<CardTitle className="flex items-center gap-2">
// 								<Users className="size-5" /> Employees overview
// 							</CardTitle>
// 						</CardHeader>
// 						<CardContent>
// 							<Table>
// 								<TableHeader>
// 									<TableRow>
// 										<TableHead>Name</TableHead>
// 										<TableHead>Role</TableHead>
// 										<TableHead className="text-right">Base Salary</TableHead>
// 										<TableHead></TableHead>
// 									</TableRow>
// 								</TableHeader>
// 								<TableBody>
// 									{setup?.employees.map((emp: any) => (
// 										<TableRow key={emp.id}>
// 											<TableCell className="font-medium">{emp.name}</TableCell>
// 											<TableCell>
// 												<Badge variant="outline">{emp.role}</Badge>
// 											</TableCell>
// 											<TableCell className="text-right font-mono">
// 												PKR {Number(emp.baseSalary).toLocaleString()}
// 											</TableCell>
// 											<TableCell>
// 												<Button
// 													variant="ghost"
// 													size="sm"
// 													onClick={() => {
// 														form.setValue("employeeId", emp.id);
// 														form.setValue("baseSalary", Number(emp.baseSalary));
// 													}}
// 												>
// 													Prepare Pay
// 												</Button>
// 											</TableCell>
// 										</TableRow>
// 									))}
// 								</TableBody>
// 							</Table>
// 						</CardContent>
// 					</Card>

// 					<Card>
// 						<CardHeader>
// 							<CardTitle className="text-sm font-medium">
// 								Recent Payroll History
// 							</CardTitle>
// 						</CardHeader>
// 						<CardContent>
// 							<Table>
// 								<TableHeader>
// 									<TableRow>
// 										<TableHead>Employee</TableHead>
// 										<TableHead>Period</TableHead>
// 										<TableHead className="text-right">Total Paid</TableHead>
// 										<TableHead>Status</TableHead>
// 									</TableRow>
// 								</TableHeader>
// 								<TableBody>
// 									{setup?.history.map((record: any) => (
// 										<TableRow key={record.id}>
// 											<TableCell>{record.employee.name}</TableCell>
// 											<TableCell className="text-xs uppercase text-muted-foreground font-medium">
// 												{new Date(record.year, record.month - 1).toLocaleString(
// 													"default",
// 													{ month: "short", year: "numeric" },
// 												)}
// 											</TableCell>
// 											<TableCell className="text-right font-bold">
// 												PKR {Number(record.totalPaid).toLocaleString()}
// 											</TableCell>
// 											<TableCell>
// 												<Badge className="bg-green-100 text-green-700 hover:bg-green-100 border-none">
// 													Received
// 												</Badge>
// 											</TableCell>
// 										</TableRow>
// 									))}
// 								</TableBody>
// 							</Table>
// 						</CardContent>
// 					</Card>
// 				</div>

// 				{/* Right: Payroll Processor Form */}
// 				<div className="lg:col-span-4">
// 					<Card className="sticky top-6">
// 						<CardHeader>
// 							<CardTitle className="flex items-center gap-2">
// 								<Banknote className="size-5" /> Process Payment
// 							</CardTitle>
// 							<CardDescription>
// 								Calculate and disburse salary to employees.
// 							</CardDescription>
// 						</CardHeader>
// 						<CardContent>
// 							<form
// 								onSubmit={form.handleSubmit((v) => processPayroll(v))}
// 								className="space-y-6"
// 							>
// 								<Controller
// 									control={form.control}
// 									name="employeeId"
// 									render={({ field, fieldState }) => (
// 										<Field>
// 											<FieldLabel>Select Employee</FieldLabel>
// 											<Select
// 												value={field.value}
// 												onValueChange={field.onChange}
// 											>
// 												<SelectTrigger>
// 													<SelectValue placeholder="Select..." />
// 												</SelectTrigger>
// 												<SelectContent>
// 													{setup?.employees.map((e: any) => (
// 														<SelectItem key={e.id} value={e.id}>
// 															{e.name}
// 														</SelectItem>
// 													))}
// 												</SelectContent>
// 											</Select>
// 											<FieldError errors={[fieldState.error]} />
// 										</Field>
// 									)}
// 								/>

// 								<div className="grid grid-cols-2 gap-4">
// 									<Controller
// 										control={form.control}
// 										name="month"
// 										render={({ field }) => (
// 											<Field>
// 												<FieldLabel>Month</FieldLabel>
// 												<Select
// 													value={field.value.toString()}
// 													onValueChange={(v) => field.onChange(Number(v))}
// 												>
// 													<SelectTrigger>
// 														<SelectValue />
// 													</SelectTrigger>
// 													<SelectContent>
// 														{Array.from({ length: 12 }).map((_, i) => (
// 															<SelectItem
// 																key={i + 1}
// 																value={(i + 1).toString()}
// 															>
// 																{new Date(0, i).toLocaleString("default", {
// 																	month: "long",
// 																})}
// 															</SelectItem>
// 														))}
// 													</SelectContent>
// 												</Select>
// 											</Field>
// 										)}
// 									/>
// 									<Controller
// 										control={form.control}
// 										name="year"
// 										render={({ field }) => (
// 											<Field>
// 												<FieldLabel>Year</FieldLabel>
// 												<Input type="number" {...field} />
// 											</Field>
// 										)}
// 									/>
// 								</div>

// 								<Separator />

// 								<div className="space-y-4 pt-2">
// 									<Controller
// 										control={form.control}
// 										name="baseSalary"
// 										render={({ field }) => (
// 											<Field>
// 												<FieldLabel>Base Salary (PKR)</FieldLabel>
// 												<Input type="number" {...field} />
// 											</Field>
// 										)}
// 									/>
// 									<div className="grid grid-cols-2 gap-4">
// 										<Controller
// 											control={form.control}
// 											name="overtimePay"
// 											render={({ field }) => (
// 												<Field>
// 													<FieldLabel>Overtime (OT)</FieldLabel>
// 													<Input type="number" {...field} />
// 												</Field>
// 											)}
// 										/>
// 										<Controller
// 											control={form.control}
// 											name="deductions"
// 											render={({ field }) => (
// 												<Field>
// 													<FieldLabel>Deductions</FieldLabel>
// 													<Input type="number" {...field} />
// 												</Field>
// 											)}
// 										/>
// 									</div>
// 								</div>

// 								<Controller
// 									control={form.control}
// 									name="walletId"
// 									render={({ field, fieldState }) => (
// 										<Field>
// 											<FieldLabel>Disburse From</FieldLabel>
// 											<Select
// 												value={field.value}
// 												onValueChange={field.onChange}
// 											>
// 												<SelectTrigger>
// 													<SelectValue placeholder="Select Account" />
// 												</SelectTrigger>
// 												<SelectContent>
// 													{setup?.wallets.map((w: any) => (
// 														<SelectItem key={w.id} value={w.id}>
// 															{w.name}
// 														</SelectItem>
// 													))}
// 												</SelectContent>
// 											</Select>
// 											<FieldError errors={[fieldState.error]} />
// 										</Field>
// 									)}
// 								/>

// 								<div className="bg-primary/5 p-4 rounded-xl space-y-1">
// 									<div className="text-xs text-muted-foreground uppercase font-bold tracking-tight">
// 										Net Amount to Pay
// 									</div>
// 									<div className="text-2xl font-black text-primary">
// 										PKR {netPay.toLocaleString()}
// 									</div>
// 								</div>

// 								<Button
// 									type="submit"
// 									className="w-full text-lg h-12"
// 									disabled={isPending}
// 								>
// 									{isPending ? (
// 										<Loader2 className="animate-spin mr-2 h-4 w-4" />
// 									) : null}
// 									Disburse Salary
// 								</Button>
// 							</form>
// 						</CardContent>
// 					</Card>
// 				</div>
// 			</div>
// 		</div>
// 	);
// }
