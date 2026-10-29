# Attendance RPC source review

Read-only investigation of the initial upload HTTP 500 recorded in `attendance-browser/2026-10-17T06-48-27-518Z/results.json`. No browser, database, or tests ran during this review. No application or dependency code changed.

The attendance RPC declarations have no identified export or declaration defect. `src/server-functions/hr/attendance/device-import-fn.ts` declares all four server functions normally. The installed compiler emits each suffixed handler in provider files, and the retained production asset `node_modules/.nitro/vite/services/ssr/assets/device-import-fn-z96BedMo.js` contains those handlers. The service's application imports do not lead back to the RPC module. Its only non-test caller is `src/hooks/hr/use-device-attendance.ts`.

The supplied server stack places the failure before payload parsing. `node_modules/@tanstack/start-server-core/src/server-functions-handler.ts:49` resolves the action, then line 53 reads `action.method`. Therefore that stack cannot be caused by the CSV parser, file validation, attendance service, or HR authorization rejecting this request.

The installed development resolver returns `mod[devServerFn.export]` without checking it at `node_modules/@tanstack/start-plugin-core/src/vite/start-compiler-plugin/plugin.ts:138-144`. Production resolution has a missing-export guard at `src/start-compiler/server-fn-resolver-module.ts:60-62` in the same package. The development and production resolution paths therefore differ.

Vite's installed module runner usually awaits an existing module promise. However, `node_modules/vite/dist/node/module-runner.js:1144-1154` returns `mod.exports` immediately when it detects a circular import, before checking `mod.promise`. Its `directRequest` registers both static and dynamic imports in the same imports/importers graph and assigns an initially empty exports object before evaluating the module.

A framework cycle follows directly from the installed entry points:

```text
device-import provider
  -> src/lib/middlewares.ts
  -> @tanstack/react-start/server
  -> @tanstack/react-start-server
  -> @tanstack/start-server-core
  -> createStartHandler
  -> server-functions-handler
  -> getServerFnById virtual resolver
  -> dynamic import of device-import provider
```

This gives a specific mechanism for the proposed cold concurrent-import failure. When one request is evaluating the provider and has registered its middleware import, another resolver request may detect the accumulated graph cycle and receive the provider's incomplete exports. Nitro uses this Vite `ModuleRunner` in `node_modules/nitro/dist/runtime/internal/vite/dev-worker.mjs:51`. This explanation is supported by source, but runtime confirmation of that branch is still required.

The UI permits overlap. `src/components/hr/attendance/device-import-sheet.tsx:73` starts the recent-import query when the sheet opens. Its `busy` expression at lines 99-103 excludes that query. The saved results record upload POST 500 and recent-import GET 200 by response completion order; they do not contain request-start times, so the record alone does not prove overlap.

The smallest next diagnostic is a cold and warm comparison, with temporary provider-specific logging at Vite's `cachedRequest` showing evaluated state, promise presence, export keys, and the three circular-import conditions. A cold failure where the circular branch returns incomplete exports, followed by warm success, would confirm the mechanism. Preserve the application code until that evidence is collected.
