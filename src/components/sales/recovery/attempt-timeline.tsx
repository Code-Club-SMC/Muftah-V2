import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Phone,
  UserCheck,
  MessageSquare,
  FileText,
  MoreHorizontal,
  HandCoins,
} from "lucide-react";

type AttemptOutcome =
  | "no_answer"
  | "promised"
  | "partial_payment"
  | "refused"
  | "unreachable"
  | "resolved"
  | string;

type Attempt = {
  id: string;
  attemptMethod: string;
  attemptOutcome: AttemptOutcome;
  amountPromised?: string | null;
  promisedDate?: string | Date | null;
  notes?: string | null;
  attemptedAt: string | Date;
  assignedTo?: { name?: string | null } | null;
};

const METHOD_META: Record<string, { icon: React.ReactNode; label: string; tone: string }> = {
  call: {
    icon: <Phone className="size-3.5" />,
    label: "Call",
    tone: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300",
  },
  visit: {
    icon: <UserCheck className="size-3.5" />,
    label: "Visit",
    tone: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300",
  },
  whatsapp: {
    icon: <MessageSquare className="size-3.5" />,
    label: "WhatsApp",
    tone: "bg-green-100 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-300",
  },
  letter: {
    icon: <FileText className="size-3.5" />,
    label: "Letter",
    tone: "bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300",
  },
  other: {
    icon: <MoreHorizontal className="size-3.5" />,
    label: "Other",
    tone: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300",
  },
};

const OUTCOME_META: Record<string, { label: string; tone: string }> = {
  no_answer: {
    label: "No Answer",
    tone: "bg-slate-100 text-slate-700 border-slate-200",
  },
  promised: {
    label: "Promised",
    tone: "bg-amber-100 text-amber-800 border-amber-200",
  },
  partial_payment: {
    label: "Partial Payment",
    tone: "bg-orange-100 text-orange-800 border-orange-200",
  },
  refused: {
    label: "Refused",
    tone: "bg-red-100 text-red-800 border-red-200",
  },
  unreachable: {
    label: "Unreachable",
    tone: "bg-zinc-100 text-zinc-700 border-zinc-200",
  },
  resolved: {
    label: "Resolved",
    tone: "bg-emerald-100 text-emerald-800 border-emerald-200",
  },
};

const PKR = (v: number) =>
  `PKR ${v.toLocaleString("en-PK", { minimumFractionDigits: 2 })}`;

export function AttemptTimeline({ attempts }: { attempts: Attempt[] }) {
  if (!attempts?.length) {
    return (
      <div className="flex flex-col items-center justify-center py-8 px-4 border border-dashed rounded-lg bg-muted/20 text-center">
        <Phone className="size-6 text-muted-foreground/50 mb-2" />
        <p className="text-sm font-medium">No attempts yet</p>
        <p className="text-xs text-muted-foreground mt-1">
          Log your first recovery attempt below.
        </p>
      </div>
    );
  }

  return (
    <ol className="relative space-y-4 pl-2">
      {/* Vertical line */}
      <span
        aria-hidden
        className="absolute left-[19px] top-2 bottom-2 w-px bg-border"
      />

      {attempts.map((a, idx) => {
        const methodMeta = METHOD_META[a.attemptMethod] ?? METHOD_META.other;
        const outcomeMeta =
          OUTCOME_META[a.attemptOutcome] ?? {
            label: a.attemptOutcome,
            tone: "bg-slate-100 text-slate-700 border-slate-200",
          };
        const isResolved = a.attemptOutcome === "resolved";
        const promisedAmount = a.amountPromised
          ? Number(a.amountPromised)
          : null;
        const isLatest = idx === 0;
        const amountCaption =
          a.attemptOutcome === "partial_payment"
            ? "Recorded amount"
            : "Promised amount";

        return (
          <li key={a.id} className="relative pl-10">
            {/* Dot */}
            <span
              className={cn(
                "absolute left-0 top-1.5 flex items-center justify-center size-9 rounded-full border-2 bg-background",
                isResolved
                  ? "border-emerald-500 text-emerald-600"
                  : "border-border text-muted-foreground",
              )}
            >
              {methodMeta.icon}
            </span>

            <div className="rounded-lg border bg-card p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2 justify-between">
                <div className="flex items-center gap-1.5">
                  <Badge
                    variant="outline"
                    className={cn("text-[10px] px-1.5 py-0", methodMeta.tone)}
                  >
                    {methodMeta.label}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={cn("text-[10px] px-1.5 py-0", outcomeMeta.tone)}
                  >
                    {outcomeMeta.label}
                  </Badge>
                </div>
                <time
                  dateTime={new Date(a.attemptedAt).toISOString()}
                  className="text-[10px] text-muted-foreground tabular-nums"
                >
                  {format(new Date(a.attemptedAt), "dd MMM yyyy · HH:mm")}
                </time>
              </div>

              {promisedAmount !== null && promisedAmount > 0 && (
                <div className="flex items-center gap-1.5 text-xs">
                  <HandCoins className="size-3.5 text-amber-600" />
                  <span className="text-muted-foreground">{amountCaption}</span>
                  <span className="font-semibold tabular-nums">
                    {PKR(promisedAmount)}
                  </span>
                  {a.attemptOutcome === "promised" && a.promisedDate && (
                    <span className="text-muted-foreground">
                      by{" "}
                      {format(
                        new Date(a.promisedDate),
                        "dd MMM yyyy",
                      )}
                    </span>
                  )}
                </div>
              )}

              {a.notes && (
                <p className="text-xs text-foreground/80 leading-relaxed">
                  {a.notes}
                </p>
              )}

              {a.assignedTo?.name && (
                <p className="text-[10px] text-muted-foreground">
                  Recovery rep: {a.assignedTo.name}
                  {isLatest && (
                    <span className="ml-1.5 font-semibold text-primary">
                      · Latest
                    </span>
                  )}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
