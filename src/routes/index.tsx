import { createFileRoute, redirect } from "@tanstack/react-router";
import { getViewerAccessFn } from "@/server-functions/auth/get-viewer-access-fn";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    const viewerAccess = await getViewerAccessFn();

    if (viewerAccess) {
      throw redirect({
        to: viewerAccess.defaultLandingPath,
      });
    }

    throw redirect({
      to: "/login",
    });
  },
});
