import { createId } from "@paralleldrive/cuid2";
import { createFileRoute } from "@tanstack/react-router";
import { and, eq } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { z } from "zod";
import { account, appRoles, db, user, userRoleAssignments } from "@/db";
import {
  hasValidBootstrapSecret,
} from "@/lib/admin-bootstrap";
import { ensureRbacSeeded, syncUserRoleAssignment } from "@/lib/authz.server";

const createBootstrapAdminSchema = z.object({
  name: z.string().min(2, "Name is required"),
  email: z.string().email("Valid email is required"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

const updateBootstrapAdminSchema = z.object({
  userId: z.string().optional(),
  currentEmail: z.string().email().optional(),
  name: z.string().min(2).optional(),
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
});



function hiddenNotFoundResponse() {
  return Response.json({ error: "Not Found" }, { status: 404 });
}

function invalidPayloadResponse(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

async function getSuperAdmins() {
  return db
    .select({
      userId: userRoleAssignments.userId,
      email: user.email,
      name: user.name,
    })
    .from(userRoleAssignments)
    .innerJoin(appRoles, eq(userRoleAssignments.roleId, appRoles.id))
    .innerJoin(user, eq(userRoleAssignments.userId, user.id))
    .where(eq(appRoles.slug, "super-admin"));
}

async function setOrCreateCredentialPassword(
  userId: string,
  newPassword: string,
) {
  const credentialAccount = await db.query.account.findFirst({
    where: and(
      eq(account.userId, userId),
      eq(account.providerId, "credential"),
    ),
  });
  const passwordHash = await hashPassword(newPassword);
  const now = new Date();

  if (credentialAccount) {
    await db
      .update(account)
      .set({
        accountId: userId,
        password: passwordHash,
        updatedAt: now,
      })
      .where(eq(account.id, credentialAccount.id));
    return;
  }

  await db.insert(account).values({
    id: createId(),
    userId,
    providerId: "credential",
    accountId: userId,
    password: passwordHash,
    createdAt: now,
    updatedAt: now,
  });
}

export const Route = createFileRoute("/api/internal/bootstrap-admin")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        if (!hasValidBootstrapSecret(request)) {
          return hiddenNotFoundResponse();
        }

        await ensureRbacSeeded();

        const superAdmins = await getSuperAdmins();

        return Response.json({
          bootstrapped: superAdmins.length > 0,
          superAdminCount: superAdmins.length,
          superAdmins,
        });
      },

      POST: async ({ request }: { request: Request }) => {
        if (!hasValidBootstrapSecret(request)) {
          return hiddenNotFoundResponse();
        }

        await ensureRbacSeeded();

        const payload = await request.json().catch(() => null);
        const parsed = createBootstrapAdminSchema.safeParse(payload);
        if (!parsed.success) {
          return invalidPayloadResponse(
            parsed.error.issues[0]?.message ?? "Invalid payload.",
          );
        }
        const data = parsed.data;
        const normalizedEmail = data.email.toLowerCase();

        const existingSuperAdmins = await getSuperAdmins();
        if (existingSuperAdmins.length > 0) {
          return Response.json(
            {
              error:
                "Super admin already exists. Use PATCH on this endpoint to update it.",
            },
            { status: 409 },
          );
        }

        const existingUser = await db.query.user.findFirst({
          where: eq(user.email, normalizedEmail),
        });

        if (existingUser) {
          await db
            .update(user)
            .set({
              name: data.name.trim(),
              updatedAt: new Date(),
            })
            .where(eq(user.id, existingUser.id));

          await setOrCreateCredentialPassword(
            existingUser.id,
            data.password,
          );
          await syncUserRoleAssignment(existingUser.id, "super-admin");

          return Response.json({
            success: true,
            mode: "promoted-existing-user",
            userId: existingUser.id,
            email: normalizedEmail,
          });
        }

        const createdUserId = createId();
        await db.insert(user).values({
          id: createdUserId,
          name: data.name.trim(),
          email: normalizedEmail,
          emailVerified: true,
          role: "super-admin",
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        await setOrCreateCredentialPassword(
          createdUserId,
          data.password,
        );

        await syncUserRoleAssignment(createdUserId, "super-admin");

        return Response.json({
          success: true,
          mode: "created-new-user",
          userId: createdUserId,
          email: normalizedEmail,
        });
      },

      PATCH: async ({ request }: { request: Request }) => {
        if (!hasValidBootstrapSecret(request)) {
          return hiddenNotFoundResponse();
        }

        await ensureRbacSeeded();

        const payload = await request.json().catch(() => null);
        const parsed = updateBootstrapAdminSchema.safeParse(payload);
        if (!parsed.success) {
          return invalidPayloadResponse(
            parsed.error.issues[0]?.message ?? "Invalid payload.",
          );
        }
        const data = parsed.data;

        const superAdmins = await getSuperAdmins();
        if (superAdmins.length === 0) {
          return Response.json(
            { error: "No super admin exists yet. Use POST first." },
            { status: 404 },
          );
        }

        if (!data.name && !data.email && !data.password) {
          return invalidPayloadResponse("Provide at least one field to update.");
        }

        const target =
          (data.userId
            ? superAdmins.find((admin) => admin.userId === data.userId)
            : null) ??
          (data.currentEmail
            ? superAdmins.find(
              (admin) =>
                admin.email.toLowerCase() ===
                data.currentEmail?.toLowerCase(),
            )
            : null) ??
          (superAdmins.length === 1 ? superAdmins[0] : null);

        if (!target) {
          return Response.json(
            {
              error:
                "Target super admin is ambiguous. Provide userId or currentEmail.",
            },
            { status: 400 },
          );
        }

        const updateUserData: Partial<typeof user.$inferInsert> = {};

        if (data.name) {
          updateUserData.name = data.name.trim();
        }

        if (data.email) {
          updateUserData.email = data.email.toLowerCase();
        }

        if (Object.keys(updateUserData).length > 0) {
          updateUserData.updatedAt = new Date();
          await db
            .update(user)
            .set(updateUserData)
            .where(eq(user.id, target.userId));
        }

        if (data.password) {
          await setOrCreateCredentialPassword(
            target.userId,
            data.password,
          );
        }

        await syncUserRoleAssignment(target.userId, "super-admin");

        return Response.json({
          success: true,
          userId: target.userId,
        });
      },
    },
  },
});
