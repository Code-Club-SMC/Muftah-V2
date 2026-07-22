import { motion } from "framer-motion";

export const OperationEmptyIllustration = ({ className }: { className?: string }) => {
  return (
    <svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" className={`max-w-[240px] w-full h-auto mx-auto ${className || ""}`}>
      <defs>
        <radialGradient id="opGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#4F46E5" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#4F46E5" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="opOrbitGrad" x1="0" y1="0" x2="120" y2="120">
          <stop offset="0%" stopColor="#818CF8" />
          <stop offset="100%" stopColor="#3730A3" />
        </linearGradient>
      </defs>

      <motion.circle cx="60" cy="60" r="45" fill="url(#opGlow)" animate={{ scale: [1, 1.1, 1], opacity: [0.5, 0.9, 0.5] }} transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }} />
      <circle cx="60" cy="60" r="38" stroke="url(#opOrbitGrad)" strokeWidth="0.5" strokeOpacity="0.4" strokeDasharray="2 4" />

      <motion.circle cx="60" cy="60" r="30" stroke="url(#opOrbitGrad)" strokeWidth="1.5" strokeOpacity="0.8" strokeDasharray="60 10 20 5" animate={{ rotate: 360 }} transition={{ duration: 15, repeat: Infinity, ease: "linear" }} style={{ transformOrigin: "60px 60px" }} />
      
      <motion.g animate={{ rotate: 360 }} transition={{ duration: 15, repeat: Infinity, ease: "linear" }} style={{ transformOrigin: "60px 60px" }}>
        <circle cx="90" cy="60" r="3" fill="#818CF8" />
        <circle cx="30" cy="60" r="2.5" fill="#4338CA" />
      </motion.g>

      <motion.circle cx="60" cy="60" r="20" stroke="url(#opOrbitGrad)" strokeWidth="2" strokeOpacity="0.5" strokeDasharray="2 8" animate={{ rotate: -360 }} transition={{ duration: 25, repeat: Infinity, ease: "linear" }} style={{ transformOrigin: "60px 60px" }} />
      
      <motion.g animate={{ rotate: 360 }} transition={{ duration: 40, repeat: Infinity, ease: "linear" }} style={{ transformOrigin: "60px 60px" }}>
        <circle cx="60" cy="45" r="2" fill="#818CF8" />
        <circle cx="72" cy="68" r="1.5" fill="#4F46E5" />
        <circle cx="48" cy="68" r="2.5" fill="#3730A3" />
      </motion.g>

      <motion.g animate={{ scale: [1, 1.05, 1] }} transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}>
        <path d="M60 48 L70.5 54 V66 L60 72 L49.5 66 V54 Z" stroke="#818CF8" strokeWidth="2" fill="#4F46E5" fillOpacity="0.1" />
        <path d="M60 48 V60 M49.5 54 L60 60 M70.5 54 L60 60 M49.5 66 L60 60 M70.5 66 L60 60 M60 72 V60" stroke="#818CF8" strokeWidth="1.5" strokeOpacity="0.6" />
        <circle cx="60" cy="60" r="5" fill="#818CF8" />
      </motion.g>

      <motion.g animate={{ opacity: [0.3, 0.8, 0.3] }} transition={{ duration: 3, repeat: Infinity, ease: "easeInOut", delay: 1 }}>
        <path d="M60 20 V48 M60 72 V100 M20 60 H49.5 M70.5 60 H100" stroke="#4F46E5" strokeWidth="1.5" strokeOpacity="0.5" strokeDasharray="3 3" />
      </motion.g>

      <motion.circle cx="85" cy="30" r="1.5" fill="#A5B4FC" animate={{ x: [0, 5, 0], opacity: [0, 0.8, 0] }} transition={{ duration: 2, repeat: Infinity, ease: "linear" }} />
      <motion.circle cx="35" cy="85" r="2" fill="#818CF8" animate={{ x: [0, -5, 0], opacity: [0, 0.6, 0] }} transition={{ duration: 2.5, repeat: Infinity, ease: "linear", delay: 0.5 }} />
    </svg>
  );
};