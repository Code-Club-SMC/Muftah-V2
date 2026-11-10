import { useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { OfflineDesk, OfflineEntryDraft } from "@/hooks/sales/use-offline-desk";
import type { OfflineDeskEntry } from "@/lib/sales/offline/desk-pack";
import {
  bookedOrderItems,
  calculateOfflineEntry,
  type OfflineEntryIssue,
  type OfflineEntryPayment,
} from "@/lib/sales/offline/entry-calculator";
import { formatPKR } from "@/lib/currency-format";
import { allocatedUnitsByProduct, formatStock, lineStockWarning } from "@/lib/sales/offline/desk-stock";

type SaleType = OfflineEntryDraft["saleType"];
type PaymentKind = "cash" | "bank_transfer" | "digital" | "cheque" | "salary_offset";
type ItemRow = {
  productCode: string;
  cartons: string;
  loose: string;
  manualFree: string;
  /** Carton price typed over the list. Empty means the listed price. */
  priceOverride: string;
  changePrice: boolean;
};
type PaymentRow = {
  kind: PaymentKind;
  amount: string;
  walletCode: string;
  reference: string;
  chequeBank: string;
  chequeNumber: string;
  chequeDate: string;
  senderBankName: string;
  senderAccountNumber: string;
  provider: string;
  senderMobile: string;
  senderTitle: string;
  instantVerify: boolean;
  notes: string;
  salesmanId: string;
};

const PROVIDERS = ["EasyPaisa", "JazzCash", "Raast", "SadaPay", "NayaPay", "Other"];
const TIME_ZONE = "Asia/Karachi";

function pakistanNow() {
  const now = new Date();
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  return { date, time };
}

const emptyItem = (): ItemRow => ({
  productCode: "",
  cartons: "",
  loose: "",
  manualFree: "",
  priceOverride: "",
  changePrice: false,
});

function blankPayment(kind: PaymentKind, walletCode: string): PaymentRow {
  return {
    kind,
    amount: "",
    walletCode,
    reference: "",
    chequeBank: "",
    chequeNumber: "",
    chequeDate: "",
    senderBankName: "",
    senderAccountNumber: "",
    provider: "EasyPaisa",
    senderMobile: "",
    senderTitle: "",
    instantVerify: false,
    notes: "",
    salesmanId: "",
  };
}

function whole(value: string) {
  return /^\d+$/.test(value.trim()) ? Number(value) : value.trim() === "" ? 0 : Number.NaN;
}

function amountOf(value: string) {
  return value.trim() === "" ? 0 : Number(value);
}

function fromEntry(entry: OfflineDeskEntry) {
  return {
    saleType: entry.saleType,
    saleDate: entry.saleDate,
    saleTime: entry.saleTime,
    customerCode: entry.distributorCode ?? "",
    orderKey: entry.orderBookerCode ? `${entry.orderBookerCode}|${entry.billNumber}` : "",
    isNewCustomer: Boolean(entry.newCustomer),
    newName: entry.newCustomer?.name ?? "",
    newMobile: entry.newCustomer?.mobile ?? "",
    newCity: entry.newCustomer?.city ?? "",
    newAddress: entry.newCustomer?.address ?? "",
    items: entry.items.map<ItemRow>((item) => ({
      productCode: item.productCode,
      cartons: String(item.cartonQuantity),
      loose: String(item.looseUnitQuantity),
      manualFree: item.manualFreeCartons ? String(item.manualFreeCartons) : "",
      priceOverride: item.priceOverride != null ? String(item.priceOverride) : "",
      changePrice: item.priceOverride != null,
    })),
    payments: entry.payments.map<PaymentRow>((payment) => ({
      ...blankPayment(
        payment.digital ? "digital" : payment.method === "expense_offset" ? "salary_offset" : payment.method,
        payment.walletCode,
      ),
      salesmanId: payment.expenseEmployeeId ?? "",
      amount: String(payment.amount),
      reference: payment.reference ?? "",
      chequeBank: payment.chequeBank ?? "",
      chequeNumber: payment.chequeNumber ?? "",
      chequeDate: payment.chequeDate ?? "",
      senderBankName: payment.bank?.senderBankName ?? "",
      senderAccountNumber: payment.bank?.senderAccountNumber ?? "",
      provider: payment.digital?.provider ?? "EasyPaisa",
      senderMobile: payment.digital?.senderMobile ?? "",
      senderTitle: payment.digital?.senderTitle ?? "",
      instantVerify: Boolean(payment.instantVerify),
      notes: payment.notes ?? "",
    })),
    dueDate: entry.paymentDueDate ?? "",
    remarks: entry.remarks ?? "",
    discount: entry.invoiceDiscount ? String(entry.invoiceDiscount) : "",
    discountNote: entry.invoiceDiscountDescription ?? "",
    expenses: entry.expenses ? String(entry.expenses) : "",
    expensesNote: entry.expensesDescription ?? "",
  };
}

export function EntryForm({
  desk,
  editing,
  onSaved,
  onCancelEdit,
}: {
  desk: OfflineDesk;
  editing: OfflineDeskEntry | null;
  onSaved: (entry: OfflineDeskEntry, print: boolean) => void;
  onCancelEdit: () => void;
}) {
  const pack = desk.pack;
  const initial = useMemo(() => {
    if (editing) return fromEntry(editing);
    const now = pakistanNow();
    return {
      saleType: "direct_distributor" as SaleType,
      saleDate: now.date,
      saleTime: now.time,
      customerCode: "",
      orderKey: "",
      isNewCustomer: false,
      newName: "",
      newMobile: "",
      newCity: "",
      newAddress: "",
      items: [emptyItem()],
      payments: [] as PaymentRow[],
      dueDate: "",
      remarks: "",
      discount: "",
      discountNote: "",
      expenses: "",
      expensesNote: "",
    };
  }, [editing]);

  const [saleType, setSaleType] = useState<SaleType>(initial.saleType);
  const [saleDate, setSaleDate] = useState(initial.saleDate);
  const [saleTime, setSaleTime] = useState(initial.saleTime);
  const [customerCode, setCustomerCode] = useState(initial.customerCode);
  const [customerSearch, setCustomerSearch] = useState("");
  const [orderKey, setOrderKey] = useState(initial.orderKey);
  const [isNewCustomer, setIsNewCustomer] = useState(initial.isNewCustomer);
  const [newName, setNewName] = useState(initial.newName);
  const [newMobile, setNewMobile] = useState(initial.newMobile);
  const [newCity, setNewCity] = useState(initial.newCity);
  const [newAddress, setNewAddress] = useState(initial.newAddress);
  const [items, setItems] = useState<ItemRow[]>(initial.items);
  const [payments, setPayments] = useState<PaymentRow[]>(initial.payments);
  const [dueDate, setDueDate] = useState(initial.dueDate);
  const [remarks, setRemarks] = useState(initial.remarks);
  const [discount, setDiscount] = useState(initial.discount);
  const [discountNote, setDiscountNote] = useState(initial.discountNote);
  const [expenses, setExpenses] = useState(initial.expenses);
  const [expensesNote, setExpensesNote] = useState(initial.expensesNote);
  const [issues, setIssues] = useState<OfflineEntryIssue[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Packs already promised on other invoices that are still on this computer.
  // The invoice being changed is left out. Cached, because it runs the invoice
  // maths once per saved invoice.
  const allocated = useMemo(
    () => (pack ? allocatedUnitsByProduct(desk.entries, pack.reference, editing?.slotNumber) : new Map<string, number>()),
    [desk.entries, pack, editing?.slotNumber],
  );

  if (!pack) return null;
  const reference = pack.reference;
  const now = new Date();
  const cashWallets = reference.wallets.filter((wallet) => wallet.type === "cash");
  const bankWallets = reference.wallets.filter((wallet) => wallet.type === "bank");
  const booked = saleType === "booked_order";
  const retail = saleType === "direct_retailer";
  const selectedOrder = booked
    ? reference.orders.find((value) => `${value.orderBookerCode}|${value.billNumber}` === orderKey)
    : undefined;
  const selectedRetailer = retail && !isNewCustomer
    ? reference.retailers.find((value) => value.code === customerCode)
    : undefined;

  const search = customerSearch.trim().toLowerCase();
  const retailerChoices = reference.retailers
    .filter(
      (value) =>
        !search ||
        value.name.toLowerCase().includes(search) ||
        value.code.toLowerCase().includes(search) ||
        (value.mobile ?? "").includes(search),
    )
    .slice(0, 300);

  const draft: OfflineEntryDraft = {
    saleDate,
    saleTime,
    saleType,
    distributorCode: booked || (retail && isNewCustomer) ? null : customerCode || null,
    newCustomer:
      retail && isNewCustomer
        ? {
            name: newName.trim(),
            mobile: newMobile.trim() || null,
            city: newCity.trim() || null,
            address: newAddress.trim() || null,
          }
        : null,
    orderBookerCode: booked ? (selectedOrder?.orderBookerCode ?? null) : null,
    billNumber: booked ? (selectedOrder?.billNumber ?? null) : null,
    paymentDueDate: dueDate || null,
    remarks: remarks.trim() || null,
    invoiceDiscount: amountOf(discount),
    invoiceDiscountDescription: discountNote.trim() || null,
    expenses: amountOf(expenses),
    expensesDescription: expensesNote.trim() || null,
    items: items
      .filter((row) => row.productCode || row.cartons || row.loose)
      .map((row) => ({
        productCode: row.productCode,
        cartonQuantity: whole(row.cartons),
        looseUnitQuantity: whole(row.loose),
        physicalStockConfirmed: false,
        manualFreeCartons: booked ? 0 : whole(row.manualFree),
        priceOverride: !booked && row.changePrice && row.priceOverride.trim() !== "" ? Number(row.priceOverride) : null,
      })),
    payments: payments.map<OfflineEntryPayment>((row) => ({
      method: row.kind === "digital" ? "bank_transfer" : row.kind === "salary_offset" ? "expense_offset" : row.kind,
      expenseEmployeeId: row.kind === "salary_offset" ? row.salesmanId || null : null,
      amount: amountOf(row.amount),
      walletCode: row.walletCode,
      reference: row.reference.trim() || null,
      chequeBank: row.chequeBank.trim() || null,
      chequeNumber: row.chequeNumber.trim() || null,
      chequeDate: row.chequeDate || null,
      paymentDate: saleDate,
      instantVerify: row.kind !== "cash" && row.kind !== "salary_offset" && row.instantVerify,
      digital:
        row.kind === "digital"
          ? { provider: row.provider, senderMobile: row.senderMobile.trim(), senderTitle: row.senderTitle.trim() || null }
          : null,
      bank:
        row.kind === "bank_transfer"
          ? { senderBankName: row.senderBankName.trim(), senderAccountNumber: row.senderAccountNumber.trim() }
          : null,
      notes: row.notes.trim() || null,
    })),
  };
  const slot = editing ?? desk.freeSlots[0];
  const preview = calculateOfflineEntry(
    { ...draft, slotNumber: 0, recordToken: "" },
    reference,
    editing?.reservedSerial ?? desk.freeSlots[0]?.reservedSerial ?? 0,
  );
  const previewByProduct = new Map(preview.items.map((item) => [item.productCode, item]));

  const chooseOrder = (key: string) => {
    setOrderKey(key);
    const order = reference.orders.find((value) => `${value.orderBookerCode}|${value.billNumber}` === key);
    setItems(
      order
        ? bookedOrderItems(order, reference.products).map<ItemRow>((item) => ({
            ...emptyItem(),
            productCode: item.productCode,
            cartons: String(item.cartonQuantity),
            loose: String(item.looseUnitQuantity),
          }))
        : [emptyItem()],
    );
  };
  const changeSaleType = (next: SaleType) => {
    setSaleType(next);
    setCustomerCode("");
    setCustomerSearch("");
    setOrderKey("");
    setIsNewCustomer(false);
    setDiscount("");
    setItems([emptyItem()]);
  };
  const setItem = (index: number, patch: Partial<ItemRow>) =>
    setItems((rows) => rows.map((row, at) => (at === index ? { ...row, ...patch } : row)));
  const setPayment = (index: number, patch: Partial<PaymentRow>) =>
    setPayments((rows) => rows.map((row, at) => (at === index ? { ...row, ...patch } : row)));
  const addPayment = (kind: PaymentKind, amount = "") =>
    setPayments((rows) => [
      ...rows,
      {
        ...blankPayment(
          kind,
          kind === "salary_offset" ? "expense_offset" : (kind === "cash" ? cashWallets : bankWallets)[0]?.code ?? "",
        ),
        amount,
      },
    ]);

  const submit = async (print: boolean) => {
    setSaving(true);
    setProblem(null);
    const result = await desk.saveEntry(draft, editing?.slotNumber);
    setSaving(false);
    if (!result.ok) {
      setIssues(result.issues);
      setProblem(result.message ?? null);
      return;
    }
    setIssues([]);
    onSaved(result.entry, print);
  };

  const noSlots = !slot;
  const customerLabels: Record<SaleType, string> = {
    direct_distributor: "Distributor",
    direct_retailer: "Retailer / walk-in",
    booked_order: "Booked order",
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {editing ? `Change ${editing.invoiceNumber}` : "New invoice"}
          {!editing && desk.freeSlots[0] && (
            <Badge variant="secondary" className="ml-3 font-mono">
              Next no. #{String(desk.freeSlots[0].reservedSerial).padStart(3, "0")}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Prices and free cartons come from the price list saved on this computer. They cannot be changed here.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {noSlots && (
          <Alert variant="destructive">
            <AlertTitle>No invoice numbers left</AlertTitle>
            <AlertDescription>Send the saved invoices, then press Refresh this computer for a new set.</AlertDescription>
          </Alert>
        )}

        <FieldGroup className="grid gap-4 md:grid-cols-4">
          <Field className="md:col-span-2">
            <FieldLabel>Sale type</FieldLabel>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(customerLabels) as SaleType[]).map((type) => (
                <Button
                  key={type}
                  type="button"
                  variant={saleType === type ? "default" : "outline"}
                  onClick={() => changeSaleType(type)}
                  disabled={Boolean(editing)}
                >
                  {customerLabels[type]}
                </Button>
              ))}
            </div>
          </Field>
          <Field>
            <FieldLabel htmlFor="desk-date">Date</FieldLabel>
            <Input id="desk-date" type="date" value={saleDate} onChange={(event) => setSaleDate(event.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="desk-time">Time</FieldLabel>
            <Input id="desk-time" type="time" value={saleTime} onChange={(event) => setSaleTime(event.target.value)} />
          </Field>

          {booked && (
            <Field className="md:col-span-4">
              <FieldLabel htmlFor="desk-order">Booked order</FieldLabel>
              <NativeSelect id="desk-order" className="w-full" value={orderKey} onChange={(event) => chooseOrder(event.target.value)} disabled={Boolean(editing)}>
                <NativeSelectOption value="">Choose the booked order…</NativeSelectOption>
                {reference.orders.map((order) => (
                  <NativeSelectOption key={`${order.orderBookerCode}|${order.billNumber}`} value={`${order.orderBookerCode}|${order.billNumber}`}>
                    Bill {order.billNumber} · {order.shopkeeperName}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          )}

          {saleType === "direct_distributor" && (
            <Field className="md:col-span-4">
              <FieldLabel htmlFor="desk-distributor">Distributor</FieldLabel>
              <NativeSelect id="desk-distributor" className="w-full" value={customerCode} onChange={(event) => setCustomerCode(event.target.value)}>
                <NativeSelectOption value="">Choose the distributor…</NativeSelectOption>
                {reference.distributors.map((value) => (
                  <NativeSelectOption key={value.code} value={value.code}>
                    {value.code} · {value.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          )}

          {retail && (
            <>
              <Field className="md:col-span-4">
                <FieldLabel>Customer</FieldLabel>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant={isNewCustomer ? "outline" : "default"} onClick={() => setIsNewCustomer(false)} disabled={Boolean(editing)}>
                    Existing customer
                  </Button>
                  <Button type="button" variant={isNewCustomer ? "default" : "outline"} onClick={() => { setIsNewCustomer(true); setCustomerCode(""); }} disabled={Boolean(editing)}>
                    New customer
                  </Button>
                </div>
              </Field>
              {!isNewCustomer ? (
                <>
                  <Field className="md:col-span-2">
                    <FieldLabel htmlFor="desk-customer-search">Find customer</FieldLabel>
                    <Input id="desk-customer-search" placeholder="Type a name, phone or code" value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} disabled={Boolean(editing)} />
                  </Field>
                  <Field className="md:col-span-2">
                    <FieldLabel htmlFor="desk-customer">Customer</FieldLabel>
                    <NativeSelect id="desk-customer" className="w-full" value={customerCode} onChange={(event) => setCustomerCode(event.target.value)} disabled={Boolean(editing)}>
                      <NativeSelectOption value="">Choose the customer…</NativeSelectOption>
                      {retailerChoices.map((value) => (
                        <NativeSelectOption key={value.code} value={value.code}>
                          {value.name}
                          {value.mobile ? ` · ${value.mobile}` : ""}
                          {value.city ? ` · ${value.city}` : ""} ({value.code})
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                    <FieldDescription>
                      {reference.retailers.length === 0
                        ? "No saved customers on this computer. Use New customer."
                        : retailerChoices.length >= 300
                          ? "Showing the first 300. Type to narrow the list."
                          : `${retailerChoices.length} customer(s)`}
                    </FieldDescription>
                  </Field>
                </>
              ) : (
                <>
                  <Field className="md:col-span-2">
                    <FieldLabel htmlFor="desk-new-name">Customer name</FieldLabel>
                    <Input id="desk-new-name" value={newName} onChange={(event) => setNewName(event.target.value)} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="desk-new-mobile">Mobile</FieldLabel>
                    <Input id="desk-new-mobile" inputMode="tel" value={newMobile} onChange={(event) => setNewMobile(event.target.value)} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="desk-new-city">City</FieldLabel>
                    <Input id="desk-new-city" value={newCity} onChange={(event) => setNewCity(event.target.value)} />
                  </Field>
                  <Field className="md:col-span-4">
                    <FieldLabel htmlFor="desk-new-address">Address</FieldLabel>
                    <Input id="desk-new-address" value={newAddress} onChange={(event) => setNewAddress(event.target.value)} />
                    <FieldDescription>
                      The customer is created when the office posts this invoice. The same mobile number is matched to an existing customer.
                    </FieldDescription>
                  </Field>
                </>
              )}
            </>
          )}
        </FieldGroup>

        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium">Items</p>
          {items.map((row, index) => {
            const priced = previewByProduct.get(row.productCode);
            const listed = reference.products.find((value) => value.code === row.productCode);
            const stockWarning =
              priced && listed
                ? lineStockWarning({
                    dispatchedUnits: priced.dispatchedUnits,
                    stockUnits: listed.stockUnits,
                    allocatedUnits: allocated.get(listed.code) ?? 0,
                    packsPerCarton: listed.packsPerCarton,
                    asOf: reference.generatedAt,
                    now,
                  })
                : null;
            return (
              <div key={index} className="flex flex-col gap-3 border bg-card p-3">
                <div className="grid items-end gap-3 md:grid-cols-[1fr_7rem_7rem_9rem_auto]">
                  <Field>
                    <FieldLabel>Product</FieldLabel>
                    <NativeSelect className="w-full" value={row.productCode} onChange={(event) => setItem(index, { productCode: event.target.value })} disabled={booked}>
                      <NativeSelectOption value="">Choose product…</NativeSelectOption>
                      {reference.products.map((product) => (
                        <NativeSelectOption key={product.code} value={product.code}>
                          {product.name} ({product.packsPerCarton}/ctn)
                          {product.stockUnits !== undefined
                            ? ` · in stock: ${formatStock(Math.max(0, product.stockUnits - (allocated.get(product.code) ?? 0)), product.packsPerCarton)}`
                            : ""}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field>
                    <FieldLabel>Cartons</FieldLabel>
                    <Input inputMode="numeric" value={row.cartons} onChange={(event) => setItem(index, { cartons: event.target.value })} readOnly={booked} />
                  </Field>
                  <Field>
                    <FieldLabel>Loose packs</FieldLabel>
                    <Input inputMode="numeric" value={row.loose} onChange={(event) => setItem(index, { loose: event.target.value })} readOnly={booked} />
                  </Field>
                  <div className="pb-1.5 text-right text-sm">
                    {priced ? (
                      <>
                        <p className="font-medium">{formatPKR(priced.lineAmount, false)}</p>
                        {priced.freeCartons + priced.manualFreeCartons > 0 && (
                          <p className="text-xs text-muted-foreground">
                            {priced.freeCartons > 0 ? `+${priced.freeCartons} scheme` : ""}
                            {priced.freeCartons > 0 && priced.manualFreeCartons > 0 ? " · " : ""}
                            {priced.manualFreeCartons > 0 ? `${priced.manualFreeCartons} free by hand` : ""}
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="text-muted-foreground">—</p>
                    )}
                  </div>
                  {!booked && items.length > 1 && (
                    <Button type="button" variant="ghost" onClick={() => setItems((rows) => rows.filter((_, at) => at !== index))}>
                      Remove
                    </Button>
                  )}
                </div>
                {stockWarning && <p className="text-xs text-amber-500">{stockWarning}</p>}
                {!booked && (
                  <div className="grid items-end gap-3 md:grid-cols-[9rem_1fr]">
                    <Field>
                      <FieldLabel>Free cartons (by hand)</FieldLabel>
                      <Input
                        inputMode="numeric"
                        value={row.manualFree}
                        onChange={(event) => setItem(index, { manualFree: event.target.value })}
                      />
                    </Field>
                    <div className="flex flex-wrap items-end gap-3">
                      {row.changePrice ? (
                        <>
                          <Field className="w-44">
                            <FieldLabel>Carton price (PKR)</FieldLabel>
                            <Input
                              inputMode="decimal"
                              value={row.priceOverride}
                              onChange={(event) => setItem(index, { priceOverride: event.target.value })}
                            />
                          </Field>
                          <Button type="button" variant="ghost" size="sm" onClick={() => setItem(index, { changePrice: false, priceOverride: "" })}>
                            Use list price
                          </Button>
                        </>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={!priced}
                          onClick={() => setItem(index, { changePrice: true, priceOverride: priced ? String(priced.listedCartonPrice) : "" })}
                        >
                          Change price
                        </Button>
                      )}
                      {priced?.isPriceOverride && (
                        <Badge variant="outline">
                          Changed from {formatPKR(priced.listedCartonPrice, false)} — the office will check it
                        </Badge>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {!booked && (
            <div>
              <Button type="button" variant="outline" onClick={() => setItems((rows) => [...rows, emptyItem()])}>
                Add another product
              </Button>
            </div>
          )}
        </div>

        <FieldGroup className="grid gap-4 md:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="desk-discount">Invoice discount (PKR)</FieldLabel>
            <Input id="desk-discount" inputMode="decimal" value={discount} onChange={(event) => setDiscount(event.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="desk-discount-note">Discount reason</FieldLabel>
            <Input id="desk-discount-note" value={discountNote} onChange={(event) => setDiscountNote(event.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="desk-expenses">Freight / expenses (PKR)</FieldLabel>
            <Input id="desk-expenses" inputMode="decimal" value={expenses} onChange={(event) => setExpenses(event.target.value)} />
            <FieldDescription>Added to what the customer owes.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="desk-expenses-note">Freight / expenses description</FieldLabel>
            <Input id="desk-expenses-note" value={expensesNote} onChange={(event) => setExpensesNote(event.target.value)} />
          </Field>
        </FieldGroup>

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">Money received now</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" disabled={preview.invoiceAmount <= 0 || payments.length > 0} onClick={() => addPayment("cash", String(preview.invoiceAmount))}>
                Paid in full (cash)
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => addPayment("cash")}>
                + Cash
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => addPayment("bank_transfer")}>
                + Bank transfer
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => addPayment("digital")}>
                + Digital account
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => addPayment("cheque")}>
                + Cheque
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => addPayment("salary_offset")}>
                + Salary paid by distributor
              </Button>
            </div>
          </div>
          {payments.length === 0 && <p className="text-sm text-muted-foreground">Nothing received. The full amount stays due.</p>}
          {payments.map((row, index) => {
            const wallets = row.kind === "cash" ? cashWallets : bankWallets;
            return (
              <div key={index} className="grid items-end gap-3 border bg-card p-3 md:grid-cols-[9rem_9rem_1fr_auto]">
                <Field>
                  <FieldLabel>How</FieldLabel>
                  <NativeSelect
                    className="w-full"
                    value={row.kind}
                    onChange={(event) => {
                      const kind = event.target.value as PaymentKind;
                      setPayment(index, {
                        kind,
                        walletCode: kind === "salary_offset" ? "expense_offset" : (kind === "cash" ? cashWallets : bankWallets)[0]?.code ?? "",
                        instantVerify: false,
                      });
                    }}
                  >
                    <NativeSelectOption value="cash">Cash</NativeSelectOption>
                    <NativeSelectOption value="bank_transfer">Bank transfer</NativeSelectOption>
                    <NativeSelectOption value="digital">Digital account</NativeSelectOption>
                    <NativeSelectOption value="cheque">Cheque</NativeSelectOption>
                    <NativeSelectOption value="salary_offset">Salary paid by distributor</NativeSelectOption>
                  </NativeSelect>
                </Field>
                <Field>
                  <FieldLabel>Amount</FieldLabel>
                  <Input inputMode="decimal" value={row.amount} onChange={(event) => setPayment(index, { amount: event.target.value })} />
                </Field>
                {row.kind === "salary_offset" ? (
                  <Field>
                    <FieldLabel>Salesman whose salary was paid</FieldLabel>
                    <NativeSelect className="w-full" value={row.salesmanId} onChange={(event) => setPayment(index, { salesmanId: event.target.value })}>
                      <NativeSelectOption value="">Choose the salesman…</NativeSelectOption>
                      {reference.salesmen.map((person) => (
                        <NativeSelectOption key={person.employeeId} value={person.employeeId}>
                          {person.name}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                    <FieldDescription>Their salary is marked as paid in HR when the office posts this invoice.</FieldDescription>
                  </Field>
                ) : (
                  <Field>
                    <FieldLabel>Into account</FieldLabel>
                    <NativeSelect className="w-full" value={row.walletCode} onChange={(event) => setPayment(index, { walletCode: event.target.value })}>
                      {wallets.map((wallet) => (
                        <NativeSelectOption key={wallet.code} value={wallet.code}>
                          {wallet.name}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </Field>
                )}
                <Button type="button" variant="ghost" onClick={() => setPayments((rows) => rows.filter((_, at) => at !== index))}>
                  Remove
                </Button>

                {row.kind === "bank_transfer" && (
                  <div className="grid gap-3 md:col-span-4 md:grid-cols-3">
                    <Field>
                      <FieldLabel>Customer's bank</FieldLabel>
                      <Input value={row.senderBankName} onChange={(event) => setPayment(index, { senderBankName: event.target.value })} />
                    </Field>
                    <Field>
                      <FieldLabel>Customer's account / IBAN</FieldLabel>
                      <Input value={row.senderAccountNumber} onChange={(event) => setPayment(index, { senderAccountNumber: event.target.value })} />
                    </Field>
                    <Field>
                      <FieldLabel>Transfer reference</FieldLabel>
                      <Input value={row.reference} onChange={(event) => setPayment(index, { reference: event.target.value })} />
                    </Field>
                  </div>
                )}
                {row.kind === "digital" && (
                  <div className="grid gap-3 md:col-span-4 md:grid-cols-4">
                    <Field>
                      <FieldLabel>Platform</FieldLabel>
                      <NativeSelect className="w-full" value={row.provider} onChange={(event) => setPayment(index, { provider: event.target.value })}>
                        {PROVIDERS.map((provider) => (
                          <NativeSelectOption key={provider} value={provider}>
                            {provider}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </Field>
                    <Field>
                      <FieldLabel>Sender mobile / account</FieldLabel>
                      <Input value={row.senderMobile} onChange={(event) => setPayment(index, { senderMobile: event.target.value })} />
                    </Field>
                    <Field>
                      <FieldLabel>Account title (optional)</FieldLabel>
                      <Input value={row.senderTitle} onChange={(event) => setPayment(index, { senderTitle: event.target.value })} />
                    </Field>
                    <Field>
                      <FieldLabel>Transaction ID (TID)</FieldLabel>
                      <Input value={row.reference} onChange={(event) => setPayment(index, { reference: event.target.value })} />
                    </Field>
                  </div>
                )}
                {row.kind === "cheque" && (
                  <div className="grid gap-3 md:col-span-4 md:grid-cols-3">
                    <Field>
                      <FieldLabel>Cheque bank</FieldLabel>
                      <Input value={row.chequeBank} onChange={(event) => setPayment(index, { chequeBank: event.target.value })} />
                    </Field>
                    <Field>
                      <FieldLabel>Cheque number</FieldLabel>
                      <Input value={row.chequeNumber} onChange={(event) => setPayment(index, { chequeNumber: event.target.value })} />
                    </Field>
                    <Field>
                      <FieldLabel>Cheque date</FieldLabel>
                      <Input type="date" value={row.chequeDate} onChange={(event) => setPayment(index, { chequeDate: event.target.value })} />
                    </Field>
                  </div>
                )}
                {row.kind !== "cash" && row.kind !== "salary_offset" && (
                  <label className="flex items-start gap-2 text-xs md:col-span-4">
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4"
                      checked={row.instantVerify}
                      onChange={(event) => setPayment(index, { instantVerify: event.target.checked })}
                    />
                    <span>
                      <span className="font-semibold">Instant verification.</span>{" "}
                      <span className="text-muted-foreground">
                        The money is already confirmed in the company account, so finance does not need to verify it.
                      </span>
                    </span>
                  </label>
                )}
              </div>
            );
          })}
        </div>

        <FieldGroup className="grid gap-4 md:grid-cols-2">
          {preview.payLaterAmount > 0 && (
            <Field>
              <FieldLabel htmlFor="desk-due">Payment due date</FieldLabel>
              <Input id="desk-due" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
              <FieldDescription>Needed because {formatPKR(preview.payLaterAmount, false)} has no payment yet.</FieldDescription>
            </Field>
          )}
          <Field className={preview.payLaterAmount > 0 ? "" : "md:col-span-2"}>
            <FieldLabel htmlFor="desk-remarks">Remarks (optional)</FieldLabel>
            <Textarea id="desk-remarks" rows={2} value={remarks} onChange={(event) => setRemarks(event.target.value)} />
          </Field>
        </FieldGroup>

        <div className="grid gap-2 border bg-muted/40 p-4 sm:grid-cols-5">
          <div>
            <p className="text-xs uppercase text-muted-foreground">Items</p>
            <p className="text-lg font-semibold">{formatPKR(preview.itemsTotal, false)}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-muted-foreground">Discount / freight</p>
            <p className="text-lg font-semibold">
              {preview.invoiceDiscount > 0 ? `-${formatPKR(preview.invoiceDiscount, false)}` : "—"}
              {preview.expenses > 0 ? ` +${formatPKR(preview.expenses, false)}` : ""}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase text-muted-foreground">Invoice total</p>
            <p className="text-xl font-semibold">{formatPKR(preview.invoiceAmount, false)}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-muted-foreground">Received now</p>
            <p className="text-xl font-semibold">{formatPKR(preview.paidAmount + preview.pendingAmount, false)}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-muted-foreground">Still due</p>
            <p className="text-xl font-semibold">{formatPKR(preview.payLaterAmount, false)}</p>
          </div>
        </div>

        {(issues.length > 0 || problem) && (
          <Alert variant="destructive">
            <AlertTitle>Fix this before saving</AlertTitle>
            <AlertDescription>
              {problem && <p>{problem}</p>}
              <ul className="list-disc pl-5">
                {issues.map((issue, index) => (
                  <li key={`${issue.code}-${index}`}>
                    {issue.source ? `${issue.source}: ` : ""}
                    {issue.message}
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          {editing && (
            <Button type="button" variant="ghost" onClick={onCancelEdit}>
              Cancel change
            </Button>
          )}
          <Button type="button" variant="outline" disabled={saving || noSlots} onClick={() => void submit(false)}>
            Save
          </Button>
          <Button type="button" disabled={saving || noSlots} onClick={() => void submit(true)}>
            Save and print
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
