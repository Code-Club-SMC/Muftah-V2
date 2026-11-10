import * as React from "react";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useReturnReasons, useSaveReturnReason } from "@/hooks/sales/use-sales-returns";
import { useViewerAccess } from "@/hooks/use-viewer-access";
import { hasPermission } from "@/lib/rbac";

const MIN_REASON_LENGTH = 2;
const MAX_REASON_LENGTH = 80;

function isValidReasonName(name: string): boolean {
  const length = name.trim().length;
  return length >= MIN_REASON_LENGTH && length <= MAX_REASON_LENGTH;
}

export function ReturnReasonsSettings() {
  const { data: viewer, isLoading: viewerLoading } = useViewerAccess();
  const canViewReasons = !!viewer && hasPermission(viewer.permissions, "sales.view");
  const canManageConfig =
    canViewReasons && !!viewer && hasPermission(viewer.permissions, "sales.config.manage");

  const {
    data: reasons = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useReturnReasons(canViewReasons, { includeInactive: true });
  const save = useSaveReturnReason();

  const [name, setName] = React.useState("");
  const [requiresNote, setRequiresNote] = React.useState(false);
  const [editing, setEditing] = React.useState<{ id: string; name: string } | null>(null);

  if (viewer && !canViewReasons) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Access restricted</AlertTitle>
        <AlertDescription>Sales view permission is required to view return reasons.</AlertDescription>
      </Alert>
    );
  }

  const allInactive = reasons.length > 0 && reasons.every((reason) => !reason.isActive);
  const canAdd = canManageConfig && isValidReasonName(name) && !save.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Return reasons</CardTitle>
        <CardDescription>
          The list people pick from when they record a return. Turn a reason off instead of deleting
          it, so old returns keep their reason.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {viewer && !canManageConfig && (
          <Alert>
            <AlertTitle>Read-only access</AlertTitle>
            <AlertDescription>
              Sales configuration manage permission is required to add or edit return reasons.
            </AlertDescription>
          </Alert>
        )}

        {allInactive && (
          <Alert>
            <AlertTitle>No active return reasons</AlertTitle>
            <AlertDescription>
              All reasons are turned off. New return requests cannot be created until at least one
              reason is in use.
            </AlertDescription>
          </Alert>
        )}

        {canManageConfig && (
          <form
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
            onSubmit={(event) => {
              event.preventDefault();
              const trimmed = name.trim();
              if (!isValidReasonName(trimmed) || save.isPending) return;
              save.mutate(
                { name: trimmed, requiresNote, isActive: true },
                {
                  onSuccess: () => {
                    setName("");
                    setRequiresNote(false);
                  },
                },
              );
            }}
          >
            <div className="flex-1 space-y-1">
              <Label htmlFor="new-return-reason">New reason</Label>
              <Input
                id="new-return-reason"
                value={name}
                maxLength={MAX_REASON_LENGTH}
                placeholder="e.g. Damaged packaging"
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="flex items-center gap-2 pb-1">
              <Switch
                id="new-return-reason-note"
                checked={requiresNote}
                disabled={save.isPending}
                onCheckedChange={setRequiresNote}
              />
              <Label htmlFor="new-return-reason-note" className="text-sm font-normal">
                Note required
              </Label>
            </div>
            <Button type="submit" disabled={!canAdd}>
              Add
            </Button>
          </form>
        )}

        {save.isError && (
          <p role="alert" className="text-sm text-destructive">
            {save.error instanceof Error ? save.error.message : "Failed to save return reason."}
          </p>
        )}

        {viewerLoading || isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : isError ? (
          <Alert variant="destructive">
            <AlertTitle>Could not load return reasons</AlertTitle>
            <AlertDescription>
              {error instanceof Error ? error.message : "Failed to load return reasons."}
            </AlertDescription>
            <AlertAction>
              <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
                Retry
              </Button>
            </AlertAction>
          </Alert>
        ) : !reasons.length ? (
          <p className="rounded-md border px-3 py-6 text-center text-sm text-muted-foreground">
            No return reasons configured yet.
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {reasons.map((reason) => (
              <li
                key={reason.id}
                className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
              >
                {canManageConfig && editing?.id === reason.id ? (
                  <form
                    className="flex flex-1 items-center gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const trimmed = editing.name.trim();
                      if (!isValidReasonName(trimmed) || save.isPending) return;
                      save.mutate(
                        {
                          id: reason.id,
                          name: trimmed,
                          requiresNote: reason.requiresNote,
                          isActive: reason.isActive,
                        },
                        { onSuccess: () => setEditing(null) },
                      );
                    }}
                  >
                    <Input
                      aria-label="Edit reason name"
                      value={editing.name}
                      maxLength={MAX_REASON_LENGTH}
                      onChange={(event) => setEditing({ id: reason.id, name: event.target.value })}
                      autoFocus
                    />
                    <Button
                      type="submit"
                      size="sm"
                      disabled={!isValidReasonName(editing.name) || save.isPending}
                    >
                      Save
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={save.isPending}
                      onClick={() => {
                        setEditing(null);
                        save.reset();
                      }}
                    >
                      Back
                    </Button>
                  </form>
                ) : canManageConfig ? (
                  <button
                    type="button"
                    className={
                      reason.isActive
                        ? "text-left text-sm hover:underline"
                        : "text-left text-sm text-muted-foreground line-through hover:underline"
                    }
                    onClick={() => {
                      save.reset();
                      setEditing({ id: reason.id, name: reason.name });
                    }}
                  >
                    {reason.name}
                  </button>
                ) : (
                  <span
                    className={
                      reason.isActive
                        ? "text-left text-sm"
                        : "text-left text-sm text-muted-foreground line-through"
                    }
                  >
                    {reason.name}
                  </span>
                )}
                <div className="flex items-center gap-4 text-sm">
                  <div className="flex items-center gap-2">
                    <Switch
                      id={`reason-note-${reason.id}`}
                      checked={reason.requiresNote}
                      disabled={!canManageConfig || save.isPending}
                      onCheckedChange={(checked) =>
                        save.mutate({
                          id: reason.id,
                          name: reason.name,
                          requiresNote: checked,
                          isActive: reason.isActive,
                        })
                      }
                    />
                    <Label htmlFor={`reason-note-${reason.id}`} className="font-normal">
                      Note required
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      id={`reason-active-${reason.id}`}
                      checked={reason.isActive}
                      disabled={!canManageConfig || save.isPending}
                      onCheckedChange={(checked) =>
                        save.mutate({
                          id: reason.id,
                          name: reason.name,
                          requiresNote: reason.requiresNote,
                          isActive: checked,
                        })
                      }
                    />
                    <Label htmlFor={`reason-active-${reason.id}`} className="font-normal">
                      In use
                    </Label>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
