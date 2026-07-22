import { createServerFn } from "@tanstack/react-start";
import { requireHrManageMiddleware } from "@/lib/middlewares";

/**
 * Server function wrapper for UI previews.
 */
export const generateNextEmployeeCodeFn = createServerFn()
  .middleware([requireHrManageMiddleware])
  .handler(async () => {
    // Keep the generator module (which imports pg/db) out of the client bundle.
    // TanStack Start transforms server functions for the client, but top-level
    // imports of Node-only modules in the same file can still be evaluated by
    // Vite during dev. Dynamic import ensures this runs only on the server.
    const { generateNextEmployeeCode } = await import(
      "./employee-code-generator"
    );
    return generateNextEmployeeCode();
  });
