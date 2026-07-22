import { db } from "@/db";
import {
  categoryFieldOptions,
  categoryFields,
  expenseCategories,
  expenseFieldValues,
} from "@/db/schemas/finance-schema";
import {
  requireFinanceManageMiddleware,
  requireFinanceViewMiddleware,
} from "@/lib/middlewares";
import { createServerFn } from "@tanstack/react-start";
import { and, count, eq } from "drizzle-orm";
import { z } from "zod";
import { createId } from "@paralleldrive/cuid2";

const categoryFieldTypeSchema = z.enum([
  "text",
  "textarea",
  "number",
  "date",
  "select",
  "boolean",
]);

const toSlug = (name: string) =>
  name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

// ── List Categories ────────────────────────────────────────────────────────
export const listExpenseCategoriesFn = createServerFn()
  .middleware([requireFinanceViewMiddleware])
  .handler(async () => {
    return db.query.expenseCategories.findMany({
      where: and(
        eq(expenseCategories.isActive, true),
        eq(expenseCategories.isArchived, false),
      ),
      orderBy: (t, { asc }) => [asc(t.sortOrder), asc(t.name)],
    });
  });

// ── List All (including inactive) for admin management ────────────────────
export const listAllExpenseCategoriesFn = createServerFn()
  .middleware([requireFinanceManageMiddleware])
  .handler(async () => {
    return db.query.expenseCategories.findMany({
      orderBy: (t, { asc }) => [asc(t.sortOrder), asc(t.name)],
    });
  });

export const listCategoryDefinitionsFn = createServerFn()
  .middleware([requireFinanceViewMiddleware])
  .handler(async () => {
    return db.query.expenseCategories.findMany({
      where: and(
        eq(expenseCategories.isActive, true),
        eq(expenseCategories.isArchived, false),
      ),
      orderBy: (c, { asc }) => [asc(c.sortOrder), asc(c.name)],
      with: {
        fields: {
          where: eq(categoryFields.isActive, true),
          orderBy: (f, { asc }) => [asc(f.sortOrder), asc(f.label)],
          with: {
            options: {
              where: eq(categoryFieldOptions.isActive, true),
              orderBy: (o, { asc }) => [asc(o.sortOrder), asc(o.label)],
            },
          },
        },
      },
    });
  });

// ── Create Category ────────────────────────────────────────────────────────
export const createExpenseCategoryFn = createServerFn()
  .middleware([requireFinanceManageMiddleware])
  .inputValidator(
    z.object({
      name: z.string().min(1).max(50),
      icon: z.string().optional(),
      sortOrder: z.number().int().min(0).default(0),
    }),
  )
  .handler(async ({ data }) => {
    const slug = toSlug(data.name);
    const [category] = await db
      .insert(expenseCategories)
      .values({
        id: createId(),
        name: data.name,
        slug,
        icon: data.icon ?? null,
        sortOrder: data.sortOrder,
        isActive: true,
        isArchived: false,
      })
      .returning();
    return category;
  });

// ── Update Category ────────────────────────────────────────────────────────
export const updateExpenseCategoryFn = createServerFn()
  .middleware([requireFinanceManageMiddleware])
  .inputValidator(
    z.object({
      id: z.string(),
      name: z.string().min(1).max(50).optional(),
      icon: z.string().optional(),
      isActive: z.boolean().optional(),
      sortOrder: z.number().int().min(0).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { id, ...updates } = data;
    const finalUpdates = {
      ...updates,
      ...(updates.name ? { slug: toSlug(updates.name) } : {}),
    };

    const [category] = await db
      .update(expenseCategories)
      .set(finalUpdates)
      .where(eq(expenseCategories.id, id))
      .returning();
    return category;
  });

// ── Archive Category (soft-delete) ────────────────────────────────────────
export const deleteExpenseCategoryFn = createServerFn()
  .middleware([requireFinanceManageMiddleware])
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    await db
      .update(expenseCategories)
      .set({ isArchived: true, isActive: false })
      .where(eq(expenseCategories.id, data.id));
    return { success: true };
  });

// ── Category Fields ────────────────────────────────────────────────────────

export const listCategoryFieldsFn = createServerFn()
  .middleware([requireFinanceManageMiddleware])
  .inputValidator(z.object({ categoryId: z.string() }))
  .handler(async ({ data }) => {
    return db.query.categoryFields.findMany({
      where: eq(categoryFields.categoryId, data.categoryId),
      orderBy: (f, { asc }) => [asc(f.sortOrder), asc(f.label)],
      with: {
        options: {
          orderBy: (o, { asc }) => [asc(o.sortOrder), asc(o.label)],
        },
      },
    });
  });

export const createCategoryFieldFn = createServerFn()
  .middleware([requireFinanceManageMiddleware])
  .inputValidator(
    z.object({
      categoryId: z.string(),
      key: z
        .string()
        .min(1)
        .max(64)
        .regex(/^[a-z][a-z0-9_]*$/),
      label: z.string().min(1).max(100),
      fieldType: categoryFieldTypeSchema,
      isRequired: z.boolean().default(false),
      sortOrder: z.number().int().min(0).default(0),
      placeholder: z.string().max(200).optional(),
      helperText: z.string().max(500).optional(),
      minLength: z.number().int().min(0).optional(),
      maxLength: z.number().int().min(0).optional(),
      minNumber: z.number().optional(),
      maxNumber: z.number().optional(),
      minDate: z.string().optional(),
      maxDate: z.string().optional(),
      regexPattern: z.string().max(300).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const [field] = await db
      .insert(categoryFields)
      .values({
        id: createId(),
        categoryId: data.categoryId,
        key: data.key,
        label: data.label,
        fieldType: data.fieldType,
        isRequired: data.isRequired,
        sortOrder: data.sortOrder,
        placeholder: data.placeholder ?? null,
        helperText: data.helperText ?? null,
        minLength: data.minLength ?? null,
        maxLength: data.maxLength ?? null,
        minNumber: data.minNumber !== undefined ? data.minNumber.toString() : null,
        maxNumber: data.maxNumber !== undefined ? data.maxNumber.toString() : null,
        minDate: data.minDate ? new Date(data.minDate) : null,
        maxDate: data.maxDate ? new Date(data.maxDate) : null,
        regexPattern: data.regexPattern ?? null,
      })
      .returning();

    return field;
  });

export const updateCategoryFieldFn = createServerFn()
  .middleware([requireFinanceManageMiddleware])
  .inputValidator(
    z.object({
      id: z.string(),
      label: z.string().min(1).max(100).optional(),
      fieldType: categoryFieldTypeSchema.optional(),
      isRequired: z.boolean().optional(),
      sortOrder: z.number().int().min(0).optional(),
      placeholder: z.string().max(200).optional(),
      helperText: z.string().max(500).optional(),
      minLength: z.number().int().min(0).optional(),
      maxLength: z.number().int().min(0).optional(),
      minNumber: z.number().optional(),
      maxNumber: z.number().optional(),
      minDate: z.string().optional(),
      maxDate: z.string().optional(),
      regexPattern: z.string().max(300).optional(),
      isActive: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const current = await db.query.categoryFields.findFirst({
      where: eq(categoryFields.id, data.id),
      columns: { id: true, fieldType: true },
    });

    if (!current) {
      throw new Error("Field not found");
    }

    if (data.fieldType && data.fieldType !== current.fieldType) {
      const [used] = await db
        .select({ value: count() })
        .from(expenseFieldValues)
        .where(eq(expenseFieldValues.fieldId, data.id));

      if ((used?.value ?? 0) > 0) {
        throw new Error(
          "Field type cannot be changed after values have been saved for this field",
        );
      }
    }

    const updates = {
      ...(data.label !== undefined ? { label: data.label } : {}),
      ...(data.fieldType !== undefined ? { fieldType: data.fieldType } : {}),
      ...(data.isRequired !== undefined ? { isRequired: data.isRequired } : {}),
      ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
      ...(data.placeholder !== undefined ? { placeholder: data.placeholder } : {}),
      ...(data.helperText !== undefined ? { helperText: data.helperText } : {}),
      ...(data.minLength !== undefined ? { minLength: data.minLength } : {}),
      ...(data.maxLength !== undefined ? { maxLength: data.maxLength } : {}),
      ...(data.minNumber !== undefined
        ? { minNumber: data.minNumber.toString() }
        : {}),
      ...(data.maxNumber !== undefined
        ? { maxNumber: data.maxNumber.toString() }
        : {}),
      ...(data.minDate !== undefined
        ? { minDate: data.minDate ? new Date(data.minDate) : null }
        : {}),
      ...(data.maxDate !== undefined
        ? { maxDate: data.maxDate ? new Date(data.maxDate) : null }
        : {}),
      ...(data.regexPattern !== undefined ? { regexPattern: data.regexPattern } : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
    };

    const [field] = await db
      .update(categoryFields)
      .set(updates)
      .where(eq(categoryFields.id, data.id))
      .returning();

    return field;
  });

export const archiveCategoryFieldFn = createServerFn()
  .middleware([requireFinanceManageMiddleware])
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const [field] = await db
      .update(categoryFields)
      .set({ isActive: false })
      .where(eq(categoryFields.id, data.id))
      .returning();

    return field;
  });

// ── Category Field Options ────────────────────────────────────────────────

export const createCategoryFieldOptionFn = createServerFn()
  .middleware([requireFinanceManageMiddleware])
  .inputValidator(
    z.object({
      fieldId: z.string(),
      value: z.string().min(1).max(100),
      label: z.string().min(1).max(100),
      sortOrder: z.number().int().min(0).default(0),
    }),
  )
  .handler(async ({ data }) => {
    const [option] = await db
      .insert(categoryFieldOptions)
      .values({
        id: createId(),
        fieldId: data.fieldId,
        value: data.value,
        label: data.label,
        sortOrder: data.sortOrder,
        isActive: true,
      })
      .returning();

    return option;
  });

export const updateCategoryFieldOptionFn = createServerFn()
  .middleware([requireFinanceManageMiddleware])
  .inputValidator(
    z.object({
      id: z.string(),
      value: z.string().min(1).max(100).optional(),
      label: z.string().min(1).max(100).optional(),
      sortOrder: z.number().int().min(0).optional(),
      isActive: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { id, ...updates } = data;
    const [option] = await db
      .update(categoryFieldOptions)
      .set(updates)
      .where(eq(categoryFieldOptions.id, id))
      .returning();

    return option;
  });

export const archiveCategoryFieldOptionFn = createServerFn()
  .middleware([requireFinanceManageMiddleware])
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const [option] = await db
      .update(categoryFieldOptions)
      .set({ isActive: false })
      .where(eq(categoryFieldOptions.id, data.id))
      .returning();

    return option;
  });
