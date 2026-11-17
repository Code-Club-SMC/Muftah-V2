import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { requireInventoryViewMiddleware } from "@/lib/middlewares";
import { z } from "zod";

const getMaterialsSchema = z
  .object({
    includeEmpty: z.boolean().optional(),
  })
  .optional();

export const getMaterialsFn = createServerFn()
  .middleware([requireInventoryViewMiddleware])
  .inputValidator(getMaterialsSchema)
  .handler(async ({ data }) => {
    const includeEmpty = data?.includeEmpty ?? false;
    const [allChemicals, allPackagings] = await Promise.all([
      db.query.chemicals.findMany({
        with: {
          stock: true,
        },
      }),
      db.query.packagingMaterials.findMany({
        with: {
          stock: true,
        },
      }),
    ]);

    const chemicals = includeEmpty
      ? allChemicals
      : allChemicals.filter(
          (c) => c.stock && c.stock.some((s) => Number(s.quantity) > 0),
        );

    const packagings = includeEmpty
      ? allPackagings
      : allPackagings.filter(
          (p) => p.stock && p.stock.some((s) => Number(s.quantity) > 0),
        );

    return { chemicals, packagings };
  });
