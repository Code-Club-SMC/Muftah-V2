import { Suspense } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { GenericLoader } from "@/components/custom/generic-loader";
import { OfflineAttendancePage } from "@/components/hr/attendance/offline/offline-attendance-page";
import { offlineAttendanceKeys } from "@/hooks/hr/use-offline-attendance";
import {
  listOfflineAttendanceOperatorsFn,
  listOfflineAttendanceWorkbooksFn,
} from "@/server-functions/hr/attendance/offline-workbooks-fn";
import { getOfflineImportQueuesFn } from "@/server-functions/hr/attendance/offline-review-fn";

export const Route = createFileRoute("/_protected/hr/attendance/offline")({
  loader: async ({ context }) => {
    void context.queryClient.prefetchQuery({
      queryKey: offlineAttendanceKeys.workbooks(),
      queryFn: () => listOfflineAttendanceWorkbooksFn(),
    });
    void context.queryClient.prefetchQuery({
      queryKey: offlineAttendanceKeys.operators(),
      queryFn: () => listOfflineAttendanceOperatorsFn(),
    });
    void context.queryClient.prefetchQuery({
      queryKey: offlineAttendanceKeys.queues(),
      queryFn: () => getOfflineImportQueuesFn(),
    });
  },
  component: OfflineAttendanceRoute,
});

function OfflineAttendanceRoute() {
  return (
    <Suspense
      fallback={
        <GenericLoader
          title="Loading offline attendance"
          description="Please wait while workbook and import queues load"
          className="my-auto"
        />
      }
    >
      <OfflineAttendancePage />
    </Suspense>
  );
}
