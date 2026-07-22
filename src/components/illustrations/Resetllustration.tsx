import { AmbientBase, sharedTransition } from "./AmbientBase";
import { motion } from "framer-motion";

export const ResetIllustration = ({ className }: { className?: string }) => (
    <svg viewBox="0 0 120 120" fill="none" className={className}>
        <AmbientBase glowColor="#3B82F6" />
        <defs>
            <linearGradient id="resetGrad" x1="0" y1="0" x2="120" y2="120">
                <stop offset="0%" stopColor="#60A5FA" />
                <stop offset="100%" stopColor="#1D4ED8" />
            </linearGradient>
        </defs>
        <motion.ellipse cx="60" cy="95" rx="35" ry="10" fill="url(#authGlow)" animate={{ rx: [30, 40, 30], opacity: [0.3, 0.8, 0.3] }} transition={sharedTransition} />

        <motion.g animate={{ y: [-2, 2, -2] }} transition={sharedTransition}>
            {/* The background lock */}
            <path d="M70 50a4 4 0 0 1 4-4h24a4 4 0 0 1 4 4v30a4 4 0 0 1-4 4H74a4 4 0 0 1-4-4V50z" fill="currentColor" fillOpacity="0.02" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.2" />
            <path d="M86 46v-8a10 10 0 1 0-20 0v8" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.2" strokeLinecap="round" />
            <circle cx="86" cy="65" r="2.5" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.2" />

            {/* The foreground re-synced key */}
            <rect x="30" y="30" width="50" height="65" rx="6" fill="#EFF6FF" fillOpacity="0.05" stroke="url(#resetGrad)" strokeWidth="2.5" />
            <path d="M40 40h30" stroke="url(#resetGrad)" strokeWidth="2.5" strokeLinecap="round" />

            <circle cx="55" cy="60" r="10" stroke="url(#resetGrad)" strokeWidth="2.5" />
            <path d="M48 60h14 M55 53v14" stroke="url(#resetGrad)" strokeWidth="2" strokeLinecap="round" />

            {/* Abstract sync bars */}
            <rect x="45" y="80" width="20" height="2" rx="1" fill="#60A5FA" fillOpacity="0.6" />
            <rect x="40" y="85" width="30" height="2" rx="1" fill="#60A5FA" fillOpacity="0.2" />
        </motion.g>
    </svg>
);