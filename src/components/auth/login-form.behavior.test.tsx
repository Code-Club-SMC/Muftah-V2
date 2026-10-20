import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { LoginForm } from "./login-form";

const mocks = vi.hoisted(() => ({
  hydrated: false,
  signIn: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
  useHydrated: () => mocks.hydrated,
  Link: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: { signIn: { email: mocks.signIn } },
}));
vi.mock("@/server-functions/auth/resolve-post-login-destination-fn", () => ({
  resolvePostLoginDestinationFn: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: mocks.error, success: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.hydrated = false;
  mocks.signIn.mockResolvedValue({
    error: { message: "Test credentials rejected" },
  });
});

describe("login hydration safety", () => {
  it("keeps server-rendered credential inputs and submission disabled and uses POST", () => {
    const { container } = render(<LoginForm />);
    expect(
      (container.querySelector('input[name="email"]') as HTMLInputElement)
        .disabled,
    ).toBe(true);
    expect(
      (container.querySelector('input[name="password"]') as HTMLInputElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Sign in" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(container.querySelector("form")?.getAttribute("method")).toBe(
      "post",
    );
    expect(mocks.signIn).not.toHaveBeenCalled();
  });
  it("enables the hydrated form and submits credentials through Better Auth", async () => {
    mocks.hydrated = true;
    const { container } = render(<LoginForm />);
    fireEvent.change(container.querySelector('input[name="email"]')!, {
      target: { value: "browser-test@example.test" },
    });
    fireEvent.change(container.querySelector('input[name="password"]')!, {
      target: { value: "test-password-value" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() =>
      expect(mocks.signIn).toHaveBeenCalledWith({
        email: "browser-test@example.test",
        password: "test-password-value",
      }),
    );
    expect(mocks.error).toHaveBeenCalledWith("Test credentials rejected");
  });
});
