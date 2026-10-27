import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { Briefcase, Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { GenericEmpty } from "@/components/custom/empty";
import { HREmptyIllustration } from "@/components/illustrations/HREmptyIllustration";
import {
  useDecideTimeExceptions,
  useTimeExceptions,
  type TimeExceptionView,
} from "@/hooks/hr/use-time-exceptions";
import {
  formatExceptionMinutes,
  TIME_EXCEPTION_STATUS_LABELS,
  type TimeExceptionDecision,
} from "@/lib/attendance/time-exceptions";

type PendingDecision = { ids: string[]; status: TimeExceptionDecision };

const DECISION_TITLES: Record<TimeExceptionDecision, string> = {
  approved_official: "Approve as company work",
  approved_excused: "Excuse",
  rejected: "Reject",
  pending: "Move back to pending",
};

const shortTime = (value: string | null) => (value ? value.slice(0, 5) : "—");

export function LateEarlyApprovalsContainer() {
  const [view, setView] = useState<TimeExceptionView>("pending");
  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [decision, setDecision] = useState<PendingDecision | null>(null);
  const [note, setNote] = useState("");
  const { data, isLoading } = useTimeExceptions(view);
  const decide = useDecideTimeExceptions();

  const departments = useMemo(
    () =>
      [
        ...new Set((data?.items ?? []).map((item) => item.department).filter(Boolean)),
      ] as string[],
    [data],
  );
  const items = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (data?.items ?? []).filter(
      (item) =>
        (department === "all" || item.department === department) &&
        (!term ||
          item.employeeName.toLowerCase().includes(term) ||
          item.employeeCode.toLowerCase().includes(term)),
    );
  }, [data, search, department]);

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allSelected = items.length > 0 && items.every((item) => selected.has(item.id));

  const open = (ids: string[], status: TimeExceptionDecision) => {
    setNote("");
    setDecision({ ids, status });
  };
  const noteRequired = decision?.status === "approved_official";
  const confirm = () => {
    if (!decision) return;
    decide.mutate(
      { ...decision, note: note.trim() || undefined },
      {
        onSuccess: () => {
          setDecision(null);
          setSelected(new Set());
        },
      },
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Tabs
          value={view}
          onValueChange={(v) => {
            setView(v as TimeExceptionView);
            setSelected(new Set());
          }}
        >
          <TabsList>
            <TabsTrigger value="pending">Pending ({data?.pendingCount ?? 0})</TabsTrigger>
            <TabsTrigger value="decided">Decided</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>
        <Input
          placeholder="Search employee or code"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 w-56"
        />
        {departments.length > 0 && (
          <NativeSelect
            aria-label="Department"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
          >
            <NativeSelectOption value="all">All departments</NativeSelectOption>
            {departments.map((d) => (
              <NativeSelectOption key={d} value={d}>
                {d}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
        {selected.size > 0 && (
          <div className="ml-auto flex gap-2">
            <span className="self-center text-sm text-muted-foreground">
              {selected.size} selected
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => open([...selected], "approved_official")}
            >
              <Briefcase className="size-3.5" /> Company work
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => open([...selected], "approved_excused")}
            >
              <Check className="size-3.5" /> Excuse
            </Button>
            <Button size="sm" variant="outline" onClick={() => open([...selected], "rejected")}>
              <X className="size-3.5" /> Reject
            </Button>
          </div>
        )}
      </div>

      {!isLoading && items.length === 0 ? (
        <GenericEmpty
          icon={HREmptyIllustration}
          title={view === "pending" ? "Nothing to review" : "No late or early items"}
          description="Late arrivals and early departures past the grace period appear here."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">
                <Checkbox
                  aria-label="Select all"
                  checked={allSelected}
                  onCheckedChange={(checked) =>
                    setSelected(checked ? new Set(items.map((item) => item.id)) : new Set())
                  }
                />
              </TableHead>
              <TableHead>Employee</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Expected</TableHead>
              <TableHead>Actual</TableHead>
              <TableHead>Time</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell>
                  <Checkbox
                    aria-label={`Select ${item.employeeName}`}
                    checked={selected.has(item.id)}
                    onCheckedChange={() => toggle(item.id)}
                  />
                </TableCell>
                <TableCell>
                  <div className="font-medium">{item.employeeName}</div>
                  <div className="text-xs text-muted-foreground">
                    {item.employeeCode}
                    {item.department ? ` · ${item.department}` : ""}
                  </div>
                </TableCell>
                <TableCell>{format(parseISO(item.date), "dd MMM yyyy")}</TableCell>
                <TableCell>{item.kind === "late" ? "Late arrival" : "Early departure"}</TableCell>
                <TableCell>{shortTime(item.expectedTime)}</TableCell>
                <TableCell>{shortTime(item.actualTime)}</TableCell>
                <TableCell>{formatExceptionMinutes(item.minutes)}</TableCell>
                <TableCell>
                  <Badge
                    variant={
                      item.status === "rejected"
                        ? "destructive"
                        : item.status === "pending"
                          ? "outline"
                          : "secondary"
                    }
                  >
                    {TIME_EXCEPTION_STATUS_LABELS[item.status]}
                  </Badge>
                  {item.decidedByName && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      by {item.decidedByName}
                      {item.note ? ` — ${item.note}` : ""}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Company work"
                      onClick={() => open([item.id], "approved_official")}
                    >
                      <Briefcase className="size-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Excuse"
                      onClick={() => open([item.id], "approved_excused")}
                    >
                      <Check className="size-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Reject"
                      onClick={() => open([item.id], "rejected")}
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {data?.hasMore && (
        <p className="text-xs text-muted-foreground">
          Showing the newest {data.items.length} items only.
        </p>
      )}

      <AlertDialog open={!!decision} onOpenChange={(isOpen) => !isOpen && setDecision(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{decision ? DECISION_TITLES[decision.status] : ""}</AlertDialogTitle>
            <AlertDialogDescription>
              {decision?.status === "rejected"
                ? `${decision.ids.length} item(s) will be deducted from salary.`
                : `${decision?.ids.length ?? 0} item(s) will not be deducted.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            placeholder={noteRequired ? "What was the company work? (required)" : "Note (optional)"}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={decide.isPending || (noteRequired && !note.trim())}
              onClick={confirm}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
