import { createFileRoute } from "@tanstack/react-router";
import {
  hasValidBootstrapSecret,
  isPublicSignupEnabled,
} from "@/lib/admin-bootstrap";
import { auth } from "@/lib/auth";

function isSignUpEmailRequest(request: Request) {
  if (request.method !== "POST") {
    return false;
  }

  const pathname = new URL(request.url).pathname;
  return pathname.endsWith("/sign-up/email");
}

function rejectPublicSignUp() {
  return Response.json({ error: "Not Found" }, { status: 404 });
}

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        return await auth.handler(request);
      },
      POST: async ({ request }: { request: Request }) => {
        if (
          isSignUpEmailRequest(request) &&
          !isPublicSignupEnabled() &&
          !hasValidBootstrapSecret(request)
        ) {
          return rejectPublicSignUp();
        }

        return await auth.handler(request);
      },
    },
  },
});
