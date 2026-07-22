import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

/* ──────────────────────────────────────────────────────────────────────────
 * COLLABORATIVE TELEMETRY (Multiplayer Presence Overlays)
 * ────────────────────────────────────────────────────────────────────────── */

const LiveCursor = ({ name, color, delay = 0, path }: { name: string, color: string, delay?: number, path: { x: number, y: number }[] }) => (
    <motion.g
        initial={{ x: path[0].x, y: path[0].y, opacity: 0 }}
        animate={{
            x: path.map(p => p.x),
            y: path.map(p => p.y),
            opacity: [0, 1, 1, 0]
        }}
        transition={{ duration: 5, delay, repeat: Infinity, ease: "easeInOut" }}
        className="pointer-events-none drop-shadow-md z-50"
    >
        {/* Standard Mouse Pointer */}
        <path d="M0,0 L0,15 L4,11 L8,18 L11,16 L7,9 L12,9 Z" fill={color} stroke="#ffffff" strokeWidth="1.5" strokeLinejoin="round" />
        {/* Nametag */}
        <rect x="10" y="12" width={name.length * 6 + 8} height="12" rx="3" fill={color} />
        <text x="14" y="21" fill="#ffffff" fontSize="7" fontWeight="900" fontFamily="sans-serif" letterSpacing="0.5">{name}</text>
    </motion.g>
);

const SelectionReticle = ({ x, y, color, label }: { x: number, y: number, color: string, label: string }) => (
    <g transform={`translate(${x}, ${y})`} className="pointer-events-none">
        <motion.rect x="-15" y="-15" width="30" height="30" fill="none" stroke={color} strokeWidth="1.5" strokeDasharray="4 4" rx="2"
            animate={{ rotate: 360 }} transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
        />
        <rect x="-15" y="-24" width={label.length * 5 + 6} height="9" fill={color} rx="1" />
        <text x="-12" y="-17" fill="#ffffff" fontSize="6" fontWeight="bold" fontFamily="sans-serif">{label}</text>
    </g>
);

/* ──────────────────────────────────────────────────────────────────────────
 * DYNAMIC FACTORY PERSONNEL (Animated SVG Characters)
 * ────────────────────────────────────────────────────────────────────────── */

const CharChemist = ({ x, y, flip = false }: { x: number; y: number; flip?: boolean }) => (
    <g transform={`translate(${x}, ${y}) scale(${flip ? -1 : 1}, 1)`}>
        <ellipse cx="0" cy="38" rx="12" ry="5" fill="rgba(0,0,0,0.3)" />
        <path d="M -4 20 L -5 35 L -2 36 L 0 20 Z" fill="#334155" />
        <path d="M 2 20 L 5 35 L 8 36 L 4 20 Z" fill="#1e293b" />
        <ellipse cx="-4" cy="36" rx="4" ry="2" fill="#0f172a" /><ellipse cx="6" cy="36" rx="4" ry="2" fill="#0f172a" />
        <path d="M -7 -5 L 7 -5 L 9 22 L -9 22 Z" fill="#f8fafc" />
        <path d="M 0 -5 L 7 -5 L 9 22 L 0 22 Z" fill="#e2e8f0" />
        <ellipse cx="0" cy="-10" rx="5" ry="6" fill="#fcd34d" />
        <path d="M -4 -12 L 6 -12" stroke="#0f172a" strokeWidth="1.5" />
        <path d="M -5 -16 Q 0 -18 5 -16 A 5 5 0 0 1 -5 -16" fill="#1e293b" />
        <path d="M -6 -2 L -12 8 L -5 10 L -2 -2 Z" fill="#e2e8f0" />
        <rect x="-16" y="5" width="8" height="10" rx="1" fill="#0f172a" transform="rotate(-20 -12 8)" />
        <motion.rect x="-15" y="6" width="6" height="8" rx="0.5" fill="#06b6d4" transform="rotate(-20 -12 8)" animate={{ opacity: [0.6, 1, 0.6] }} transition={{ duration: 1, repeat: Infinity }} />
        <motion.g style={{ transformOrigin: "6px -2px" }} animate={{ rotate: [0, -15, 0, -10, 0] }} transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}>
            <path d="M 6 -2 L 12 5 L -8 8 L 0 -2 Z" fill="#f1f5f9" />
        </motion.g>
    </g>
);

const CharInspector = ({ x, y, flip = false }: { x: number; y: number; flip?: boolean }) => (
    <g transform={`translate(${x}, ${y}) scale(${flip ? -1 : 1}, 1)`}>
        <ellipse cx="0" cy="38" rx="12" ry="5" fill="rgba(0,0,0,0.3)" />
        <path d="M -4 20 L -5 35 L -2 36 L 0 20 Z" fill="#0369a1" /><path d="M 2 20 L 5 35 L 8 36 L 4 20 Z" fill="#075985" />
        <ellipse cx="-4" cy="36" rx="4" ry="2" fill="#1e293b" /><ellipse cx="6" cy="36" rx="4" ry="2" fill="#1e293b" />
        <path d="M -6 -5 L 6 -5 L 8 20 L -8 20 Z" fill="#0ea5e9" /><path d="M 0 -5 L 6 -5 L 8 20 L 0 20 Z" fill="#0284c7" />
        <ellipse cx="0" cy="-10" rx="4.5" ry="5.5" fill="#fbbf24" />
        <circle cx="-5" cy="-12" r="3" fill="#451a03" />
        <path d="M -5 -15 Q 0 -17 5 -15 A 5 5 0 0 1 -5 -15" fill="#451a03" />
        <motion.g style={{ transformOrigin: "6px -2px" }} animate={{ rotate: [0, 10, 0] }} transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}>
            <path d="M 6 -2 L 16 8 L 14 11 L 4 0 Z" fill="#0284c7" />
            <rect x="12" y="7" width="6" height="4" rx="1" fill="#334155" transform="rotate(30 14 9)" />
            <line x1="16" y1="10" x2="40" y2="25" stroke="#ef4444" strokeWidth="1.5" opacity="0.6" />
        </motion.g>
    </g>
);

const CharEngineer = ({ x, y, flip = false }: { x: number; y: number; flip?: boolean }) => (
    <g transform={`translate(${x}, ${y}) scale(${flip ? -1 : 1}, 1)`}>
        <ellipse cx="0" cy="38" rx="12" ry="5" fill="rgba(0,0,0,0.3)" />
        <path d="M -5 20 L -6 35 L -2 36 L 0 20 Z" fill="#1e293b" /><path d="M 2 20 L 6 35 L 9 36 L 4 20 Z" fill="#0f172a" />
        <ellipse cx="-5" cy="36" rx="4" ry="2" fill="#000" /><ellipse cx="7" cy="36" rx="4" ry="2" fill="#000" />
        <path d="M -7 -5 L 7 -5 L 9 20 L -9 20 Z" fill="#334155" />
        <path d="M -7 -5 L 7 -5 L 5 10 L -5 10 Z" fill="#f97316" />
        <path d="M -5 -5 L -5 10 M 5 -5 L 5 10" stroke="#fef08a" strokeWidth="1.5" />
        <ellipse cx="0" cy="-10" rx="5" ry="6" fill="#d97706" />
        <path d="M -7 -11 A 7 7 0 0 1 7 -11 L 9 -9 L -9 -9 Z" fill="#eab308" />
        <ellipse cx="0" cy="-11" rx="7" ry="2" fill="#ca8a04" />
        <motion.g style={{ transformOrigin: "0px 5px" }} animate={{ y: [0, 3, 0], rotate: [0, -5, 0] }} transition={{ duration: 1, repeat: Infinity, ease: "easeInOut" }}>
            <path d="M -6 -2 L 18 5 L 16 8 L -4 1 Z" fill="#f97316" />
            <path d="M 6 -2 L 20 2 L 18 5 L 4 1 Z" fill="#ea580c" />
        </motion.g>
    </g>
);

const CharLogistics = ({ x, y, flip = false }: { x: number; y: number; flip?: boolean }) => (
    <g transform={`translate(${x}, ${y}) scale(${flip ? -1 : 1}, 1)`}>
        <ellipse cx="0" cy="38" rx="12" ry="5" fill="rgba(0,0,0,0.3)" />
        <path d="M -4 20 L -5 35 L -2 36 L 0 20 Z" fill="#0f172a" /><path d="M 2 20 L 5 35 L 8 36 L 4 20 Z" fill="#020617" />
        <path d="M -6 -5 L 6 -5 L 8 20 L -8 20 Z" fill="#1e3a8a" /><path d="M 0 -5 L 6 -5 L 8 20 L 0 20 Z" fill="#1d4ed8" />
        <ellipse cx="0" cy="-10" rx="5" ry="6" fill="#fcd34d" />
        <path d="M -6 -11 A 6 6 0 0 1 6 -11 L 8 -9 L -8 -9 Z" fill="#3b82f6" />
        <ellipse cx="0" cy="-11" rx="6" ry="2" fill="#2563eb" />
        <motion.g style={{ transformOrigin: "6px -2px" }} animate={{ rotate: [0, 30, 0] }} transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}>
            <path d="M 6 -2 L 18 10 L 15 13 L 3 1 Z" fill="#1d4ed8" />
        </motion.g>
    </g>
);

const CharManager = ({ x, y, flip = false }: { x: number; y: number; flip?: boolean }) => (
    <g transform={`translate(${x}, ${y}) scale(${flip ? -1 : 1}, 1)`}>
        <ellipse cx="0" cy="38" rx="12" ry="5" fill="rgba(0,0,0,0.3)" />
        <path d="M -4 20 L -4 35 L -1 36 L 0 20 Z" fill="#0f172a" /><path d="M 2 20 L 4 35 L 7 36 L 4 20 Z" fill="#020617" />
        <path d="M -6 -5 L 6 -5 L 7 20 L -7 20 Z" fill="#1e293b" /><path d="M 0 -5 L 6 -5 L 7 20 L 0 20 Z" fill="#0f172a" />
        <polygon points="-2,-5 2,-5 0,3" fill="#f8fafc" />
        <polygon points="-0.5,-3 0.5,-3 0,5" fill="#ef4444" />
        <ellipse cx="0" cy="-10" rx="5" ry="6" fill="#fca5a5" />
        <path d="M -5 -15 Q 0 -17 5 -14 L 6 -11 A 5 5 0 0 1 -6 -11 Z" fill="#451a03" />
        <motion.g style={{ transformOrigin: "6px -2px" }} animate={{ rotate: [0, -20, 0, -10, 0] }} transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}>
            <path d="M 6 -2 L 20 0 L 20 3 L 4 2 Z" fill="#0f172a" />
            <path d="M 20 0 L 23 1 L 22 3 L 20 3 Z" fill="#fca5a5" />
        </motion.g>
    </g>
);

/* ──────────────────────────────────────────────────────────────────────────
 * FULLY INTEGRATED ISO SCENES WITH MULTIPLAYER OVERLAYS
 * ────────────────────────────────────────────────────────────────────────── */

export function IsoMixingVat({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 200 200" className={cn("w-full h-full overflow-visible", className)}>
            <defs>
                <linearGradient id="vatSteel" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#334155" /><stop offset="25%" stopColor="#cbd5e1" /><stop offset="50%" stopColor="#f8fafc" /><stop offset="75%" stopColor="#94a3b8" /><stop offset="100%" stopColor="#1e293b" />
                </linearGradient>
                <linearGradient id="detergentBlue" x1="0%" y1="100%" x2="0%" y2="0%">
                    <stop offset="0%" stopColor="#0369a1" /><stop offset="100%" stopColor="#38bdf8" stopOpacity="0.8" />
                </linearGradient>
            </defs>
            <ellipse cx="100" cy="175" rx="60" ry="25" fill="rgba(0,0,0,0.3)" className="blur-xl" />

            <path d="M 10 160 L 50 180 L 70 170 L 30 150 Z" fill="#334155" />
            <path d="M 10 160 L 10 165 L 50 185 L 50 180 Z" fill="#0f172a" />
            <path d="M 50 185 L 70 175 L 70 170 L 50 180 Z" fill="#1e293b" />

            <CharChemist x={40} y={135} />

            <path d="M 60 140 L 45 185 L 50 188 L 70 140 Z" fill="#1e293b" /><path d="M 140 140 L 155 185 L 150 188 L 130 140 Z" fill="#0f172a" />
            <path d="M 45 60 L 45 140 A 55 25 0 0 0 155 140 L 155 60 Z" fill="url(#vatSteel)" />
            <path d="M 60 75 L 60 145 A 40 15 0 0 0 140 145 L 140 75 A 40 15 0 0 1 60 75 Z" fill="#020617" />
            <g clipPath="inset(0 0 0 0)">
                <motion.path d="M 60 100 Q 100 90 140 100 L 140 145 A 40 15 0 0 1 60 145 Z" fill="url(#detergentBlue)" animate={{ scaleY: [1, 0.95, 1], opacity: [0.8, 1, 0.8] }} transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }} style={{ transformOrigin: "100px 145px" }} />
            </g>
            <ellipse cx="100" cy="60" rx="55" ry="25" fill="url(#vatSteel)" />

            <motion.g style={{ transformOrigin: "100px 55px" }} animate={{ rotate: [0, 360] }} transition={{ duration: 4, repeat: Infinity, ease: "linear" }}>
                <ellipse cx="100" cy="55" rx="15" ry="8" fill="#334155" />
                <path d="M 85 50 L 115 60 M 85 60 L 115 50" stroke="#94a3b8" strokeWidth="4" />
            </motion.g>
            <path d="M 97 20 L 97 55 L 103 55 L 103 20 Z" fill="#cbd5e1" />

            {/* Multiplayer Presence */}
            <SelectionReticle x={100} y={45} color="#10b981" label="Checking Agitator" />
            <LiveCursor name="Ahmad_QA" color="#10b981" path={[{ x: 180, y: 150 }, { x: 100, y: 40 }, { x: 100, y: 40 }]} delay={0.5} />
        </svg>
    );
}

export function IsoBottlingLine({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 200 200" className={cn("w-full h-full overflow-visible", className)}>
            <defs>
                <linearGradient id="bottleFill" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stopColor="#1d4ed8" /><stop offset="100%" stopColor="#3b82f6" /></linearGradient>
                <clipPath id="beltClipProd"><path d="M 25 120 L 155 185 L 175 175 L 45 110 Z" /></clipPath>
            </defs>
            <path d="M 10 130 L 150 200 L 190 180 L 50 110 Z" fill="rgba(0,0,0,0.2)" className="blur-xl" />

            <CharInspector x={140} y={115} flip />

            <path d="M 20 120 L 160 190 L 180 180 L 40 110 Z" fill="#64748b" />
            <path d="M 20 120 L 20 130 L 160 200 L 160 190 Z" fill="#334155" />
            <g clipPath="url(#beltClipProd)">
                <motion.g animate={{ x: [-35, 0], y: [-17.5, 0] }} transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}>
                    {[...Array(10)].map((_, i) => (<line key={i} x1={i * 25} y1={90 + (i * 12.5)} x2={i * 25 + 40} y2={90 + (i * 12.5) - 20} stroke="#1e293b" strokeWidth="2" opacity="0.3" />))}
                </motion.g>
            </g>
            <path d="M 85 70 L 100 77 L 100 152 L 85 145 Z" fill="#f1f5f9" />
            <motion.rect x="86" y="100" width="3" height="20" fill="#06b6d4" animate={{ opacity: [0.8, 0, 0.8] }} transition={{ duration: 0.5, repeat: Infinity }} />
            <motion.g animate={{ x: [-35, 0], y: [-17.5, 0] }} transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}>
                {[...Array(6)].map((_, i) => (
                    <g key={i} transform={`translate(${i * 35}, ${i * 17.5})`}>
                        <ellipse cx="25" cy="115" rx="8" ry="4" fill="rgba(0,0,0,0.3)" />
                        <path d="M 15 85 L 15 110 A 6 3 0 0 0 35 110 L 35 85 C 35 75 25 70 25 65 L 20 65 C 20 70 15 75 15 85 Z" fill="url(#bottleFill)" />
                        <rect x="20" y="60" width="5" height="5" fill="#ef4444" />
                    </g>
                ))}
            </motion.g>

            {/* Multiplayer Presence */}
            <LiveCursor name="SysAdmin" color="#3b82f6" path={[{ x: -20, y: 50 }, { x: 80, y: 130 }, { x: 80, y: 130 }]} delay={1.2} />
            <SelectionReticle x={60} y={130} color="#3b82f6" label="Adjusting RPM" />
        </svg>
    );
}

export function IsoExpenseSilo({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 200 200" className={cn("w-full h-full overflow-visible", className)}>
            <ellipse cx="100" cy="175" rx="60" ry="25" fill="rgba(0,0,0,0.3)" className="blur-xl" />
            <path d="M 50 50 L 50 145 A 50 20 0 0 0 150 145 L 150 50 Z" fill="#f1f5f9" />
            <path d="M 45 95 A 55 20 0 0 0 155 95 L 155 105 A 55 20 0 0 1 45 105 Z" fill="#ef4444" />
            <ellipse cx="100" cy="50" rx="50" ry="20" fill="#f8fafc" />
            <path d="M 135 60 L 135 165 M 145 55 L 145 160" stroke="#94a3b8" strokeWidth="1.5" />

            <circle cx="80" cy="140" r="10" fill="#334155" />
            <motion.g style={{ transformOrigin: "80px 140px" }} animate={{ rotate: [0, 90, 0] }} transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}>
                <path d="M 70 140 L 90 140 M 80 130 L 80 150" stroke="#ef4444" strokeWidth="4" />
                <circle cx="80" cy="140" r="3" fill="#f8fafc" />
            </motion.g>

            <CharEngineer x={60} y={130} />

            {/* Multiplayer Presence */}
            <LiveCursor name="Procurement_01" color="#f43f5e" path={[{ x: 180, y: 20 }, { x: 140, y: 100 }, { x: 140, y: 100 }]} delay={2.5} />
            <SelectionReticle x={140} y={100} color="#f43f5e" label="Reviewing Intake" />
        </svg>
    );
}

export function IsoYieldPacker({ className }: { className?: string }) {
    const Box = ({ x, y }: { x: number; y: number; }) => (
        <g transform={`translate(${x}, ${y}) scale(0.8)`}>
            <path d="M 0 0 L 25 -12.5 L 50 0 L 25 12.5 Z" fill="#d97706" />
            <path d="M 0 0 L 25 12.5 L 25 35 L 0 22.5 Z" fill="#78350f" />
            <path d="M 50 0 L 25 12.5 L 25 35 L 50 22.5 Z" fill="#b45309" />
            <path d="M 22 -11 L 28 -14 L 52 -2 L 46 1 Z" fill="#06b6d4" opacity="0.8" />
        </g>
    );

    return (
        <svg viewBox="0 0 200 200" className={cn("w-full h-full overflow-visible", className)}>
            <ellipse cx="100" cy="165" rx="65" ry="30" fill="rgba(0,0,0,0.2)" className="blur-xl" />

            <CharLogistics x={40} y={90} />

            <path d="M 45 100 L 55 105 L 55 130 L 45 125 Z" fill="#64748b" />
            <rect x="42" y="95" width="16" height="8" fill="#334155" transform="rotate(26 50 100)" />
            <line x1="50" y1="95" x2="55" y2="85" stroke="#ef4444" strokeWidth="2" />

            <path d="M 10 120 L 150 190 L 170 180 L 30 110 Z" fill="#cbd5e1" />
            <motion.g initial={{ x: -20, y: -10 }} animate={{ x: 0, y: 0 }} transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}>
                <Box x={90} y={140} />
            </motion.g>
            <Box x={130} y={160} />
            <rect x="60" y="40" width="10" height="100" fill="#f8fafc" />
            <path d="M 50 40 L 140 85 L 140 95 L 50 50 Z" fill="#38bdf8" />

            {/* Multiplayer Presence */}
            <LiveCursor name="Logistics_Bot" color="#0ea5e9" path={[{ x: -10, y: 200 }, { x: 130, y: 160 }, { x: 130, y: 160 }]} delay={0.2} />
        </svg>
    );
}

export function IsoNetYieldChart({ className }: { className?: string }) {
    const Bar = ({ x, y, h, cTop, cSide, cFront, delay }: any) => (
        <motion.g transform={`translate(${x}, ${y})`} initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.8, delay, ease: "backOut" }}>
            <path d={`M 0 0 L 15 -7.5 L 30 0 L 15 7.5 Z`} fill={cTop} />
            <path d={`M 0 0 L 15 7.5 L 15 ${h} L 0 ${h - 7.5} Z`} fill={cSide} />
            <path d={`M 30 0 L 15 7.5 L 15 ${h} L 30 ${h - 7.5} Z`} fill={cFront} />
        </motion.g>
    );
    return (
        <svg viewBox="0 0 200 200" className={cn("w-full h-full overflow-visible", className)}>
            <ellipse cx="100" cy="160" rx="60" ry="20" fill="rgba(0,0,0,0.15)" className="blur-md" />
            <path d="M 40 130 L 110 165 L 170 135 L 100 100 Z" fill="#cbd5e1" />
            <path d="M 40 130 L 40 145 L 110 180 L 110 165 Z" fill="#94a3b8" />
            <path d="M 170 135 L 170 150 L 110 180 L 110 165 Z" fill="#475569" />

            <CharManager x={150} y={110} flip />

            <Bar x={50} y={110} h={30} cTop="#38bdf8" cSide="#0284c7" cFront="#0369a1" delay={0.2} />
            <Bar x={75} y={122.5} h={50} cTop="#34d399" cSide="#059669" cFront="#047857" delay={0.4} />
            <Bar x={100} y={135} h={70} cTop="#10b981" cSide="#047857" cFront="#064e3b" delay={0.6} />

            {/* Multiplayer Presence */}
            <LiveCursor name="CEO_Terminal" color="#f59e0b" path={[{ x: -20, y: 150 }, { x: 100, y: 130 }, { x: 100, y: 130 }]} delay={1} />
            <SelectionReticle x={100} y={130} color="#f59e0b" label="Highest Yield" />
        </svg>
    );
}

export function IsoStaffTerminal({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 200 200" className={cn("w-full h-full overflow-visible", className)}>
            <ellipse cx="100" cy="170" rx="50" ry="20" fill="rgba(0,0,0,0.15)" className="blur-md" />

            <CharLogistics x={50} y={125} />

            <path d="M 90 90 L 110 100 L 110 160 L 90 150 Z" fill="#94a3b8" />
            <path d="M 110 100 L 130 90 L 130 150 L 110 160 Z" fill="#64748b" />
            <path d="M 80 60 L 120 80 L 140 70 L 100 50 Z" fill="#1e293b" />
            <path d="M 80 60 L 80 70 L 120 90 L 120 80 Z" fill="#0f172a" />
            <path d="M 85 62 L 115 77 L 130 69 L 100 54 Z" fill="#8b5cf6" opacity="0.3" />

            <motion.g animate={{ opacity: [0.2, 0.8, 0.2] }} transition={{ duration: 1.5, repeat: Infinity }}>
                <circle cx="107.5" cy="65" r="8" fill="none" stroke="#a78bfa" strokeWidth="1" transform="scale(1, 0.5) rotate(45)" />
                <circle cx="107.5" cy="65" r="4" fill="#a78bfa" transform="scale(1, 0.5) rotate(45)" />
            </motion.g>

            {/* Multiplayer Presence */}
            <LiveCursor name="HR_Manager" color="#8b5cf6" path={[{ x: 180, y: 150 }, { x: 100, y: 60 }, { x: 100, y: 60 }]} delay={3} />
            <SelectionReticle x={100} y={60} color="#8b5cf6" label="Verifying ID" />
        </svg>
    );
}

export function IsoStockDrums({ className }: { className?: string }) {
    const Drum = ({ x, y, cTop, cBody }: any) => (
        <g transform={`translate(${x}, ${y})`}>
            <path d="M 5 20 L 5 55 A 20 10 0 0 0 45 55 L 45 20 Z" fill={cBody} />
            <ellipse cx="25" cy="20" rx="20" ry="10" fill={cTop} />
            <polygon points="25,35 30,40 25,45 20,40" fill="#ef4444" />
        </g>
    );

    return (
        <svg viewBox="0 0 200 200" className={cn("w-full h-full overflow-visible", className)}>
            <ellipse cx="100" cy="170" rx="60" ry="25" fill="rgba(0,0,0,0.15)" className="blur-md" />
            <path d="M 30 135 L 110 175 L 180 140 L 100 100 Z" fill="#b45309" />
            <path d="M 30 135 L 30 145 L 110 185 L 110 175 Z" fill="#78350f" />
            <Drum x={95} y={105} cTop="#60a5fa" cBody="#2563eb" />
            <Drum x={60} y={85} cTop="#60a5fa" cBody="#2563eb" />
            <Drum x={125} y={85} cTop="#60a5fa" cBody="#2563eb" />
            <Drum x={95} y={65} cTop="#fcd34d" cBody="#d97706" />

            <CharInspector x={40} y={130} />

            {/* Multiplayer Presence */}
            <LiveCursor name="Inventory_Bot" color="#f59e0b" path={[{ x: -20, y: -20 }, { x: 95, y: 65 }, { x: 95, y: 65 }]} delay={1.5} />
        </svg>
    );
}

export function IsoWarehouseRack({ className }: { className?: string }) {
    const Box = ({ x, y }: any) => (
        <g transform={`translate(${x}, ${y}) scale(0.6)`}>
            <path d="M 0 0 L 25 -12.5 L 50 0 L 25 12.5 Z" fill="#d97706" />
            <path d="M 0 0 L 25 12.5 L 25 35 L 0 22.5 Z" fill="#78350f" />
            <path d="M 50 0 L 25 12.5 L 25 35 L 50 22.5 Z" fill="#b45309" />
            <path d="M 22 -11 L 28 -14 L 52 -2 L 46 1 Z" fill="#06b6d4" opacity="0.8" />
        </g>
    );

    return (
        <svg viewBox="0 0 200 200" className={cn("w-full h-full overflow-visible", className)}>
            <ellipse cx="100" cy="170" rx="70" ry="25" fill="rgba(0,0,0,0.15)" className="blur-md" />

            <rect x="50" y="30" width="6" height="130" fill="#1e3a8a" />
            <rect x="140" y="75" width="6" height="100" fill="#1e3a8a" />
            <path d="M 40 130 L 130 175 L 155 162.5 L 65 117.5 Z" fill="#cbd5e1" />
            <path d="M 40 80 L 130 125 L 155 112.5 L 65 67.5 Z" fill="#cbd5e1" />

            <Box x={60} y={105} /><Box x={85} y={117.5} /><Box x={110} y={130} />
            <Box x={75} y={65} /><Box x={100} y={77.5} />

            <CharLogistics x={30} y={145} />

            {/* Multiplayer Presence */}
            <LiveCursor name="Dispatch_Auto" color="#0ea5e9" path={[{ x: 180, y: 0 }, { x: 85, y: 110 }, { x: 85, y: 110 }]} delay={0.8} />
            <SelectionReticle x={85} y={110} color="#0ea5e9" label="Marked for Dispatch" />
        </svg>
    );
}

