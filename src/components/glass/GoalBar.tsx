import { motion } from "framer-motion";

export function GoalBar({
  value,
  max,
  tint,
  glow,
  caption,
}: {
  value: number;
  max: number;
  tint: string;
  glow: string;
  caption?: string;
}) {
  const safeMax = max > 0 ? max : 1;
  const pct = Math.max(0, Math.min(100, (value / safeMax) * 100));
  const goalNear = pct >= 80;

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-xs uppercase tracking-[0.2em] text-white/60">{caption ?? "Progress"}</span>
        <motion.span
          animate={{ scale: goalNear ? 1.06 : 1, opacity: goalNear ? 1 : 0.85 }}
          transition={{ type: "spring", stiffness: 280, damping: 22 }}
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
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ type: "spring", stiffness: 90, damping: 20 }}
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            background: `linear-gradient(90deg, ${tint}, ${glow})`,
            boxShadow: goalNear ? `0 0 24px ${glow}, 0 0 12px ${glow}` : `0 0 8px ${tint}`,
          }}
        />
        <motion.div
          aria-hidden
          animate={{ opacity: goalNear ? [0.0, 0.25, 0.0] : 0 }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
          className="absolute inset-0 rounded-full"
          style={{ background: `radial-gradient(60% 100% at 80% 50%, ${glow}, transparent)` }}
        />
      </div>
      <div className="flex justify-between text-[11px] tabular-nums text-white/55">
        <span>${Math.round(value).toLocaleString()}</span>
        <span>${Math.round(max).toLocaleString()}</span>
      </div>
    </div>
  );
}
