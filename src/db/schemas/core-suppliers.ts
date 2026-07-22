import { createId } from "@paralleldrive/cuid2";
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
};

// --- SUPPLIERS ---
export const suppliers = pgTable("suppliers", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  supplierName: text("supplier_name").notNull(),
  supplierShopName: text("supplier_shop_name"),
  email: text("email"),
  phone: text("phone"),
  nationalId: text("national_id"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  notes: text("notes"),
  ...timestamps,
});
