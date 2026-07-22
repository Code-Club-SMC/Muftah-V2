import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";
import { UsersTable } from "@/components/user-management/users-table";
import { adminGetUsersFn } from "@/server-functions/user-management/super-admin-get-users-fn";

export const Route = createFileRoute("/_protected/user-management/")({
  component: RouteComponent,
  loader: async ({ context }) => {
    void context.queryClient.prefetchQuery({
      queryKey: ["admin-users"],
      queryFn: () => adminGetUsersFn(),
      staleTime: Infinity,
    });
  },
});

// ── Loading Skeleton ─────────────────────────────────────────────────────────
function PageSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header skeleton */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-5 w-44 animate-pulse rounded-lg bg-muted" />
          <div className="h-3.5 w-64 animate-pulse rounded-lg bg-muted" />
        </div>
        <div className="flex gap-2">
          <div className="h-9 w-28 animate-pulse rounded-lg bg-muted" />
          <div className="h-9 w-28 animate-pulse rounded-lg bg-muted" />
        </div>
      </div>

      {/* Stat cards skeleton */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="bg-card border border-border/60 rounded-xl p-5 space-y-3"
          >
            <div className="flex items-start justify-between">
              <div className="space-y-1.5">
                <div className="h-3 w-20 animate-pulse rounded-md bg-muted" />
                <div className="h-8 w-12 animate-pulse rounded-md bg-muted" />
                <div className="h-2.5 w-28 animate-pulse rounded-md bg-muted" />
              </div>
              <div className="h-10 w-10 animate-pulse rounded-lg bg-muted" />
            </div>
          </div>
        ))}
      </div>

      {/* Table card skeleton */}
      <div className="bg-card border border-border/60 rounded-xl overflow-hidden">
        <div className="flex items-center gap-4 px-4 py-3 border-b border-border/50">
          <div className="h-8 w-16 animate-pulse rounded-md bg-muted" />
          <div className="h-8 w-16 animate-pulse rounded-md bg-muted" />
          <div className="h-8 w-24 animate-pulse rounded-md bg-muted" />
          <div className="ml-auto flex gap-2">
            <div className="h-8 w-28 animate-pulse rounded-lg bg-muted" />
            <div className="h-8 w-44 animate-pulse rounded-lg bg-muted" />
          </div>
        </div>
        <div className="divide-y divide-border/30">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3.5">
              <div className="size-8 animate-pulse rounded-full bg-muted shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3.5 w-36 animate-pulse rounded-md bg-muted" />
                <div className="h-3 w-52 animate-pulse rounded-md bg-muted" />
              </div>
              <div className="h-5 w-20 animate-pulse rounded-full bg-muted" />
              <div className="h-4 w-16 animate-pulse rounded-md bg-muted" />
              <div className="h-3.5 w-24 animate-pulse rounded-md bg-muted" />
              <div className="h-8 w-8 animate-pulse rounded-lg bg-muted" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function RouteComponent() {
  return (
    <div className="space-y-6">
      <Suspense fallback={<PageSkeleton />}>
        <UsersTable />
      </Suspense>
    </div>
  );
}
