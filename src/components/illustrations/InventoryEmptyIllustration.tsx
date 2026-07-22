import { motion } from "framer-motion";

export const InventoryEmptyIllustration = ({ className }: { className?: string }) => {
  return (
    <svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" className={`max-w-[240px] w-full h-auto mx-auto ${className || ""}`}>
      <defs>
        <radialGradient id="invGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#D97706" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#D97706" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="invGrad" x1="0" y1="0" x2="120" y2="120">
          <stop offset="0%" stopColor="#FBBF24" />
          <stop offset="100%" stopColor="#B45309" />
        </linearGradient>
      </defs>

      <motion.ellipse cx="60" cy="95" rx="40" ry="12" fill="url(#invGlow)" animate={{ rx: [35, 40, 35], opacity: [0.6, 1, 0.6] }} transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }} />

      <g transform="translate(0, 15)">
        <path d="M40 50 L60 40 L80 50 L80 70 L60 80 L40 70 Z" fill="currentColor" fillOpacity="0.02" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeOpacity="0.2" />
        <path d="M40 50 L60 60 L80 50 M60 60 L60 80" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeOpacity="0.2" />
      </g>

      <motion.g animate={{ y: [0, -3, 0] }} transition={{ duration: 4, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}>
        <path d="M50 45 L70 35 L90 45 L90 65 L70 75 L50 65 Z" fill="#D97706" fillOpacity="0.05" stroke="url(#invGrad)" strokeWidth="1.5" strokeLinejoin="round" strokeOpacity="0.6" />
        <path d="M50 45 L70 55 L90 45 M70 55 L70 75" stroke="url(#invGrad)" strokeWidth="1.5" strokeLinejoin="round" strokeOpacity="0.6" />
      </motion.g>

      <motion.g animate={{ y: [0, -6, 0] }} transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}>
        <path d="M30 35 L50 25 L70 35 L70 55 L50 65 L30 55 Z" fill="#FFFBEB" fillOpacity="0.05" stroke="url(#invGrad)" strokeWidth="2.5" strokeLinejoin="round" />
        <path d="M30 35 L50 45 L70 35 M50 45 L50 65" stroke="url(#invGrad)" strokeWidth="2.5" strokeLinejoin="round" />
        
        <path d="M40 30 L60 40 M60 30 L40 40" stroke="#FBBF24" strokeWidth="2.5" strokeOpacity="0.8" />
        <path d="M35 48 L45 53" stroke="url(#invGrad)" strokeWidth="2" strokeLinecap="round" />
        <path d="M35 52 L42 55.5" stroke="url(#invGrad)" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.6" />
      </motion.g>

      <motion.circle cx="85" cy="20" r="3" fill="#FBBF24" animate={{ y: [0, -5, 0], opacity: [0.4, 1, 0.4] }} transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }} />
      <motion.circle cx="20" cy="40" r="2" fill="#D97706" animate={{ y: [0, -8, 0], opacity: [0.2, 0.8, 0.2] }} transition={{ duration: 3.5, repeat: Infinity, ease: "easeInOut", delay: 1 }} />
    </svg>
  );
};
