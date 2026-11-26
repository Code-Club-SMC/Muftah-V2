import { describe, expect, it } from "vitest";
import {
  describeMonthChange,
  getMonthToDateRanges,
  getTemplateReminder,
  getTemplateWindow,
  reminderDateFor,
  templateChipLabel,
  templateFormDate,
  templateToDraftPatch,
  toDayKey,
} from "./expense-templates";

describe("reminder date", () => {
  it.each([
    ["2026-11", 1, "2026-11-01"],
    ["2026-11", 31, "2026-11-30"],
    ["2026-02", 31, "2026-02-28"],
    ["2028-02", 30, "2028-02-29"],
    ["2026-12", 15, "2026-12-15"],
  ])("%s day %i is %s", (month, day, expected) => {
    expect(reminderDateFor(month, day)).toBe(expected);
  });
});

describe("due this week", () => {
  const base = { reminderDay: 1, expenseDates: [] as string[], skippedMonth: null };

  it("shows nothing without a reminder day", () => {
    expect(getTemplateReminder({ ...base, reminderDay: null, todayKey: "2026-11-05" })).toBeNull();
  });

  it("is overdue once this month's date has passed unpaid", () => {
    expect(getTemplateReminder({ ...base, todayKey: "2026-11-05" })).toEqual({
      status: "overdue",
      dueDate: "2026-11-01",
      monthKey: "2026-11",
    });
  });

  it("is due on the day itself", () => {
    expect(getTemplateReminder({ ...base, reminderDay: 5, todayKey: "2026-11-05" })).toEqual({
      status: "due",
      dueDate: "2026-11-05",
      monthKey: "2026-11",
    });
  });

  it("is due when the date is within 7 days (today plus 6)", () => {
    expect(getTemplateReminder({ ...base, reminderDay: 11, todayKey: "2026-11-05" })?.status).toBe("due");
    expect(getTemplateReminder({ ...base, reminderDay: 12, todayKey: "2026-11-05" })).toBeNull();
  });

  it("is quiet once this month is paid", () => {
    expect(getTemplateReminder({ ...base, todayKey: "2026-11-05", expenseDates: ["2026-11-02"] })).toBeNull();
  });

  it("is quiet when this month is skipped", () => {
    expect(getTemplateReminder({ ...base, todayKey: "2026-11-05", skippedMonth: "2026-11" })).toBeNull();
  });

  it("looks at next month near the month end once this month is paid", () => {
    expect(
      getTemplateReminder({ ...base, reminderDay: 2, todayKey: "2026-11-28", expenseDates: ["2026-11-02"] }),
    ).toEqual({ status: "due", dueDate: "2026-12-02", monthKey: "2026-12" });
  });

  it("does not jump to next month while this month is still unpaid", () => {
    expect(getTemplateReminder({ ...base, reminderDay: 2, todayKey: "2026-11-28" })).toEqual({
      status: "overdue",
      dueDate: "2026-11-02",
      monthKey: "2026-11",
    });
  });

  it("is quiet when next month is already paid early", () => {
    expect(
      getTemplateReminder({
        ...base,
        reminderDay: 2,
        todayKey: "2026-11-28",
        expenseDates: ["2026-11-02", "2026-12-02"],
      }),
    ).toBeNull();
  });

  it("stays quiet while the date is more than 7 days away", () => {
    expect(getTemplateReminder({ ...base, reminderDay: 25, todayKey: "2026-11-05" })).toBeNull();
  });
});

describe("template window", () => {
  it("covers this month and next month", () => {
    const { from, to } = getTemplateWindow("2026-11-28");
    expect(toDayKey(from)).toBe("2026-11-01");
    expect(toDayKey(to)).toBe("2026-12-31");
  });
});

describe("chip label and form fill", () => {
  it("adds the amount when the template has one", () => {
    expect(templateChipLabel({ name: "Shop rent", amount: "85000.00" })).toBe("Shop rent — Rs 85,000");
    expect(templateChipLabel({ name: "Electricity", amount: null })).toBe("Electricity");
  });

  it("fills the form, keeping the account only if it still exists", () => {
    const template = { categoryId: "rent", amount: "85000.00", payee: "Landlord", walletId: "w1", note: "Shop rent" };
    expect(templateToDraftPatch(template, ["w1"])).toEqual({
      categoryId: "rent",
      amount: "85,000",
      payee: "Landlord",
      walletId: "w1",
      note: "Shop rent",
    });
    expect(templateToDraftPatch({ ...template, walletId: "gone", amount: null, payee: null, note: null }, ["w1"])).toEqual({
      categoryId: "rent",
      amount: "",
      payee: "",
      walletId: "",
      note: "",
    });
  });

  it("dates the expense today unless the reminder is for a later month", () => {
    expect(templateFormDate(null, "2026-11-28")).toBe("2026-11-28");
    expect(templateFormDate({ status: "overdue", dueDate: "2026-11-01", monthKey: "2026-11" }, "2026-11-28")).toBe("2026-11-28");
    expect(templateFormDate({ status: "due", dueDate: "2026-12-02", monthKey: "2026-12" }, "2026-11-28")).toBe("2026-12-02");
  });
});

describe("month summary", () => {
  it("compares this month so far with the same days last month", () => {
    const { current, previous } = getMonthToDateRanges("2026-11-28");
    expect([toDayKey(current.from), toDayKey(current.to)]).toEqual(["2026-11-01", "2026-11-28"]);
    expect([toDayKey(previous.from), toDayKey(previous.to)]).toEqual(["2026-10-01", "2026-10-28"]);
  });

  it("stops at the end of a shorter last month", () => {
    const { previous } = getMonthToDateRanges("2026-03-31");
    expect([toDayKey(previous.from), toDayKey(previous.to)]).toEqual(["2026-02-01", "2026-02-28"]);
  });

  it("describes the change", () => {
    expect(describeMonthChange(120000, 100000)).toEqual({ direction: "up", amount: "20000.00", percent: 20 });
    expect(describeMonthChange(75000, 100000)).toEqual({ direction: "down", amount: "25000.00", percent: 25 });
    expect(describeMonthChange(5000, 5000)).toEqual({ direction: "same", amount: "0.00", percent: 0 });
    expect(describeMonthChange(5000, 0)).toEqual({ direction: "up", amount: "5000.00", percent: null });
  });
});
