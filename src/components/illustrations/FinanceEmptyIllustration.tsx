import { motion } from "framer-motion";

export const FinanceEmptyIllustration = ({ className }: { className?: string }) => {
  return (
    <svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" className={`max-w-[240px] w-full h-auto mx-auto ${className || ""}`}>
      <defs>
        <radialGradient id="finGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#059669" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#059669" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="finGrad" x1="0" y1="0" x2="120" y2="120">
          <stop offset="0%" stopColor="#34D399" />
          <stop offset="100%" stopColor="#047857" />
        </linearGradient>
        <linearGradient id="goldGrad" x1="0" y1="0" x2="10" y2="10">
          <stop offset="0%" stopColor="#FBBF24" />
          <stop offset="100%" stopColor="#D97706" />
        </linearGradient>
      </defs>

      <motion.rect x="20" y="30" width="80" height="60" rx="10" fill="url(#finGlow)" animate={{ y: [0, -3, 0], opacity: [0.6, 1, 0.6] }} transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }} />

      <motion.rect x="30" y="40" width="80" height="60" rx="10" stroke="url(#finGrad)" strokeWidth="2" fill="currentColor" fillOpacity="0.02" animate={{ y: [0, -4, 0] }} transition={{ duration: 4, repeat: Infinity, ease: "easeInOut", delay: 0.2 }} />

      <motion.g animate={{ y: [0, -4, 0] }} transition={{ duration: 4, repeat: Infinity, ease: "easeInOut", delay: 0.2 }}>
        <motion.rect x="42" y="75" width="8" height="15" rx="3" fill="url(#finGrad)" fillOpacity="0.4" animate={{ height: [15, 20, 15], y: [60, 55, 60] }} transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }} />
        <motion.rect x="56" y="65" width="8" height="25" rx="3" fill="url(#finGrad)" fillOpacity="0.6" animate={{ height: [25, 30, 25], y: [50, 45, 50] }} transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut", delay: 0.2 }} />
        <motion.rect x="70" y="50" width="8" height="40" rx="3" fill="url(#finGrad)" animate={{ height: [40, 45, 40], y: [35, 30, 35] }} transition={{ duration: 3, repeat: Infinity, ease: "easeInOut", delay: 0.4 }} />
        <motion.rect x="84" y="60" width="8" height="30" rx="3" fill="url(#finGrad)" fillOpacity="0.8" animate={{ height: [30, 25, 30], y: [45, 50, 45] }} transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut", delay: 0.6 }} />
      </motion.g>

      <motion.g animate={{ y: [0, -8, 0] }} transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}>
        <circle cx="35" cy="30" r="12" stroke="url(#goldGrad)" strokeWidth="2" fill="#FEF3C7" fillOpacity="0.1" />
        <path d="M35" fill="none"/>
        <path d="M35 23V37M30 30H40" stroke="url(#goldGrad)" strokeWidth="2" strokeLinecap="round" />
        <motion.circle cx="35" cy="30" r="16" stroke="url(#goldGrad)" strokeWidth="1" strokeOpacity="0.5" fill="none" strokeDasharray="3 4" animate={{ rotate: 360 }} transition={{ duration: 8, repeat: Infinity, ease: "linear" }} style={{ transformOrigin: "35px 30px" }} />
      </motion.g>

      <motion.circle cx="85" cy="20" r="5" stroke="url(#finGrad)" strokeWidth="1.5" fill="#34D399" fillOpacity="0.2" animate={{ y: [0, -5, 0], x: [0, 3, 0] }} transition={{ duration: 4, repeat: Infinity, ease: "easeInOut", delay: 1 }} />
      <motion.path d="M85 17V23M82 20H88" stroke="url(#finGrad)" strokeWidth="1.5" strokeLinecap="round" animate={{ y: [0, -5, 0], x: [0, 3, 0] }} transition={{ duration: 4, repeat: Infinity, ease: "easeInOut", delay: 1 }} />
    </svg>
  );
};
