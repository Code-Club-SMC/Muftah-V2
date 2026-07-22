import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Navigation } from "lucide-react";
import { useCreateOrderBookerTrip } from "@/hooks/sales/use-order-booker-trips";
import {
  ORDER_BOOKER_SHOP_TYPE_OPTIONS,
  ORDER_BOOKER_VEHICLE_TYPE_OPTIONS,
  createDefaultOrderBookerTripFormValues,
  getOrderBookerTripFormError,
  parseOrderBookerTripForm,
} from "@/lib/sales/order-booker-trip-form";
import { getOrderBookerTripEligibilityFn } from "@/server-functions/sales/get-order-booker-trip-eligibility-fn";

interface OrderBooker {
  id: string;
  name: string;
}

interface CreateTripDialogProps {
  orderBookers: OrderBooker[];
}

export function CreateTripDialog({ orderBookers }: CreateTripDialogProps) {
  const [open, setOpen] = useState(false);
  const createTrip = useCreateOrderBookerTrip();

  const [form, setForm] = useState({
    orderBookerId: "",
    ...createDefaultOrderBookerTripFormValues(),
  });

  const { data: eligibility, isFetching: isCheckingEligibility } = useQuery({
    queryKey: ["orderBookerTripEligibility", form.orderBookerId, form.tripDate],
    queryFn: () =>
      getOrderBookerTripEligibilityFn({
        data: {
          orderBookerId: form.orderBookerId,
          tripDate: form.tripDate,
        },
      }),
    enabled: open && !!form.orderBookerId && !!form.tripDate,
  });

  const blockedReason =
    eligibility && !eligibility.isAllowed
      ? eligibility.reasonMessage ?? "Trips are blocked for this date."
      : null;

  const handleSubmit = () => {
    if (!form.orderBookerId) {
      toast.error("Please select an order booker");
      return;
    }
    if (blockedReason) {
      toast.error(blockedReason);
      return;
    }

    let tripValues;
    try {
      tripValues = parseOrderBookerTripForm(form);
    } catch (error) {
      toast.error(getOrderBookerTripFormError(error));
      return;
    }

    createTrip.mutate(
      {
        data: {
          orderBookerId: form.orderBookerId,
          tripDate: tripValues.tripDate,
          destination: tripValues.destination,
          shopType: tripValues.shopType,
          distanceKm: tripValues.distanceKm,
          vehicleType: tripValues.vehicleType,
          fuelCost: tripValues.fuelCost,
          notes: tripValues.notes,
        },
      },
      {
        onSuccess: () => {
          setOpen(false);
          toast.success("Trip logged successfully");
          setForm({
            orderBookerId: "",
            ...createDefaultOrderBookerTripFormValues(),
          });
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Navigation className="size-4" />
          Log Trip
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Navigation className="size-5 text-primary" />
            Log Trip (No Order)
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Order Booker
            </Label>
            <Select
              value={form.orderBookerId}
              onValueChange={(v) => setForm((f) => ({ ...f, orderBookerId: v }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select order booker" />
              </SelectTrigger>
              <SelectContent>
                {orderBookers.map((ob) => (
                  <SelectItem key={ob.id} value={ob.id}>
                    {ob.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Date
              </Label>
              <Input
                type="date"
                value={form.tripDate}
                onChange={(e) => setForm((f) => ({ ...f, tripDate: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Vehicle
              </Label>
              <Select
                value={form.vehicleType}
                onValueChange={(v: "own_vehicle" | "company_vehicle") =>
                  setForm((f) => ({ ...f, vehicleType: v }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ORDER_BOOKER_VEHICLE_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Shop Type
            </Label>
            <Select
              value={form.shopType}
              onValueChange={(v: "old" | "new") =>
                setForm((f) => ({ ...f, shopType: v }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ORDER_BOOKER_SHOP_TYPE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Destination
            </Label>
            <Input
              value={form.destination}
              onChange={(e) => setForm((f) => ({ ...f, destination: e.target.value }))}
              placeholder="Area or shop visited"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Distance (km)
              </Label>
              <Input
                type="number"
                step="0.1"
                min="0"
                value={form.distanceKm}
                onChange={(e) => setForm((f) => ({ ...f, distanceKm: e.target.value }))}
              />
            </div>
            {form.vehicleType === "own_vehicle" && (
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Fuel Cost (PKR)
                </Label>
                <Input
                  type="number"
                  min="0"
                  value={form.fuelCost}
                  onChange={(e) => setForm((f) => ({ ...f, fuelCost: e.target.value }))}
                />
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Notes (optional)
            </Label>
            <Input
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Any additional notes..."
            />
          </div>

          {blockedReason && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {blockedReason}
            </div>
          )}

          <Button
            className="w-full"
            onClick={handleSubmit}
            disabled={createTrip.isPending || isCheckingEligibility || !!blockedReason}
          >
            {createTrip.isPending
              ? "Logging..."
              : isCheckingEligibility
                ? "Checking date..."
                : "Log Trip"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
