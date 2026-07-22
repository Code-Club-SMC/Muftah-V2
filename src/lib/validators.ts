import { z } from "zod";

export const emailSchema = z.email("Please enter a valid email address");

export const passwordSchema = z
  .string()
  .min(1, "Password is required")
  .min(8, "Password must be at least 8 characters");

export const nameSchema = z
  .string()
  .min(1, "Name is required")
  .min(2, "Name must be at least 2 characters")
  .max(100, "Name must be less than 100 characters");

export const loginSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export const signupSchema = z
  .object({
    fullName: nameSchema,
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const updateProfileSchema = z.object({
  username: z
    .string({ error: "Username is required" })
    .min(2, { error: "Username must be at least 2 characters" })
    .max(100, { error: "Username must be less than 100 characters" }),
  image: z
    .url({ error: "Image URL is required" })
    .max(100, { error: "Image URL must be less than 100 characters" }),
});

export const addWarehouseSchema = z.object({
  name: z.string().min(2, "Name is too short").max(100),
  address: z.string().min(2, "Location/Address is required"),
  city: z.string().min(1, "City is required"),
  state: z.string().min(1, "State is required"),
  type: z.enum(["storage", "factory_floor"]),
  latitude: z
    .string()
    .refine((val) => !isNaN(Number(val)), "Must be a number")
    .transform(Number)
    .pipe(z.number().min(-90).max(90)),
  longitude: z
    .string()
    .refine((val) => !isNaN(Number(val)), "Must be a number")
    .transform(Number)
    .pipe(z.number().min(-180).max(180)),
});

export const updateWarehouseSchema = addWarehouseSchema.extend({
  id: z.string().min(1),
});
export const changeEmailSchema = z
  .object({
    email: emailSchema,
    confirmEmail: emailSchema,
  })
  .refine((data) => data.email === data.confirmEmail, {
    message: "Emails do not match",
    path: ["confirmEmail"],
  });

export const changePasswordSchema = z
  .object({
    currentPassword: passwordSchema,
    newPassword: passwordSchema,
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "New passwords do not match",
    path: ["confirmPassword"],
  });

export const supplierSchema = z.object({
  supplierName: z.string().min(2, "Name is required"),
  supplierShopName: z.string().min(2, "Name is required"),
  email: z
    .email("Invalid email")
    .optional()
    .or(z.literal(""))
    .nullable(),
  nationalId: z.string().min(1, "National ID is required").optional().or(z.literal("")),
  phone: z.string().min(1, "Phone is required"),
  address: z.string().min(1, "Address is required"),
  city: z.string().optional(),
  state: z.string().optional(),
  notes: z.string().optional(),
});

export const updateSupplierSchema = supplierSchema.extend({
  id: z.string().min(1),
});
