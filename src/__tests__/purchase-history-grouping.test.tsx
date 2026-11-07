import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  PurchaseHistoryTable,
  groupByMaterial,
  type PurchaseRecord,
} from "@/components/suppliers/purchase-history-table";

describe("groupByMaterial", () => {
  const records: PurchaseRecord[] = [
    {
      id: "p1",
      createdAt: "2026-11-02T10:00:00Z",
      purchaseDate: "2026-11-02T10:00:00Z",
      quantity: "100",
      cost: "7000",
      paidAmount: "7000",
      unitCost: "70",
      materialType: "chemical",
      stockLeft: 100,
      chemical: {
        id: "chem-1",
        name: "MC-001N",
        unit: "kg",
        minimumStockLevel: "50",
      },
    },
    {
      id: "p2",
      createdAt: "2026-10-30T10:00:00Z",
      purchaseDate: "2026-10-30T10:00:00Z",
      quantity: "300",
      cost: "21000",
      paidAmount: "21000",
      unitCost: "70",
      materialType: "chemical",
      stockLeft: 300,
      chemical: {
        id: "chem-1",
        name: "MC-001N",
        unit: "kg",
        minimumStockLevel: "50",
      },
    },
    {
      id: "p3",
      createdAt: "2026-10-25T10:00:00Z",
      purchaseDate: "2026-10-25T10:00:00Z",
      quantity: "500",
      cost: "25000",
      paidAmount: "10000",
      unitCost: "50",
      materialType: "packaging",
      stockLeft: 200,
      packagingMaterial: {
        id: "pkg-1",
        name: "500ml Bottle",
        type: "primary",
        capacity: "500",
        capacityUnit: "units",
        minimumStockLevel: 100,
      },
    },
  ];

  it("groups purchases of the same material together", () => {
    const groups = groupByMaterial(records);
    expect(groups.length).toBe(2);

    const mc001n = groups.find((g) => g.materialName === "MC-001N");
    expect(mc001n).toBeDefined();
    expect(mc001n?.purchaseCount).toBe(2);
    expect(mc001n?.totalQty).toBe(400);
    expect(mc001n?.totalCost).toBe(28000);
    expect(mc001n?.totalPaid).toBe(28000);
    expect(mc001n?.totalStockLeft).toBe(400);
    expect(mc001n?.unit).toBe("kg");
    expect(mc001n?.records.length).toBe(2);
    // Sub-records must be newest first
    expect(mc001n?.records[0]?.id).toBe("p1");
    expect(mc001n?.records[1]?.id).toBe("p2");
  });

  it("orders groups with most recent activity first", () => {
    const groups = groupByMaterial(records);
    expect(groups[0]?.materialName).toBe("MC-001N"); // Nov 2
    expect(groups[1]?.materialName).toBe("500ml Bottle"); // Oct 25
  });

  it("resolves packaging unit to pcs regardless of container capacityUnit", () => {
    const recordsWithLiterBottle: PurchaseRecord[] = [
      {
        id: "p-liter-1",
        createdAt: "2026-11-05T10:00:00Z",
        purchaseDate: "2026-11-05T10:00:00Z",
        quantity: "5000",
        cost: "150000",
        paidAmount: "150000",
        unitCost: "30",
        materialType: "packaging",
        stockLeft: 5000,
        packagingMaterial: {
          id: "pkg-liter-bottle",
          name: "1L Bottle",
          type: "primary",
          capacity: "1",
          capacityUnit: "L",
          minimumStockLevel: 500,
          measuredInKg: false,
        },
      },
      {
        id: "p-shopper-1",
        createdAt: "2026-11-04T10:00:00Z",
        purchaseDate: "2026-11-04T10:00:00Z",
        quantity: "250",
        cost: "130000",
        paidAmount: "130000",
        unitCost: "520",
        materialType: "packaging",
        stockLeft: 250,
        packagingMaterial: {
          id: "pkg-shopper-kg",
          name: "100g Shopper Bag",
          type: "primary",
          capacity: null,
          capacityUnit: null,
          minimumStockLevel: 50,
          measuredInKg: true,
        },
      },
    ];

    const groups = groupByMaterial(recordsWithLiterBottle);
    const bottleGroup = groups.find((g) => g.materialName === "1L Bottle");
    const shopperGroup = groups.find((g) => g.materialName === "100g Shopper Bag");

    expect(bottleGroup?.unit).toBe("pcs");
    expect(shopperGroup?.unit).toBe("kg");
  });
});

describe("PurchaseHistoryTable UI", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });
  afterEach(cleanup);

  const mockRecords: PurchaseRecord[] = [
    {
      id: "p1",
      createdAt: "2026-11-02T10:00:00Z",
      purchaseDate: "2026-11-02T10:00:00Z",
      quantity: "100",
      cost: "7000",
      paidAmount: "7000",
      unitCost: "70",
      materialType: "chemical",
      stockLeft: 100,
      chemical: {
        id: "chem-1",
        name: "MC-001N",
        unit: "kg",
        minimumStockLevel: "50",
      },
    },
    {
      id: "p2",
      createdAt: "2026-10-30T10:00:00Z",
      purchaseDate: "2026-10-30T10:00:00Z",
      quantity: "300",
      cost: "21000",
      paidAmount: "21000",
      unitCost: "70",
      materialType: "chemical",
      stockLeft: 300,
      chemical: {
        id: "chem-1",
        name: "MC-001N",
        unit: "kg",
        minimumStockLevel: "50",
      },
    },
  ];

  it("renders aggregated 400 kg row instead of separate duplicate entries", () => {
    const onRestock = vi.fn();
    render(
      <PurchaseHistoryTable
        data={mockRecords}
        setSelectedItem={vi.fn()}
        setDetailsOpen={vi.fn()}
        setEditDialogOpen={vi.fn()}
        setDeleteDialogOpen={vi.fn()}
        onRecordPayment={vi.fn()}
        onRestock={onRestock}
      />,
    );

    // Should see MC-001N
    expect(screen.getByText("MC-001N")).toBeTruthy();
    // Should see 2 purchases badge
    expect(screen.getByText("2 purchases")).toBeTruthy();
    // Total quantity and stock left should show 400
    expect(screen.getAllByText(/400/).length).toBeGreaterThanOrEqual(1);
    // Buy Again button should be present
    const buyAgainBtn = screen.getByRole("button", { name: /Buy Again/i });
    expect(buyAgainBtn).toBeTruthy();

    // Clicking Buy Again on the summary row invokes onRestock with the latest purchase
    fireEvent.click(buyAgainBtn);
    expect(onRestock).toHaveBeenCalledWith(mockRecords[0]);
  });

  it("expands sub-rows to show detailed purchase breakdown when clicked", () => {
    render(
      <PurchaseHistoryTable
        data={mockRecords}
        setSelectedItem={vi.fn()}
        setDetailsOpen={vi.fn()}
        setEditDialogOpen={vi.fn()}
        setDeleteDialogOpen={vi.fn()}
        onRecordPayment={vi.fn()}
      />,
    );

    // Sub-records should not be visible before clicking expand
    expect(screen.queryByText("Nov 2, 2026")).toBeNull();
    expect(screen.queryByText("Oct 30, 2026")).toBeNull();

    // Click on the summary row to expand
    fireEvent.click(screen.getByText("MC-001N"));

    // Sub-records should now be visible
    expect(screen.getByText("Nov 2, 2026")).toBeTruthy();
    expect(screen.getByText("Oct 30, 2026")).toBeTruthy();
  });

  it("filters materials by search input", () => {
    render(
      <PurchaseHistoryTable
        data={mockRecords}
        setSelectedItem={vi.fn()}
        setDetailsOpen={vi.fn()}
        setEditDialogOpen={vi.fn()}
        setDeleteDialogOpen={vi.fn()}
        onRecordPayment={vi.fn()}
      />,
    );

    const searchInput = screen.getByPlaceholderText(/search material/i);
    fireEvent.change(searchInput, { target: { value: "NonExistent" } });

    expect(screen.queryByText("MC-001N")).toBeNull();
    expect(screen.getByText(/no matching materials found/i)).toBeTruthy();

    fireEvent.change(searchInput, { target: { value: "MC-001" } });
    expect(screen.getByText("MC-001N")).toBeTruthy();
  });
});
