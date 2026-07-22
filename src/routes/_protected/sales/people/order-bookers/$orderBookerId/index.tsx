import { createFileRoute, useParams, useRouter } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChevronLeft } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DatePickerWithRange } from "@/components/custom/date-range-picker";
import { useState } from "react";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { useGetOrderBookerDetail } from "@/hooks/sales/use-sales-people";
import { useGetOrderBookerTrips, useDeleteOrderBookerTrip } from "@/hooks/sales/use-order-booker-trips";
import { useGetCommissionRecords, useGetCommissionSummary } from "@/hooks/sales/use-order-booker-commission";
import { useGetOrders } from "@/hooks/sales/use-orders";
import { toast } from "sonner";
import type { DateRange } from "react-day-picker";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getOrderBookerEligibleUsersFn, linkOrderBookerToUserFn } from "@/server-functions/sales/sales-config-fn";
import { User } from "lucide-react";
import { CreateTripDialog } from "@/components/sales/create-trip-dialog";

export const Route = createFileRoute("/_protected/sales/people/order-bookers/$orderBookerId/")({
  component: OrderBookerProfilePage,
});

function OrderBookerProfilePage() {
  const { orderBookerId } = useParams({ from: "/_protected/sales/people/order-bookers/$orderBookerId/" });
  const router = useRouter();
  const { data: orderBooker } = useGetOrderBookerDetail(orderBookerId);

  const [tripDateRange, setTripDateRange] = useState<DateRange | undefined>({
    from: startOfMonth(new Date()),
    to: endOfMonth(new Date()),
  });
  const [commissionDateRange, setCommissionDateRange] = useState<DateRange | undefined>({
    from: startOfMonth(new Date()),
    to: endOfMonth(new Date()),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => router.history.back()}>
          <ChevronLeft className="size-4" />
          Back
        </Button>
        <h1 className="text-2xl font-bold">{orderBooker?.name || "Order Booker"}</h1>
        <Badge variant={orderBooker?.status === "active" ? "default" : "outline"}>{orderBooker?.status}</Badge>
      </div>

      {/* Header Card */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Phone</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-semibold">{orderBooker?.phone || "—"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Assigned Area</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-semibold">{orderBooker?.assignedArea || "—"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Commission Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-semibold">{orderBooker?.commissionRate ? `${orderBooker.commissionRate}%` : "—"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Address</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-semibold">{orderBooker?.address || "—"}</p>
          </CardContent>
        </Card>
        <PortalAccountCard orderBookerId={orderBookerId} userId={orderBooker?.userId} />
      </div>

      <Tabs defaultValue="trips" className="space-y-4">
        <TabsList>
          <TabsTrigger value="trips">Trip Logs</TabsTrigger>
          <TabsTrigger value="orders">Orders</TabsTrigger>
          <TabsTrigger value="commission">Commission</TabsTrigger>
        </TabsList>

        <TabsContent value="trips">
          <TripsTab
            orderBooker={orderBooker}
            orderBookerId={orderBookerId}
            dateRange={tripDateRange}
            onDateRangeChange={setTripDateRange}
          />
        </TabsContent>

        <TabsContent value="orders">
          <OrdersTab orderBookerId={orderBookerId} />
        </TabsContent>

        <TabsContent value="commission">
          <CommissionTab orderBookerId={orderBookerId} dateRange={commissionDateRange} onDateRangeChange={setCommissionDateRange} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Trips Tab ──
function TripsTab({ orderBooker, orderBookerId, dateRange, onDateRangeChange }: {
  orderBooker?: { id: string; name: string } | null;
  orderBookerId: string;
  dateRange: DateRange | undefined;
  onDateRangeChange: (range: DateRange | undefined) => void;
}) {
  const { data: trips } = useGetOrderBookerTrips(
    orderBookerId,
    dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : undefined,
    dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : undefined,
  );
  const deleteTrip = useDeleteOrderBookerTrip();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <DatePickerWithRange date={dateRange} onDateChange={onDateRangeChange} />
        <CreateTripDialog
          orderBookers={
            orderBooker
              ? [{ id: orderBooker.id, name: orderBooker.name }]
              : []
          }
        />
      </div>

      <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-[11px]">Date</TableHead>
              <TableHead className="text-[11px]">Destination</TableHead>
              <TableHead className="text-[11px]">Distance</TableHead>
              <TableHead className="text-[11px]">Vehicle</TableHead>
              <TableHead className="text-[11px] text-right">Fuel</TableHead>
              <TableHead className="text-[11px] text-right">TADA</TableHead>
              <TableHead className="text-[11px] w-[50px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {!trips?.length ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-10 text-sm">No trips found.</TableCell>
              </TableRow>
            ) : (
              trips.map((trip: any) => (
                <TableRow key={trip.id}>
                  <TableCell className="text-sm">{format(new Date(trip.tripDate), "dd MMM yyyy")}</TableCell>
                  <TableCell className="text-sm">{trip.destination}</TableCell>
                  <TableCell className="text-sm">{trip.distanceKm} km</TableCell>
                  <TableCell className="text-sm capitalize">{trip.vehicleType.replace("_", " ")}</TableCell>
                  <TableCell className="text-sm text-right tabular-nums">{Number(trip.fuelCost) > 0 ? `PKR ${trip.fuelCost}` : "—"}</TableCell>
                  <TableCell className="text-sm text-right tabular-nums">{Number(trip.tadaAmount) > 0 ? `PKR ${trip.tadaAmount}` : "—"}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" className="h-7 text-[11px] text-rose-500" onClick={() => deleteTrip.mutate({ data: { id: trip.id } })}>
                      Delete
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ── Orders Tab ──
function OrdersTab({ orderBookerId }: { orderBookerId: string }) {
  const { data: ordersList } = useGetOrders({ orderBookerId });
  const router = useRouter();

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-[11px]">Bill #</TableHead>
              <TableHead className="text-[11px]">Shopkeeper</TableHead>
              <TableHead className="text-[11px]">Status</TableHead>
              <TableHead className="text-[11px] text-right">Amount</TableHead>
              <TableHead className="text-[11px]">Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!ordersList?.length ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-10 text-sm">No orders found.</TableCell>
              </TableRow>
            ) : (
              ordersList.map((order: any) => (
                <TableRow key={order.id} className="cursor-pointer" onClick={() => router.navigate({ to: "/sales/orders" })}>
                  <TableCell className="text-sm font-medium">#{order.billNumber}</TableCell>
                  <TableCell className="text-sm">{order.shopkeeperName}</TableCell>
                  <TableCell>
                    <Badge variant={order.status === "delivered" ? "default" : order.status === "pending" ? "outline" : "secondary"} className="text-[10px] capitalize">
                      {order.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-right tabular-nums">
                    PKR {order.items?.reduce((sum: number, item: any) => sum + Number(item.amount), 0).toFixed(2)}
                  </TableCell>
                  <TableCell className="text-sm">{format(new Date(order.createdAt), "dd MMM yyyy")}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ── Commission Tab ──
function CommissionTab({ orderBookerId, dateRange, onDateRangeChange }: {
  orderBookerId: string;
  dateRange: DateRange | undefined;
  onDateRangeChange: (range: DateRange | undefined) => void;
}) {
  const fromStr = dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : "";
  const toStr = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : "";
  const { data: records } = useGetCommissionRecords(orderBookerId, fromStr, toStr);
  const { data: summary } = useGetCommissionSummary(orderBookerId, fromStr, toStr);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <DatePickerWithRange date={dateRange} onDateChange={onDateRangeChange} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Total Accrued</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">PKR {summary?.totalAccrued.toFixed(2) || "0.00"}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Total Paid</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">PKR {summary?.totalPaid.toFixed(2) || "0.00"}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Reversed</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">PKR {summary?.totalReversed.toFixed(2) || "0.00"}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Pending</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">PKR {summary?.totalPending.toFixed(2) || "0.00"}</p></CardContent>
        </Card>
      </div>

      <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-[11px]">Order</TableHead>
              <TableHead className="text-[11px] text-right">Fulfilled</TableHead>
              <TableHead className="text-[11px] text-right">Rate</TableHead>
              <TableHead className="text-[11px] text-right">Commission</TableHead>
              <TableHead className="text-[11px]">Status</TableHead>
              <TableHead className="text-[11px]">Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!records?.length ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-10 text-sm">No commission records found.</TableCell>
              </TableRow>
            ) : (
              records.map((rec: any) => (
                <TableRow key={rec.id}>
                  <TableCell className="text-sm font-medium">#{rec.orderId.slice(-6)}</TableCell>
                  <TableCell className="text-sm text-right tabular-nums">PKR {rec.fulfilledAmount}</TableCell>
                  <TableCell className="text-sm text-right tabular-nums">{rec.appliedRate}%</TableCell>
                  <TableCell className="text-sm text-right tabular-nums font-medium">PKR {rec.commissionAmount}</TableCell>
                  <TableCell>
                    <Badge variant={rec.status === "paid" ? "default" : "outline"} className="text-[10px] capitalize">{rec.status}</Badge>
                  </TableCell>
                  <TableCell className="text-sm">{format(new Date(rec.calculatedAt), "dd MMM yyyy")}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function PortalAccountCard({ orderBookerId, userId }: { orderBookerId: string; userId?: string | null }) {
  const [open, setOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState(userId || "__none__");
  const qc = useQueryClient();

  const { data: eligibleUsers } = useQuery({
    queryKey: ["ob-eligible-users", orderBookerId],
    queryFn: () => getOrderBookerEligibleUsersFn({ data: { orderBookerId } }),
  });

  const handleLink = async () => {
    try {
      await linkOrderBookerToUserFn({
        data: {
          orderBookerId,
          userId: selectedUserId === "__none__" ? null : selectedUserId,
        },
      });
      toast.success("Portal account updated");
      qc.invalidateQueries({ queryKey: ["order-booker-detail", orderBookerId] });
      qc.invalidateQueries({ queryKey: ["ob-eligible-users"] });
      setOpen(false);
    } catch (e: any) {
      toast.error(e.message || "Failed to update");
    }
  };

  const linkedUser = eligibleUsers?.find((u: any) => u.id === userId);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
          <User className="size-3.5" />
          Portal Account
        </CardTitle>
      </CardHeader>
      <CardContent>
        {linkedUser ? (
          <div className="space-y-1">
            <p className="text-sm font-semibold">{linkedUser.name}</p>
            <p className="text-xs text-muted-foreground">{linkedUser.email}</p>
          </div>
        ) : userId ? (
          <p className="text-sm text-muted-foreground">Linked (user ID: {userId.slice(0, 8)}…)</p>
        ) : (
          <p className="text-sm text-muted-foreground">Not linked</p>
        )}
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="ghost" size="sm" className="mt-2 h-7 text-[11px]">
              {userId ? "Change" : "Link Account"}
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle className="text-sm">Link Portal Account</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 pt-2">
              <div className="space-y-1">
                <Label className="text-xs">User with Order Booker Role</Label>
                <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select user" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— None —</SelectItem>
                    {(eligibleUsers || []).map((u: any) => (
                      <SelectItem key={u.id} value={u.id}>{u.name} ({u.email})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button className="w-full" size="sm" onClick={handleLink}>
                Save
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
