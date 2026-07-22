import { adminClient, twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { toast } from "sonner";
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

export const authClient = createAuthClient({
  baseURL: getAuthBaseUrl(),
  fetchOptions: {
    onError: async (context) => {
      const { response } = context;
      if (response.status === 429) {
        const retryAfter = response.headers.get("X-Retry-After") as string;
        toast.error(`Rate limit exceeded. Retry after ${retryAfter} seconds`);
      }
    },
  },
  plugins: [
    twoFactorClient({
      onTwoFactorRedirect: () => {
        window.location.href = "/2-fa";
      },
    }),
    adminClient({
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
