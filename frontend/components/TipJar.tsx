'use client';

import { useEffect, useState } from 'react';

// Resting spots for coins that have landed in the jar. Coordinates are in the
// SVG's user space; they stack loosely at the bottom of the jar.
const RESTING_SPOTS = [
  { x: 100, y: 232, r: -12 },
  { x: 128, y: 236, r: 8 },
  { x: 76, y: 236, r: 15 },
  { x: 114, y: 222, r: -6 },
  { x: 88, y: 224, r: 20 },
  { x: 100, y: 214, r: -18 },
];

// Timing for the auto-drop loop. One coin falls, lands, and after a short beat
// the next one drops — looping forever without any interaction.
const FALL_MS = 700;
const GAP_MS = 900;

function Coin({ x, y, r, size = 20 }: { x: number; y: number; r: number; size?: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${r})`}>
      <circle r={size} fill="#ffd84d" stroke="var(--ink)" strokeWidth="3" />
      <text
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={size * 1.1}
        fontWeight="800"
        fill="var(--ink)"
      >
        ★
      </text>
    </g>
  );
}

// Respect users who prefer reduced motion: fill the jar statically and skip
// the looping animation entirely. Read once as the initial state so the
// reduced-motion case never needs a synchronous setState from inside the
// effect below.
function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  );
}

export function TipJar({ widthClass = 'w-[260px] sm:w-[320px]' }: { widthClass?: string }) {
  // Number of coins resting in the jar, and whether one is mid-drop. The whole
  // cycle runs on a self-scheduling timer — no click needed.
  const [landed, setLanded] = useState(() => (prefersReducedMotion() ? RESTING_SPOTS.length : 0));
  const [dropping, setDropping] = useState(false);

  useEffect(() => {
    if (prefersReducedMotion()) {
      return;
    }

    let fallTimer: number | null = null;
    let cycleTimer: number | null = null;
    let isMounted = true;

    const clearAllTimers = () => {
      if (fallTimer !== null) {
        window.clearTimeout(fallTimer);
        fallTimer = null;
      }
      if (cycleTimer !== null) {
        window.clearTimeout(cycleTimer);
        cycleTimer = null;
      }
    };

    const scheduleCycle = () => {
      clearAllTimers();
      if (!isMounted || (typeof document !== 'undefined' && document.hidden)) return;
      cycleTimer = window.setTimeout(cycle, GAP_MS);
    };

    const cycle = () => {
      if (!isMounted || (typeof document !== 'undefined' && document.hidden)) return;
      setDropping(true);
      fallTimer = window.setTimeout(() => {
        if (!isMounted || (typeof document !== 'undefined' && document.hidden)) return;
        setLanded((n) => (n + 1) % (RESTING_SPOTS.length + 1));
        setDropping(false);
        scheduleCycle();
      }, FALL_MS);
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        clearAllTimers();
        if (isMounted) setDropping(false);
      } else {
        scheduleCycle();
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    scheduleCycle();

    return () => {
      isMounted = false;
      clearAllTimers();
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
    };
  }, []);

  return (
    <div className="flex flex-col items-center select-none">
      <div className="relative" aria-hidden="true">
        <svg
          width="320"
          height="400"
          viewBox="0 0 200 300"
          className={`${widthClass} h-auto overflow-visible drop-shadow-[6px_6px_0_var(--shadow-color)]`}
        >
          {/* Hand dropping a coin (simple mitten shape holding a coin). The
              outer group carries the release animation; the inner group scales
              the whole hand up without fighting that transform. */}
          <g className={dropping ? 'tipjar-hand-release' : ''}>
            <g transform="translate(100 44) scale(1.35) translate(-100 -44)">
              <Coin x={100} y={40} r={0} size={18} />
              <path
                d="M64 40 q-16 6 -16 24 q0 16 20 18 l52 0 q10 -2 10 -14 l0 -6 q10 0 10 -10 q0 -10 -12 -10 l-40 0 q-8 0 -16 6 z"
                fill="#ff9db1"
                stroke="var(--ink)"
                strokeWidth="2.4"
                strokeLinejoin="round"
                transform="translate(0 26)"
              />
            </g>
          </g>

          {/* Jar body */}
          <g>
            {/* Jar rim / lip */}
            <rect x="48" y="150" width="104" height="20" rx="6" fill="#6fd3ff" stroke="var(--ink)" strokeWidth="4" />
            {/* Jar glass */}
            <path
              d="M54 168 q-8 0 -8 12 l0 78 q0 16 16 16 l76 0 q16 0 16 -16 l0 -78 q0 -12 -8 -12 z"
              fill="#c4b5fd"
              fillOpacity="0.35"
              stroke="var(--ink)"
              strokeWidth="4"
              strokeLinejoin="round"
            />
            {/* "TIPS" label band */}
            <rect x="66" y="188" width="68" height="26" rx="4" fill="var(--card)" stroke="var(--ink)" strokeWidth="3" />
            <text x="100" y="201" textAnchor="middle" dominantBaseline="central" fontSize="15" fontWeight="800" fill="var(--ink)">
              TIPS
            </text>

            {/* Coins resting in the jar */}
            {RESTING_SPOTS.slice(0, landed).map((s, i) => (
              <Coin key={i} x={s.x} y={s.y} r={s.r} size={16} />
            ))}
          </g>

          {/* Falling coin: drops from the hand down through the jar mouth and
              into the pile. Rendered last so it stays visible in front of the
              (semi-transparent) glass and the "TIPS" band as it falls. */}
          {dropping && (
            <g className="tipjar-drop">
              <Coin x={100} y={0} r={0} size={18} />
            </g>
          )}
        </svg>
      </div>
    </div>
  );
}
