import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Settings2, Save, RotateCcw } from "lucide-react";

type Labels = Record<number, string>;

const LEVEL_NUMBERS = [0, 1, 2, 3] as const;

const DEFAULTS: Labels = {
  0: "Normal",
  1: "First Reminder",
  2: "Supervisor Review",
  3: "Legal Action",
};

const LEVEL_META: Record<number, { tone: string; helper: string }> = {
  0: {
    tone: "text-slate-600 dark:text-slate-400",
    helper: "Default — no escalation needed yet",
  },
  1: {
    tone: "text-amber-600 dark:text-amber-400",
    helper: "First reminder sent or attempted",
  },
  2: {
    tone: "text-orange-600 dark:text-orange-400",
    helper: "Supervisor or manager is involved",
  },
  3: {
    tone: "text-red-600 dark:text-red-400",
    helper: "Final stage — legal or default",
  },
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  current: Labels | undefined;
  onSave: (labels: Labels) => void;
  isPending: boolean;
};

export function EscalationLabelsEditor({
  open,
  onOpenChange,
  current,
  onSave,
  isPending,
}: Props) {
  const [labels, setLabels] = useState<Labels>(DEFAULTS);

  // Reset to the server-provided (or default) labels each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setLabels({
      0: current?.[0] ?? DEFAULTS[0],
      1: current?.[1] ?? DEFAULTS[1],
      2: current?.[2] ?? DEFAULTS[2],
      3: current?.[3] ?? DEFAULTS[3],
    });
    // We intentionally re-seed when the dialog opens. Subsequent updates to
    // `current` while open should not clobber in-progress edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleChange = (key: number, value: string) => {
    setLabels((prev) => ({ ...prev, [key]: value }));
  };

  const handleReset = () => {
    setLabels(DEFAULTS);
  };

  const handleSave = () => {
    const cleaned: Labels = {
      0: labels[0].trim() || DEFAULTS[0],
      1: labels[1].trim() || DEFAULTS[1],
      2: labels[2].trim() || DEFAULTS[2],
      3: labels[3].trim() || DEFAULTS[3],
    };
    onSave(cleaned);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="size-4 text-primary" />
            Escalation Level Labels
          </DialogTitle>
          <DialogDescription>
            Customize the meaning of each escalation level. These labels appear
            throughout the recovery module.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          {LEVEL_NUMBERS.map((level) => {
            const meta = LEVEL_META[level];
            return (
              <div key={level} className="space-y-1.5">
                <Label
                  htmlFor={`esc-label-${level}`}
                  className="flex items-center gap-2"
                >
                  <span className={`font-bold ${meta.tone}`}>L{level}</span>
                  <span className="text-[11px] font-normal text-muted-foreground">
                    {meta.helper}
                  </span>
                </Label>
                <Input
                  id={`esc-label-${level}`}
                  value={labels[level]}
                  onChange={(e) => handleChange(level, e.target.value)}
                  maxLength={50}
                  placeholder={`Label for L${level}`}
                />
              </div>
            );
          })}
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReset}
            disabled={isPending}
          >
            <RotateCcw className="size-3.5 mr-1" />
            Reset to defaults
          </Button>
          <div className="flex-1" />
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isPending}>
            <Save className="size-3.5 mr-1" />
            {isPending ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
