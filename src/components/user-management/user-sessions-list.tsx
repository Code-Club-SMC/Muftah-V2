import { useUsers } from "@/hooks/use-users";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import {
  Loader2,
  MonitorX,
  Laptop,
  Tablet,
  Smartphone,
  HelpCircle,
  WifiOff,
} from "lucide-react";
import { Session } from "better-auth";

type Props = { userId: string };

export const UserSessionsList = ({ userId }: Props) => {
  const { listUserSessions, revokeUserSession, revokeAllUserSessions } = useUsers();
  const { data: sessions, isLoading } = listUserSessions(userId, true);

  const getDeviceIcon = (userAgent?: string) => {
    if (!userAgent) return <HelpCircle className="size-4 text-muted-foreground/40" />;
    const ua = userAgent.toLowerCase();
    if (ua.includes("mobi") || ua.includes("android") || ua.includes("iphone"))
      return <Smartphone className="size-4 text-muted-foreground/60" />;
    if (ua.includes("tablet") || ua.includes("ipad"))
      return <Tablet className="size-4 text-muted-foreground/60" />;
    return <Laptop className="size-4 text-muted-foreground/60" />;
  };

  return (
    <div className="space-y-3 pt-2">
      {/* Header row */}
      {sessions && sessions.length > 0 && (
        <div className="flex items-center justify-between px-0.5">
          <span className="text-[11px] text-muted-foreground/50 font-medium">
            {sessions.length} active session{sessions.length !== 1 ? "s" : ""}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2.5 text-[11px] font-semibold text-destructive hover:bg-destructive/8 hover:text-destructive"
            onClick={() => revokeAllUserSessions.mutate({ userId })}
            disabled={revokeAllUserSessions.isPending}
          >
            {revokeAllUserSessions.isPending ? (
              <><Loader2 className="mr-1.5 size-3 animate-spin" />Revoking…</>
            ) : "Revoke All"}
          </Button>
        </div>
      )}

      {/* Session list */}
      <div className="space-y-2 max-h-[340px] overflow-y-auto pr-0.5">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2.5 text-muted-foreground/40">
            <Loader2 className="animate-spin size-5" />
            <span className="text-[11px] font-medium">Syncing sessions…</span>
          </div>
        ) : sessions && sessions.length > 0 ? (
          sessions.map((session: Session) => (
            <div
              key={session.token}
              className="group flex items-center justify-between p-3 rounded-none border border-border/50 bg-muted/20 hover:bg-muted/40 hover:border-border/80 transition-all"
            >
              <div className="flex items-center gap-3 min-w-0">
                {/* Device icon */}
                <div className="size-8 shrink-0 rounded-none border border-border/50 bg-background flex items-center justify-center group-hover:border-primary/20 transition-colors">
                  {getDeviceIcon(session.userAgent!)}
                </div>
                <div className="flex flex-col min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-[12px] truncate max-w-[160px]">
                      {session.userAgent
                        ? session.userAgent.length > 40
                          ? session.userAgent.slice(0, 40) + "…"
                          : session.userAgent
                        : "Unknown Device"}
                    </span>
                    {session.ipAddress && (
                      <span className="shrink-0 font-mono text-[9.5px] text-muted-foreground/55 bg-muted px-1.5 py-0.5 rounded-none border border-border/40">
                        {session.ipAddress}
                      </span>
                    )}
                  </div>
                  <span className="text-[10.5px] text-muted-foreground/55">
                    Active since {format(new Date(session.createdAt), "MMM d, h:mm a")}
                  </span>
                </div>
              </div>

              {/* Revoke button — visible on hover */}
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0 rounded-none text-muted-foreground/30 hover:text-destructive hover:bg-destructive/8 opacity-0 group-hover:opacity-100 transition-all"
                onClick={() => revokeUserSession.mutate({ sessionToken: session.token })}
                disabled={revokeUserSession.isPending}
              >
                <MonitorX className="size-3.5" />
              </Button>
            </div>
          ))
        ) : (
          <div className="flex flex-col items-center justify-center py-14 px-4 text-center rounded-none border border-dashed border-border/50 bg-muted/10">
            <div className="size-10 rounded-none bg-muted/60 flex items-center justify-center mb-3">
              <WifiOff className="size-4 text-muted-foreground/40" />
            </div>
            <p className="text-[12px] font-semibold text-muted-foreground/60">No active sessions</p>
            <p className="text-[11px] text-muted-foreground/40 mt-0.5">
              This user has no open login sessions.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};