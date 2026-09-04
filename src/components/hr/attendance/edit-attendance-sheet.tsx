import { EditAttendanceForm } from "./edit-attendance-form";
import { format, parseISO } from "date-fns";
import { ResponsiveSheet } from "@/components/custom/responsive-sheet";
import { UserCheck } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: {
    id: string;
    firstName: string;
    lastName: string;
    shiftStartTime?: string | null;
    shiftEndTime?: string | null;
    restDays?: number[] | null;
    [key: string]: any;
  };
  attendance?: {
    checkIn?: string | null;
    checkOut?: string | null;
    dutyHours?: string | null;
    overtimeHours?: string | null;
    // FIX: leaveType was missing — it's now threaded through correctly
    leaveType?: "sick" | "annual" | "special" | "compensatory" | null;
    status: "present" | "absent" | "leave" | "holiday";
    isLate?: boolean | null;
    isNightShift?: boolean | null;
    isApprovedLeave?: boolean | null;
    earlyDepartureStatus?: "none" | "pending" | "approved" | "rejected" | null;
    overtimeStatus?: "pending" | "approved" | "rejected" | null;
    overtimeRemarks?: string | null;
    entrySource?: string | null;
    notes?: string | null;

    // Order Booker
    areaVisited?: string | null;
    paymentMode?: "per_km" | null;
    distanceKm?: string | null;
    perKmRate?: string | null;
    saleAmount?: string | null;
    recoveryAmount?: string | null;
    returnAmount?: string | null;
    slipNumbers?: string | null;
    shopType?: "old" | "new" | null;
  } | null;
  date: string;
}

export const EditAttendanceSheet = ({
  open,
  onOpenChange,
  employee,
  attendance,
  date,
}: Props) => {
  const formattedDate = format(parseISO(date), "PPP");

  return (
    <ResponsiveSheet
      title="Attendance Management"
      description={`Log or update work records for ${employee.firstName} ${employee.lastName} on ${formattedDate}.`}
      open={open}
      onOpenChange={onOpenChange}
      icon={UserCheck}
    >
      <EditAttendanceForm
        employee={employee}
        attendance={attendance as any}
        date={date}
        onSuccess={() => onOpenChange(false)}
      />
    </ResponsiveSheet>
  );
};
