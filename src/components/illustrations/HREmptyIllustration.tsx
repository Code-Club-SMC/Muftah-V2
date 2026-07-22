import { motion } from "framer-motion";

export const HREmptyIllustration = ({ className }: { className?: string }) => {
  return (
    <svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" className={`max-w-[240px] w-full h-auto mx-auto ${className || ""}`}>
      <defs>
        <radialGradient id="hrGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#9333EA" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#9333EA" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="hrGrad" x1="0" y1="0" x2="120" y2="120">
          <stop offset="0%" stopColor="#C084FC" />
          <stop offset="100%" stopColor="#7E22CE" />
        </linearGradient>
      </defs>

      <motion.circle cx="60" cy="60" r="45" fill="url(#hrGlow)" animate={{ scale: [1, 1.05, 1], opacity: [0.6, 1, 0.6] }} transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }} />

      <motion.path d="M60 10 Q40 35 60 45" stroke="url(#hrGrad)" strokeWidth="2.5" strokeLinecap="round" strokeOpacity="0.4" fill="transparent" animate={{ x: [-5, 5, -5], opacity: [0.3, 0.6, 0.3] }} transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }} />

      <motion.g animate={{ y: [0, -4, 0], rotateZ: [0, -3, 3, 0] }} transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }} style={{ transformOrigin: "60px 45px" }}>
        <rect x="40" y="45" width="40" height="55" rx="6" stroke="url(#hrGrad)" strokeWidth="2" fill="currentColor" fillOpacity="0.03" />
        <rect x="52" y="45" width="16" height="4" rx="2" fill="url(#hrGrad)" />
        <circle cx="60" cy="65" r="9" stroke="url(#hrGrad)" strokeWidth="1.5" fill="#9333EA" fillOpacity="0.1" />
        <path d="M50 82 Q60 68 70 82" stroke="url(#hrGrad)" strokeWidth="2" strokeLinecap="round" />
        <rect x="48" y="88" width="24" height="3" rx="1.5" fill="url(#hrGrad)" fillOpacity="0.6" />
        <rect x="52" y="94" width="16" height="3" rx="1.5" fill="url(#hrGrad)" fillOpacity="0.4" />
      </motion.g>

      <motion.g animate={{ x: [-15, 15, -15], y: [-5, 5, -5] }} transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}>
        <circle cx="75" cy="75" r="12" stroke="#C084FC" strokeWidth="2.5" fill="#F3E8FF" fillOpacity="0.1" />
        <path d="M83 83 L92 92" stroke="#C084FC" strokeWidth="3" strokeLinecap="round" />
        <path d="M68 72 Q75 66 82 72" stroke="#C084FC" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.6" />
      </motion.g>

      <motion.path d="M25 45L23 50L18 52L23 54L25 59L27 54L32 52L27 50L25 45Z" fill="#C084FC" animate={{ opacity: [0.2, 0.8, 0.2], scale: [0.8, 1.2, 0.8] }} transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }} />
      <motion.path d="M95 35L94 38L91 39L94 40L95 43L96 40L99 39L96 38L95 35Z" fill="#7E22CE" animate={{ opacity: [0.2, 0.6, 0.2], scale: [0.8, 1.1, 0.8] }} transition={{ duration: 4, repeat: Infinity, ease: "easeInOut", delay: 1 }} />
    </svg>
  );
};
