import { type Transition } from "framer-motion";

export const AmbientBase = ({ glowColor = "#10B981" }: { glowColor?: string }) => (
    <defs>
        <radialGradient id="authGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={glowColor} stopOpacity="0.1" />
            <stop offset="100%" stopColor={glowColor} stopOpacity="0" />
        </radialGradient>
        <linearGradient id="authGrad" x1="0" y1="0" x2="120" y2="120">
            <stop offset="0%" stopColor="#34D399" />
            <stop offset="100%" stopColor="#059669" />
        </linearGradient>
    </defs>
);

export const sharedTransition: Transition = { duration: 4, repeat: Infinity, ease: "easeInOut" };