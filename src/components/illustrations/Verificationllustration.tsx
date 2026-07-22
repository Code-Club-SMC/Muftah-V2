import { AmbientBase, sharedTransition } from "./AmbientBase";
import { motion } from "framer-motion";

export const VerificationIllustration = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 120 120" fill="none" className={className}>
    <AmbientBase />
    <motion.ellipse cx="60" cy="95" rx="35" ry="10" fill="url(#authGlow)" animate={{ rx: [30, 40, 30], opacity: [0.3, 0.8, 0.3] }} transition={sharedTransition} />

    <motion.g animate={{ y: [0, -5, 0] }} transition={sharedTransition}>
      {/* Floating abstract documents */}
      <rect x="25" y="25" width="45" height="60" rx="4" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.2" transform="rotate(-15 25 25)" />

      {/* The main envelope document */}
      <path d="M30 25a4 4 0 0 1 4-4h30l16 16v54a4 4 0 0 1-4 4H34a4 4 0 0 1-4-4V25z" fill="#ECFDF5" fillOpacity="0.05" stroke="url(#authGrad)" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M64 21v16h16" stroke="url(#authGrad)" strokeWidth="2.5" strokeLinejoin="round" />

      {/* Invoice Content */}
      <path d="M40 45h20M40 55h30M40 65h15" stroke="url(#authGrad)" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.6" />

      {/* Check/Paid Stamp */}
      <motion.g animate={{ scale: [0.95, 1.05, 0.95], opacity: [0.7, 1, 0.7] }} transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }} style={{ originX: "70px", originY: "75px" }}>
        <circle cx="70" cy="75" r="12" fill="#10B981" fillOpacity="0.1" stroke="url(#authGrad)" strokeWidth="2" strokeOpacity="0.8" />
        <path d="M66 75l3 3 7-7" stroke="url(#authGrad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" strokeOpacity="0.9" />
      </motion.g>
    </motion.g>
  </svg>
);