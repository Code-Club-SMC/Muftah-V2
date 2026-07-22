import {
  Clock,
  Warehouse,
  MapPin,
  History,
  Activity,
  Navigation2,
  ShieldCheck,
} from "lucide-react";
import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent } from "@/components/ui/card";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  warehouse: {
    id: string;
    name: string;
    address: string;
    city: string;
    state: string;
    latitude: string | number;
    longitude: string | number;
    isActive: boolean;
    type: string;
    createdAt: string | Date;
    updatedAt: string | Date;
  };
};

export const WarehouseDetailsDialog = ({
  open,
  onOpenChange,
  warehouse,
}: Props) => {
  if (!warehouse) return null;

  const createdAt = new Date(warehouse.createdAt);
  const updatedAt = new Date(warehouse.updatedAt);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0 gap-0 overflow-hidden border-none ">
        <div className="bg-primary/5 p-6 border-b border-primary/10">
          <DialogHeader className="space-y-1">
            <div className="flex items-center gap-2 mb-2">
              <Badge
                variant="outline"
                className="bg-primary/10 text-primary border-primary/20 uppercase text-[10px] font-bold "
              >
                Facility Profile
              </Badge>
              <Badge
                variant={warehouse.isActive ? "healthy" : "secondary"}
                className="text-[10px] font-bold uppercase "
              >
                {warehouse.isActive ? "Operational" : "Archived"}
              </Badge>
            </div>
            <DialogTitle className="text-2xl font-black tracking-tight text-foreground flex items-center gap-3">
              <Warehouse className="size-6 text-primary" />
              {warehouse.name}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground flex items-center gap-2 pt-1">
              <MapPin className="size-3.5" />
              <span className="font-medium text-foreground">
                {warehouse.city}, {warehouse.state}
              </span>
              <span className="text-[10px] opacity-50 font-mono">
                ID: {warehouse.id}
              </span>
            </DialogDescription>
          </DialogHeader>
        </div>

        <ScrollArea className="max-h-[60vh]">
          <div className="p-6 space-y-6">
            {/* Geographic Matrix */}
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 rounded-2xl border bg-muted/5 flex flex-col gap-3">
                <div className="flex items-center gap-2 text-primary font-bold text-[10px] uppercase ">
                  <Activity className="size-3.5" />
                  <span>Global Positioning</span>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-muted-foreground">Latitude</span>
                    <span className="font-mono font-bold">
                      {warehouse.latitude}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-muted-foreground">Longitude</span>
                    <span className="font-mono font-bold">
                      {warehouse.longitude}
                    </span>
                  </div>
                </div>
              </div>
              <div className="p-4 rounded-2xl border bg-muted/5 flex flex-col gap-3">
                <div className="flex items-center gap-2 text-primary font-bold text-[10px] uppercase ">
                  <ShieldCheck className="size-3.5" />
                  <span>Facility Classification</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-bold capitalize">
                    {warehouse.type.replace("_", " ")}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    Industrial Category
                  </span>
                </div>
              </div>
            </div>

            {/* Lifecycle Traceability */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-primary font-bold text-xs uppercase ">
                <History className="size-3.5" />
                <span>Administrative Audit Trail</span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 rounded-xl border border-dashed bg-primary/5 flex flex-col gap-1">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                    <Clock className="size-3.5" />
                    <span className="text-[10px] font-bold uppercase tracking-tighter">
                      Facility Registered
                    </span>
                  </div>
                  <p className="font-bold text-sm text-foreground">
                    {format(createdAt, "PPP")}
                  </p>
                  <p className="text-[10px] font-mono text-muted-foreground opacity-70">
                    {format(createdAt, "pp")}
                  </p>
                </div>
                <div className="p-4 rounded-xl border border-dashed bg-primary/5 flex flex-col gap-1">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                    <Clock className="size-3.5" />
                    <span className="text-[10px] font-bold uppercase tracking-tighter">
                      Record Last Modified
                    </span>
                  </div>
                  <p className="font-bold text-sm text-foreground">
                    {format(updatedAt, "PPP")}
                  </p>
                  <p className="text-[10px] font-mono text-muted-foreground opacity-70">
                    {format(updatedAt, "pp")}
                  </p>
                </div>
              </div>
            </div>

            {/* Physical Address */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-primary font-bold text-xs uppercase ">
                <Navigation2 className="size-3.5" />
                <span>Logistics Destination</span>
              </div>
              <Card className="bg-muted/10 border-none ">
                <CardContent className="p-4">
                  <p className="text-sm font-semibold leading-relaxed text-foreground/80 italic">
                    "{warehouse.address}"
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </ScrollArea>

        <div className="p-4 bg-muted/30 border-t flex justify-end">
          <button
            onClick={() => onOpenChange(false)}
            className="px-6 py-2 bg-foreground text-background font-bold rounded-xl text-sm transition-all hover:opacity-90 active:scale-95 "
          >
            Dismiss Audit
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
