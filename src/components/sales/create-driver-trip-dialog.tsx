import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Truck, Info, Calculator } from "lucide-react";
import { nowPKTDate } from "@/lib/attendance/time";
import {
  useCreateDriverTrip,
  useGetDrivers,
  useGetTadaRate,
} from "@/hooks/sales/use-driver-trips";

interface DriverOption {
  id: string;
  name: string;
  phone?: string | null;
  licenseNumber?: string | null;
}

interface CreateDriverTripDialogProps {
  drivers?: DriverOption[];
  defaultDriverId?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: React.ReactNode;
}

export function CreateDriverTripDialog({
  drivers: propDrivers,
  defaultDriverId,
  open: controlledOpen,
  onOpenChange: setControlledOpen,
  trigger,
}: CreateDriverTripDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = (val: boolean) => {
    if (isControlled) {
      setControlledOpen?.(val);
    } else {
      setInternalOpen(val);
    }
  };

  const { data: fetchedDrivers } = useGetDrivers("active");
  const { data: activeTadaRate, isLoading: isLoadingRate } = useGetTadaRate();
  const createTrip = useCreateDriverTrip();

  const driversList = propDrivers || fetchedDrivers || [];

  const [driverId, setDriverId] = useState(defaultDriverId || "");
  const [tripDate, setTripDate] = useState(nowPKTDate());
  const [destination, setDestination] = useState("");
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [distanceKm, setDistanceKm] = useState<string>("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (defaultDriverId) {
      setDriverId(defaultDriverId);
    }
  }, [defaultDriverId]);

  const ratePerKm = activeTadaRate ? parseFloat(activeTadaRate.ratePerKm) : 0;
  const parsedDistance = parseFloat(distanceKm) || 0;
  const calculatedTada = (parsedDistance * ratePerKm).toFixed(2);

  const resetForm = () => {
    if (!defaultDriverId) setDriverId("");
    setTripDate(nowPKTDate());
    setDestination("");
    setVehicleNumber("");
    setDistanceKm("");
    setNotes("");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!driverId) {
      toast.error("Please select a driver");
      return;
    }
    if (!destination.trim()) {
      toast.error("Please enter a destination");
      return;
    }
    if (parsedDistance <= 0) {
      toast.error("Please enter a valid distance in KM (greater than 0)");
      return;
    }
    if (!activeTadaRate) {
      toast.error("No active system TA/DA rate configured in Sales > Configurations.");
      return;
    }

    createTrip.mutate(
      {
        data: {
          driverId,
          tripDate,
          destination: destination.trim(),
          vehicleNumber: vehicleNumber.trim() || undefined,
          distanceKm: parsedDistance,
          notes: notes.trim() || undefined,
        },
      },
      {
        onSuccess: () => {
          toast.success("Driver delivery trip logged successfully");
          resetForm();
          setOpen(false);
        },
        onError: (err: any) => {
          toast.error(err?.message || "Failed to log driver trip");
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger !== null && (
        <DialogTrigger asChild>
          {trigger || (
            <Button size="sm" className="gap-1.5">
              <Plus className="size-4" />
              Log Driver Trip
            </Button>
          )}
        </DialogTrigger>
      )}

      <DialogContent className="sm:max-w-[520px]">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Truck className="size-5 text-primary" />
              Log Driver Trip
            </DialogTitle>
            <DialogDescription>
              Record a delivery trip. TA/DA is calculated using the system-wide global rate and credited in the monthly payroll payslip.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3.5 py-1">
            {/* Driver Select */}
            <div className="space-y-1.5">
              <Label htmlFor="driver" className="text-xs font-semibold">
                Driver <span className="text-destructive">*</span>
              </Label>
              <Select value={driverId} onValueChange={setDriverId}>
                <SelectTrigger id="driver" className="h-9">
                  <SelectValue placeholder="Select driver" />
                </SelectTrigger>
                <SelectContent>
                  {driversList.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name} {d.phone ? `(${d.phone})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Trip Date & Vehicle Number */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="tripDate" className="text-xs font-semibold">
                  Trip Date <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="tripDate"
                  type="date"
                  value={tripDate}
                  onChange={(e) => setTripDate(e.target.value)}
                  className="h-9"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="vehicleNumber" className="text-xs font-semibold">
                  Vehicle Number
                </Label>
                <Input
                  id="vehicleNumber"
                  placeholder="e.g. LES-1234"
                  value={vehicleNumber}
                  onChange={(e) => setVehicleNumber(e.target.value)}
                  className="h-9"
                />
              </div>
            </div>

            {/* Destination */}
            <div className="space-y-1.5">
              <Label htmlFor="destination" className="text-xs font-semibold">
                Destination <span className="text-destructive">*</span>
              </Label>
              <Input
                id="destination"
                placeholder="e.g. Hyderabad Warehouse / Route B"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                className="h-9"
                required
              />
            </div>

            {/* Distance in KM */}
            <div className="space-y-1.5">
              <Label htmlFor="distanceKm" className="text-xs font-semibold">
                Distance (KM) <span className="text-destructive">*</span>
              </Label>
              <Input
                id="distanceKm"
                type="number"
                step="0.1"
                min="0.1"
                placeholder="e.g. 45"
                value={distanceKm}
                onChange={(e) => setDistanceKm(e.target.value)}
                className="h-9"
                required
              />
            </div>

            {/* Live TA/DA Calculation Card */}
            <div className="rounded-lg border border-border/70 bg-muted/40 p-3 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 text-muted-foreground font-medium">
                  <Calculator className="size-3.5 text-primary" />
                  System TA/DA Rate:
                </span>
                <span className="font-semibold tabular-nums text-foreground">
                  {isLoadingRate
                    ? "Loading rate..."
                    : activeTadaRate
                    ? `PKR ${ratePerKm.toFixed(2)} / km`
                    : "No active rate configured"}
                </span>
              </div>

              <div className="flex items-center justify-between border-t border-border/50 pt-2 text-sm">
                <span className="font-medium text-muted-foreground">
                  Calculated TA/DA:
                </span>
                <span className="text-base font-bold text-primary tabular-nums">
                  PKR {Number(calculatedTada).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>

              <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                <Info className="size-3 text-muted-foreground shrink-0" />
                Picked from Sales &gt; Configurations. Credited via monthly payroll payslip.
              </p>
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <Label htmlFor="notes" className="text-xs font-semibold">
                Notes
              </Label>
              <Textarea
                id="notes"
                placeholder="Optional trip details or remarks..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="resize-none text-xs"
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={createTrip.isPending || !driverId || parsedDistance <= 0}
            >
              {createTrip.isPending ? "Logging Trip..." : "Log Trip"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
