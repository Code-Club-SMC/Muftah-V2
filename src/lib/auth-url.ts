const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");

export function getAuthBaseUrl() {
  if (typeof window !== "undefined") {
    return trimTrailingSlash(window.location.origin);
  }

  const envUrl = process.env.BETTER_AUTH_URL?.trim();
  return envUrl ? trimTrailingSlash(envUrl) : undefined;
}

export function getAbsoluteAuthUrl(pathname: string) {
  const baseUrl = getAuthBaseUrl();
  if (!baseUrl) {
    return pathname;
  }

  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${baseUrl}${normalizedPath}`;
}
