import { logActivityQuiet } from "./activity-logger.server";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin as adminPlugin } from "better-auth/plugins/admin";
import { twoFactor } from "better-auth/plugins/two-factor";
import { account, db, session, user, verification } from "../db";
import { resetPasswordTemplate } from "../email-templates/reset-password-template";
import { sendEmail, verifySmtpConnection } from "./email-client";
import { getAuthBaseUrl } from "./auth-url";
import {
  ac,
  admin,
  attendanceTerminal,
  financeManager,
  operator,
  orderBooker,
  superAdmin,
} from "./permissions";

const authBaseUrl = getAuthBaseUrl();
const trustedOrigins = authBaseUrl ? [authBaseUrl] : [];
const isDeploymentRuntime =
  process.env.NODE_ENV === "production" || process.env.NODE_ENV === "staging";

if (isDeploymentRuntime && !process.env.BETTER_AUTH_SECRET) {
  throw new Error("BETTER_AUTH_SECRET environment variable is required");
}

if (isDeploymentRuntime && !process.env.BETTER_AUTH_URL) {
  throw new Error("BETTER_AUTH_URL environment variable is required");
}

if (typeof window === "undefined") {
  void verifySmtpConnection();
}

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg", // or "mysql"
    schema: {
      session,
      account,
      verification,
      twoFactor,
      user,
    },
  }),
  emailVerification: {
    // autoSignInAfterVerification: true,
    // sendOnSignIn: true,
    // sendOnSignUp: true,
    // sendVerificationEmail: async ({ url, user }) => {
    //   await sendEmail({
    //     email: user.email,
    //     html: () =>
    //       verificationEmailTemplate({
    //         url,
    //         user,
    //       }),
    //     subject: "Verify Your Email",
    //   });
    // },
  },
  emailAndPassword: {
    // autoSignIn: true,
    requireEmailVerification: false,
    enabled: true,
    sendResetPassword: async ({ user, url }) => {
      await sendEmail({
        email: user.email,
        html: () =>
          resetPasswordTemplate({
            url,
            user,
          }),
        subject: "Reset Password Request",
      });
    },
  },
  
  databaseHooks: {
    session: {
      create: {
        after: async (session: any) => {
          // Fetch user name since session only has userId
          const u = await db.query.user.findFirst({ where: (u, { eq }) => eq(u.id, session.userId) });
          logActivityQuiet({
            module: "auth",
            action: "login",
            entityType: "session",
            actorId: session.userId,
            actorName: u?.name || "Unknown User",
            description: `User ${u?.name || session.userId} logged in`,
          });
        }
      },
      delete: {
        before: async (session: any) => {
          const u = await db.query.user.findFirst({ where: (u, { eq }) => eq(u.id, session.userId) });
          logActivityQuiet({
            module: "auth",
            action: "logout",
            entityType: "session",
            actorId: session.userId,
            actorName: u?.name || "Unknown User",
            description: `User ${u?.name || session.userId} logged out`,
          });
        }
      }
    }
  },

  trustedOrigins,
  advanced: {
    useSecureCookies: process.env.NODE_ENV === "production",
  },

  plugins: [
    twoFactor(),
    adminPlugin({
      defaultRole: "operator",
      adminRoles: ["super-admin", "admin"],
      ac,
      roles: {
        operator: operator,
        "super-admin": superAdmin,
        admin: admin,
        "finance-manager": financeManager,
        "attendance-terminal": attendanceTerminal,
        "order-booker": orderBooker,
      },
    }),
  ],
});
