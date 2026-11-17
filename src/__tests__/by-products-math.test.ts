// src/__tests__/by-products-math.test.ts
import { describe, expect, it } from "vitest";
import {
  byProductColumns,
  byProductLabel,
  containerCount,
  containerKey,
  earnedEmpties,
  normalizeContainerName,
  sizeFromPackagingText,
  type EmptiesPurchase,
} from "@/lib/inventory/by-products";

const drum = (quantity: string, size = "100"): EmptiesPurchase => ({
  quantity, byProductTracked: true, containerName: "Drum", containerSize: size,
});
const plain = (quantity: string): EmptiesPurchase => ({
  quantity, byProductTracked: false, containerName: null, containerSize: null,
});
const earned = (map: ReturnType<typeof earnedEmpties>, key: string) => map.get(key)?.earned ?? 0;

describe("normalizeContainerName", () => {
  it("trims, collapses spaces and title-cases", () => {
    expect(normalizeContainerName("  plastic   DRUM ")).toBe("Plastic Drum");
    expect(normalizeContainerName("bag")).toBe("Bag");
  });
});

describe("containerCount", () => {
  it("returns whole counts only", () => {
    expect(containerCount("1000", "100")).toBe(10);
    expect(containerCount("950", "100")).toBeNull();
    expect(containerCount("10", "0")).toBeNull();
    expect(containerCount("37.5", "12.5")).toBe(3);
  });
});

describe("byProductColumns", () => {
  it("nulls the container when not tracked", () => {
    expect(byProductColumns({ byProductTracked: false, containerName: "Drum", containerSize: "100" }, "1000"))
      .toEqual({ byProductTracked: false, containerName: null, containerSize: null });
    expect(byProductColumns({}, "1000")).toEqual({ byProductTracked: false, containerName: null, containerSize: null });
  });
  it("normalizes a tracked container", () => {
    expect(byProductColumns({ byProductTracked: true, containerName: " drum", containerSize: "100" }, "1000"))
      .toEqual({ byProductTracked: true, containerName: "Drum", containerSize: "100.000" });
  });
  it("refuses missing name, bad size and partial containers", () => {
    expect(() => byProductColumns({ byProductTracked: true, containerName: " ", containerSize: "100" }, "1000")).toThrow("container name");
    expect(() => byProductColumns({ byProductTracked: true, containerName: "Drum", containerSize: "0" }, "1000")).toThrow("Container size");
    expect(() => byProductColumns({ byProductTracked: true, containerName: "Drum", containerSize: "abc" }, "1000")).toThrow("Container size");
    expect(() => byProductColumns({ byProductTracked: true, containerName: "Drum", containerSize: "100" }, "950")).toThrow("whole number of containers");
  });
});

describe("earnedEmpties", () => {
  it("counts fully used containers only", () => {
    // 10 drums bought, 650kg still in stock, so 350kg used: 3 empty, 4th half full.
    const map = earnedEmpties({ inStock: "650", purchases: [drum("1000")] });
    expect(earned(map, containerKey("Drum", "100"))).toBe(3);
  });

  it("uses older purchases first", () => {
    // Bags (old) then drums (new). 600 left in stock fills the newest drums first.
    const bags: EmptiesPurchase = { quantity: "500", byProductTracked: true, containerName: "Bag", containerSize: "50" };
    const map = earnedEmpties({ inStock: "600", purchases: [bags, drum("1000")] });
    expect(earned(map, containerKey("Bag", "50"))).toBe(10); // all 500kg of bags used
    expect(earned(map, containerKey("Drum", "100"))).toBe(4); // 400kg of drums used
  });

  it("treats stock beyond all purchases as unused purchases", () => {
    // 1200 in stock, only 1000 bought: nothing from the purchase is used yet.
    const map = earnedEmpties({ inStock: "1200", purchases: [drum("1000")] });
    expect(earned(map, containerKey("Drum", "100"))).toBe(0);
  });

  it("lets untracked purchases take their share without giving empties", () => {
    // Old tracked 500, newer untracked 500, 400 in stock: untracked keeps 400, tracked fully used.
    const map = earnedEmpties({ inStock: "400", purchases: [drum("500"), plain("500")] });
    expect(earned(map, containerKey("Drum", "100"))).toBe(5);
    expect(map.size).toBe(1);
  });

  it("keeps two sizes of the same container apart", () => {
    const map = earnedEmpties({ inStock: "0", purchases: [drum("200", "100"), drum("100", "50")] });
    expect(earned(map, containerKey("Drum", "100"))).toBe(2);
    expect(earned(map, containerKey("Drum", "50"))).toBe(2);
  });

  it("never goes negative with negative stock", () => {
    const map = earnedEmpties({ inStock: "-5", purchases: [drum("100")] });
    expect(earned(map, containerKey("Drum", "100"))).toBe(1);
  });
});

describe("labels", () => {
  it("formats the label and key", () => {
    expect(byProductLabel("Soda", "kg", "Drum", "100.000")).toBe("Soda – 100kg Drum");
    expect(containerKey("Drum", "100")).toBe("Drum|100.000");
  });
  it("reads a size out of saved packaging text", () => {
    expect(sizeFromPackagingText("100kg")).toBe("100");
    expect(sizeFromPackagingText(" 20 L")).toBe("20");
    expect(sizeFromPackagingText("big")).toBe("");
    expect(sizeFromPackagingText(null)).toBe("");
  });
});
