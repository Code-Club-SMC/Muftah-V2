import { useState } from "react";
import { Briefcase, Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useViewerAccess } from "@/hooks/use-viewer-access";
import { hasPermission } from "@/lib/rbac";
import { useDecideTimeExceptions, useTimeExceptions } from "@/hooks/hr/use-time-exceptions";
import {
  formatExceptionMinutes,
  TIME_EXCEPTION_STATUS_LABELS,
  type TimeExceptionDecision,
} from "@/lib/attendance/time-exceptions";

export function TimeExceptionDecisions({ attendanceId }: { attendanceId: string | undefined }) {
  const { data: viewerAccess } = useViewerAccess();
  const canDecide = !!viewerAccess && hasPermission(viewerAccess.permissions, "hr.manage");

  // Only HR can list items, so the query mounts after the permission check.
  if (!attendanceId || !canDecide) return null;
  return <TimeExceptionDecisionList attendanceId={attendanceId} />;
}

function TimeExceptionDecisionList({ attendanceId }: { attendanceId: string }) {
  const { data, isLoading } = useTimeExceptions("all", attendanceId);
  const decide = useDecideTimeExceptions();
  const [notes, setNotes] = useState<Record<string, string>>({});

  if (isLoading) return null;
  const items = data?.items ?? [];
  if (items.length === 0) {
    return (
      <p className="text-[12.5px] text-muted-foreground">
        No late arrival or early departure on this day.
      </p>
    );
  }

  const save = (id: string, status: TimeExceptionDecision) =>
    decide.mutate({ ids: [id], status, note: notes[id]?.trim() || undefined });

  return (
    <div className="space-y-3">
      {items.map((item) => {
        const label = `${item.kind === "late" ? "Late arrival" : "Early departure"} ${formatExceptionMinutes(item.minutes)}`;
        if (item.status === "grace") {
          return (
            <div key={item.id} className="text-[13px] text-muted-foreground">
              {label} — grace applied
            </div>
          );
        }
        const note = notes[item.id] ?? item.note ?? "";
        return (
          <div key={item.id} className="space-y-2 rounded-lg border border-border/60 p-3">
            <div className="flex items-center justify-between gap-2 text-[13px] font-medium">
              <span>{label}</span>
              <Badge
                variant={
                  item.status === "rejected"
                    ? "destructive"
                    : item.status === "pending"
                      ? "outline"
                      : "secondary"
                }
              >
                {TIME_EXCEPTION_STATUS_LABELS[item.status]}
              </Badge>
            </div>
            <Input
              aria-label={`Note for ${label}`}
              placeholder="Note (required for company work)"
              value={note}
              onChange={(e) => setNotes((current) => ({ ...current, [item.id]: e.target.value }))}
              className="h-8 text-[13px]"
            />
            {/* type="button" keeps these from submitting the surrounding attendance form. */}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={decide.isPending || !note.trim()}
                onClick={() => save(item.id, "approved_official")}
              >
                <Briefcase className="size-3.5" /> Company work
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={decide.isPending}
                onClick={() => save(item.id, "approved_excused")}
              >
                <Check className="size-3.5" /> Excuse
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={decide.isPending}
                onClick={() => save(item.id, "rejected")}
              >
                <X className="size-3.5" /> Reject
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
