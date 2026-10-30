import { vi } from "vitest";
import { db } from "@/db";
import type { Tx } from "@/lib/inventory/material-lots.server";

const rollback = new Error("rollback");

// Runs the check inside one transaction that is rolled back at the end. Server functions' own
// transactions become savepoints inside it, so nothing is committed and suites running in
// parallel never see this test's factory floors.
export async function withRollback(check: (tx: Tx) => Promise<void>) {
  try {
    await db.transaction(async (tx) => {
      const spy = vi.spyOn(db, "transaction").mockImplementation(
        ((callback: Parameters<typeof db.transaction>[0]) => tx.transaction(callback)) as typeof db.transaction,
      );
      try {
        await check(tx);
      } finally {
        spy.mockRestore();
      }
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}
