import { createFileRoute } from "@tanstack/react-router";
import { sql } from "drizzle-orm";
import { db } from "@/db";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        try {
          await db.execute(sql`SELECT 1`);
          return Response.json(
            {
              status: "ok",
              checks: {
                postgres: "ok",
              },
              timestamp: new Date().toISOString(),
            },
            { status: 200 },
          );
        } catch (error) {
          return Response.json(
            {
              status: "error",
              checks: {
                postgres: "error",
              },
              error: error instanceof Error ? error.message : "Unknown error",
              timestamp: new Date().toISOString(),
            },
            { status: 503 },
          );
        }
      },
    },
  },
});
