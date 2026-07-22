// nav-icons.tsx
// Animated SVG icons for the sidebar navigation.
// Each icon accepts `className` and `isActive` props.
// When `isActive` is true, the icon plays its unique CSS animation.

export interface IconProps {
  className?: string;
  style?: React.CSSProperties;
  isActive?: boolean;
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
export const DashboardIcon = ({ className, isActive }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <rect
      x="3"
      y="3"
      width="7"
      height="7"
      rx="1.5"
      stroke="currentColor"
      strokeWidth="1.6"
      style={{
        transformOrigin: "6.5px 6.5px",
        animation: isActive ? "dashPulse 1.8s ease-in-out infinite" : "none",
      }}
    />
    <rect
      x="14"
      y="3"
      width="7"
      height="7"
      rx="1.5"
      stroke="currentColor"
      strokeWidth="1.6"
      style={{
        transformOrigin: "17.5px 6.5px",
        animation: isActive
          ? "dashPulse 1.8s ease-in-out 0.3s infinite"
          : "none",
      }}
    />
    <rect
      x="3"
      y="14"
      width="7"
      height="7"
      rx="1.5"
      stroke="currentColor"
      strokeWidth="1.6"
      style={{
        transformOrigin: "6.5px 17.5px",
        animation: isActive
          ? "dashPulse 1.8s ease-in-out 0.6s infinite"
          : "none",
      }}
    />
    <rect
      x="14"
      y="14"
      width="7"
      height="7"
      rx="1.5"
      stroke="currentColor"
      strokeWidth="1.6"
      style={{
        transformOrigin: "17.5px 17.5px",
        animation: isActive
          ? "dashPulse 1.8s ease-in-out 0.9s infinite"
          : "none",
      }}
    />
    <style>{`@keyframes dashPulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.5;transform:scale(.88)} }`}</style>
  </svg>
);

// ── Manufacturing ─────────────────────────────────────────────────────────────
export const ManufacturingIcon = ({ className, isActive }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M3 21V9l5-4v4l5-4v4l5-4v16"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
    <path
      d="M3 21h18"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
    <path
      d="M16 8 Q17 6 16 4"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      style={{
        animation: isActive ? "smokeRise 1.4s ease-in-out infinite" : "none",
      }}
    />
    <path
      d="M18 8 Q19 5.5 18 3"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      style={{
        animation: isActive
          ? "smokeRise 1.4s ease-in-out 0.4s infinite"
          : "none",
      }}
    />
    <rect
      x="10"
      y="14"
      width="4"
      height="7"
      rx="0.5"
      stroke="currentColor"
      strokeWidth="1.4"
    />
    <style>{`@keyframes smokeRise { 0%{opacity:0;transform:translateY(4px)} 50%{opacity:1} 100%{opacity:0;transform:translateY(-4px)} }`}</style>
  </svg>
);

// ── Production Run ────────────────────────────────────────────────────────────
export const ProductionRunIcon = ({ className, isActive }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <rect
      x="4"
      y="3"
      width="16"
      height="18"
      rx="2"
      stroke="currentColor"
      strokeWidth="1.6"
    />
    <path
      d="M8 8h8"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      style={{
        animation: isActive ? "lineGrow 1.2s ease-in-out infinite" : "none",
        transformOrigin: "8px 8px",
      }}
    />
    <path
      d="M8 12h5"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      style={{
        animation: isActive
          ? "lineGrow 1.2s ease-in-out 0.3s infinite"
          : "none",
        transformOrigin: "8px 12px",
      }}
    />
    <path
      d="M8 16h6"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      style={{
        animation: isActive
          ? "lineGrow 1.2s ease-in-out 0.6s infinite"
          : "none",
        transformOrigin: "8px 16px",
      }}
    />
    <style>{`@keyframes lineGrow { 0%,100%{opacity:1} 50%{opacity:.4} }`}</style>
  </svg>
);

// ── Recipes ───────────────────────────────────────────────────────────────────
export const RecipesIcon = ({ className, isActive }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M12 3C9 3 7 6 7 9c0 2.5 1.5 4.5 3.5 5.3V19h3v-4.7C15.5 13.5 17 11.5 17 9c0-3-2-6-5-6z"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
    <path
      d="M10.5 19h3"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
    <circle
      cx="10"
      cy="7"
      r="1"
      fill="currentColor"
      opacity="0.6"
      style={{
        animation: isActive ? "bubble 1.6s ease-in-out infinite" : "none",
      }}
    />
    <circle
      cx="14"
      cy="6"
      r="0.8"
      fill="currentColor"
      opacity="0.6"
      style={{
        animation: isActive ? "bubble 1.6s ease-in-out 0.5s infinite" : "none",
      }}
    />
    <circle
      cx="12"
      cy="5"
      r="0.7"
      fill="currentColor"
      opacity="0.6"
      style={{
        animation: isActive ? "bubble 1.6s ease-in-out 0.9s infinite" : "none",
      }}
    />
    <style>{`@keyframes bubble { 0%{transform:translateY(0) scale(1);opacity:.6} 100%{transform:translateY(-5px) scale(0);opacity:0} }`}</style>
  </svg>
);

// ── Inventory Management ──────────────────────────────────────────────────────
export const InventoryIcon = ({ className, isActive }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M21 8l-9-5-9 5v8l9 5 9-5V8z"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
    <path d="M3 8l9 5 9-5" stroke="currentColor" strokeWidth="1.6" />
    <path d="M12 13v8" stroke="currentColor" strokeWidth="1.6" />
    <line
      x1="8"
      y1="10"
      x2="16"
      y2="10"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      style={{
        animation: isActive ? "scanLine 1.5s ease-in-out infinite" : "none",
      }}
    />
    <style>{`@keyframes scanLine { 0%,100%{transform:translateY(0);opacity:1} 50%{transform:translateY(3px);opacity:.3} }`}</style>
  </svg>
);

// ── Warehouses ────────────────────────────────────────────────────────────────
export const WarehouseIcon = ({ className, isActive }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M3 12V21h18V12"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
    <path
      d="M1 12L12 3l11 9"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
    <rect
      x="9"
      y="15"
      width="6"
      height="6"
      rx="0.5"
      stroke="currentColor"
      strokeWidth="1.4"
    />
    <rect
      x="5"
      y="14"
      width="2.5"
      height="2.5"
      rx="0.5"
      stroke="currentColor"
      strokeWidth="1.3"
      style={{
        animation: isActive ? "windowBlink 2s ease-in-out infinite" : "none",
      }}
    />
    <rect
      x="16.5"
      y="14"
      width="2.5"
      height="2.5"
      rx="0.5"
      stroke="currentColor"
      strokeWidth="1.3"
      style={{
        animation: isActive
          ? "windowBlink 2s ease-in-out 0.7s infinite"
          : "none",
      }}
    />
    <style>{`@keyframes windowBlink { 0%,100%{opacity:1} 50%{opacity:.2} }`}</style>
  </svg>
);

// ── Factory Floor ─────────────────────────────────────────────────────────────
export const FactoryFloorIcon = ({ className, isActive }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M5 9h14"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      style={{
        animation: isActive ? "arrowRight 1s ease-in-out infinite" : "none",
      }}
    />
    <path
      d="M15 5l4 4-4 4"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        animation: isActive ? "arrowRight 1s ease-in-out infinite" : "none",
      }}
    />
    <path
      d="M19 15H5"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeDasharray="2 2"
      style={{
        animation: isActive ? "arrowLeft 1s ease-in-out 0.5s infinite" : "none",
      }}
    />
    <path
      d="M9 11l-4 4 4 4"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        animation: isActive ? "arrowLeft 1s ease-in-out 0.5s infinite" : "none",
      }}
    />
    <style>{`
      @keyframes arrowRight { 0%,100%{transform:translateX(0);opacity:1} 50%{transform:translateX(3px);opacity:.6} }
      @keyframes arrowLeft  { 0%,100%{transform:translateX(0);opacity:.5} 50%{transform:translateX(-3px);opacity:.2} }
    `}</style>
  </svg>
);

// ── Suppliers ─────────────────────────────────────────────────────────────────
export const SuppliersIcon = ({ className, isActive }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <circle cx="9" cy="7" r="3" stroke="currentColor" strokeWidth="1.6" />
    <path
      d="M3 21v-2a6 6 0 0 1 6-6"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
    <path
      d="M16 11v6M13 14h6"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      style={{
        animation: isActive ? "supplierPing 1.4s ease-in-out infinite" : "none",
        transformOrigin: "16px 14px",
      }}
    />
    <circle
      cx="16"
      cy="14"
      r="4.5"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeDasharray="3 2"
      style={{
        animation: isActive ? "orbitSpin 3s linear infinite" : "none",
        transformOrigin: "16px 14px",
      }}
    />
    <style>{`
      @keyframes supplierPing { 0%,100%{transform:scale(1)} 50%{transform:scale(1.2)} }
      @keyframes orbitSpin    { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
    `}</style>
  </svg>
);

// ── Sales ─────────────────────────────────────────────────────────────────────
export const SalesIcon = ({ className, isActive }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
    <path d="M3 6h18" stroke="currentColor" strokeWidth="1.6" />
    <path
      d="M16 10a4 4 0 0 1-8 0"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      style={{
        animation: isActive ? "bagBounce 1.2s ease-in-out infinite" : "none",
        transformOrigin: "12px 10px",
      }}
    />
    <style>{`@keyframes bagBounce { 0%,100%{transform:scaleY(1)} 50%{transform:scaleY(1.15)} }`}</style>
  </svg>
);

// ── New Invoice ───────────────────────────────────────────────────────────────
export const InvoiceIcon = ({ className, isActive }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
    <path
      d="M14 2v6h6"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
    <path
      d="M8 13h8"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      style={{
        animation: isActive ? "writeLine 1.4s ease-in-out infinite" : "none",
        transformOrigin: "8px 13px",
      }}
    />
    <path
      d="M8 17h5"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      style={{
        animation: isActive
          ? "writeLine 1.4s 0.4s ease-in-out infinite"
          : "none",
        transformOrigin: "8px 17px",
      }}
    />
    <style>{`@keyframes writeLine { 0%{clip-path:inset(0 100% 0 0)} 60%,100%{clip-path:inset(0 0% 0 0)} }`}</style>
  </svg>
);

// ── Customers ─────────────────────────────────────────────────────────────────
export const CustomersIcon = ({ className, isActive }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <circle cx="8" cy="7" r="3" stroke="currentColor" strokeWidth="1.6" />
    <circle
      cx="16"
      cy="7"
      r="3"
      stroke="currentColor"
      strokeWidth="1.6"
      style={{
        animation: isActive ? "peekIn 1.6s ease-in-out infinite" : "none",
        transformOrigin: "16px 7px",
      }}
    />
    <path
      d="M2 21v-2a6 6 0 0 1 12 0v2"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
    <path
      d="M18 11c2.5.5 4 2.5 4 5v2"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
    <style>{`@keyframes peekIn { 0%,100%{transform:translateX(0);opacity:1} 50%{transform:translateX(2px);opacity:.6} }`}</style>
  </svg>
);

// ── Finance ───────────────────────────────────────────────────────────────────
export const FinanceIcon = ({ className, isActive }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M3 22h18"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
    <path
      d="M3 10h18"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
    <path
      d="M12 2L3 10"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
    <path
      d="M12 2l9 8"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
    {[5, 9, 13, 17].map((x, i) => (
      <line
        key={x}
        x1={x}
        y1="10"
        x2={x}
        y2="22"
        stroke="currentColor"
        strokeWidth="1.4"
        style={{
          animation: isActive
            ? `pillarPulse 1.6s ease-in-out ${i * 0.2}s infinite`
            : "none",
        }}
      />
    ))}
    <style>{`@keyframes pillarPulse { 0%,100%{opacity:1} 50%{opacity:.3} }`}</style>
  </svg>
);

// ── Accounts ──────────────────────────────────────────────────────────────────
export const AccountsIcon = ({ className, isActive }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M21 12V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
    <path
      d="M21 12h-4a2 2 0 0 0 0 4h4"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
    <circle
      cx="17"
      cy="14"
      r="0.8"
      fill="currentColor"
      style={{
        animation: isActive ? "coinPulse 1s ease-in-out infinite" : "none",
      }}
    />
    <style>{`@keyframes coinPulse { 0%,100%{transform:scale(1);opacity:1} 50%{transform:scale(1.8);opacity:.4} }`}</style>
  </svg>
);

// ── Expenses ──────────────────────────────────────────────────────────────────
export const ExpensesIcon = ({ className, isActive }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1-2-1z"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
    <path
      d="M8 10h8"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
    <path
      d="M8 14h5"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
    <path
      d="M16 12l-2 2 2 2"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        animation: isActive ? "expDrop 1s ease-in-out infinite" : "none",
        transformOrigin: "15px 14px",
      }}
    />
    <style>{`@keyframes expDrop { 0%,100%{transform:translateY(0)} 50%{transform:translateY(2px)} }`}</style>
  </svg>
);

// ── Ledger ────────────────────────────────────────────────────────────────────
export const LedgerIcon = ({ className, isActive }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
    <path
      d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
    <path
      d="M9 7h7M9 11h7M9 15h4"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      style={{
        animation: isActive ? "pageFlip 2s ease-in-out infinite" : "none",
      }}
    />
    <style>{`@keyframes pageFlip { 0%,100%{opacity:1} 40%{opacity:.3;transform:scaleX(.9)} 60%{opacity:1;transform:scaleX(1)} }`}</style>
  </svg>
);

// ── Utilities ─────────────────────────────────────────────────────────────────
export const UtilitiesIcon = ({ className, isActive }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M13 2L4.09 12.96A1 1 0 0 0 5 14.5h6.5L11 22l8.91-10.96A1 1 0 0 0 19 9.5H12.5L13 2z"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
      style={{
        animation: isActive ? "bolt 1.2s ease-in-out infinite" : "none",
        transformOrigin: "12px 12px",
      }}
    />
    <style>{`@keyframes bolt { 0%,100%{filter:drop-shadow(0 0 0px currentColor);opacity:1} 50%{filter:drop-shadow(0 0 4px currentColor);opacity:.7} }`}</style>
  </svg>
);

// ── HR & Payroll ──────────────────────────────────────────────────────────────
export const HRIcon = ({ className, isActive }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <circle cx="9" cy="7" r="3" stroke="currentColor" strokeWidth="1.6" />
    <circle cx="17" cy="7" r="3" stroke="currentColor" strokeWidth="1.6" />
    <path
      d="M3 21v-2a6 6 0 0 1 6-6h6a6 6 0 0 1 6 6v2"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      style={{
        animation: isActive ? "hrWave 1.8s ease-in-out infinite" : "none",
        transformOrigin: "12px 18px",
      }}
    />
    <style>{`@keyframes hrWave { 0%,100%{stroke-dasharray:0 40;stroke-dashoffset:0} 50%{stroke-dasharray:40 0} }`}</style>
  </svg>
);

// ── Employees ─────────────────────────────────────────────────────────────────
export const EmployeesIcon = ({ className, isActive }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.6" />
    <path
      d="M4 20a8 8 0 0 1 16 0"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
    <rect
      x="9"
      y="5"
      width="6"
      height="2"
      rx="1"
      fill="currentColor"
      opacity="0"
      style={{
        animation: isActive ? "idFlash 1.5s ease-in-out infinite" : "none",
      }}
    />
    <style>{`@keyframes idFlash { 0%,100%{opacity:0} 50%{opacity:.5} }`}</style>
  </svg>
);

// ── Attendance ────────────────────────────────────────────────────────────────
export const AttendanceIcon = ({ className, isActive }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <rect
      x="3"
      y="4"
      width="18"
      height="18"
      rx="2"
      stroke="currentColor"
      strokeWidth="1.6"
    />
    <path
      d="M16 2v4M8 2v4"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
    <path d="M3 10h18" stroke="currentColor" strokeWidth="1.6" />
    <path
      d="M8 16l2.5 2.5L16 13"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        animation: isActive ? "checkDraw 1.4s ease-in-out infinite" : "none",
      }}
    />
    <style>{`@keyframes checkDraw { 0%{stroke-dasharray:0 20} 60%,100%{stroke-dasharray:20 0} }`}</style>
  </svg>
);

// ── Approval Center ───────────────────────────────────────────────────────────
export const ApprovalIcon = ({ className, isActive }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M9 11l3 3L22 4"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        animation: isActive ? "approveDraw 1.2s ease-in-out infinite" : "none",
      }}
    />
    <path
      d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <style>{`@keyframes approveDraw { 0%{stroke-dasharray:0 30;opacity:.3} 60%,100%{stroke-dasharray:30 0;opacity:1} }`}</style>
  </svg>
);

// ── Payroll ───────────────────────────────────────────────────────────────────
export const PayrollIcon = ({ className, isActive }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <rect
      x="2"
      y="6"
      width="20"
      height="12"
      rx="2"
      stroke="currentColor"
      strokeWidth="1.6"
    />
    <circle
      cx="12"
      cy="12"
      r="3"
      stroke="currentColor"
      strokeWidth="1.5"
      style={{
        animation: isActive ? "coinSpin 1.5s linear infinite" : "none",
        transformOrigin: "12px 12px",
      }}
    />
    <path
      d="M6 9v6M18 9v6"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
    <style>{`@keyframes coinSpin { 0%,100%{transform:scaleX(1)} 50%{transform:scaleX(.2)} }`}</style>
  </svg>
);

// ── Operator Interface ────────────────────────────────────────────────────────
export const OperatorIcon = ({ className, isActive }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <rect
      x="3"
      y="3"
      width="18"
      height="18"
      rx="3"
      stroke="currentColor"
      strokeWidth="1.6"
    />
    <circle
      cx="12"
      cy="12"
      r="3"
      stroke="currentColor"
      strokeWidth="1.5"
      style={{
        animation: isActive ? "gearSpin 2s linear infinite" : "none",
        transformOrigin: "12px 12px",
      }}
    />
    <path
      d="M12 3v3M12 18v3M3 12h3M18 12h3"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      style={{
        animation: isActive ? "gearSpin 2s linear infinite" : "none",
        transformOrigin: "12px 12px",
      }}
    />
    <style>{`@keyframes gearSpin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }`}</style>
  </svg>
);

export const OrderBookerIcon = ({ className, isActive }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <rect
      x="4"
      y="3"
      width="16"
      height="18"
      rx="2"
      stroke="currentColor"
      strokeWidth="1.6"
    />
    <path
      d="M8 8h8M8 12h8M8 16h5"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      style={{
        animation: isActive ? "obPulse 1.6s ease-in-out infinite" : "none",
      }}
    />
    <style>{`@keyframes obPulse { 0%,100%{opacity:1} 50%{opacity:.5} }`}</style>
  </svg>
);

// ── User Management ───────────────────────────────────────────────────────────
export const UserMgmtIcon = ({ className, isActive }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.6" />
    <path
      d="M4 20a8 8 0 0 1 16 0"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
    <path
      d="M17 3l1.5 1-1.5 5-1.5-5L17 3z"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinejoin="round"
      style={{
        animation: isActive ? "shieldPulse 1.4s ease-in-out infinite" : "none",
        transformOrigin: "17px 5px",
      }}
    />
    <style>{`@keyframes shieldPulse { 0%,100%{transform:scale(1);opacity:1} 50%{transform:scale(1.3);opacity:.5} }`}</style>
  </svg>
);

// ── Reports ───────────────────────────────────────────────────────────────────
export const ReportsIcon = ({ className, isActive }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
    <path
      d="M14 2v6h6"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
    <path
      d="M8 13h8"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      style={{
        animation: isActive ? "writeLine 1.4s ease-in-out infinite" : "none",
        transformOrigin: "8px 13px",
      }}
    />
    <path
      d="M8 17h5"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      style={{
        animation: isActive
          ? "writeLine 1.4s 0.4s ease-in-out infinite"
          : "none",
        transformOrigin: "8px 17px",
      }}
    />
    <style>{`@keyframes writeLine { 0%{clip-path:inset(0 100% 0 0)} 60%,100%{clip-path:inset(0 0% 0 0)} }`}</style>
  </svg>
);

// ── Settings ──────────────────────────────────────────────────────────────────
export const SettingsIcon = ({ className, isActive }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <circle
      cx="12"
      cy="12"
      r="3"
      stroke="currentColor"
      strokeWidth="1.6"
      style={{
        animation: isActive ? "settingsSpin 3s linear infinite" : "none",
        transformOrigin: "12px 12px",
      }}
    />
    <path
      d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"
      stroke="currentColor"
      strokeWidth="1.6"
      style={{
        animation: isActive ? "settingsSpin 3s linear infinite" : "none",
        transformOrigin: "12px 12px",
      }}
    />
    <style>{`@keyframes settingsSpin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }`}</style>
  </svg>
);
