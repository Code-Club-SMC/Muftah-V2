import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  "src/server-functions/hr/attendance/device-import-fn.ts",
  "utf8",
);
const actions = [
  "uploadDeviceAttendanceFn",
  "previewDeviceAttendanceFn",
  "confirmDeviceAttendanceFn",
  "listDeviceAttendanceImportsFn",
];
function definition(name: string) {
  return source
    .slice(source.indexOf(`export const ${name}`))
    .split(/\nexport const /)[0];
}

describe("device report RPC permission boundaries", () => {
  it.each(actions)("requires HR management permission for %s", (name) => {
    expect(definition(name)).toContain(
      ".middleware([requireHrManageMiddleware])",
    );
  });
  it("uses POST for uploads, mappings and confirmation, with the actor from the session", () => {
    for (const action of actions.slice(0, 3)) {
      expect(definition(action)).toContain(
        'createServerFn({ method: "POST" })',
      );
    }
    expect(definition("uploadDeviceAttendanceFn")).toContain(
      "context.session.user.id",
    );
    expect(definition("confirmDeviceAttendanceFn")).toContain(
      "context.session.user.id",
    );
    expect(definition("listDeviceAttendanceImportsFn")).toContain(
      'createServerFn({ method: "GET" })',
    );
  });
});
