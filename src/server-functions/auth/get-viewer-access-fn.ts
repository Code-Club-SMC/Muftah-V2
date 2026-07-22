import { createServerFn } from "@tanstack/react-start";
import { getAuthContext } from "@/lib/authz.server";

export const getViewerAccessFn = createServerFn().handler(async () => {
  const authContext = await getAuthContext();

  if (!authContext) {
    return null;
  }

  return {
    session: authContext.session.session,
    user: authContext.session.user,
    role: authContext.role,
    permissions: authContext.permissionList,
    defaultLandingPath: authContext.defaultLandingPath,
  };
});
