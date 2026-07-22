import { motion } from "framer-motion";

export const CustomersEmptyIllustration = ({ className }: { className?: string }) => {
  return (
    <svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" className={`max-w-[240px] w-full h-auto mx-auto ${className || ""}`}>
      <defs>
        <radialGradient id="custGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#4F46E5" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#4F46E5" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="custGrad" x1="0" y1="0" x2="120" y2="120">
          <stop offset="0%" stopColor="#818CF8" />
          <stop offset="100%" stopColor="#4338CA" />
        </linearGradient>
      </defs>

      <motion.circle cx="60" cy="60" r="45" fill="url(#custGlow)"
        animate={{ scale: [1, 1.05, 1], opacity: [0.5, 0.8, 0.5] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
      />
      
      <motion.path d="M60 55 L35 75 M60 55 L85 75 M35 75 L85 75" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.2" strokeDasharray="4 4"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1, opacity: [0.1, 0.4, 0.1] }} transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
      />

      <motion.g animate={{ y: [0, -4, 0] }} transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}>
        <circle cx="60" cy="45" r="12" stroke="url(#custGrad)" strokeWidth="2" fill="#4F46E5" fillOpacity="0.1" />
        <path d="M46 68 Q60 50 74 68" stroke="url(#custGrad)" strokeWidth="2.5" strokeLinecap="round" />
        <motion.circle cx="60" cy="45" r="16" stroke="#818CF8" strokeWidth="1" strokeOpacity="0.5" fill="none"
          animate={{ scale: [1, 1.2, 1], opacity: [0.5, 0, 0.5] }} transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
        />
      </motion.g>

      <motion.g animate={{ y: [0, -2, 0] }} transition={{ duration: 3.5, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}>
        <circle cx="35" cy="70" r="8" stroke="url(#custGrad)" strokeWidth="1.5" strokeOpacity="0.8" fill="#4F46E5" fillOpacity="0.05" />
        <path d="M25 88 Q35 75 45 88" stroke="url(#custGrad)" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.8" />
      </motion.g>

      <motion.g animate={{ y: [0, -3, 0] }} transition={{ duration: 4, repeat: Infinity, ease: "easeInOut", delay: 1 }}>
        <circle cx="85" cy="70" r="8" stroke="url(#custGrad)" strokeWidth="1.5" strokeOpacity="0.8" fill="#4F46E5" fillOpacity="0.05" />
        <path d="M75 88 Q85 75 95 88" stroke="url(#custGrad)" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.8" />
      </motion.g>

      <motion.circle cx="85" cy="35" r="2.5" fill="#818CF8" animate={{ y: [0, -10, 0], opacity: [0, 0.8, 0] }} transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }} />
      <motion.circle cx="35" cy="40" r="2" fill="#4338CA" animate={{ y: [0, -8, 0], opacity: [0, 0.6, 0] }} transition={{ duration: 3, repeat: Infinity, ease: "easeInOut", delay: 1 }} />
    </svg>
  );
};
