import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  archiveRoleFn,
  assignUserRoleFn,
  banManagedUserFn,
  createManagedUserFn,
  createRoleFn,
  deleteRoleFn,
  revokeManagedUserSessionFn,
  revokeManagedUserSessionsFn,
  setManagedUserPasswordFn,
  unbanManagedUserFn,
  updateManagedUserFn,
  updateRoleFn,
  removeManagedUserFn,
} from "@/server-functions/user-management/rbac-management-fn";
import { superAdminGetUserSessionsFn } from "@/server-functions/user-management/super-admin-get-user-sessions-fn";

const overviewQueryKey = ["admin-users"];

export const useUsers = () => {
  const queryClient = useQueryClient();

  const invalidateOverview = () =>
    queryClient.invalidateQueries({ queryKey: overviewQueryKey });

  const listUserSessions = (userId: string, enabled: boolean) => {
    return useQuery({
      queryKey: ["user-sessions", userId],
      queryFn: async () => {
        const result = await superAdminGetUserSessionsFn({ data: { userId } });
        return result.sessions ?? result;
      },
      enabled,
    });
  };

  const createUser = useMutation({
    mutationFn: async (data: Parameters<typeof createManagedUserFn>[0]["data"]) =>
      createManagedUserFn({ data }),
    onSuccess: () => {
      toast.success("User created successfully.");
      invalidateOverview();
    },
    onError: (error) => toast.error(error.message),
  });

  const setRole = useMutation({
    mutationFn: async (data: Parameters<typeof assignUserRoleFn>[0]["data"]) =>
      assignUserRoleFn({ data }),
    onSuccess: () => {
      toast.success("User role updated successfully.");
      invalidateOverview();
    },
    onError: (error) => toast.error(error.message),
  });

  const updateUser = useMutation({
    mutationFn: async (data: Parameters<typeof updateManagedUserFn>[0]["data"]) =>
      updateManagedUserFn({ data }),
    onSuccess: () => {
      toast.success("User updated successfully.");
      invalidateOverview();
    },
    onError: (error) => toast.error(error.message),
  });

  const setUserPassword = useMutation({
    mutationFn: async (
      data: Parameters<typeof setManagedUserPasswordFn>[0]["data"],
    ) => setManagedUserPasswordFn({ data }),
    onSuccess: () => {
      toast.success("Password updated successfully.");
    },
    onError: (error) => toast.error(error.message),
  });

  const banUser = useMutation({
    mutationFn: async (data: Parameters<typeof banManagedUserFn>[0]["data"]) =>
      banManagedUserFn({ data }),
    onSuccess: () => {
      toast.success("User restricted successfully.");
      invalidateOverview();
    },
    onError: (error) => toast.error(error.message),
  });

  const unbanUser = useMutation({
    mutationFn: async (data: Parameters<typeof unbanManagedUserFn>[0]["data"]) =>
      unbanManagedUserFn({ data }),
    onSuccess: () => {
      toast.success("User access restored successfully.");
      invalidateOverview();
    },
    onError: (error) => toast.error(error.message),
  });

  const removeUser = useMutation({
    mutationFn: async (data: Parameters<typeof removeManagedUserFn>[0]["data"]) =>
      removeManagedUserFn({ data }),
    onSuccess: () => {
      toast.success("User deleted successfully.");
      invalidateOverview();
    },
    onError: (error) => toast.error(error.message),
  });

  const revokeUserSession = useMutation({
    mutationFn: async (
      data: Parameters<typeof revokeManagedUserSessionFn>[0]["data"],
    ) => revokeManagedUserSessionFn({ data }),
    onSuccess: () => {
      toast.success("Session revoked successfully.");
      queryClient.invalidateQueries({ queryKey: ["user-sessions"] });
    },
    onError: (error) => toast.error(error.message),
  });

  const revokeAllUserSessions = useMutation({
    mutationFn: async (
      data: Parameters<typeof revokeManagedUserSessionsFn>[0]["data"],
    ) => revokeManagedUserSessionsFn({ data }),
    onSuccess: () => {
      toast.success("All sessions revoked successfully.");
      queryClient.invalidateQueries({ queryKey: ["user-sessions"] });
    },
    onError: (error) => toast.error(error.message),
  });

  const createRole = useMutation({
    mutationFn: async (data: Parameters<typeof createRoleFn>[0]["data"]) =>
      createRoleFn({ data }),
    onSuccess: () => {
      toast.success("Role created successfully.");
      invalidateOverview();
    },
    onError: (error) => toast.error(error.message),
  });

  const updateRole = useMutation({
    mutationFn: async (data: Parameters<typeof updateRoleFn>[0]["data"]) =>
      updateRoleFn({ data }),
    onSuccess: () => {
      toast.success("Role updated successfully.");
      invalidateOverview();
    },
    onError: (error) => toast.error(error.message),
  });

  const archiveRole = useMutation({
    mutationFn: async (data: Parameters<typeof archiveRoleFn>[0]["data"]) =>
      archiveRoleFn({ data }),
    onSuccess: (_, variables) => {
      toast.success(
        variables.isArchived ? "Role archived successfully." : "Role restored successfully.",
      );
      invalidateOverview();
    },
    onError: (error) => toast.error(error.message),
  });

  const deleteRole = useMutation({
    mutationFn: async (data: Parameters<typeof deleteRoleFn>[0]["data"]) =>
      deleteRoleFn({ data }),
    onSuccess: () => {
      toast.success("Role deleted successfully.");
      invalidateOverview();
    },
    onError: (error) => toast.error(error.message),
  });

  return {
    listUserSessions,
    createUser,
    setRole,
    updateUser,
    setUserPassword,
    banUser,
    unbanUser,
    removeUser,
    revokeUserSession,
    revokeAllUserSessions,
    createRole,
    updateRole,
    archiveRole,
    deleteRole,
  };
};
