import { motion } from "framer-motion";

export const FactoryFloorProductionIllustration = ({ className }: { className?: string }) => {
    return (
        <svg
            viewBox="0 0 120 120"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className={`max-w-[240px] w-full h-auto mx-auto ${className || ""}`}
        >
            <defs>
                <radialGradient id="prodGlow" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.2" />
                    <stop offset="100%" stopColor="#3B82F6" stopOpacity="0" />
                </radialGradient>
                <linearGradient id="prodGrad" x1="0" y1="0" x2="120" y2="120">
                    <stop offset="0%" stopColor="#60A5FA" />
                    <stop offset="100%" stopColor="#1D4ED8" />
                </linearGradient>
                <linearGradient id="beltGrad" x1="0" y1="0" x2="120" y2="0">
                    <stop offset="0%" stopColor="#94A3B8" stopOpacity="0.1" />
                    <stop offset="50%" stopColor="#94A3B8" stopOpacity="0.3" />
                    <stop offset="100%" stopColor="#94A3B8" stopOpacity="0.1" />
                </linearGradient>
            </defs>

            {/* Ambient Floor Glow */}
            <motion.ellipse
                cx="60"
                cy="95"
                rx="40"
                ry="12"
                fill="url(#prodGlow)"
                animate={{ rx: [35, 42, 35], opacity: [0.5, 0.9, 0.5] }}
                transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
            />

            {/* Background Dashboard / Monitor */}
            <g transform="translate(0, -5)">
                <path d="M25 35 h20 v15 h-20 z" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.2" strokeLinejoin="round" />
                <motion.path
                    d="M29 40 h12"
                    stroke="#60A5FA"
                    strokeWidth="2"
                    strokeLinecap="round"
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                />
                <path d="M29 45 h8" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.2" strokeLinecap="round" />
            </g>

            {/* Rotating Background Gear */}
            <motion.g
                animate={{ rotate: 360 }}
                transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
                style={{ originX: "90px", originY: "40px" }}
            >
                <circle cx="90" cy="40" r="8" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.2" strokeDasharray="4 4" />
                <circle cx="90" cy="40" r="3" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.2" />
            </motion.g>

            {/* Static Conveyor Belt Base */}
            <g transform="translate(0, 5)">
                <path d="M15 80 L105 80 L100 86 L20 86 Z" fill="url(#beltGrad)" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeOpacity="0.3" />
                <circle cx="30" cy="83" r="2" stroke="currentColor" strokeWidth="1" strokeOpacity="0.4" />
                <circle cx="60" cy="83" r="2" stroke="currentColor" strokeWidth="1" strokeOpacity="0.4" />
                <circle cx="90" cy="83" r="2" stroke="currentColor" strokeWidth="1" strokeOpacity="0.4" />
            </g>

            {/* Animated Product on Conveyor Belt */}
            <motion.g
                animate={{ x: [-3, 3, -3] }}
                transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
            >
                <path d="M44 63 L76 63 L76 83 L44 83 Z" fill="#EFF6FF" fillOpacity="0.05" stroke="url(#prodGrad)" strokeWidth="2.5" strokeLinejoin="round" />
                <path d="M50 70 h20 M50 76 h12" stroke="url(#prodGrad)" strokeWidth="1.5" strokeLinecap="round" strokeOpacity="0.6" />
            </motion.g>

            {/* Animated Robotic Press / Scanner Arm */}
            <motion.g
                animate={{ y: [0, 8, 0] }}
                transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
            >
                {/* Ceiling Mount */}
                <path d="M48 20 L72 20 L68 28 L52 28 Z" fill="currentColor" fillOpacity="0.02" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.4" strokeLinejoin="round" />
                {/* Hydraulic Piston */}
                <path d="M57 28 L63 28 L63 46 L57 46 Z" fill="url(#prodGrad)" fillOpacity="0.2" stroke="url(#prodGrad)" strokeWidth="1" strokeOpacity="0.8" />
                {/* Scanner Head */}
                <path d="M50 46 L70 46 L68 52 L52 52 Z" fill="#EFF6FF" fillOpacity="0.05" stroke="url(#prodGrad)" strokeWidth="2.5" strokeLinejoin="round" />

                {/* Laser / Scanner Beam */}
                <motion.path
                    d="M60 52 L60 58"
                    stroke="#60A5FA"
                    strokeWidth="2"
                    strokeLinecap="round"
                    animate={{ opacity: [0, 1, 0] }}
                    transition={{ duration: 2.5, repeat: Infinity, ease: "circInOut", delay: 1.25 }}
                />
            </motion.g>

            {/* Floating Ambient Particles */}
            <motion.circle
                cx="85" cy="20" r="2.5"
                fill="#60A5FA"
                animate={{ y: [0, -5, 0], opacity: [0.4, 1, 0.4] }}
                transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.circle
                cx="25" cy="55" r="2"
                fill="#3B82F6"
                animate={{ y: [0, -8, 0], opacity: [0.2, 0.8, 0.2] }}
                transition={{ duration: 3.5, repeat: Infinity, ease: "easeInOut", delay: 1 }}
            />
        </svg>
    );
};