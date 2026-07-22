import { useEffect, useMemo, useState } from "react";
import { Blocks, Layers2, Radar, Eye, Edit2, Activity, ShieldCheck, FileCheck, PowerOff, ShieldAlert, FolderKey } from "lucide-react";
import { ResponsiveDialog } from "@/components/custom/responsive-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useUsers } from "@/hooks/use-users";
import { MODULE_PERMISSION_GROUPS } from "@/lib/rbac";

import { RoleDialogState, PermissionDefinition, LandingPathPill, MODULE_LABELS } from "./types";

const getPermissionProps = (key: string) => {
  if (key.endsWith(".view") || key.endsWith(".read")) return { icon: Eye, color: "text-blue-500" };
  if (key.includes(".run.")) return { icon: Activity, color: "text-amber-500" };
  if (key.includes(".roles.")) return { icon: ShieldAlert, color: "text-rose-500" };
  if (key.includes(".users.")) return { icon: ShieldCheck, color: "text-fuchsia-500" };
  if (key.endsWith(".manage")) return { icon: Edit2, color: "text-violet-500" };
  if (key.endsWith(".log")) return { icon: FileCheck, color: "text-emerald-500" };
  if (key.endsWith(".complete") || key.endsWith(".fail")) return { icon: PowerOff, color: "text-red-500" };
  return { icon: FolderKey, color: "text-muted-foreground" };
};

export function RoleEditorDialog({
  dialogState,
  open,
  onOpenChange,
  permissions,
  landingPathOptions,
}: {
  dialogState: RoleDialogState | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  permissions: PermissionDefinition[];
  landingPathOptions: string[];
}) {
  const { createRole, updateRole } = useUsers();
  const isEditing = dialogState?.mode === "edit";
  const isSuperAdmin = dialogState?.mode === "edit" && dialogState.role.slug === "super-admin";

  const [formState, setFormState] = useState(() => ({
    name: dialogState?.mode === "edit" ? dialogState.role.name : "",
    slug: dialogState?.mode === "edit" ? dialogState.role.slug : "",
    description: dialogState?.mode === "edit" ? dialogState.role.description : "",
    defaultLandingPath:
      dialogState?.mode === "edit"
        ? dialogState.role.defaultLandingPath
        : landingPathOptions[0] ?? "/dashboard",
    permissionKeys:
      dialogState?.mode === "edit"
        ? dialogState.role.permissionKeys.filter((permissionKey) => permissionKey !== "*")
        : [],
  }));

  const groupedPermissions = useMemo(() => {
    return permissions.reduce<Record<string, PermissionDefinition[]>>((acc, permission) => {
      acc[permission.moduleKey] = acc[permission.moduleKey] ?? [];
      acc[permission.moduleKey].push(permission);
      return acc;
    }, {});
  }, [permissions]);

  const resetForm = () => {
    setFormState({
      name: dialogState?.mode === "edit" ? dialogState.role.name : "",
      slug: dialogState?.mode === "edit" ? dialogState.role.slug : "",
      description: dialogState?.mode === "edit" ? dialogState.role.description : "",
      defaultLandingPath:
        dialogState?.mode === "edit"
          ? dialogState.role.defaultLandingPath
          : landingPathOptions[0] ?? "/dashboard",
      permissionKeys:
        dialogState?.mode === "edit"
          ? dialogState.role.permissionKeys.filter((permissionKey) => permissionKey !== "*")
          : [],
    });
  };

  const close = (nextOpen: boolean) => {
    if (!nextOpen) {
      resetForm();
    }
    onOpenChange(nextOpen);
  };

  useEffect(() => {
    resetForm();
  }, [dialogState, landingPathOptions]);

  const togglePermission = (permissionKey: string) => {
    setFormState((current) => ({
      ...current,
      permissionKeys: current.permissionKeys.includes(permissionKey)
        ? current.permissionKeys.filter((existingKey) => existingKey !== permissionKey)
        : [...current.permissionKeys, permissionKey],
    }));
  };

  const handleSubmit = async () => {
    if (isEditing && dialogState?.mode === "edit") {
      await updateRole.mutateAsync({
        roleId: dialogState.role.id,
        name: formState.name.trim(),
        slug: formState.slug.trim(),
        description: formState.description.trim(),
        defaultLandingPath: formState.defaultLandingPath,
        permissionKeys: formState.permissionKeys as any,
      });
      close(false);
      return;
    }

    await createRole.mutateAsync({
      name: formState.name.trim(),
      slug: formState.slug.trim(),
      description: formState.description.trim(),
      defaultLandingPath: formState.defaultLandingPath,
      permissionKeys: formState.permissionKeys as any,
    });
    close(false);
  };

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={close}
      title={isEditing ? "Tune Role Blueprint" : "Design New Role"}
      description="Shape permissions, choose a landing page, and keep the control surface readable."
      className="min-w-5xl w-full border-border/60 bg-card/95 p-0"
      icon={Blocks}
      noScroll
    >
      {/* ── ISOLATED SCROLL CONTAINER ── */}
      <div className="flex flex-col h-[85vh] max-h-[900px] overflow-hidden">

        {/* Split Pane Content */}
        <div className="flex flex-1 min-h-0 flex-col lg:flex-row overflow-hidden">

          {/* ── LEFT PANE: STICKY FORM ── */}
          <div className="w-full lg:w-[40%] xl:w-[40%] shrink-0 border-b lg:border-b-0 lg:border-r border-border/60 bg-card/30 overflow-y-auto p-6">
            <div className="space-y-6">
              <label className="space-y-2 block">
                <span className="text-[11px] font-bold uppercase text-muted-foreground flex gap-1 items-center">
                  Role Name <span className="text-destructive text-sm">*</span>
                </span>
                <Input
                  value={formState.name}
                  onChange={(event) =>
                    setFormState((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="Machine Operator"
                  className="h-11 rounded-none border-border/60 bg-background/80"
                />
              </label>

              <label className="space-y-2 block">
                <span className="text-[11px] font-bold uppercase text-muted-foreground">
                  Role Slug
                </span>
                <Input
                  value={formState.slug}
                  onChange={(event) =>
                    setFormState((current) => ({
                      ...current,
                      slug: event.target.value
                        .toLowerCase()
                        .replace(/[^a-z0-9-]+/g, "-")
                        .replace(/--+/g, "-"),
                    }))
                  }
                  disabled={dialogState?.mode === "edit" && dialogState.role.isSystem}
                  placeholder="machine-operator"
                  className="h-11 rounded-none border-border/60 bg-background/80 font-mono text-[13px]"
                />
              </label>

              <label className="space-y-2 block">
                <span className="text-[11px] font-bold uppercase text-muted-foreground flex gap-1 items-center">
                  Description <span className="text-destructive text-sm">*</span>
                </span>
                <Textarea
                  value={formState.description}
                  onChange={(event) =>
                    setFormState((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                  placeholder="Summarize what this role owns and why it exists."
                  className="min-h-28 rounded-none border border-border/60 bg-background/80 resize-none"
                />
              </label>

              <label className="space-y-2 block">
                <span className="text-[11px] font-bold uppercase text-muted-foreground flex gap-1 items-center">
                  Default Landing Page <span className="text-destructive text-sm">*</span>
                </span>
                <Select
                  value={formState.defaultLandingPath}
                  onValueChange={(value) =>
                    setFormState((current) => ({
                      ...current,
                      defaultLandingPath: value,
                    }))
                  }
                >
                  <SelectTrigger className="h-11 w-full rounded-none border-border/60 bg-background/80 px-4">
                    <SelectValue placeholder="Choose a landing page" />
                  </SelectTrigger>
                  <SelectContent>
                    {landingPathOptions.map((path) => (
                      <SelectItem key={path} value={path}>
                        {path}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>

              <div className="rounded-none border border-border/60 bg-linear-to-br from-primary/10 via-background to-background p-5">
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-none bg-primary/15 text-primary shrink-0">
                    <Radar className="size-4" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-foreground">Preview Engine</p>
                    <p className="text-xs text-muted-foreground">
                      This role will open here after sign-in.
                    </p>
                  </div>
                </div>
                <div className="mt-4">
                  <LandingPathPill path={formState.defaultLandingPath} />
                </div>
              </div>
            </div>
          </div>

          {/* ── RIGHT PANE: SCROLLABLE MATRIX ── */}
          <div className="flex-1 bg-background/40 flex flex-col min-w-0 overflow-hidden">
            <ScrollArea className="flex-1 w-full h-full">
              <div className="p-6">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-foreground">Permission Matrix</p>
                    <p className="text-xs text-muted-foreground">
                      Toggle the exact route and action capabilities this role should own.
                    </p>
                  </div>
                  {isSuperAdmin ? (
                    <Badge className="rounded-none bg-primary px-3 py-1 text-[10px] font-bold uppercase text-primary-foreground">
                      Locked Full Access
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="rounded-none px-3 py-1 text-[10px]">
                      Custom Permissions
                    </Badge>
                  )}
                </div>

                <div className="space-y-4">
                  {Object.entries(groupedPermissions).map(([moduleKey, modulePermissions]) => {
                    const moduleTone = MODULE_PERMISSION_GROUPS[moduleKey as keyof typeof MODULE_PERMISSION_GROUPS];
                    return (
                      <div
                        key={moduleKey}
                        className="rounded-none border border-border/60 bg-background/80 p-4"
                      >
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <div
                              className={cn(
                                "flex size-9 items-center justify-center rounded-none border bg-muted text-foreground",
                                moduleTone?.accent === "violet" && "border-violet-500/20 bg-violet-500/10 text-violet-600 dark:text-violet-300",
                                moduleTone?.accent === "amber" && "border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-300",
                                moduleTone?.accent === "cyan" && "border-cyan-500/20 bg-cyan-500/10 text-cyan-600 dark:text-cyan-300",
                                moduleTone?.accent === "orange" && "border-orange-500/20 bg-orange-500/10 text-orange-600 dark:text-orange-300",
                                moduleTone?.accent === "emerald" && "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
                                moduleTone?.accent === "sky" && "border-sky-500/20 bg-sky-500/10 text-sky-600 dark:text-sky-300",
                                moduleTone?.accent === "rose" && "border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-300",
                                moduleTone?.accent === "yellow" && "border-yellow-500/20 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300",
                                moduleTone?.accent === "fuchsia" && "border-fuchsia-500/20 bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-300",
                                moduleTone?.accent === "indigo" && "border-indigo-500/20 bg-indigo-500/10 text-indigo-600 dark:text-indigo-300",
                              )}
                            >
                              <Layers2 className="size-4" />
                            </div>
                            <div>
                              <p className="text-sm font-bold text-foreground">
                                {MODULE_LABELS[moduleKey] ?? moduleKey}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {modulePermissions.length} permission lanes
                              </p>
                            </div>
                          </div>
                        </div>

                        <div className="grid gap-3">
                          {modulePermissions.map((permission) => {
                            const isChecked =
                              isSuperAdmin || formState.permissionKeys.includes(permission.key);
                            const PermIcon = getPermissionProps(permission.key).icon;
                            const iconColor = getPermissionProps(permission.key).color;
                            return (
                              <label
                                key={permission.key}
                                className="flex items-start gap-4 rounded-none border border-border/50 bg-card/60 px-4 py-3 hover:bg-muted/10 transition-colors cursor-pointer"
                              >
                                <Checkbox
                                  checked={isChecked}
                                  disabled={isSuperAdmin}
                                  onCheckedChange={() => togglePermission(permission.key)}
                                  className="mt-0.5 rounded-none"
                                />
                                <div className={cn("mt-0.5 p-1.5 rounded-none bg-muted/40 border border-border/50", iconColor)}>
                                  <PermIcon className="size-4" />
                                </div>
                                <div className="space-y-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-sm font-semibold text-foreground">
                                      {permission.label}
                                    </span>
                                    <Badge variant="outline" className="h-5 rounded-none px-2 text-[10px] font-mono">
                                      {permission.key}
                                    </Badge>
                                  </div>
                                  <p className="text-xs leading-relaxed text-muted-foreground">
                                    {permission.description}
                                  </p>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </ScrollArea>
          </div>
        </div>

        {/* ── STICKY FOOTER ── */}
        <div className="shrink-0 flex items-center justify-end gap-3 border-t border-border/60 px-6 py-4 bg-background z-10 relative">
          <Button variant="outline" onClick={() => close(false)} className="rounded-none px-5">
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={
              createRole.isPending ||
              updateRole.isPending ||
              !formState.name.trim() ||
              !formState.slug.trim() ||
              (!isSuperAdmin && formState.permissionKeys.length === 0)
            }
            className="rounded-none px-5"
          >
            {createRole.isPending || updateRole.isPending
              ? "Saving..."
              : isEditing
                ? "Save Role"
                : "Create Role"}
          </Button>
        </div>
      </div>
    </ResponsiveDialog>
  );
}