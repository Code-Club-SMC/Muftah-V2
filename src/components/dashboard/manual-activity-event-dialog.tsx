import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useCreateManualActivityEvent } from "@/hooks/dashboard/use-activity-timeline";

const formSchema = z.object({
  module: z.string().min(1, "Module is required"),
  action: z.string().min(1, "Action is required"),
  entityType: z.string().min(1, "Entity Type is required"),
  severity: z.enum(["info", "warning", "critical"]),
  description: z.string().min(1, "Description is required"),
});

type FormValues = z.infer<typeof formSchema>;

interface ManualActivityEventDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ManualActivityEventDialog({
  open,
  onOpenChange,
}: ManualActivityEventDialogProps) {
  const { mutateAsync: createEvent, isPending } = useCreateManualActivityEvent();

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      module: "",
      action: "",
      entityType: "",
      severity: "info",
      description: "",
    },
  });

  const onSubmit = async (values: FormValues) => {
    try {
      await createEvent(values);
      toast.success("Event logged successfully");
      reset();
      onOpenChange(false);
    } catch {
      toast.error("Failed to log event");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Log Manual Event</DialogTitle>
          <DialogDescription>
            Record a system-wide activity event manually.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Module</label>
            <Input placeholder="e.g. hr, finance, operations" {...register("module")} />
            {errors.module && (
              <p className="text-sm text-red-500">{errors.module.message}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Action</label>
              <Input placeholder="e.g. created, updated" {...register("action")} />
              {errors.action && (
                <p className="text-sm text-red-500">{errors.action.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Entity Type</label>
              <Input placeholder="e.g. employee, invoice" {...register("entityType")} />
              {errors.entityType && (
                <p className="text-sm text-red-500">{errors.entityType.message}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Severity</label>
            <Controller
              control={control}
              name="severity"
              render={({ field }) => (
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select severity" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="info">Info</SelectItem>
                    <SelectItem value="warning">Warning</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
            {errors.severity && (
              <p className="text-sm text-red-500">{errors.severity.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Description</label>
            <Textarea
              placeholder="Describe the event..."
              className="resize-none"
              {...register("description")}
            />
            {errors.description && (
              <p className="text-sm text-red-500">{errors.description.message}</p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Log Event
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
