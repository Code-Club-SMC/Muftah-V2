import { createFileRoute, redirect } from "@tanstack/react-router";
import { hasPermission } from "@/lib/rbac";
import { getViewerAccessFn } from "@/server-functions/auth/get-viewer-access-fn";

export const Route = createFileRoute("/attendance/scan")({
  beforeLoad: async ({ location }) => {
    const viewerAccess = await getViewerAccessFn();
    if (!viewerAccess)
      throw redirect({ to: "/login", search: { redirect: location.href } });
    if (hasPermission(viewerAccess.permissions, "hr.view"))
      throw redirect({ to: "/hr/attendance" });
    return { viewerAccess };
  },
  component: RetiredAttendanceTerminal,
});

function RetiredAttendanceTerminal() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-8 text-center text-foreground">
      <h1 className="text-2xl font-semibold">Attendance recording has moved</h1>
      <p className="max-w-md text-muted-foreground">
        HR now uploads the device punch report from the Attendance page. Contact
        HR to correct a missing or incorrect punch.
      </p>
    </main>
  );
}
