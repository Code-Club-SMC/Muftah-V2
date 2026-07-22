import { History } from "lucide-react";
import { ResponsiveSheet } from "@/components/custom/responsive-sheet";
import { useCartonAuditLog } from "../hooks/use-carton-mutations";
import { AuditLogTimeline } from "../components";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cartonId: string;
  sku?: string | null;
};

export function AuditLogSheet({ open, onOpenChange, cartonId, sku }: Props) {
  const { data, isLoading } = useCartonAuditLog(cartonId, 1, 50);

  const entries = (data?.data ?? []).map((e: any) => ({
    id: e.id,
    type: e.type,
    packsBefore: e.packsBefore,
    delta: e.delta,
    packsAfter: e.packsAfter,
    reason: e.reason,
    performedBy: e.performedByUser?.name ?? e.performedBy,
    performedAt: e.performedAt,
    relatedCartonId: e.relatedCartonId,
  }));

  return (
    <ResponsiveSheet
      title="Audit Log"
      description={`Adjustment history for carton${sku ? ` ${sku}` : ` ${cartonId.slice(0, 8)}…`}`}
      icon={History}
      open={open}
      onOpenChange={onOpenChange}
      className="max-w-[700px]"
    >
      <div className="py-4">
        <AuditLogTimeline entries={entries} loading={isLoading} />
      </div>
    </ResponsiveSheet>
  );
}