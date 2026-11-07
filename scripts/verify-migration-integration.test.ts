import { describe, expect, it, vi } from "vitest";

const { constructor } = vi.hoisted(() => ({ constructor: vi.fn() }));
vi.mock("pg", () => ({ Client: constructor }));
import {
  validateLocalTestUrl,
  withLocalClient,
  forwardConstraintNames,
} from "./verify-migration-integration";

describe("migration rehearsal connection boundary", () => {
  it("connects with explicit fields and closes even when local work fails", async () => {
    const client = { connect: vi.fn(), query: vi.fn(), end: vi.fn() };
    constructor.mockImplementation(function () {
      return client;
    });
    const work = vi.fn().mockRejectedValue(new Error("fixture failure"));
    await expect(
      withLocalClient(
        "postgresql://runner:temporary@[::1]:5433/titan_test",
        work,
      ),
    ).rejects.toThrow("fixture failure");
    expect(constructor).toHaveBeenCalledWith({
      host: "::1",
      port: 5433,
      database: "titan_test",
      user: "runner",
      password: "temporary",
      ssl: false,
      connectionTimeoutMillis: 5000,
    });
    expect(client.connect).toHaveBeenCalledOnce();
    expect(work).toHaveBeenCalledWith(client);
    expect(client.end).toHaveBeenCalledOnce();
  });
  it("uses PostgreSQL's 63-byte limit for generated ASCII constraint names", () => {
    const name =
      "invoices_offline_sales_slot_id_offline_sales_invoice_slots_id_fk";
    expect(
      forwardConstraintNames(
        `ALTER TABLE "invoices" ADD CONSTRAINT "${name}" FOREIGN KEY (id);`,
      ),
    ).toEqual([
      "invoices_offline_sales_slot_id_offline_sales_invoice_slots_id_f",
    ]);
  });
  it.each([
    "postgresql://runner:temporary@127.0.0.1:49152/titan_upgrade_test",
    "postgres://runner:temporary@[::1]:5433/titan_clean_test",
  ])(
    "accepts an explicit loopback host, port and _test database: %s",
    (url) => {
      expect(validateLocalTestUrl(url).pathname).toMatch(/_test$/);
    },
  );

  const unsafe = [
    "",
    "not a URL",
    "https://127.0.0.1:5433/titan_test",
    "postgresql://runner:temporary@production.example:5433/titan_test",
    "postgresql://runner:temporary@localhost:5433/titan_test",
    "postgresql://runner:temporary@127.0.0.2:5433/titan_test",
    "postgresql://runner:temporary@0.0.0.0:5433/titan_test",
    "postgresql://runner:temporary@[::ffff:127.0.0.1]:5433/titan_test",
    "postgresql://runner:temporary@127.0.0.1/titan_test",
    "postgresql://runner:temporary@127.0.0.1:0/titan_test",
    "postgresql://runner:temporary@127.0.0.1:65536/titan_test",
    "postgresql://runner:temporary@127.0.0.1:5433/postgres",
    "postgresql://runner:temporary@127.0.0.1:5433/titan",
    "postgresql://runner:temporary@127.0.0.1:5433/titan_test/other",
    "postgresql://runner:temporary@127.0.0.1:5433/%74itan_test",
    "postgresql://runner:temporary@127.0.0.1:5433/titan_test?host=production.example",
    "postgresql://runner:temporary@127.0.0.1:5433/titan_test?port=5432",
    "postgresql://runner:temporary@127.0.0.1:5433/titan_test?service=production",
    "postgresql://runner:temporary@127.0.0.1:5433/titan_test?options=-csearch_path=other",
    "postgresql://runner:temporary@127.0.0.1:5433/titan_test#fragment",
  ];

  it.each(unsafe)(
    "rejects unsafe target before constructing a client: %s",
    async (url) => {
      constructor.mockClear();
      const work = vi.fn();
      expect(() => validateLocalTestUrl(url)).toThrow();
      await expect(withLocalClient(url, work)).rejects.toThrow();
      expect(constructor).not.toHaveBeenCalled();
      expect(work).not.toHaveBeenCalled();
    },
  );
});
