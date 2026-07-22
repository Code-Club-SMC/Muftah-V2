import { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  MoreHorizontal,
  UserCog,
  ShieldAlert,
  ShieldCheck,
  Monitor,
  Trash2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

export type User = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string | null;
  createdAt: Date;
  updatedAt: Date;
  role?: string | null;
  banned?: boolean | null;
};

export type UserAction = "update" | "sessions" | "ban" | "delete";

// ── Role config ────────────────────────────────────────────────────────────────

const roleConfig: Record<string, { label: string; className: string }> = {
  "super-admin": {
    label: "Super Admin",
    className: "border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400",
  },
  admin: {
    label: "Admin",
    className: "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400",
  },
  "finance-manager": {
    label: "Finance",
    className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  operator: {
    label: "Operator",
    className: "border-orange-500/30 bg-orange-500/10 text-orange-600 dark:text-orange-400",
  },
};

// ── Actions cell ───────────────────────────────────────────────────────────────

const ActionsCell = ({
  user,
  onAction,
}: {
  user: User;
  onAction: (user: User, action: UserAction) => void;
}) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button
        variant="ghost"
        size="icon"
        className="size-7 rounded-lg text-muted-foreground/50 hover:text-foreground hover:bg-muted transition-all"
      >
        <span className="sr-only">Open menu</span>
        <MoreHorizontal className="size-3.5" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-52 p-1.5 rounded-xl">
      <DropdownMenuLabel className="px-2 py-1.5 text-[10px] font-bold uppercase  text-muted-foreground/50">
        Actions
      </DropdownMenuLabel>
      <DropdownMenuSeparator className="my-1" />

      <DropdownMenuItem
        onClick={() => onAction(user, "update")}
        className="rounded-lg gap-2.5 cursor-pointer py-2 px-2.5"
      >
        <div className="size-6 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
          <UserCog className="size-3.5 text-primary" />
        </div>
        <div className="flex flex-col">
          <span className="font-medium text-[12.5px]">Edit Profile</span>
          <span className="text-[10px] text-muted-foreground">Name, email & role</span>
        </div>
      </DropdownMenuItem>

      <DropdownMenuItem
        onClick={() => onAction(user, "sessions")}
        className="rounded-lg gap-2.5 cursor-pointer py-2 px-2.5"
      >
        <div className="size-6 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
          <Monitor className="size-3.5 text-primary" />
        </div>
        <div className="flex flex-col">
          <span className="font-medium text-[12.5px]">Sessions</span>
          <span className="text-[10px] text-muted-foreground">View active devices</span>
        </div>
      </DropdownMenuItem>

      <DropdownMenuItem
        onClick={() => onAction(user, "ban")}
        className="rounded-lg gap-2.5 cursor-pointer py-2 px-2.5"
      >
        <div
          className={cn(
            "size-6 rounded-md flex items-center justify-center shrink-0",
            user.banned ? "bg-emerald-500/10" : "bg-orange-500/10",
          )}
        >
          {user.banned ? (
            <ShieldCheck className="size-3.5 text-emerald-600" />
          ) : (
            <ShieldAlert className="size-3.5 text-orange-500" />
          )}
        </div>
        <div className="flex flex-col">
          <span className="font-medium text-[12.5px]">
            {user.banned ? "Unban Account" : "Ban Account"}
          </span>
          <span className="text-[10px] text-muted-foreground">Access control</span>
        </div>
      </DropdownMenuItem>

      <DropdownMenuSeparator className="my-1" />

      <DropdownMenuItem
        onClick={() => onAction(user, "delete")}
        className="rounded-lg gap-2.5 cursor-pointer py-2 px-2.5 text-destructive focus:text-destructive focus:bg-destructive/8"
      >
        <div className="size-6 rounded-md bg-destructive/10 flex items-center justify-center shrink-0">
          <Trash2 className="size-3.5 text-destructive" />
        </div>
        <div className="flex flex-col">
          <span className="font-medium text-[12.5px]">Delete User</span>
          <span className="text-[10px] opacity-60">Permanent removal</span>
        </div>
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
);

// ── Column definitions ─────────────────────────────────────────────────────────

export const columns = (
  onAction: (user: User, action: UserAction) => void,
): ColumnDef<User>[] => [
    {
      accessorKey: "user",
      header: "User",
      cell: ({ row }) => {
        const user = row.original;
        const initials = user.name
          .split(" ")
          .map((n) => n[0])
          .join("")
          .toUpperCase()
          .slice(0, 2);
        return (
          <div className="flex items-center gap-3 py-1">
            <Avatar className="size-8 border border-border/60 shrink-0">
              <AvatarImage src={user.image || ""} alt={user.name} />
              <AvatarFallback className="bg-primary/10 text-primary text-[11px] font-bold">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-col min-w-0">
              <span className="font-semibold text-[13px] tracking-tight truncate">
                {user.name}
              </span>
              <span className="text-[11px] text-muted-foreground/65 font-mono truncate">
                {user.email}
              </span>
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "role",
      header: "Role",
      cell: ({ row }) => {
        const role = row.original.role || "user";
        const config = roleConfig[role] ?? {
          label: role,
          className: "border-muted-foreground/20 bg-muted/40 text-muted-foreground",
        };
        return (
          <Badge
            variant="outline"
            className={cn("text-[10.5px] font-semibold px-2 h-5 rounded-md", config.className)}
          >
            {config.label}
          </Badge>
        );
      },
    },
    {
      accessorKey: "emailVerified",
      header: "Verified",
      cell: ({ row }) => {
        const verified = row.original.emailVerified;
        return (
          <div className="flex items-center gap-1.5">
            <div
              className={cn(
                "size-1.5 rounded-full",
                verified
                  ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]"
                  : "bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.5)]",
              )}
            />
            <span
              className={cn(
                "text-[11px] font-medium",
                verified ? "text-emerald-600" : "text-amber-600",
              )}
            >
              {verified ? "Verified" : "Pending"}
            </span>
          </div>
        );
      },
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => {
        const isBanned = row.original.banned;
        return (
          <div className="flex items-center gap-1.5">
            <div
              className={cn(
                "size-1.5 rounded-full",
                isBanned
                  ? "bg-destructive shadow-[0_0_6px_rgba(239,68,68,0.5)]"
                  : "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]",
              )}
            />
            <span
              className={cn(
                "text-[11px] font-medium",
                isBanned ? "text-destructive/80" : "text-emerald-600",
              )}
            >
              {isBanned ? "Banned" : "Active"}
            </span>
          </div>
        );
      },
    },
    {
      accessorKey: "createdAt",
      header: "Joined",
      cell: ({ row }) => (
        <span className="text-[11px] text-muted-foreground/55 font-mono">
          {format(new Date(row.original.createdAt), "dd MMM yyyy")}
        </span>
      ),
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <div className="flex justify-end">
          <ActionsCell user={row.original} onAction={onAction} />
        </div>
      ),
    },
  ];