import { motion } from "framer-motion";
import { AmbientBase, sharedTransition } from "./AmbientBase";


export const LoginIllustration = ({ className }: { className?: string }) => (
    <svg viewBox="0 0 120 120" fill="none" className={className}>
        <AmbientBase />
        <motion.ellipse cx="60" cy="95" rx="40" ry="12" fill="url(#authGlow)" animate={{ rx: [35, 42, 35], opacity: [0.5, 0.9, 0.5] }} transition={sharedTransition} />

        <motion.path d="M40 50 L60 40 L80 50 L80 80 L60 90 L40 80 Z" fill="currentColor" fillOpacity="0.02" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.2" />
        <motion.path d="M40 50 L60 60 L80 50 M60 60 L60 90" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.2" />

        <motion.g animate={{ y: [-3, 3, -3], rotate: [-1, 1, -1] }} transition={sharedTransition}>
            {/* Paging Lock Body */}
            <path d="M40 50a8 8 0 0 1 8-8h24a8 8 0 0 1 8 8v30a8 8 0 0 1-8 8H48a8 8 0 0 1-8-8V50z" fill="currentColor" fillOpacity="0.05" stroke="url(#authGrad)" strokeWidth="2.5" />
            <path d="M60 42v-8a10 10 0 1 0-20 0v8" stroke="url(#authGrad)" strokeWidth="2.5" strokeLinecap="round" />

            {/* Dynamic gears */}
            <motion.circle cx="60" cy="65" r="7" stroke="url(#authGrad)" strokeWidth="1.5" strokeDasharray="3 3" animate={{ rotate: 360 }} transition={{ duration: 10, repeat: Infinity, ease: "linear" }} style={{ originX: "60px", originY: "65px" }} />
            <circle cx="60" cy="65" r="2.5" stroke="url(#authGrad)" strokeWidth="1.5" />
        </motion.g>
    </svg>
);