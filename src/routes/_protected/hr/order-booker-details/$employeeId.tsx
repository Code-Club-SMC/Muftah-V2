import { createFileRoute } from "@tanstack/react-router";
import { getEmployeeAttendanceLogFn } from "@/server-functions/hr/attendance/get-employee-attendance-log-fn";
import { attendanceLogRange } from "@/lib/attendance/log-range";
import { z } from "zod";
import { OrderBookerLogView } from "@/components/hr/attendance/order-booker-log-view";

const searchSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});

export const Route = createFileRoute("/_protected/hr/order-booker-details/$employeeId")({
  validateSearch: searchSchema,
  loaderDeps: ({ search: { from, to } }) => ({ from, to }),
  loader: async ({ params, context, deps }) => {
    const range = attendanceLogRange();
    const startDate = deps.from || range.startDate;
    const endDate = deps.to || range.endDate;

    void context.queryClient.prefetchQuery({
      queryKey: [
        "employee-attendance-log",
        params.employeeId,
        startDate,
        endDate,
      ],
      queryFn: () =>
        getEmployeeAttendanceLogFn({
          data: { employeeId: params.employeeId, startDate, endDate },
        }),
      gcTime: 0,
    });
  },
  component: OrderBookerLogView,
});
