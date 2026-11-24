import { useEffect, useState, type ComponentProps } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { format, parseISO } from "date-fns";
import { Edit2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useViewerAccess } from "@/hooks/use-viewer-access";
import { nowPKTDate } from "@/lib/attendance/time";
import { hasPermission } from "@/lib/rbac";
import { getDailyAttendanceFn } from "@/server-functions/hr/attendance/get-daily-attendance-fn";
import { EditAttendanceSheet } from "./edit-attendance-sheet";

type FieldDay = {
  date: string;
  isRestDay: boolean;
  attendanceStatus: string | null;
};

/** Edit button column and attendance form for the order booker, salesman and driver logs. */
export function useFieldDayEditor<T extends FieldDay>(employee: {
  id: string;
  joiningDate: string;
}) {
  const { data: viewer } = useViewerAccess();
  const canManage = hasPermission(viewer?.permissions ?? [], "hr.manage");
  const today = nowPKTDate();
  const [editDate, setEditDate] = useState<string | null>(null);
  // The logs show only part of a day's record. The form needs all of it, or saving would lose the rest.
  const daily = useQuery({
    queryKey: ["daily-attendance", editDate],
    queryFn: () => getDailyAttendanceFn({ data: { date: editDate! } }),
    enabled: canManage && editDate !== null,
    staleTime: 0,
  });
  const editEmployee = daily.isFetching
    ? undefined
    : daily.data?.find((row) => row.id === employee.id);
  useEffect(() => {
    if (!editDate || daily.isFetching || editEmployee) return;
    if (!daily.isError && !daily.data) return;
    toast.error(
      daily.isError
        ? "Unable to load this day. Please try again."
        : "This employee is no longer active, so the day can't be edited here.",
    );
    setEditDate(null);
  }, [editDate, daily.isFetching, daily.isError, daily.data, editEmployee]);

  const columns: ColumnDef<T>[] = canManage
    ? [
        {
          id: "actions",
          header: () => <div className="text-right">Action</div>,
          cell: ({ row }) => {
            const day = row.original;
            if (day.date > today || day.date < employee.joiningDate) return null;
            // An unworked rest day needs no decision.
            if (day.isRestDay && !day.attendanceStatus) return null;
            return (
              <div className="flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={editDate !== null}
                  aria-label={`Edit attendance on ${format(parseISO(day.date), "dd MMM yyyy")}`}
                  onClick={() => setEditDate(day.date)}
                >
                  {editDate === day.date && daily.isFetching ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Edit2 className="size-3.5" />
                  )}
                  {day.attendanceStatus ? "Edit" : "Mark"}
                </Button>
              </div>
            );
          },
        },
      ]
    : [];

  const sheet =
    editDate && editEmployee ? (
      <EditAttendanceSheet
        key={editDate}
        open
        onOpenChange={(open) => {
          if (!open) setEditDate(null);
        }}
        employee={editEmployee}
        attendance={
          editEmployee.attendance[0] as ComponentProps<
            typeof EditAttendanceSheet
          >["attendance"]
        }
        date={editDate}
      />
    ) : null;

  return { columns, sheet };
}
