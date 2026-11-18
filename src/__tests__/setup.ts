import { vi } from "vitest";

process.env.DATABASE_URL ||=
  "postgresql://postgres:postgres@localhost:5433/titan_test";

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// jsdom has no ResizeObserver; Radix (for example Checkbox) needs it.
if (!("ResizeObserver" in window)) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(window, "ResizeObserver", { configurable: true, writable: true, value: ResizeObserverStub });
  Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, writable: true, value: ResizeObserverStub });
}
