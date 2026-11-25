import { fireEvent, render, screen } from "@testing-library/react";
import { useForm } from "@tanstack/react-form";
import { expect, it } from "vitest";
import { STANDARD_ALLOWANCES, type AllowanceConfig } from "@/lib/types/hr-types";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AllowanceCard } from "./allowance-card";

function Harness({ id }: { id: string }) {
  const form = useForm({
    defaultValues: { allowanceConfig: STANDARD_ALLOWANCES.filter((a) => a.id === id) as AllowanceConfig[] },
  });
  return (
    <TooltipProvider>
      <AllowanceCard form={form} index={0} allowanceId={id} onRemove={() => {}} />
      <form.Subscribe selector={(s) => s.values.allowanceConfig[0]?.payBasis}>
        {(basis) => <output>{basis ?? "unset"}</output>}
      </form.Subscribe>
    </TooltipProvider>
  );
}

it("switches an allowance to per day, hides its deduction rules, and switches back", () => {
  render(<Harness id="fuel" />);
  expect(screen.getByRole("button", { name: "Per month" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByText("Deduct on")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Per day" }));
  expect(screen.getByRole("status").textContent).toBe("perDay");
  expect(screen.queryByText("Deduct on")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Per month" }));
  expect(screen.getByRole("status").textContent).toBe("monthly");
  expect(screen.getByText("Deduct on")).toBeTruthy();
});

it("offers no pay basis on the night shift allowance", () => {
  render(<Harness id="nightShift" />);
  expect(screen.queryByRole("button", { name: "Per day" })).toBeNull();
});
