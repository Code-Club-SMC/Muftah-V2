import { motion } from "framer-motion";

export const ProductionsEmpty = ({ className }: { className?: string }) => {
  return (
    <svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" className={`max-w-[240px] w-full h-auto mx-auto ${className || ""}`}>
      <defs>
        <radialGradient id="prodGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#E11D48" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#E11D48" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="prodGrad" x1="0" y1="0" x2="120" y2="120">
          <stop offset="0%" stopColor="#FB7185" />
          <stop offset="100%" stopColor="#9F1239" />
        </linearGradient>
      </defs>

      <motion.circle cx="60" cy="60" r="45" fill="url(#prodGlow)" animate={{ scale: [1, 1.05, 1], opacity: [0.6, 1, 0.6] }} transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }} />

      <path d="M10 85 L110 85" stroke="url(#prodGrad)" strokeWidth="3" strokeLinecap="round" strokeOpacity="0.4" />
      <circle cx="25" cy="90" r="4" stroke="url(#prodGrad)" strokeWidth="2" strokeOpacity="0.6" fill="transparent" />
      <circle cx="45" cy="90" r="4" stroke="url(#prodGrad)" strokeWidth="2" strokeOpacity="0.6" fill="transparent" />
      <circle cx="65" cy="90" r="4" stroke="url(#prodGrad)" strokeWidth="2" strokeOpacity="0.6" fill="transparent" />
      <circle cx="85" cy="90" r="4" stroke="url(#prodGrad)" strokeWidth="2" strokeOpacity="0.6" fill="transparent" />

      <motion.g animate={{ y: [0, -1.5, 0] }} transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}>
        <path d="M30 80 V50 L45 40 V60" stroke="url(#prodGrad)" strokeWidth="2.5" strokeLinejoin="round" fill="#E11D48" fillOpacity="0.05" />
        <path d="M45 60 V40 L65 25 V60" stroke="url(#prodGrad)" strokeWidth="2.5" strokeLinejoin="round" fill="#E11D48" fillOpacity="0.08" />
        <path d="M65 60 V25 L90 45 V80 H30 Z" stroke="url(#prodGrad)" strokeWidth="2.5" strokeLinejoin="round" fill="#E11D48" fillOpacity="0.12" />
        <rect x="40" y="65" width="8" height="8" rx="1" stroke="url(#prodGrad)" strokeWidth="1.5" fill="#FB7185" fillOpacity="0.2" />
        <rect x="55" y="65" width="8" height="8" rx="1" stroke="url(#prodGrad)" strokeWidth="1.5" fill="#FB7185" fillOpacity="0.2" />
        <rect x="70" y="65" width="8" height="8" rx="1" stroke="url(#prodGrad)" strokeWidth="1.5" fill="#FB7185" fillOpacity="0.2" />
      </motion.g>

      <motion.g>
        <motion.circle cx="70" cy="15" r="5" fill="#FDA4AF" fillOpacity="0.2" animate={{ y: [0, -15], scale: [1, 2], opacity: [0.6, 0] }} transition={{ duration: 3, repeat: Infinity, ease: "easeOut" }} />
        <motion.circle cx="65" cy="10" r="4" fill="#FDA4AF" fillOpacity="0.2" animate={{ y: [0, -15], scale: [1, 2.5], opacity: [0.5, 0] }} transition={{ duration: 3.5, repeat: Infinity, ease: "easeOut", delay: 1 }} />
        <motion.circle cx="75" cy="5" r="6" fill="#FDA4AF" fillOpacity="0.2" animate={{ y: [0, -15], scale: [1, 3], opacity: [0.4, 0] }} transition={{ duration: 4, repeat: Infinity, ease: "easeOut", delay: 2 }} />
      </motion.g>

      <motion.circle cx="45" cy="38" r="3" fill="#FB7185" animate={{ opacity: [0.3, 1, 0.3], boxShadow: "0 0 10px #FB7185" }} transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }} />
      <motion.circle cx="65" cy="23" r="3" fill="#FB7185" animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut", delay: 0.5 }} />
    </svg>
  );
};
