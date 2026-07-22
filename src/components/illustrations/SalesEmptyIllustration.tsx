import { motion } from "framer-motion";

export const SalesEmptyIllustration = ({ className }: { className?: string }) => {
  return (
    <svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" className={`max-w-[240px] w-full h-auto mx-auto ${className || ""}`}>
      <defs>
        <radialGradient id="saleGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#DB2777" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#DB2777" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="saleGrad" x1="0" y1="0" x2="120" y2="120">
          <stop offset="0%" stopColor="#F472B6" />
          <stop offset="100%" stopColor="#BE185D" />
        </linearGradient>
      </defs>

      <motion.circle cx="60" cy="60" r="45" fill="url(#saleGlow)" animate={{ scale: [1, 1.05, 1] }} transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }} />

      <motion.path d="M30 40 H90 V100 H30 Z" fill="#DB2777" fillOpacity="0.05" stroke="url(#saleGrad)" strokeWidth="2" strokeOpacity="0.4" animate={{ y: [0, -3, 0] }} transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }} />
      <motion.path d="M45 40 V25 C45 15 75 15 75 25 V40" stroke="url(#saleGrad)" strokeWidth="2" strokeOpacity="0.4" fill="transparent" animate={{ y: [0, -3, 0] }} transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }} />
      
      <motion.g animate={{ y: [0, -6, 0], rotate: [-5, 5, -5] }} transition={{ duration: 4, repeat: Infinity, ease: "easeInOut", delay: 0.2 }} style={{ transformOrigin: "60px 40px" }}>
        <path d="M45 40 L75 40 L90 60 L60 90 L30 60 Z" stroke="url(#saleGrad)" strokeWidth="2.5" strokeLinejoin="round" fill="#DB2777" fillOpacity="0.1" />
        <circle cx="60" cy="50" r="5" stroke="#F472B6" strokeWidth="2" fill="transparent" />
        <path d="M50 65 L70 65 M55 75 L65 75" stroke="#F472B6" strokeWidth="2" strokeLinecap="round" />
      </motion.g>

      <motion.path d="M60 15 Q50 25 60 45" stroke="url(#saleGrad)" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.6" fill="transparent" strokeDasharray="4 3" animate={{ x: [-3, 3, -3], opacity: [0.4, 0.8, 0.4] }} transition={{ duration: 4, repeat: Infinity, ease: "easeInOut", delay: 0.2 }} />
      
      <circle cx="60" cy="15" r="4" stroke="url(#saleGrad)" strokeWidth="2" fill="#F472B6" fillOpacity="0.2" />

      <motion.g animate={{ rotate: 180, scale: [0.8, 1.2, 0.8], opacity: [0.4, 1, 0.4] }} transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }} style={{ transformOrigin: "25px 50px" }}>
        <path d="M25 40 V60 M15 50 H35" stroke="#F472B6" strokeWidth="2.5" strokeLinecap="round" />
      </motion.g>
      
      <motion.g animate={{ rotate: -180, scale: [0.8, 1.1, 0.8], opacity: [0.2, 0.8, 0.2] }} transition={{ duration: 4, repeat: Infinity, ease: "easeInOut", delay: 1 }} style={{ transformOrigin: "95px 75px" }}>
        <path d="M95 68 V82 M88 75 H102" stroke="#F472B6" strokeWidth="2" strokeLinecap="round" />
      </motion.g>

      <motion.circle cx="85" cy="35" r="8" fill="#DB2777" fillOpacity="0.2" stroke="#F472B6" strokeWidth="1.5" strokeDasharray="3 3" animate={{ rotate: 360, y: [0, -5, 0] }} transition={{ duration: 6, repeat: Infinity, ease: "linear" }} style={{ transformOrigin: "85px 35px" }} />
    </svg>
  );
};
