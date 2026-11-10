import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateReturnDialog } from "@/components/sales/create-return-dialog";
import { Route } from "@/routes/_protected/sales/invoices/$invoiceId/index";

const mocks = vi.hoisted(() => ({ create: vi.fn(), decide: vi.fn(), complete: vi.fn(), cancel: vi.fn(), void: vi.fn(), reasons: vi.fn(), saveReason: vi.fn(), listReturns: vi.fn(), returnDetail: vi.fn(), detail: vi.fn(), permissions: ["*"] as string[] }));
vi.mock("@/server-functions/sales/sales-returns-fn", () => ({ createSalesReturnFn: mocks.create, decideSalesReturnFn: mocks.decide, completeSalesReturnFn: mocks.complete, cancelSalesReturnFn: mocks.cancel, voidSalesReturnFn: mocks.void, listSalesReturnsFn: mocks.listReturns, getSalesReturnDetailFn: mocks.returnDetail }));
vi.mock("@/server-functions/sales/return-reasons-fn", () => ({ getReturnReasonsFn: mocks.reasons, saveReturnReasonFn: mocks.saveReason }));
vi.mock("@/server-functions/sales/invoice-detail-fn", () => ({ getInvoiceDetailFn: mocks.detail }));
vi.mock("@/hooks/use-viewer-access", () => ({ useViewerAccess: () => ({ data: { permissions: mocks.permissions } }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useParams: () => ({ invoiceId: "invoice" }),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
let client: QueryClient;
const item = { id: "item", pack: "Bottle", numberOfCartons: 2, quantity: 0, packsPerCarton: 10, actualPackSize: 1, amount: "200", perCartonPrice: "100", recipe: { id: "recipe", name: "Recipe" } };
const second = { ...item, id: "item2", pack: "Can" };
const quantities = { cartonsRequested: 1, quantityRequested: 0, goodUnits: 0, damagedUnits: 0, expiredUnits: 0 };
const returnLine = { id: "line", invoiceItemId: "item", invoiceItem: { id: "item", pack: "Bottle" }, cartonsReturned: 0, quantityReturned: 0, ...quantities };
function salesReturn(status = "requested") {
  return { id: "return", returnNumber: 42, returnDate: "2026-11-01", status, reason: "Other: Wrong delivery", totalAmount: "100", condition: "good", completedAt: null as string | null, voidedAt: null as string | null, voidReason: null as string | null, stockTraces: [] as Array<{ id: string; kind: string; cartonsMoved: number; quantityMoved: number; destination: string }>, items: [returnLine, { ...returnLine, id: "line2", invoiceItemId: "item2", invoiceItem: { id: "item2", pack: "Can" } }] };
}
function detail(ret = salesReturn()) {
  return { invoice: { id: "invoice", invoiceNumber: "INV-1", createdAt: "2026-11-01", date: "2026-11-01", totalPrice: "400", amount: "400", paidAmount: "0", outstandingAmount: "400", invoiceDiscount: "0", items: [item, second] }, payments: [], slip: null, returns: [ret], timeline: [] };
}
function mount(ui: React.ReactNode) { return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>); }
function mountPage(ret = salesReturn()) {
  mocks.detail.mockResolvedValue(detail(ret));
  client.setQueryData(["invoice-detail", "invoice"], detail(ret));
  const Page = Route.options.component!;
  return mount(<Page />);
}
async function openRequest() {
  fireEvent.click(screen.getByRole("button", { name: "Request return" }));
  await screen.findByRole("combobox", { name: "Reason" });
}
async function chooseReason(name = "Other") {
  const select = screen.getByRole("combobox", { name: "Reason" });
  await waitFor(() => expect((select as HTMLButtonElement).disabled).toBe(false));
  fireEvent.keyDown(select, { key: "ArrowDown" });
  const option = await screen.findByRole("option", { name });
  expect(screen.queryByRole("option", { name: "Inactive" })).toBeNull();
  fireEvent.click(option);
}
const request = (returns: React.ComponentProps<typeof CreateReturnDialog>["returns"] = []) => mount(<CreateReturnDialog invoiceId="invoice" invoiceDiscount="0" items={[item]} returns={returns} />);
beforeEach(() => {
  vi.resetAllMocks(); mocks.permissions = ["*"];
  [mocks.create, mocks.decide, mocks.complete, mocks.cancel, mocks.void].forEach(mock => mock.mockResolvedValue({ success: true }));
  mocks.reasons.mockResolvedValue([{ id: "other", name: "Other", requiresNote: true, isActive: true }, { id: "damaged", name: "Damaged", requiresNote: false, isActive: true }, { id: "inactive", name: "Inactive", requiresNote: false, isActive: false }]);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});
afterEach(() => { cleanup(); client.clear(); });

describe("request return on the existing screen", () => {
  it.each([["sales.view"], ["sales.manage"], ["sales.returns.create"], ["inventory.returns.receive"]])("does not run reason seeding or offer requests without both read and create: %j", permissions => {
    mocks.permissions = [permissions]; request();
    expect(screen.queryByRole("button", { name: "Request return" })).toBeNull();
    expect(mocks.reasons).not.toHaveBeenCalled();
  });
  it("loads active choices only on authorized open and requires the configured note", async () => {
    request(); expect(mocks.reasons).not.toHaveBeenCalled();
    await openRequest(); await chooseReason();
    expect(screen.queryByRole("option", { name: "Inactive" })).toBeNull();
    fireEvent.change(screen.getByRole("spinbutton", { name: "Bottle loose packs" }), { target: { value: "2" } });
    const submit = screen.getByRole("button", { name: "Submit request" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Reason note"), { target: { value: "Wrong delivery" } });
    fireEvent.click(submit);
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(mocks.create).toHaveBeenCalledWith({ data: { invoiceId: "invoice", reasonId: "other", reasonNote: "Wrong delivery", items: [{ invoiceItemId: "item", cartonsReturned: 0, quantityReturned: 2 }], notes: undefined, priceOverrideReason: undefined } });
  });
  it("counts requested/approved requested packs and completed inspected packs, releases terminal reservations", async () => {
    request([
      { status: "requested", items: [{ ...returnLine, cartonsRequested: 0, quantityRequested: 3 }] },
      { status: "approved", items: [{ ...returnLine, cartonsRequested: 0, quantityRequested: 2 }] },
      { status: "completed", items: [{ ...returnLine, goodUnits: 2, damagedUnits: 1, expiredUnits: 1 }] },
      ...["rejected", "cancelled", "voided"].map(status => ({ status, items: [returnLine] })),
    ]);
    await openRequest();
    expect(screen.getByText("Returnable: 1 carton(s), 1 loose")).toBeTruthy();
  });
  it("rejects fractional, negative and excessive requested packs", async () => {
    request(); await openRequest(); await chooseReason("Damaged");
    for (const value of ["-1", "1.5", "21"]) {
      fireEvent.change(screen.getByRole("spinbutton", { name: "Bottle loose packs" }), { target: { value } });
      fireEvent.submit(screen.getByRole("button", { name: "Submit request" }).closest("form")!);
    }
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("retains request fields on failure and prevents duplicate requests while pending", async () => {
    let reject!: (error: Error) => void;
    mocks.create.mockImplementation(() => new Promise((_, no) => { reject = no; }));
    request(); await openRequest(); await chooseReason();
    fireEvent.change(screen.getByLabelText("Reason note"), { target: { value: "Keep this note" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Bottle loose packs" }), { target: { value: "2" } });
    const form = screen.getByRole("button", { name: "Submit request" }).closest("form")!;
    fireEvent.submit(form); fireEvent.submit(form);
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    await act(async () => reject(new Error("Reservation changed")));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Reservation changed");
    expect((screen.getByLabelText("Reason note") as HTMLInputElement).value).toBe("Keep this note");
    expect((screen.getByRole("spinbutton", { name: "Bottle loose packs" }) as HTMLInputElement).value).toBe("2");
    mocks.create.mockResolvedValue({ success: true });
    fireEvent.click(screen.getByRole("button", { name: "Submit request" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
  it("keeps the entered request visible when refreshed reservations consume all remaining packs", async () => {
    const { rerender } = request(); await openRequest(); await chooseReason("Damaged");
    fireEvent.change(screen.getByRole("spinbutton", { name: "Bottle loose packs" }), { target: { value: "2" } });
    rerender(<QueryClientProvider client={client}><CreateReturnDialog invoiceId="invoice" invoiceDiscount="0" items={[item]} returns={[{ status: "requested", items: [{ ...returnLine, cartonsRequested: 2 }] }]} /></QueryClientProvider>);
    expect((screen.getByRole("spinbutton", { name: "Bottle loose packs" }) as HTMLInputElement).value).toBe("2");
    expect((screen.getByRole("button", { name: "Submit request" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("All invoice packs are already reserved or received.")).toBeTruthy();
  });
  it("clears a fully reserved selected line for a retained-data retry without closing", async () => {
    mocks.create.mockRejectedValueOnce(new Error("Reservation changed"));
    const { rerender } = mount(<CreateReturnDialog invoiceId="invoice" invoiceDiscount="0" items={[item, second]} returns={[]} />);
    await openRequest(); await chooseReason();
    fireEvent.change(screen.getByLabelText("Reason note"), { target: { value: "Keep reason details" } });
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Keep internal notes" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Bottle cartons" }), { target: { value: "1" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Bottle loose packs" }), { target: { value: "2" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Can cartons" }), { target: { value: "1" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Can loose packs" }), { target: { value: "3" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Change price" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Change price" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Bottle refund per pack" }), { target: { value: "12" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Can refund per pack" }), { target: { value: "11" } });
    fireEvent.change(screen.getByLabelText("Why refund above the invoice price?"), { target: { value: "Keep override details" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit request" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Reservation changed");

    rerender(<QueryClientProvider client={client}><CreateReturnDialog invoiceId="invoice" invoiceDiscount="0" items={[item, second]} returns={[{ status: "requested", items: [{ ...returnLine, cartonsRequested: 2 }] }]} /></QueryClientProvider>);
    const value = (name: string) => (screen.getByRole("spinbutton", { name }) as HTMLInputElement).value;
    expect(value("Bottle cartons")).toBe("1");
    expect(value("Bottle loose packs")).toBe("2");
    expect((screen.getByRole("button", { name: "Submit request" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Clear Bottle quantities" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(value("Bottle cartons")).toBe("0");
    expect(value("Bottle loose packs")).toBe("0");
    expect(value("Bottle refund per pack")).toBe("12");
    expect(value("Can cartons")).toBe("1");
    expect(value("Can loose packs")).toBe("3");
    expect(value("Can refund per pack")).toBe("11");
    expect(screen.getByRole("combobox", { name: "Reason" }).textContent).toContain("Other");
    expect((screen.getByLabelText("Reason note") as HTMLTextAreaElement).value).toBe("Keep reason details");
    expect((screen.getByLabelText("Notes") as HTMLTextAreaElement).value).toBe("Keep internal notes");
    expect((screen.getByLabelText("Why refund above the invoice price?") as HTMLTextAreaElement).value).toBe("Keep override details");

    fireEvent.change(screen.getByRole("spinbutton", { name: "Can loose packs" }), { target: { value: "21" } });
    fireEvent.submit(screen.getByRole("button", { name: "Submit request" }).closest("form")!);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByRole("spinbutton", { name: "Can loose packs" }), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit request" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
    expect(mocks.create).toHaveBeenLastCalledWith({ data: { invoiceId: "invoice", reasonId: "other", reasonNote: "Keep reason details", notes: "Keep internal notes", priceOverrideReason: "Keep override details", items: [{ invoiceItemId: "item2", cartonsReturned: 1, quantityReturned: 3, refundPerUnit: 11 }] } });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
  it("renders loading without preselecting a reason and does not seed after closing", async () => {
    let resolve!: (rows: unknown[]) => void;
    mocks.reasons.mockImplementation(() => new Promise(yes => { resolve = yes; }));
    request(); await openRequest();
    expect(screen.getByRole("status").textContent).toBe("Loading return reasons...");
    expect((screen.getByRole("button", { name: "Submit request" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => resolve([{ id: "damaged", name: "Damaged", requiresNote: false, isActive: true }]));
    expect(screen.getByRole("combobox", { name: "Reason" }).textContent).toContain("Pick a reason");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await act(async () => { await client.invalidateQueries({ queryKey: ["return-reasons"] }); });
    expect(mocks.reasons).toHaveBeenCalledTimes(1);
  });
  it("shows reason loading, empty and error states with a retry", async () => {
    mocks.reasons.mockRejectedValueOnce(new Error("Reasons unavailable")).mockResolvedValueOnce([]);
    request(); await openRequest();
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Reasons unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Retry reasons" }));
    expect(await screen.findByText("No active return reasons. Ask a sales configuration manager.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Submit request" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("keeps refund price changes behind the existing override permission", async () => {
    mocks.permissions = ["sales.view", "sales.returns.create"];
    request(); await openRequest();
    expect(screen.queryByRole("button", { name: "Change price" })).toBeNull();
  });
  it("requires and submits a price override reason without replacing the selected return reason", async () => {
    request(); await openRequest(); await chooseReason("Damaged");
    fireEvent.change(screen.getByRole("spinbutton", { name: "Bottle loose packs" }), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Change price" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Bottle refund per pack" }), { target: { value: "12" } });
    expect((screen.getByRole("button", { name: "Submit request" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Why refund above the invoice price?"), { target: { value: "Approved goodwill" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit request" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith({ data: { invoiceId: "invoice", reasonId: "damaged", reasonNote: undefined, notes: undefined, priceOverrideReason: "Approved goodwill", items: [{ invoiceItemId: "item", cartonsReturned: 0, quantityReturned: 1, refundPerUnit: 12 }] } }));
  });
});

describe("invoice lifecycle actions", () => {
  it.each([
    ["requested", ["sales.view"], []],
    ["requested", ["sales.view", "sales.manage"], []],
    ["requested", ["sales.view", "sales.returns.approve"], ["Approve", "Reject"]],
    ["approved", ["sales.view", "inventory.returns.receive"], ["Receive"]],
    ["approved", ["sales.view", "sales.returns.approve"], ["Cancel return"]],
    ["approved", ["inventory.returns.receive"], []],
    ["completed", ["sales.view", "sales.returns.approve"], ["Void receipt"]],
    ["approved", ["*"], ["Receive", "Cancel return"]],
    ["rejected", ["*"], []], ["cancelled", ["*"], []], ["voided", ["*"], []],
  ])("%s exposes only authorized lifecycle actions %j", (status, permissions, expected) => {
    mocks.permissions = permissions as string[]; mountPage(salesReturn(status as string));
    for (const name of ["Approve", "Reject", "Receive", "Cancel return", "Void receipt"]) {
      expect(!!screen.queryByRole("button", { name })).toBe((expected as string[]).includes(name));
    }
  });
  it("approval is explicit, prevents duplicates and says it is awaiting receipt", async () => {
    let resolve!: (value: unknown) => void;
    mocks.decide.mockImplementation(() => new Promise(yes => { resolve = yes; }));
    mountPage();
    expect(screen.getByText("Not received. Request and approval do not change stock or invoice credit.")).toBeTruthy();
    const approve = screen.getByRole("button", { name: "Approve" });
    fireEvent.click(approve); fireEvent.click(approve);
    await waitFor(() => expect(mocks.decide).toHaveBeenCalledTimes(1));
    expect((screen.getByRole("button", { name: "Reject" }) as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.decide).toHaveBeenCalledWith({ data: { returnId: "return", action: "approve" } });
    await act(async () => resolve({ success: true }));
  });
  it.each([["requested", "Reject", "decide"], ["approved", "Cancel return", "cancel"], ["completed", "Void receipt", "void"]] as const)("%s sends a real required reason for %s, never notes", async (status, label, action) => {
    mountPage(salesReturn(status)); fireEvent.click(screen.getByRole("button", { name: label }));
    const dialog = screen.getByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: label });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    for (const value of ["   ", "ab"]) {
      fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value } });
      fireEvent.submit(confirm.closest("form")!);
      expect(mocks[action]).not.toHaveBeenCalled();
    }
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: " Wrong goods " } });
    fireEvent.click(confirm);
    await waitFor(() => expect(mocks[action]).toHaveBeenCalledTimes(1));
    expect(mocks[action]).toHaveBeenCalledWith({ data: { returnId: "return", ...(action === "decide" ? { action: "reject" } : {}), reason: "Wrong goods" } });
  });
  it("requires explicit pack inspection, validates every line, shows shortfall and submits mixed receipt", async () => {
    mountPage(salesReturn("approved")); fireEvent.click(screen.getByRole("button", { name: "Receive" }));
    const dialog = screen.getByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Confirm receipt" });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    for (const input of within(dialog).getAllByRole("spinbutton")) expect((input as HTMLInputElement).value).toBe("");
    const good = within(dialog).getByLabelText("Bottle good packs");
    for (const value of ["-1", "0.5", "11"]) {
      fireEvent.change(good, { target: { value } }); fireEvent.submit(confirm.closest("form")!);
      expect(mocks.complete).not.toHaveBeenCalled();
    }
    fireEvent.change(good, { target: { value: "4" } });
    fireEvent.change(within(dialog).getByLabelText("Can expired packs"), { target: { value: "-1" } });
    fireEvent.submit(confirm.closest("form")!);
    expect(mocks.complete).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText("Bottle damaged packs"), { target: { value: "2" } });
    fireEvent.change(within(dialog).getByLabelText("Can expired packs"), { target: { value: "1" } });
    expect(within(dialog).getByText("Received: 7 packs. Shortfall: 13 packs. The shortfall is released when this receipt closes the request.")).toBeTruthy();
    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.complete).toHaveBeenCalledWith({ data: { returnId: "return", notes: undefined, lines: [{ returnItemId: "line", goodUnits: 4, damagedUnits: 2, expiredUnits: 0 }, { returnItemId: "line2", goodUnits: 0, damagedUnits: 0, expiredUnits: 1 }] } }));
  });
  it("retains inspection and errors, blocks duplicates, and refreshes stale invoice actions", async () => {
    let reject!: (error: Error) => void;
    mocks.complete.mockImplementation(() => new Promise((_, no) => { reject = no; }));
    mountPage(salesReturn("approved")); fireEvent.click(screen.getByRole("button", { name: "Receive" }));
    fireEvent.change(screen.getByLabelText("Bottle good packs"), { target: { value: "3" } });
    const form = screen.getByRole("button", { name: "Confirm receipt" }).closest("form")!;
    fireEvent.submit(form); fireEvent.submit(form);
    await waitFor(() => expect(mocks.complete).toHaveBeenCalledTimes(1));
    await act(async () => reject(new Error("Return is cancelled")));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Return is cancelled");
    expect((screen.getByLabelText("Bottle good packs") as HTMLInputElement).value).toBe("3");
    await waitFor(() => expect(mocks.detail).toHaveBeenCalled());
  });
  it("keeps a failed void reason for retry after stock shortage", async () => {
    mocks.void.mockRejectedValueOnce(new Error("Not enough stock to reverse receipt"));
    mountPage(salesReturn("completed")); fireEvent.click(screen.getByRole("button", { name: "Void receipt" }));
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Wrong receipt" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Void receipt" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Not enough stock to reverse receipt");
    expect((screen.getByLabelText("Reason") as HTMLTextAreaElement).value).toBe("Wrong receipt");
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Void receipt" }));
    await waitFor(() => expect(mocks.void).toHaveBeenCalledTimes(2));
  });
  it("refreshes a raced terminal state while keeping inspection visible and preventing retry", async () => {
    mountPage(salesReturn("approved"));
    mocks.detail.mockResolvedValue(detail(salesReturn("cancelled")));
    mocks.complete.mockRejectedValue(new Error("Return is cancelled"));
    fireEvent.click(screen.getByRole("button", { name: "Receive" }));
    fireEvent.change(screen.getByLabelText("Bottle good packs"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm receipt" }));
    expect(await screen.findByText("This action is no longer available. Invoice details have refreshed; your entries are kept.")).toBeTruthy();
    expect((screen.getByLabelText("Bottle good packs") as HTMLInputElement).value).toBe("3");
    expect((screen.getByRole("button", { name: "Confirm receipt" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(screen.getByRole("button", { name: "Confirm receipt" }).closest("form")!);
    expect(mocks.complete).toHaveBeenCalledTimes(1);
  });
  it("shows retained receipt facts, void date/reason and trace direction rather than approval restocking", () => {
    mountPage({ ...salesReturn("voided"), completedAt: "2026-11-02", voidedAt: "2026-11-03", voidReason: "Wrong receipt", items: [{ ...returnLine, goodUnits: 3, damagedUnits: 1, expiredUnits: 0 }], stockTraces: [{ id: "in", kind: "receive", cartonsMoved: 0, quantityMoved: 4, destination: "sellable" }, { id: "out", kind: "void", cartonsMoved: 0, quantityMoved: -4, destination: "sellable" }] } as ReturnType<typeof salesReturn>);
    expect(screen.getByText(/Received at:/)).toBeTruthy(); expect(screen.getByText(/Voided at:/)).toBeTruthy();
    expect(screen.getByText("Void reason: Wrong receipt")).toBeTruthy();
    expect(screen.getByText(/Receipt: added/)).toBeTruthy(); expect(screen.getByText(/Void: removed/)).toBeTruthy();
    expect(screen.getByText(/Good: 3.*Damaged: 1.*Expired: 0/)).toBeTruthy();
    expect(screen.queryByText(/Approved good returns go back/)).toBeNull();
  });
});
