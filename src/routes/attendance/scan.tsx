import { createFileRoute, redirect } from "@tanstack/react-router";
import { ScanTerminal } from "@/components/attendance/scan-terminal";
import { hasPermission } from "@/lib/rbac";
import { getViewerAccessFn } from "@/server-functions/auth/get-viewer-access-fn";

export const Route = createFileRoute("/attendance/scan")({
  beforeLoad: async ({ location }) => {
    const viewerAccess = await getViewerAccessFn();

    if (!viewerAccess) {
      throw redirect({
        to: "/login",
        search: {
          redirect: location.href,
        },
      });
    }

    if (!hasPermission(viewerAccess.permissions, "attendance_terminal.scan")) {
      throw redirect({
        to: viewerAccess.defaultLandingPath,
      });
    }

    return {
      viewerAccess,
    };
  },
  component: ScanTerminal,
});
