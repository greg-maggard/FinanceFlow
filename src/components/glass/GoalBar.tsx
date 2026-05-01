import { motion } from "framer-motion";
import { M } from "../../theme/motion";

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
        {/* Flowing-wave hint over the unfilled portion: a slow, soft gradient
            sweeping rightward, suggesting motion toward the goal. */}
        {incomplete && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 overflow-hidden"
            style={{ left: `${pct}%`, right: 0 }}
          >
            <motion.div
              className="absolute inset-y-0 left-0"
              style={{
                width: "60%",
                background: `linear-gradient(90deg, transparent 0%, ${glow} 50%, transparent 100%)`,
                opacity: goalNear ? 0.85 : 0.65,
                mixBlendMode: "screen",
              }}
              animate={{ x: ["-110%", "240%"] }}
              transition={{ duration: 3.6, repeat: Infinity, ease: "linear" }}
            />
          </div>
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
        <span>${Math.round(value).toLocaleString()}</span>
        <span>${Math.round(max).toLocaleString()}</span>
      </div>
    </div>
  );
}
