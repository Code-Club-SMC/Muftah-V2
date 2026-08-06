import { useEffect } from "react";
import { TERMINAL_HEARTBEAT_INTERVAL_MS } from "@/lib/attendance/offline/constants";
import { recordTerminalHeartbeatFn } from "@/server-functions/hr/attendance/terminal-heartbeat-fn";

export function useTerminalHeartbeat(isOnline: boolean) {
  useEffect(() => {
    if (!isOnline) return;

    let cancelled = false;

    const recordHeartbeat = () => {
      void recordTerminalHeartbeatFn().catch(() => {
        // Heartbeat is supporting evidence only. It must never break scanning.
      });
    };

    recordHeartbeat();
    const timer = window.setInterval(() => {
      if (!cancelled) recordHeartbeat();
    }, TERMINAL_HEARTBEAT_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [isOnline]);
}
