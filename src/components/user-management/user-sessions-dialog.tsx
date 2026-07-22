import { ResponsiveDialog } from "@/components/custom/responsive-dialog";
import { UserSessionsList } from "./user-sessions-list";
import { MonitorDot } from "lucide-react";
import { ManagedUser } from "./types";

type Props = {
  sessionsUser: ManagedUser | null;
  onOpenChange: (open: boolean) => void;
};

export const UserSessionsDialog = ({ sessionsUser, onOpenChange }: Props) => {
  return (
    <ResponsiveDialog
      open={!!sessionsUser}
      onOpenChange={onOpenChange}
      title="Active Sessions"
      description={`Inspect and revoke active device sessions for ${sessionsUser?.email ?? ""}.`}
      className="max-w-xl w-full rounded-none shadow-none border-border/60 bg-card/95 p-0"
      icon={MonitorDot}
    >
      {sessionsUser && <UserSessionsList userId={sessionsUser.id} />}
    </ResponsiveDialog>
  );
};
