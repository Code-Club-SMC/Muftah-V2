import { createFileRoute } from "@tanstack/react-router";
import { getSalesmanActivityLogFn } from "@/server-functions/hr/attendance/get-salesman-activity-log-fn";
import { attendanceLogRange } from "@/lib/attendance/log-range";
import { z } from "zod";
import { SalesmanLogView } from "@/components/hr/attendance/salesman-log-view";

const searchSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});

export const Route = createFileRoute("/_protected/hr/salesman-details/$employeeId")({
  validateSearch: searchSchema,
  loaderDeps: ({ search: { from, to } }) => ({ from, to }),
  loader: async ({ params, context, deps }) => {
    const range = attendanceLogRange();
    const startDate = deps.from || range.startDate;
    const endDate = deps.to || range.endDate;

    void context.queryClient.prefetchQuery({
      queryKey: [
        "salesman-activity-log",
        params.employeeId,
        startDate,
        endDate,
      ],
      queryFn: () =>
        getSalesmanActivityLogFn({
          data: { employeeId: params.employeeId, startDate, endDate },
        }),
      gcTime: 0,
    });
  },
  component: SalesmanLogView,
});
