import { authClient } from "@/lib/auth-client";
import { ROLE_BADGE_STYLES } from "@/lib/rbac";
import { cn } from "@/lib/utils";
import { useViewerAccess } from "@/hooks/use-viewer-access";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { SidebarMenu, SidebarMenuItem } from "../ui/sidebar";
import { LogOut, Loader2, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export function NavUser() {
  const { data: viewerAccess, isPending } = useViewerAccess();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await authClient.signOut({
        fetchOptions: {
          onSuccess: () => {
            toast.success("Signed out successfully");
            window.location.href = "/login";
          },
          onError: (ctx) => {
            toast.error(ctx.error.message || "Failed to sign out");
            setIsLoggingOut(false);
          },
        },
      });
    } catch (error: any) {
      toast.error(error.message || "An unexpected error occurred");
      setIsLoggingOut(false);
    }
  };

  // ── Skeleton ───────────────────────────────────────────────────────────────
  if (isPending) {
    return (
      <div className="space-y-2 px-1 animate-pulse">
        <div className="h-16 rounded-xl bg-white/5" />
        <div className="h-10 rounded-xl bg-white/5" />
      </div>
    );
  }

  if (!viewerAccess) return null;

  const { role, user } = viewerAccess;
  const initials = user.name
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <SidebarMenu className="gap-2">
      {/* ── User card ────────────────────────────────────────────────────── */}
      <SidebarMenuItem>
        <div
          className="
            relative overflow-hidden
            flex items-center gap-3 px-3 py-3 rounded-xl
            group-data-[collapsible=icon]:justify-center
            group-data-[collapsible=icon]:px-0
            group-data-[collapsible=icon]:py-0
            group-data-[collapsible=icon]:bg-transparent
            transition-all duration-200
          "
          style={{
            background:
              "linear-gradient(135deg, rgba(79,70,229,0.25) 0%, rgba(55,48,163,0.15) 100%)",
            border: "1px solid rgba(99,102,241,0.3)",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06)",
          }}
        >
          {/* Subtle shimmer in top-right */}
          <div
            className="absolute -top-6 -right-6 w-20 h-20 rounded-full pointer-events-none group-data-[collapsible=icon]:hidden"
            style={{
              background:
                "radial-gradient(circle, rgba(99,102,241,0.18) 0%, transparent 70%)",
            }}
          />

          {/* Avatar */}
          <Avatar
            className="size-9 rounded-xl shrink-0"
            style={{
              boxShadow:
                "0 0 0 2px rgba(99,102,241,0.5), 0 0 0 4px rgba(99,102,241,0.15)",
            }}
          >
            <AvatarImage src={user.image || ""} alt={user.name} />
            <AvatarFallback
              className="rounded-xl text-[13px] font-bold text-white"
              style={{
                background: "linear-gradient(135deg, #4f46e5, #6366f1)",
              }}
            >
              {initials}
            </AvatarFallback>
          </Avatar>

          {/* Name, email, role — stacked so email never truncates */}
          <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
            <p
              className="text-[13.5px] font-semibold truncate leading-none"
              style={{ color: "#e0e7ff" }}
            >
              {user.name}
            </p>
            <p
              className="text-[11px] mt-1.5 leading-none break-all"
              style={{ color: "rgba(165,180,252,0.65)" }}
            >
              {user.email}
            </p>
            <span
              className={cn(
                "mt-2 inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] font-bold uppercase ",
                ROLE_BADGE_STYLES[role.slug] ??
                  "border-white/10 bg-white/5 text-indigo-100",
              )}
            >
              <ShieldCheck className="size-2.5" />
              {role.name}
            </span>
          </div>
        </div>
      </SidebarMenuItem>

      {/* ── Logout button ────────────────────────────────────────────────── */}
      <SidebarMenuItem>
        <button
          onClick={handleLogout}
          disabled={isLoggingOut}
          className="
            w-full flex items-center gap-3 px-3 h-10 rounded-xl
            transition-all duration-150 group/logout
            group-data-[collapsible=icon]:justify-center
            group-data-[collapsible=icon]:px-0
            disabled:opacity-40 disabled:cursor-not-allowed
          "
          style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
            color: "rgba(165,180,252,0.7)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(239,68,68,0.12)";
            e.currentTarget.style.borderColor = "rgba(239,68,68,0.25)";
            e.currentTarget.style.color = "#f87171";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(255,255,255,0.04)";
            e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)";
            e.currentTarget.style.color = "rgba(165,180,252,0.7)";
          }}
        >
          {isLoggingOut ? (
            <Loader2
              className="size-4 shrink-0 animate-spin"
              style={{ color: "#f87171" }}
            />
          ) : (
            <LogOut className="size-4 shrink-0 transition-colors duration-150" />
          )}
          <span className="text-[12px] font-semibold uppercase  group-data-[collapsible=icon]:hidden">
            {isLoggingOut ? "Signing out…" : "Log out"}
          </span>
        </button>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
