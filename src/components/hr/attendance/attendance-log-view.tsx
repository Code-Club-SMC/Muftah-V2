import { DatePicker } from "@/components/custom/date-picker";
import { EmployeeAttendanceLog } from "@/components/hr/attendance/employee-attendance-log";
import { Button } from "@/components/ui/button";
import { GenericLoader } from "@/components/custom/generic-loader";
import { format, parseISO, startOfMonth, endOfMonth } from "date-fns";
import { ArrowLeft, CalendarRange, Check, FilterX } from "lucide-react";
import { useState, useEffect, Suspense } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearch,
} from "@tanstack/react-router";

export const AttendanceLogView = () => {
  const { employeeId } = useParams({
    from: "/_protected/hr/attendance/$employeeId",
  });
  const { from, to } = useSearch({
    from: "/_protected/hr/attendance/$employeeId",
  });
  const navigate = useNavigate({ from: "/hr/attendance/$employeeId" });

  const today = new Date();
  const defaultStart = format(startOfMonth(today), "yyyy-MM-dd");
  const defaultEnd = format(endOfMonth(today), "yyyy-MM-dd");

  // Local state for filters
  const [localFrom, setLocalFrom] = useState(from || defaultStart);
  const [localTo, setLocalTo] = useState(to || defaultEnd);

  // Sync local state if search params change (e.g. on clear)
  useEffect(() => {
    setLocalFrom(from || defaultStart);
    setLocalTo(to || defaultEnd);
  }, [from, to]);

  const handleApply = () => {
    navigate({
      search: (prev) => ({
        ...prev,
        from: localFrom === defaultStart ? undefined : localFrom,
        to: localTo === defaultEnd ? undefined : localTo,
      }),
    });
  };

  const handleClear = () => {
    setLocalFrom(defaultStart);
    setLocalTo(defaultEnd);
    navigate({ search: { from: undefined, to: undefined } });
  };

  const isDirty =
    localFrom !== (from || defaultStart) || localTo !== (to || defaultEnd);

  return (
    <div className="p-8 pt-6 space-y-8 animate-in fade-in duration-500">
      {/* Action Bar / Filter */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 bg-secondary p-5 rounded-2xl border">
        <div className="flex items-start gap-4 mt-1">
          <Button
            variant="outline"
            size="icon"
            className="h-10 w-10 shrink-0 rounded-xl bg-background transition-transform hover:-translate-x-1"
            asChild
          >
            <Link to="/hr/attendance">
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <div className="space-y-1">
            <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
              <CalendarRange className="text-primary size-6" />
              Attendance Log
            </h1>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
              Monitoring productivity & attendance records
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-3 bg-muted/30 px-5 rounded-xl border border-dashed">
            <div className="flex items-center gap-2 px-3 border-r pr-4">
              <span className="text-[10px] font-black uppercase text-muted-foreground tracking-tighter">
                Start
              </span>
              <DatePicker
                date={parseISO(localFrom)}
                onChange={(d) => d && setLocalFrom(format(d, "yyyy-MM-dd"))}
                className="h-9 w-[160px] border-none bg-transparent hover:bg-white/50"
              />
            </div>
            <div className="flex items-center gap-2 px-3">
              <span className="text-[10px] font-black uppercase text-muted-foreground tracking-tighter">
                End
              </span>
              <DatePicker
                date={parseISO(localTo)}
                onChange={(d) => d && setLocalTo(format(d, "yyyy-MM-dd"))}
                className="h-9 w-[160px] border-none bg-transparent hover:bg-white/50"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button size="sm" onClick={handleApply} disabled={!isDirty}>
              <Check className="size-4 mr-2 stroke-3" />
              Apply Filters
            </Button>
            {(from || to) && (
              <Button variant="destructive" size="sm" onClick={handleClear}>
                <FilterX className="size-4 mr-2" />
                Reset
              </Button>
            )}
          </div>
        </div>
      </div>

      <Suspense fallback={<GenericLoader title="Loading Attendance Log..." />}>
        <EmployeeAttendanceLog
          employeeId={employeeId}
          startDate={from || defaultStart}
          endDate={to || defaultEnd}
        />
      </Suspense>
    </div>
  );
};
