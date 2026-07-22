import { AmbientBase, sharedTransition } from "./AmbientBase";
import { motion } from "framer-motion";

export const SignupIllustration = ({ className }: { className?: string }) => (
    <svg viewBox="0 0 120 120" fill="none" className={className}>
        <AmbientBase />
        <motion.ellipse cx="60" cy="95" rx="35" ry="10" fill="url(#authGlow)" animate={{ rx: [30, 40, 30], opacity: [0.3, 0.8, 0.3] }} transition={sharedTransition} />

        <g transform="translate(10, -5)">
            {/* Launchpad abstract */}
            <path d="M20 90h60" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.2" />

            {/* Launch particles */}
            {[...Array(3)].map((_, i) => (
                <motion.circle key={i} cx={30 + i * 20} cy="90" r="3" fill="#34D399" fillOpacity="0.2" animate={{ y: [0, -15], opacity: [0, 1, 0] }} transition={{ duration: 2, repeat: Infinity, delay: i * 0.4 }} />
            ))}
        </g>

        <motion.g animate={{ y: [0, -5, 0], x: [0, 2, 0] }} transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}>
            {/* Rocket Main Body */}
            <path d="M60 25c10 10 10 30 10 40v15H50V65c0-10 0-30 10-40z" fill="currentColor" fillOpacity="0.05" stroke="url(#authGrad)" strokeWidth="2.5" />
            <path d="M50 70l-8 10h26" stroke="url(#authGrad)" strokeWidth="2.5" strokeLinecap="round" />

            {/* Fins */}
            <path d="M50 70l-8 10" stroke="url(#authGrad)" strokeWidth="2.5" />
            <path d="M70 70l8 10" stroke="url(#authGrad)" strokeWidth="2.5" />

            {/* Window */}
            <circle cx="60" cy="50" r="4" stroke="url(#authGrad)" strokeWidth="2" />

            {/* Animated Flames */}
            <motion.path d="M54 80c0 5 3 10 6 10s6-5 6-10" stroke="#F87171" strokeWidth="2" strokeLinecap="round" animate={{ opacity: [0.2, 0.8, 0.2], scale: [1, 1.2, 1] }} transition={sharedTransition} style={{ originX: "60px", originY: "80px" }} />
        </motion.g>
    </svg>
);