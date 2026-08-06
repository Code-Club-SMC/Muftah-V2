import React, { useEffect, useRef, useState, startTransition, memo, useMemo, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Briefcase,
  Building2,
  CalendarDays,
  CheckCircle2,
  Clock,
  CreditCard,
  Globe,
  HeadphonesIcon,
  Lightbulb,
  ScanBarcode,
  User,
  Users,
  XCircle,
} from "lucide-react";
import { scanAttendanceFn } from "@/server-functions/hr/attendance/scan-attendance-fn";
import {
  terminalStatusQueryKey,
  useTerminalStatus,
} from "@/hooks/attendance/use-terminal-status";
import { useTerminalHeartbeat } from "@/hooks/attendance/use-terminal-heartbeat";
import { cn } from "@/lib/utils";

type ScanResult =
  | {
      status: "idle";
    }
  | {
      status: "processing";
    }
  | {
      status: "accepted";
      direction: "in" | "out";
      employeeName: string;
      employeeCode: string;
      attendanceDate: string;
      punchTime: string;
      isLate: boolean | null;
      dutyHours: string;
      isNightShift: boolean;
      message: string;
    }
  | {
      status: "rejected";
      reason: string;
      message: string;
      employeeName?: string;
      employeeCode?: string;
    }
  | {
      status: "duplicate";
      reason: "duplicate_scan";
      message: string;
      employeeName: string;
      employeeCode: string;
    }
  | {
      status: "error";
      message: string;
    };

type WakeLockSentinelLike = {
  release: () => Promise<void>;
};

type NavigatorWithWakeLock = Navigator & {
  wakeLock?: {
    request: (type: "screen") => Promise<WakeLockSentinelLike>;
  };
};

function getPKTClockAndDate(dateObj = new Date()) {
  return {
    time: new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Karachi",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    }).format(dateObj),
    date: new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Karachi",
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(dateObj),
  };
}

function usePKTClockAndDate() {
  const [dateTime, setDateTime] = useState(getPKTClockAndDate());

  useEffect(() => {
    const timer = window.setInterval(() => setDateTime(getPKTClockAndDate()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return dateTime;
}

const BarcodeGraphic = memo(({ className }: { className?: string }) => {
  const bars = [
    4, 2, 6, 2, 8, 2, 4, 4, 2, 6, 4, 2, 8, 2, 6, 2, 4, 6, 2, 8, 4, 2, 6, 4, 2, 6, 2, 8, 4, 6, 2, 4, 2, 8, 4, 2, 6
  ];
  let x = 0;
  return (
    <svg className={className} viewBox={`0 0 ${bars.reduce((a, b) => a + b + 4, 0)} 100`} fill="currentColor" preserveAspectRatio="none">
      {bars.map((w, i) => {
        const rect = <rect key={i} x={x} y="0" width={w} height="100" />;
        x += w + (i % 3 === 0 ? 3 : 5);
        return rect;
      })}
    </svg>
  );
});
BarcodeGraphic.displayName = "BarcodeGraphic";

const FactoryBackground = memo(() => (
  <svg 
    className="absolute bottom-16 left-0 w-full h-[45vh] text-[#0B3A70] opacity-[0.05] pointer-events-none" 
    viewBox="0 0 1440 400" 
    fill="currentColor" 
    preserveAspectRatio="none"
  >
    <path d="M0,400 L0,250 L50,250 L50,200 L80,200 L80,250 L120,250 L120,150 L150,150 L150,250 L200,250 L200,300 L300,300 L300,100 L320,100 L320,300 L400,300 L400,200 L450,200 L450,300 L500,300 L500,150 L550,150 L550,300 L650,300 L650,200 L700,200 L700,300 L800,300 L800,220 L850,220 L850,300 L950,300 L950,100 L970,100 L970,300 L1050,300 L1050,150 L1100,150 L1100,300 L1200,300 L1200,250 L1250,250 L1250,300 L1350,300 L1350,200 L1400,200 L1400,300 L1440,300 L1440,400 Z" />
    <rect x="180" y="50" width="8" height="200" />
    <rect x="520" y="80" width="10" height="220" />
    <rect x="820" y="120" width="8" height="180" />
    <rect x="1120" y="60" width="12" height="240" />
  </svg>
));
FactoryBackground.displayName = "FactoryBackground";

const LiveHeader = memo(() => {
  const { time, date } = usePKTClockAndDate();
  return (
    <header className="bg-[#0B3A70] text-white px-10 py-5 flex justify-between items-center z-20 shadow-md">
      <div className="flex items-center gap-5">
        <img
          src="/company-logo.svg"
          alt="Muftah Chemical"
          className="h-16 w-auto bg-white p-1.5 rounded-xl shadow-lg"
        />
        <div className="flex flex-col">
          <h1 className="text-[1.75rem] font-bold tracking-wide mb-1">Muftah Chemical PVT Limited</h1>
          <p className="text-blue-200/90 text-[1.1rem] font-medium">Attendance Management System</p>
        </div>
      </div>
      <div className="flex items-center gap-5">
        <Clock className="w-12 h-12 text-white/90" strokeWidth={1.5} />
        <div className="flex flex-col text-right">
          <div className="text-[1.75rem] font-bold tracking-wide mb-1">{time}</div>
          <div className="text-blue-200/90 text-[1.1rem] font-medium">{date}</div>
        </div>
      </div>
    </header>
  );
});
LiveHeader.displayName = "LiveHeader";

const TerminalFooter = memo(({
  isOnline,
  scannerActive,
}: {
  isOnline: boolean;
  scannerActive: boolean;
}) => (
  <footer className="bg-[#0A2540] text-white px-12 py-6 flex justify-between items-center z-20 shadow-[0_-4px_20px_rgba(0,0,0,0.1)] text-sm">
    <div className="flex items-center gap-5">
      <ScanBarcode className="w-10 h-10 text-white/80" strokeWidth={1.5} />
      <div className="flex flex-col">
        <span className="font-semibold text-white text-base">Scanner Connected</span>
        <span className="text-slate-400 text-sm mt-0.5">2D Barcode Scanner</span>
      </div>
      <div className={cn(
        "w-3.5 h-3.5 rounded-full ml-5 shadow-[0_0_12px_rgba(34,197,94,0.6)] transition-colors",
        scannerActive ? "bg-green-500" : "bg-amber-500 shadow-amber-500"
      )} />
    </div>

    <div className="h-12 w-[1px] bg-white/10" />

    <div className="flex items-center gap-5">
      <Globe className="w-10 h-10 text-white/80" strokeWidth={1.5} />
      <div className="flex flex-col">
        <span className="font-semibold text-white text-base">
          {isOnline ? "System Online" : "System Offline"}
        </span>
        <span className="text-slate-400 text-sm mt-0.5">
          {isOnline
            ? "All systems operational"
            : "Record attendance in assigned Excel workbook"}
        </span>
      </div>
      <div className={`w-3.5 h-3.5 rounded-full ml-5 shadow-[0_0_12px_rgba(34,197,94,0.6)] ${isOnline ? 'bg-green-500' : 'bg-red-500 shadow-red-500'}`} />
    </div>

    <div className="h-12 w-[1px] bg-white/10" />

    <div className="flex items-center gap-5">
      <HeadphonesIcon className="w-10 h-10 text-white/80" strokeWidth={1.5} />
      <div className="flex flex-col">
        <span className="font-semibold text-white text-base">Need Help?</span>
        <span className="text-slate-400 text-sm mt-0.5">Contact HR / Admin for assistance</span>
      </div>
    </div>
  </footer>
));
TerminalFooter.displayName = "TerminalFooter";

const StandbyMode = memo(({ isProcessing }: { isProcessing: boolean }) => (
  <div className="relative z-10 flex flex-col items-center max-w-4xl w-full">
    <div className="flex items-center bg-white rounded-full px-4 py-1.5 shadow-[0_4px_12px_rgba(0,0,0,0.05)] border border-slate-200/60 mb-6 gap-3">
      <div className="flex items-center gap-2 pr-3 border-r border-slate-200">
        <div className="w-2.5 h-2.5 bg-[#0B3A70] rounded-full" />
        <span className="text-[#0B3A70] font-bold text-sm tracking-widest uppercase">STANDBY MODE</span>
      </div>
      <span className="text-slate-500 text-sm font-medium">{isProcessing ? "Processing Scan..." : "Waiting for Scan"}</span>
    </div>

    <h2 className="text-[3.25rem] font-bold text-[#0B3A70] mb-2 tracking-tight">Scan Employee Card</h2>
    
    <div className="flex items-center gap-2 mb-2">
      <div className="flex gap-[3px]">
        {[...Array(6)].map((_, i) => <div key={i} className="w-1 h-5 bg-[#0B3A70] opacity-80 rounded-full" />)}
      </div>
    </div>
    
    <p className="text-slate-500 text-xl mb-10 font-medium">Present your employee card barcode to the scanner</p>

    <div className={cn(
      "relative bg-white rounded-[2rem] p-12 shadow-[0_8px_30px_rgb(0,0,0,0.06)] border border-white w-full max-w-[650px] aspect-[21/9] flex items-center justify-center mb-10 overflow-hidden transition-opacity duration-300",
      isProcessing && "opacity-50"
    )}>
      <div className="absolute top-8 left-8 w-10 h-10 border-t-4 border-l-4 border-[#0B3A70] rounded-tl-2xl" />
      <div className="absolute top-8 right-8 w-10 h-10 border-t-4 border-r-4 border-[#0B3A70] rounded-tr-2xl" />
      <div className="absolute bottom-8 left-8 w-10 h-10 border-b-4 border-l-4 border-[#0B3A70] rounded-bl-2xl" />
      <div className="absolute bottom-8 right-8 w-10 h-10 border-b-4 border-r-4 border-[#0B3A70] rounded-br-2xl" />

      <BarcodeGraphic className="w-full h-32 text-[#111827]" />
      
      {!isProcessing && (
        <div 
          className="absolute left-0 right-0 h-[3px] bg-[#3B82F6] shadow-[0_0_25px_8px_rgba(59,130,246,0.8)]" 
          style={{ animation: 'scanLine 2.5s cubic-bezier(0.4, 0, 0.2, 1) infinite' }} 
        />
      )}
    </div>

    <div className="flex bg-[#F0F5FF] rounded-2xl p-7 gap-8 shadow-[0_4px_20px_rgba(11,58,112,0.05)] border border-[#0B3A70]/10 max-w-3xl w-full">
      <div className="flex gap-5 flex-1 items-start">
        <div className="bg-[#0B3A70] text-white p-3.5 rounded-full shrink-0 mt-0.5 shadow-md">
          <CreditCard className="w-7 h-7" strokeWidth={1.5} />
        </div>
        <div>
          <h4 className="font-bold text-[#0B3A70] text-lg mb-1">Employee Card Barcode</h4>
          <p className="text-[#0B3A70]/70 leading-relaxed font-medium">Hold your card steady in front of the scanner until the scan is complete.</p>
        </div>
      </div>
      
      <div className="w-[1px] bg-[#0B3A70]/15 shrink-0" />
      
      <div className="flex gap-5 flex-1 items-start">
        <div className="bg-[#0B3A70] text-white p-3.5 rounded-full shrink-0 mt-0.5 shadow-md">
          <Lightbulb className="w-7 h-7" strokeWidth={1.5} />
        </div>
        <div>
          <h4 className="font-bold text-[#0B3A70] text-lg mb-1">Tip</h4>
          <p className="text-[#0B3A70]/70 leading-relaxed font-medium">Ensure the barcode is clear and well-lit for best results.</p>
        </div>
      </div>
    </div>
  </div>
));
StandbyMode.displayName = "StandbyMode";

const ResultCard = memo(({ result }: { result: Exclude<ScanResult, {status: 'idle'|'processing'}> }) => {
  const fallback = useMemo(() => getPKTClockAndDate(), [result]);

  const isAccepted = result.status === "accepted";
  const isWarning = result.status === "duplicate";

  const theme = isAccepted 
    ? {
        dot: "bg-green-500",
        text: "text-green-600",
        bgLight: "bg-[#E6F4EA]",
        borderLight: "border-green-200",
        iconBg: "bg-green-500 text-white shadow-[0_0_15px_rgba(34,197,94,0.4)]",
        fieldBg: "bg-green-50 text-green-600",
        bottomAlertBg: "bg-[#E6F4EA]",
        bottomAlertBorder: "border-green-200",
        bottomAlertIconBg: "bg-green-600 text-white",
        bottomAlertText: "text-green-800",
        accent: "bg-green-600",
      }
    : isWarning 
    ? {
        dot: "bg-amber-500",
        text: "text-amber-600",
        bgLight: "bg-[#FFF8E1]",
        borderLight: "border-amber-200",
        iconBg: "bg-amber-500 text-white shadow-[0_0_15px_rgba(245,158,11,0.4)]",
        fieldBg: "bg-amber-50 text-amber-600",
        bottomAlertBg: "bg-[#FFF8E1]",
        bottomAlertBorder: "border-amber-200",
        bottomAlertIconBg: "bg-amber-600 text-white",
        bottomAlertText: "text-amber-800",
        accent: "bg-amber-600",
      }
    : {
        dot: "bg-red-500",
        text: "text-red-600",
        bgLight: "bg-red-50",
        borderLight: "border-red-200",
        iconBg: "bg-red-500 text-white shadow-[0_0_15px_rgba(239,68,68,0.4)]",
        fieldBg: "bg-red-50 text-red-600",
        bottomAlertBg: "bg-red-50",
        bottomAlertBorder: "border-red-200",
        bottomAlertIconBg: "bg-red-600 text-white",
        bottomAlertText: "text-red-800",
        accent: "bg-red-600",
      };

  const StatusIcon = isAccepted ? CheckCircle2 : isWarning ? AlertTriangle : XCircle;

  const eyebrow = isAccepted ? "SCAN COMPLETE" : isWarning ? "DUPLICATE SCAN" : "SCAN FAILED";
  const eyebrowSub = isAccepted 
    ? (result.direction === "in" ? "Check-In Recorded" : "Check-Out Recorded")
    : isWarning ? "Already recorded" : "Error occurred";
  
  const title = isAccepted 
    ? (result.direction === "in" ? "Check-In Successful" : "Check-Out Successful")
    : isWarning ? "Duplicate Scan" : "Scan Rejected";

  const message = result.message;

  const empName = 'employeeName' in result && result.employeeName ? result.employeeName : "---";
  const empCode = 'employeeCode' in result && result.employeeCode ? result.employeeCode : "---";
  const hasDetails = !!('employeeName' in result && result.employeeName);
  
  const displayTime = 'punchTime' in result && result.punchTime ? result.punchTime : fallback.time;
  const displayDate = 'attendanceDate' in result && result.attendanceDate ? result.attendanceDate : fallback.date;

  return (
    <div className="relative z-10 flex flex-col items-center max-w-4xl w-full">
      <div className="flex items-center bg-white rounded-full px-4 py-1.5 shadow-[0_4px_12px_rgba(0,0,0,0.05)] border border-slate-200/60 mb-6 gap-3">
        <div className="flex items-center gap-2 pr-3 border-r border-slate-200">
          <div className={`w-2.5 h-2.5 rounded-full ${theme.dot}`} />
          <span className={`font-bold text-sm tracking-widest uppercase ${theme.text}`}>{eyebrow}</span>
        </div>
        <span className="text-slate-500 font-medium text-sm">{eyebrowSub}</span>
      </div>

      <div className="flex items-center gap-4 mb-2">
        <div className={`rounded-full p-1.5 ${theme.iconBg}`}>
          <StatusIcon className="w-12 h-12" strokeWidth={3} />
        </div>
        <h2 className={`text-[3.25rem] font-bold tracking-tight ${theme.text}`}>{title}</h2>
      </div>
      
      <div className="flex items-center gap-2 mb-2 mt-3">
        <div className="flex gap-[3px]">
          {[...Array(6)].map((_, i) => <div key={i} className={`w-1 h-5 rounded-full opacity-80 ${theme.accent}`} />)}
        </div>
      </div>
      
      <p className="text-slate-500 text-xl mb-8 font-medium">{message}</p>

      {hasDetails && (
        <div className="bg-white rounded-[1.5rem] shadow-[0_8px_30px_rgb(0,0,0,0.08)] border border-slate-100 w-full overflow-hidden max-w-3xl">
          <div className="p-8 grid grid-cols-2 gap-y-7 gap-x-12">
            <div className="flex items-center gap-4">
              <div className={`p-3 rounded-full shrink-0 ${theme.fieldBg}`}>
                <CreditCard className="w-6 h-6" strokeWidth={1.5} />
              </div>
              <div className="flex w-full items-center">
                <span className="text-sm font-bold text-slate-500 w-32 uppercase tracking-wide">Employee Code</span>
                <span className="text-slate-300 mx-2">:</span>
                <span className="font-semibold text-slate-800 text-lg flex-1">{empCode}</span>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className={`p-3 rounded-full shrink-0 ${theme.fieldBg}`}>
                <Building2 className="w-6 h-6" strokeWidth={1.5} />
              </div>
              <div className="flex w-full items-center">
                <span className="text-sm font-bold text-slate-500 w-32 uppercase tracking-wide">Department</span>
                <span className="text-slate-300 mx-2">:</span>
                <span className="font-semibold text-slate-800 text-lg flex-1">Production</span>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className={`p-3 rounded-full shrink-0 ${theme.fieldBg}`}>
                <User className="w-6 h-6" strokeWidth={1.5} />
              </div>
              <div className="flex w-full items-center">
                <span className="text-sm font-bold text-slate-500 w-32 uppercase tracking-wide">Employee Name</span>
                <span className="text-slate-300 mx-2">:</span>
                <span className="font-semibold text-slate-800 text-lg flex-1">{empName}</span>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className={`p-3 rounded-full shrink-0 ${theme.fieldBg}`}>
                <Briefcase className="w-6 h-6" strokeWidth={1.5} />
              </div>
              <div className="flex w-full items-center">
                <span className="text-sm font-bold text-slate-500 w-32 uppercase tracking-wide">Designation</span>
                <span className="text-slate-300 mx-2">:</span>
                <span className="font-semibold text-slate-800 text-lg flex-1">Process Operator</span>
              </div>
            </div>
          </div>
          
          <div className="px-8 py-6 border-y border-slate-100 bg-[#F8FAFC] flex flex-col items-center">
            <span className="text-xs font-bold text-slate-400 tracking-[0.2em] uppercase mb-4 self-start">Scanned Barcode</span>
            <BarcodeGraphic className="h-16 w-full max-w-xl text-slate-800" />
          </div>

          <div className="p-8 grid grid-cols-3 gap-6">
             <div className="flex items-center gap-4">
              <div className={`p-3 rounded-full shrink-0 ${theme.fieldBg}`}>
                <Clock className="w-6 h-6" strokeWidth={1.5} />
              </div>
              <div>
                <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">{isAccepted && result.direction === "out" ? "Check-Out Time" : "Check-In Time"}</div>
                <div className="font-bold text-slate-800 text-lg">{displayTime}</div>
              </div>
             </div>

             <div className="flex items-center gap-4 border-l border-slate-100 pl-6">
              <div className={`p-3 rounded-full shrink-0 ${theme.fieldBg}`}>
                <CalendarDays className="w-6 h-6" strokeWidth={1.5} />
              </div>
              <div>
                <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Date</div>
                <div className="font-bold text-slate-800 text-lg">{displayDate}</div>
              </div>
             </div>

             <div className="flex items-center gap-4 border-l border-slate-100 pl-6">
              <div className={`p-3 rounded-full shrink-0 ${theme.fieldBg}`}>
                <CheckCircle2 className="w-6 h-6" strokeWidth={1.5} />
              </div>
              <div>
                <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Status</div>
                <div className={`font-bold text-lg ${theme.text}`}>
                  {isAccepted 
                    ? ('isLate' in result && result.isLate ? "Late Arrival" : "Present")
                    : isWarning ? "Duplicate" : "Rejected"}
                </div>
              </div>
             </div>
          </div>

          {isAccepted && (
            <div className={`mx-8 mb-8 border rounded-xl p-4 flex items-center gap-4 ${theme.bottomAlertBg} ${theme.bottomAlertBorder}`}>
              <div className={`p-2 rounded-full ${theme.bottomAlertIconBg}`}>
                <Users className="w-5 h-5" strokeWidth={1.5} />
              </div>
              <span className={`font-semibold ${theme.bottomAlertText}`}>
                {result.direction === "in" ? "Welcome. Please proceed to your workstation." : "Goodbye. Have a safe trip home."}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
ResultCard.displayName = "ResultCard";

export function ScanTerminal() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const queryClient = useQueryClient();
  const statusQuery = useTerminalStatus();
  const [rawPayload, setRawPayload] = useState("");
  const [result, setResult] = useState<ScanResult>({ status: "idle" });
  const [scannerActive, setScannerActive] = useState(false);
  const isOnline = statusQuery.isSuccess;
  useTerminalHeartbeat(isOnline);

  const scanMutation = useMutation({
    mutationFn: scanAttendanceFn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: terminalStatusQueryKey });
      void queryClient.invalidateQueries({ queryKey: ["daily-attendance"] });
    },
  });

  const focusInput = useCallback(() => {
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const ensureAudioContext = useCallback(() => {
    if (audioContextRef.current) return audioContextRef.current;
    const AudioContextClass =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextClass) return null;
    audioContextRef.current = new AudioContextClass();
    return audioContextRef.current;
  }, []);

  const playTone = useCallback((frequency: number, delay = 0) => {
    const audioContext = ensureAudioContext();
    if (!audioContext) return;

    const startTime = audioContext.currentTime + delay;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, startTime);
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(0.16, startTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.16);

    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(startTime);
    oscillator.stop(startTime + 0.18);
  }, [ensureAudioContext]);

  const playBeep = useCallback((nextResult: ScanResult) => {
    if (nextResult.status === "accepted") {
      playTone(nextResult.direction === "in" ? 880 : 660);
      return;
    }

    if (nextResult.status === "duplicate") {
      playTone(440);
      return;
    }

    if (nextResult.status === "rejected" || nextResult.status === "error") {
      playTone(220);
      playTone(220, 0.22);
    }
  }, [playTone]);

  useEffect(() => {
    focusInput();
    const refocus = () => focusInput();
    document.addEventListener("click", refocus);
    window.addEventListener("focus", refocus);

    // Keep the hidden scanner input focused at all times.
    const keepAlive = window.setInterval(() => {
      if (document.activeElement !== inputRef.current) {
        focusInput();
      }
    }, 300);

    return () => {
      document.removeEventListener("click", refocus);
      window.removeEventListener("focus", refocus);
      window.clearInterval(keepAlive);
    };
  }, [focusInput]);

  useEffect(() => {
    let wakeLock: WakeLockSentinelLike | null = null;
    const wakeLockApi = (navigator as NavigatorWithWakeLock).wakeLock;

    void wakeLockApi
      ?.request("screen")
      .then((lock) => {
        wakeLock = lock;
      })
      .catch(() => {
        wakeLock = null;
      });

    return () => {
      void wakeLock?.release().catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    if (result.status === "idle" || result.status === "processing") return;
    const timer = window.setTimeout(() => {
      startTransition(() => setResult({ status: "idle" }));
      focusInput();
    }, 10_000);
    return () => window.clearTimeout(timer);
  }, [result, focusInput]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const payload = rawPayload.trim();
    setRawPayload("");

    if (!payload || scanMutation.isPending) {
      focusInput();
      return;
    }

    startTransition(() => setResult({ status: "processing" }));

    try {
      const nextResult = await scanMutation.mutateAsync({
        data: { rawPayload: payload },
      });
      startTransition(() => setResult(nextResult));
      playBeep(nextResult);
    } catch {
      const message =
        "Internet unavailable. Record this IN/OUT event in the assigned attendance workbook.";
      const nextResult: ScanResult = { status: "error", message };
      startTransition(() => setResult(nextResult));
      playBeep(nextResult);
    } finally {
      focusInput();
    }
  };

  const isIdle = result.status === "idle" || result.status === "processing";

  return (
    <main
      className="flex flex-col h-screen overflow-hidden bg-[#F4F7FB] font-sans text-slate-800 selection:bg-[#0B3A70] selection:text-white"
      onPointerDown={focusInput}
    >
      <style>{`
        @keyframes scanLine {
          0% { top: 10%; opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { top: 90%; opacity: 0; }
        }
      `}</style>

      <form onSubmit={handleSubmit} aria-label="Attendance scanner input">
        <input
          ref={inputRef}
          value={rawPayload}
          onChange={(event) => setRawPayload(event.target.value)}
          onFocus={() => setScannerActive(true)}
          onBlur={() => setScannerActive(false)}
          autoFocus
          autoComplete="off"
          aria-label="Raw card scan payload"
          className="sr-only"
        />
      </form>

      <LiveHeader />

      <div className="flex-1 relative flex items-center justify-center p-8 overflow-hidden">
        <FactoryBackground />
        
        {isIdle ? (
          <StandbyMode isProcessing={result.status === "processing"} />
        ) : (
          <ResultCard result={result} />
        )}
      </div>

      <TerminalFooter isOnline={isOnline} scannerActive={scannerActive} />
    </main>
  );
}
