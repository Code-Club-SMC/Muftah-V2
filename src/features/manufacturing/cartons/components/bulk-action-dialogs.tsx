import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type BulkDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cartonIds: string[];
  onConfirm: (payload: any) => void;
  isPending: boolean;
};

export function BulkTopUpDialog({ open, onOpenChange, cartonIds, onConfirm, isPending }: BulkDialogProps) {
  const [delta, setDelta] = useState(1);
  const [reason, setReason] = useState("");

  const handleConfirm = () => {
    onConfirm({ delta, reason });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bulk Top-Up</DialogTitle>
          <DialogDescription>Add packs to the {cartonIds.length} selected cartons.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Packs to Add (Per Carton)</Label>
            <Input type="number" min={1} value={delta} onChange={(e) => setDelta(Math.max(1, parseInt(e.target.value) || 1))} />
          </div>
          <div className="space-y-2">
            <Label>Reason / Notes</Label>
            <Input placeholder="Optional reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleConfirm} disabled={isPending}>Confirm</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function BulkRemoveDialog({ open, onOpenChange, cartonIds, onConfirm, isPending }: BulkDialogProps) {
  const [delta, setDelta] = useState(1);
  const [reason, setReason] = useState("QC_FAIL");
  const [notes, setNotes] = useState("");

  const handleConfirm = () => {
    onConfirm({ delta, reason, notes });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bulk Remove Packs</DialogTitle>
          <DialogDescription>Remove packs from the {cartonIds.length} selected cartons.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Packs to Remove (Per Carton)</Label>
            <Input type="number" min={1} value={delta} onChange={(e) => setDelta(Math.max(1, parseInt(e.target.value) || 1))} />
          </div>
          <div className="space-y-2">
            <Label>Removal Reason</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="QC_FAIL">QC Fail</SelectItem>
                <SelectItem value="DAMAGED">Damaged</SelectItem>
                <SelectItem value="TRANSFER">Transfer</SelectItem>
                <SelectItem value="OTHER">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Notes</Label>
            <Input placeholder="Optional notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleConfirm} variant="destructive" disabled={isPending}>Remove</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function BulkOverrideDialog({ open, onOpenChange, cartonIds, onConfirm, isPending }: BulkDialogProps) {
  const [newCount, setNewCount] = useState(0);
  const [reason, setReason] = useState("");

  const handleConfirm = () => {
    onConfirm({ newCount, reason });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bulk Pack Count Override</DialogTitle>
          <DialogDescription>Force pack counts for the {cartonIds.length} selected cartons.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>New Pack Count</Label>
            <Input type="number" min={0} value={newCount} onChange={(e) => setNewCount(Math.max(0, parseInt(e.target.value) || 0))} />
          </div>
          <div className="space-y-2">
            <Label>Justification</Label>
            <Input placeholder="Required reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleConfirm} disabled={isPending || !reason.trim()}>Apply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function BulkRepackDialog({ open, onOpenChange, cartonIds, onConfirm, isPending }: BulkDialogProps) {
  const [newCapacity, setNewCapacity] = useState(1);
  const [justification, setJustification] = useState("");

  const handleConfirm = () => {
    onConfirm({ newCapacity, justification });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bulk Repack Cartons</DialogTitle>
          <DialogDescription>Update storage capacity for the {cartonIds.length} selected cartons.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>New Capacity</Label>
            <Input type="number" min={1} value={newCapacity} onChange={(e) => setNewCapacity(Math.max(1, parseInt(e.target.value) || 1))} />
          </div>
          <div className="space-y-2">
            <Label>Justification</Label>
            <Input placeholder="Required justification" value={justification} onChange={(e) => setJustification(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleConfirm} disabled={isPending || justification.length < 10}>Repack</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function BulkHoldDialog({ open, onOpenChange, cartonIds, onConfirm, isPending }: BulkDialogProps) {
  const [reason, setReason] = useState("");

  const handleConfirm = () => {
    onConfirm({ reason });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Apply Bulk QC Hold</DialogTitle>
          <DialogDescription>Place the {cartonIds.length} selected cartons on hold.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Hold Reason</Label>
            <Input placeholder="Required hold reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleConfirm} variant="destructive" disabled={isPending || reason.length < 5}>Hold</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function BulkReleaseHoldDialog({ open, onOpenChange, cartonIds, onConfirm, isPending }: BulkDialogProps) {
  const [outcome, setOutcome] = useState<"CLEARED" | "CONDEMNED">("CLEARED");

  const handleConfirm = () => {
    onConfirm({ outcome });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Release Bulk QC Hold</DialogTitle>
          <DialogDescription>Release the hold on the {cartonIds.length} selected cartons.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Release Outcome</Label>
            <Select value={outcome} onValueChange={(val: any) => setOutcome(val)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CLEARED">Cleared for Use</SelectItem>
                <SelectItem value="CONDEMNED">Condemn & Retire</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleConfirm} disabled={isPending}>Release</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

