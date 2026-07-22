import { motion } from "framer-motion";

export const RecipeEmptyIllustration = ({ className }: { className?: string }) => {
  return (
    <svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" className={`max-w-[240px] w-full h-auto mx-auto ${className || ""}`}>
      <defs>
        <radialGradient id="recGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#0D9488" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#0D9488" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="recGrad" x1="0" y1="0" x2="120" y2="120">
          <stop offset="0%" stopColor="#2DD4BF" />
          <stop offset="100%" stopColor="#0F766E" />
        </linearGradient>
      </defs>

      <motion.circle cx="60" cy="60" r="45" fill="url(#recGlow)" animate={{ scale: [1, 1.05, 1] }} transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }} />

      <motion.g animate={{ rotate: [-3, 3, -3] }} transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }} style={{ transformOrigin: "60px 80px" }}>
        <path d="M48 30 H72 V45 C72 50 85 65 85 80 C85 95 75 100 60 100 C45 100 35 95 35 80 C35 65 48 50 48 45 V30 Z" stroke="url(#recGrad)" strokeWidth="2.5" strokeLinejoin="round" fill="currentColor" fillOpacity="0.02" />
        <path d="M44 30 H76" stroke="url(#recGrad)" strokeWidth="3" strokeLinecap="round" />
        <motion.path d="M40 75 Q60 65 80 75 V80 C80 90 72 96 60 96 C48 96 40 90 40 80 Z" fill="#0D9488" fillOpacity="0.2" animate={{ scaleY: [1, 0.95, 1], opacity: [0.8, 1, 0.8] }} transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }} style={{ transformOrigin: "60px 96px" }} />
        <path d="M44 55 H52 M39 70 H47" stroke="url(#recGrad)" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.6" />
      </motion.g>

      <motion.circle cx="55" cy="40" r="4" fill="#2DD4BF" fillOpacity="0.6" animate={{ y: [0, -15], x: [0, -5], scale: [1, 1.5], opacity: [0, 0.8, 0] }} transition={{ duration: 2.5, repeat: Infinity, ease: "easeOut" }} />
      <motion.circle cx="68" cy="45" r="3" fill="#2DD4BF" fillOpacity="0.5" animate={{ y: [0, -20], x: [0, 8], scale: [1, 2], opacity: [0, 0.7, 0] }} transition={{ duration: 3, repeat: Infinity, ease: "easeOut", delay: 1 }} />
      <motion.circle cx="62" cy="35" r="5" fill="#0D9488" fillOpacity="0.4" animate={{ y: [0, -25], x: [0, 3], scale: [1, 2.5], opacity: [0, 0.6, 0] }} transition={{ duration: 4, repeat: Infinity, ease: "easeOut", delay: 1.5 }} />

      <motion.path d="M85 30 L87 35 L92 37 L87 39 L85 44 L83 39 L78 37 L83 35 Z" fill="#2DD4BF" animate={{ opacity: [0.3, 1, 0.3], rotate: 45, scale: [0.8, 1.2, 0.8] }} transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }} style={{ transformOrigin: "85px 37px" }} />
    </svg>
  );
};
