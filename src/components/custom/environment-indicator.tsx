import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type EnvironmentKind = "production" | "staging" | "development" | "test" | "custom";

const clientEnv = import.meta.env as Record<string, string | boolean | undefined>;

const normalizeEnv = (value: string | boolean | undefined) =>
  String(value ?? "")
    .trim()
    .toLowerCase();

const toEnvironment = (raw: string) => {
  if (!raw) return null;

  if (raw === "production" || raw === "prod") {
    return { kind: "production" as EnvironmentKind, label: "PRODUCTION", value: raw };
  }

  if (raw === "staging" || raw === "stage") {
    return { kind: "staging" as EnvironmentKind, label: "STAGING", value: raw };
  }

  if (raw === "development" || raw === "dev") {
    return { kind: "development" as EnvironmentKind, label: "DEVELOPMENT", value: raw };
  }

  if (raw === "test") {
    return { kind: "test" as EnvironmentKind, label: "TEST", value: raw };
  }

  return {
    kind: "custom" as EnvironmentKind,
    label: raw.toUpperCase(),
    value: raw,
  };
};

const resolveFromHostname = () => {
  if (typeof window === "undefined") return null;

  const hostname = window.location.hostname.toLowerCase();

  if (hostname.includes("staging")) {
    return { kind: "staging" as EnvironmentKind, label: "STAGING", value: "staging" };
  }

  if (
    hostname === "localhost" ||
    hostname.startsWith("127.") ||
    hostname.startsWith("192.168.")
  ) {
    return { kind: "development" as EnvironmentKind, label: "DEVELOPMENT", value: "development" };
  }

  return null;
};

function resolveEnvironment() {
  const explicitEnv =
    normalizeEnv(clientEnv.VITE_APP_ENV) ||
    normalizeEnv(clientEnv.VITE_ENV) ||
    normalizeEnv(clientEnv.VITE_DEPLOY_ENV);

  const explicitMatch = toEnvironment(explicitEnv);
  if (explicitMatch) return explicitMatch;

  const hostMatch = resolveFromHostname();
  if (hostMatch) return hostMatch;

  const modeMatch = toEnvironment(normalizeEnv(import.meta.env.MODE));
  if (modeMatch) return modeMatch;

  return { kind: "custom" as EnvironmentKind, label: "UNKNOWN", value: "unknown" };
}

const envStyles: Record<EnvironmentKind, string> = {
  production:
    "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  staging:
    "border-amber-500/45 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  development:
    "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  test: "border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300",
  custom: "border-zinc-500/40 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
};

export function EnvironmentIndicator() {
  const env = resolveEnvironment();

  return (
    <Badge
      variant="outline"
      className={cn(
        "h-6 rounded-md px-2.5 font-semibold tracking-wide",
        envStyles[env.kind],
      )}
      title={`Current environment: ${env.label}`}
      aria-label={`Current environment: ${env.label}`}
    >
      ENV: {env.label}
    </Badge>
  );
}
