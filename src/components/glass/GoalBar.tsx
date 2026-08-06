import { motion } from "framer-motion";
import { M } from "../../theme/motion";

/**
 * `value`/`max` are integer cents when `unit` is "cents" (the default) and
 * plain percentage points when it is "percent" — the bar fraction is unitless
 * either way, only the two compact labels below it care. Mirrors `GoalBar`'s
 * `showCurrency` flag in `ios/FinanceFlow/Components/UIKit.swift`.
 */
export function GoalBar({
  value,
  max,
  tint,
  glow,
  caption,
  unit = "cents",
}: {
  value: number;
  max: number;
  tint: string;
  glow: string;
  caption?: string;
  unit?: "cents" | "percent";
}) {
  const label = (n: number) =>
    unit === "cents"
      ? `$${Math.round(n / 100).toLocaleString()}`
      : `${Math.round(n).toLocaleString()}%`;
  const safeMax = max > 0 ? max : 1;
  const pct = Math.max(0, Math.min(100, (value / safeMax) * 100));
  const goalNear = pct >= 80;
  const incomplete = pct < 100;

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-xs uppercase tracking-[0.2em] text-white/60">
          {caption ?? "Progress"}
        </span>
        <motion.span
          animate={{ scale: goalNear ? 1.06 : 1, opacity: goalNear ? 1 : 0.85 }}
          transition={M.flow}
          className="text-sm font-semibold tabular-nums text-white/90"
        >
          {Math.round(pct)}%
        </motion.span>
      </div>
      <div
        className="relative h-3 w-full overflow-hidden rounded-full"
        style={{
          background: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "inset 0 1px 2px rgba(0,0,0,0.4)",
        }}
      >
        {/* Continuous flowing wave across the full bar. The filled portion
            naturally occludes it, so the wave is only visible in the empty
            portion — and stays in steady rhythm regardless of fill state. */}
        {incomplete && (
          <motion.div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0"
            style={{
              width: "60%",
              background: `linear-gradient(90deg, transparent 0%, ${glow} 50%, transparent 100%)`,
              opacity: goalNear ? 0.85 : 0.65,
              mixBlendMode: "screen",
            }}
            animate={{ x: ["-110%", "240%"] }}
            transition={{ duration: 3.6, repeat: Infinity, ease: "linear" }}
          />
        )}
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={M.bar}
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            background: `linear-gradient(90deg, ${tint}, ${glow})`,
            boxShadow: goalNear ? `0 0 24px ${glow}, 0 0 12px ${glow}` : `0 0 8px ${tint}`,
          }}
        />
      </div>
      <div className="flex justify-between text-[11px] tabular-nums text-white/55">
        <span>{label(value)}</span>
        <span>{label(max)}</span>
      </div>
    </div>
  );
}
