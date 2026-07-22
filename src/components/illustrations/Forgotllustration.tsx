import { AmbientBase, sharedTransition } from "./AmbientBase";
import { motion } from "framer-motion";

export const ForgotIllustration = ({ className }: { className?: string }) => (
    <svg viewBox="0 0 120 120" fill="none" className={className}>
        <AmbientBase glowColor="#3B82F6" />
        <defs>
            <linearGradient id="forgotGrad" x1="0" y1="0" x2="120" y2="120">
                <stop offset="0%" stopColor="#60A5FA" />
                <stop offset="100%" stopColor="#1D4ED8" />
            </linearGradient>
        </defs>
        <motion.ellipse cx="60" cy="95" rx="35" ry="10" fill="url(#authGlow)" animate={{ rx: [30, 40, 30], opacity: [0.3, 0.8, 0.3] }} transition={sharedTransition} />

        <g transform="translate(0, 10)">
            <path d="M40 50 L60 40 L80 50 L80 70 L60 80 L40 70 Z" fill="currentColor" fillOpacity="0.02" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.2" />
        </g>

        <motion.g animate={{ y: [0, -4, 0] }} transition={sharedTransition}>
            {/* Question mark abstract backdrop */}
            <motion.circle cx="85" cy="35" r="8" fill="#60A5FA" fillOpacity="0.05" stroke="url(#forgotGrad)" strokeWidth="1.5" strokeDasharray="3 3" animate={{ rotate: 360 }} transition={{ duration: 10, repeat: Infinity, ease: "linear" }} style={{ originX: "85px", originY: "35px" }} />

            {/* The Key */}
            <path d="M30 65a8 8 0 1 1 16 0c0 4-4 8-8 8a8 8 0 0 1-8-8z" fill="#EFF6FF" fillOpacity="0.05" stroke="url(#forgotGrad)" strokeWidth="2.5" />
            <path d="M38 73v25a4 4 0 0 0 4 4h8l3-3v-6h-4" stroke="url(#forgotGrad)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M38 73l25-10" stroke="url(#forgotGrad)" strokeWidth="2.5" />

            {/* Embedded Question Mark */}
            <path d="M72 40a10 10 0 1 1 20 0c0 10-10 10-10 20v2m0 6h.01" stroke="url(#forgotGrad)" strokeWidth="3" strokeLinecap="round" />
        </motion.g>
    </svg>
);