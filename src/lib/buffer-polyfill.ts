import { Buffer } from "buffer";

/**
 * Provide a browser-side Buffer polyfill.
 *
 * Some Node-first dependencies (e.g. pg/crypto utilities) are referenced during
 * module initialization even when they only execute on the server. TanStack Start
 * normally strips server-only code from the client bundle, but during development
 * Vite may evaluate those modules before the framework transform applies. This
 * polyfill prevents "Buffer is not defined" runtime errors in those cases.
 */
export function installBufferPolyfill(): void {
  if (typeof window === "undefined") return;

  const w = window as typeof window & { Buffer?: typeof Buffer };
  if (!w.Buffer) {
    w.Buffer = Buffer;
  }
}

installBufferPolyfill();
