import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExpenseListItem, ExpenseTemplate } from "@/lib/types/finance-types";

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  archive: vi.fn(),
  skip: vi.fn(),
  templates: [] as ExpenseTemplate[],
}));
vi.mock("@/components/custom/responsive-sheet", () => ({
  ResponsiveSheet: ({ open, title, children }: { open: boolean; title: string; children: React.ReactNode }) =>
    open ? <section><h2>{title}</h2>{children}</section> : null,
}));
vi.mock("@/hooks/finance/use-expense-templates", () => ({
  useExpenseTemplates: () => ({ data: mocks.templates }),
  useSaveExpenseTemplate: () => ({ mutate: mocks.save, isPending: false }),
  useArchiveExpenseTemplate: () => ({ mutate: mocks.archive, isPending: false }),
  useSkipExpenseTemplateMonth: () => ({ mutate: mocks.skip, isPending: false }),
}));

import { ExpenseReminders } from "@/components/finance/expense-reminders";
import { ExpenseTemplateDialog } from "@/components/finance/expense-template-dialog";
import { ExpenseTemplatesSheet } from "@/components/finance/expense-templates-sheet";

const template = (patch: Partial<ExpenseTemplate>): ExpenseTemplate => ({
  id: "t1",
  name: "Shop rent",
  categoryId: "rent",
  categoryName: "Rent",
  amount: "85000.00",
  payee: "Landlord",
  walletId: "w1",
  note: null,
  reminderDay: 1,
  skippedMonth: null,
  expenseDates: [],
  ...patch,
});

const expense: ExpenseListItem = {
  id: "e1",
  expenseDate: "2026-11-02T05:00:00.000Z",
  description: "",
  amount: "12000.00",
  slipNumber: null,
  remarks: null,
  payee: "LESCO",
  origin: "manual",
  voidedAt: null,
  voidReason: null,
  voidedBy: null,
  edits: [],
  category: { id: "power", name: "Electricity", slug: "power", icon: null, isActive: true, isArchived: false },
  wallet: { id: "w1", name: "Cash Box", type: "cash" },
  performer: { id: "u1", name: "Sana" },
  dynamicFields: [],
};

describe("expense templates screens", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 28, 10)); // 28 Nov 2026, local
    mocks.templates = [];
    mocks.save.mockReset();
    mocks.archive.mockReset();
    mocks.skip.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("saves an expense as a template with its category, payee and account", () => {
    render(<ExpenseTemplateDialog open onOpenChange={() => {}} source={{ kind: "expense", expense }} />);
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Electricity · LESCO");
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save template" }));
    expect(mocks.save.mock.calls[0][0].data).toEqual({
      name: "Electricity · LESCO",
      categoryId: "power",
      amount: null,
      payee: "LESCO",
      walletId: "w1",
      note: null,
      reminderDay: null,
    });
  });

  it("edits an existing template", () => {
    render(<ExpenseTemplateDialog open onOpenChange={() => {}} source={{ kind: "template", template: template({}) }} />);
    expect((screen.getByLabelText(/^Amount/) as HTMLInputElement).value).toBe("85,000");
    fireEvent.click(screen.getByRole("button", { name: "Save template" }));
    expect(mocks.save.mock.calls[0][0].data).toMatchObject({ templateId: "t1", amount: 85000, reminderDay: 1 });
  });

  it("lists templates and deletes one after confirming", () => {
    mocks.templates = [template({})];
    render(<ExpenseTemplatesSheet open onOpenChange={() => {}} />);
    expect(screen.getByText("Shop rent — Rs 85,000")).toBeTruthy();
    expect(screen.getByText("Reminds on day 1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete Shop rent" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete template" }));
    expect(mocks.archive.mock.calls[0][0].data).toEqual({ templateId: "t1" });
  });

  it("shows nothing when no reminder is due", () => {
    mocks.templates = [template({ reminderDay: null })];
    const { container } = render(<ExpenseReminders onRecord={() => {}} />);
    expect(container.textContent).toBe("");
  });

  it("lists overdue first, then due, with Record and Skip this month", () => {
    const onRecord = vi.fn();
    mocks.templates = [
      template({ id: "t-next", name: "Generator fuel", amount: null, reminderDay: 2, expenseDates: ["2026-11-02T05:00:00.000Z"] }),
      template({ id: "t-late", name: "Shop rent", reminderDay: 1 }),
    ];
    render(<ExpenseReminders onRecord={onRecord} />);
    const items = screen.getAllByRole("listitem");
    expect(items[0].textContent).toContain("Overdue since 1 Nov");
    expect(items[1].textContent).toContain("Due 2 Dec");

    fireEvent.click(within(items[0]).getByRole("button", { name: "Record" }));
    expect(onRecord).toHaveBeenCalledWith(
      expect.objectContaining({ id: "t-late" }),
      { status: "overdue", dueDate: "2026-11-01", monthKey: "2026-11" },
    );
    fireEvent.click(within(items[1]).getByRole("button", { name: "Skip this month" }));
    expect(mocks.skip.mock.calls[0][0].data).toEqual({ templateId: "t-next", monthKey: "2026-12" });
  });
});
