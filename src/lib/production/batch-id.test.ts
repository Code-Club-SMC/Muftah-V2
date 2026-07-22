import { describe, expect, it } from "vitest";
import { generateNextBatchId } from "./batch-id";

describe("generateNextBatchId", () => {
	it("starts at A0001 when there is no previous batch", () => {
		expect(generateNextBatchId(null)).toBe("A0001");
		expect(generateNextBatchId(undefined)).toBe("A0001");
		expect(generateNextBatchId("")).toBe("A0001");
	});

	it("increments A-prefixed batch IDs with zero padding", () => {
		expect(generateNextBatchId("A0001")).toBe("A0002");
		expect(generateNextBatchId("A0009")).toBe("A0010");
		expect(generateNextBatchId("A0099")).toBe("A0100");
		expect(generateNextBatchId("A9999")).toBe("A10000");
	});

	it("resets to A0001 when the previous batch uses a different scheme", () => {
		expect(generateNextBatchId("AB1000")).toBe("A0001");
		expect(generateNextBatchId("B1234")).toBe("A0001");
		expect(generateNextBatchId("A1B2")).toBe("A0001");
	});
});
