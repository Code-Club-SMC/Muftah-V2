import { motion } from "framer-motion";

export const InvoicesEmptyIllustration = ({ className }: { className?: string }) => {
  return (
    <svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" className={`max-w-[240px] w-full h-auto mx-auto ${className || ""}`}>
      <defs>
        <radialGradient id="invGlow2" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#0EA5E9" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#0EA5E9" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="invGrad2" x1="0" y1="0" x2="120" y2="120">
          <stop offset="0%" stopColor="#38BDF8" />
          <stop offset="100%" stopColor="#0369A1" />
        </linearGradient>
      </defs>

      <motion.circle cx="60" cy="60" r="45" fill="url(#invGlow2)" animate={{ scale: [1, 1.05, 1], opacity: [0.5, 0.9, 0.5] }} transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }} />

      <motion.rect x="25" y="20" width="60" height="80" rx="6" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.1" fill="currentColor" fillOpacity="0.02" transform="rotate(-5 55 60)" animate={{ rotate: [-5, -7, -5] }} transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }} style={{ transformOrigin: '55px 60px' }} />

      <motion.rect x="30" y="25" width="60" height="80" rx="6" stroke="url(#invGrad2)" strokeWidth="1.5" strokeOpacity="0.4" fill="#0EA5E9" fillOpacity="0.03" transform="rotate(3 60 65)" animate={{ rotate: [3, 4, 3] }} transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }} style={{ transformOrigin: '60px 65px' }} />

      <motion.g animate={{ y: [0, -4, 0] }} transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}>
        <rect x="35" y="15" width="60" height="80" rx="6" stroke="url(#invGrad2)" strokeWidth="2.5" fill="currentColor" fillOpacity="0.05" />

        <rect x="45" y="30" width="30" height="4" rx="2" fill="url(#invGrad2)" fillOpacity="0.8" />
        <rect x="45" y="42" width="40" height="3" rx="1.5" fill="url(#invGrad2)" fillOpacity="0.4" />
        <rect x="45" y="52" width="20" height="3" rx="1.5" fill="url(#invGrad2)" fillOpacity="0.4" />

        <rect x="45" y="70" width="25" height="4" rx="2" fill="url(#invGrad2)" fillOpacity="0.6" />
        <rect x="45" y="80" width="40" height="3" rx="1.5" fill="url(#invGrad2)" fillOpacity="0.3" />

        <motion.path d="M70 65 L78 75 L92 55" stroke="#0EA5E9" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: [0, 1, 1, 1], opacity: [0, 1, 1, 0] }} transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }} />

        <motion.circle cx="79" cy="65" r="18" stroke="#38BDF8" strokeWidth="2" fill="none" initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: [0.5, 1.2, 1.2], opacity: [0, 0.6, 0] }} transition={{ duration: 4, repeat: Infinity, ease: "easeOut", delay: 0.5 }} />
      </motion.g>

      <motion.circle cx="20" cy="30" r="3" fill="#38BDF8" animate={{ y: [0, -10, 0], opacity: [0, 0.8, 0] }} transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }} />
      <motion.path d="M95 90 L100 95 M100 90 L95 95" stroke="#0284C7" strokeWidth="2" strokeLinecap="round" animate={{ rotate: [0, 90, 0], scale: [0.8, 1, 0.8] }} transition={{ duration: 4, repeat: Infinity, ease: "linear" }} style={{ transformOrigin: '97.5px 92.5px' }} />
    </svg>
  );
};
