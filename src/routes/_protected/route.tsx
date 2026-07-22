import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AppSidebar } from "@/components/custom/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { getViewerAccessFn } from "@/server-functions/auth/get-viewer-access-fn";
import { canAccessPath } from "@/lib/rbac";

export const Route = createFileRoute("/_protected")({
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

    if (!canAccessPath(location.pathname, viewerAccess.permissions)) {
      throw redirect({
        to: viewerAccess.defaultLandingPath,
      });
    }

    return {
      viewerAccess,
    };
  },
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <SidebarProvider defaultOpen>
      <div className="print:hidden">
        <AppSidebar />
      </div>
      <SidebarInset className="relative px-10 py-7 ">
        <Outlet />
      </SidebarInset>
    </SidebarProvider>
  );
}
