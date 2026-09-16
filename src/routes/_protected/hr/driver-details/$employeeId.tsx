import { createFileRoute } from "@tanstack/react-router";
import { getDriverActivityLogFn } from "@/server-functions/hr/attendance/get-driver-activity-log-fn";
import { format, startOfMonth, endOfMonth } from "date-fns";
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
    const today = new Date();
    const startDate = deps.from || format(startOfMonth(today), "yyyy-MM-dd");
    const endDate = deps.to || format(endOfMonth(today), "yyyy-MM-dd");

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
