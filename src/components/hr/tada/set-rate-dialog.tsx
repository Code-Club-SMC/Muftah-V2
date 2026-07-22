import { useState, useEffect } from "react";
import { ResponsiveDialog } from "@/components/custom/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useSetTadaRate, useTadaRateHistory, useActiveTadaRate } from "@/hooks/hr/use-tada";
import { Settings2, History, TrendingUp, User as UserIcon, Calendar as CalendarIcon, Loader2 } from "lucide-react";
import { format, parseISO } from "date-fns";
import { DatePicker } from "@/components/custom/date-picker";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { GenericLoader } from "@/components/custom/generic-loader";
import { ScrollArea } from "@/components/ui/scroll-area";

type Props = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
};

export function SetRateDialog({ open, onOpenChange }: Props) {
    const [rate, setRate] = useState<string>("");
    const [date, setDate] = useState<Date>(new Date());
    const [remarks, setRemarks] = useState<string>("");

    const mutate = useSetTadaRate();
    const { data: history, isLoading: isHistoryLoading } = useTadaRateHistory();
    const { data: activeRate } = useActiveTadaRate();

    useEffect(() => {
        if (open) {
            setRate("");
            setDate(new Date());
            setRemarks("");
        }
    }, [open, activeRate]);

    const handleSave = async () => {
        if (!rate || isNaN(Number(rate)) || Number(rate) <= 0) return;

        await mutate.mutateAsync(
            {
                ratePerKm: Number(rate),
                effectiveFrom: format(date, "yyyy-MM-dd"),
                remarks: remarks.trim() || undefined,
            },
            {
                onSuccess: () => {
                    setRate("");
                    setRemarks("");
                    setDate(new Date());
                    onOpenChange(false);
                },
            }
        );
    };

    const isValid = rate && !isNaN(Number(rate)) && Number(rate) > 0 && date;

    return (
        <ResponsiveDialog
            open={open}
            onOpenChange={onOpenChange}
            className="min-w-[650px]"
            title="TA/DA Rate Management"
            description="Configure the global per-kilometer rate and view historical changes."
            icon={Settings2}
        >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 py-4 px-1 min-h-[440px]">
                {/* SET NEW RATE SECTION */}
                <div className="flex flex-col space-y-4">
                    <div className="flex items-center gap-2 border-b pb-2">
                        <TrendingUp className="size-4 text-muted-foreground" />
                        <h3 className="text-sm font-semibold">Update Rate</h3>
                    </div>

                    {activeRate && (
                        <div className="bg-primary/5 border border-primary/20 rounded-md p-3 mb-2 flex items-center justify-between animate-in fade-in duration-300">
                            <span className="text-xs font-medium text-muted-foreground uppercase">Current Rate</span>
                            <span className="text-sm font-bold text-primary">PKR {activeRate.ratePerKm} / km</span>
                        </div>
                    )}

                    <div className="space-y-4">
                        <div className="flex flex-col gap-2">
                            <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                                New Rate (PKR / KM)
                            </label>
                            <Input
                                type="number"
                                placeholder="0.00"
                                value={rate}
                                onChange={(e) => setRate(e.target.value)}
                                className="transition-colors focus-visible:ring-primary/50"
                                autoFocus
                            />
                        </div>
                        <div className="flex flex-col gap-2">
                            <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                                Effective From
                            </label>
                            <DatePicker
                                date={date}
                                onChange={(d) => d && setDate(d)}
                                className="w-full transition-colors"
                            />
                        </div>

                        <div className="flex flex-col gap-2">
                            <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                                Remarks
                            </label>
                            <Textarea
                                placeholder="Reason for change..."
                                value={remarks}
                                onChange={(e) => setRemarks(e.target.value)}
                                className="resize-none min-h-[80px] transition-colors focus-visible:ring-primary/50"
                                rows={2}
                            />
                        </div>

                        <Button
                            onClick={handleSave}
                            disabled={mutate.isPending || !isValid}
                            className="w-full transition-colors duration-200"
                        >
                            {mutate.isPending ? (
                                <>
                                    <Loader2 className="mr-2 size-4 animate-spin" />
                                    Applying...
                                </>
                            ) : (
                                "Apply New Rate"
                            )}
                        </Button>
                    </div>
                </div>

                {/* HISTORY SECTION */}
                <div className="flex flex-col space-y-4 h-full">
                    {/* Header stays pinned outside the scroll area */}
                    <div className="flex items-center justify-between border-b pb-2">
                        <div className="flex items-center gap-2">
                            <History className="size-4 text-muted-foreground" />
                            <h3 className="text-sm font-semibold">Rate History</h3>
                        </div>
                        {history && <Badge variant="secondary" className="bg-muted/50">{history.length} Records</Badge>}
                    </div>

                    {/* ScrollArea handles the internal list rendering */}
                    <ScrollArea className="h-[380px] pr-4">
                        {isHistoryLoading ? (
                            <div className="h-full flex items-center justify-center min-h-[200px]">
                                <GenericLoader title="Loading history..." />
                            </div>
                        ) : history && history.length > 0 ? (
                            <div className="space-y-3 pb-2 animate-in fade-in duration-300">
                                {history.map((h: any) => (
                                    <div
                                        key={h.id}
                                        className={cn(
                                            "p-4 rounded-md border transition-colors duration-200",
                                            h.isActive
                                                ? "bg-primary/5 border-primary/20 "
                                                : "bg-background hover:bg-muted/30"
                                        )}
                                    >
                                        <div className="flex items-start justify-between mb-3">
                                            <div>
                                                <div className={cn("text-lg font-semibold", h.isActive && "text-primary")}>
                                                    PKR {h.ratePerKm}
                                                    <span className="text-sm font-normal text-muted-foreground ml-1">/km</span>
                                                </div>
                                                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
                                                    <CalendarIcon className="size-3" />
                                                    {format(parseISO(h.effectiveFrom), "dd MMM yyyy")}
                                                </div>
                                            </div>
                                            {h.isActive && (
                                                <Badge variant="default" className="text-[10px] uppercase bg-primary text-primary-foreground">
                                                    Active
                                                </Badge>
                                            )}
                                        </div>

                                        {h.remarks && (
                                            <p className="text-sm text-muted-foreground mb-3 leading-relaxed">
                                                {h.remarks}
                                            </p>
                                        )}

                                        <div className="flex items-center justify-between pt-3 border-t border-border/50">
                                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                                <UserIcon className="size-3" />
                                                <span>{h.setter?.name || "System"}</span>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center p-8 text-center border rounded-md bg-muted/20 min-h-[200px] animate-in fade-in">
                                <History className="size-8 text-muted-foreground/50 mb-3" />
                                <p className="text-sm font-medium">No rate history found.</p>
                                <p className="text-sm text-muted-foreground mt-1">Set your first rate on the left.</p>
                            </div>
                        )}
                    </ScrollArea>
                </div>
            </div>
        </ResponsiveDialog>
    );
}