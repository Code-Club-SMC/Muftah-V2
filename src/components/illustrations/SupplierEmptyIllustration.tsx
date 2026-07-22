import { motion } from "framer-motion";

export const SupplierEmptyIllustration = ({ className }: { className?: string }) => {
  return (
    <svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" className={`max-w-[240px] w-full h-auto mx-auto ${className || ""}`}>
      <defs>
        <radialGradient id="supGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#2563EB" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#2563EB" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="supGrad" x1="0" y1="0" x2="120" y2="120">
          <stop offset="0%" stopColor="#60A5FA" />
          <stop offset="100%" stopColor="#1D4ED8" />
        </linearGradient>
      </defs>

      <motion.circle cx="60" cy="60" r="45" fill="url(#supGlow)" animate={{ scale: [1, 1.05, 1] }} transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }} />

      <path d="M10 90 H110" stroke="url(#supGrad)" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.4" strokeDasharray="10 5" />
      
      <motion.g animate={{ y: [0, -1.5, 0, 1.5, 0] }} transition={{ duration: 0.6, repeat: Infinity, ease: "linear" }}>
        <path d="M75 50 H90 C95 50 100 55 100 65 V85 H75 V50 Z" stroke="url(#supGrad)" strokeWidth="2.5" strokeLinejoin="round" fill="#2563EB" fillOpacity="0.05" />
        <path d="M85 55 H95 V65 H85 V55 Z" stroke="url(#supGrad)" strokeWidth="1.5" strokeLinejoin="round" fill="#60A5FA" fillOpacity="0.2" />
        
        <rect x="25" y="40" width="50" height="45" rx="3" stroke="url(#supGrad)" strokeWidth="2.5" fill="#2563EB" fillOpacity="0.1" />
        <path d="M35 55 H65 M35 65 H65" stroke="url(#supGrad)" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.5" />

        <circle cx="40" cy="85" r="9" stroke="url(#supGrad)" strokeWidth="2.5" fill="#1D4ED8" fillOpacity="0.2" />
        <circle cx="40" cy="85" r="4" fill="#60A5FA" />
        <circle cx="85" cy="85" r="9" stroke="url(#supGrad)" strokeWidth="2.5" fill="#1D4ED8" fillOpacity="0.2" />
        <circle cx="85" cy="85" r="4" fill="#60A5FA" />
      </motion.g>

      <motion.g animate={{ y: [0, -6, 0] }} transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}>
        <path d="M60 25 C60 15 72 15 72 25 C72 37 60 45 60 45 C60 45 48 37 48 25 C48 15 60 15 60 25 Z" stroke="url(#supGrad)" strokeWidth="2" fill="#2563EB" fillOpacity="0.15" strokeLinejoin="round" />
        <circle cx="60" cy="25" r="4" fill="#60A5FA" />
      </motion.g>
      
      <motion.ellipse cx="60" cy="45" rx="10" ry="2.5" fill="url(#supGrad)" fillOpacity="0.3" animate={{ scaleX: [0.8, 1.2, 0.8], opacity: [0.3, 0.6, 0.3] }} transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }} />

      <motion.path d="M15 55 H25" stroke="#60A5FA" strokeWidth="2" strokeLinecap="round" animate={{ x: [-10, 10], opacity: [0, 0.8, 0] }} transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }} />
      <motion.path d="M10 65 H20" stroke="#60A5FA" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.6" animate={{ x: [-10, 10], opacity: [0, 0.6, 0] }} transition={{ duration: 1, repeat: Infinity, ease: "linear", delay: 0.2 }} />
      <motion.path d="M15 75 H30" stroke="#60A5FA" strokeWidth="2" strokeLinecap="round" animate={{ x: [-10, 10], opacity: [0, 0.8, 0] }} transition={{ duration: 0.9, repeat: Infinity, ease: "linear", delay: 0.4 }} />
    </svg>
  );
};
