import { createFileRoute } from "@tanstack/react-router";
import { getDriverActivityLogFn } from "@/server-functions/hr/attendance/get-driver-activity-log-fn";
import { attendanceLogRange } from "@/lib/attendance/log-range";
import { z } from "zod";
import { DriverLogView } from "@/components/hr/attendance/driver-log-view";

const searchSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});

export const Route = createFileRoute("/_protected/hr/driver-details/$employeeId")({
  validateSearch: searchSchema,
  loaderDeps: ({ search: { from, to } }) => ({ from, to }),
  loader: async ({ params, context, deps }) => {
    const range = attendanceLogRange();
    const startDate = deps.from || range.startDate;
    const endDate = deps.to || range.endDate;

    void context.queryClient.prefetchQuery({
      queryKey: [
        "driver-activity-log",
        params.employeeId,
        startDate,
        endDate,
      ],
      queryFn: () =>
        getDriverActivityLogFn({
          data: { employeeId: params.employeeId, startDate, endDate },
        }),
      gcTime: 0,
    });
  },
  component: DriverLogView,
});
