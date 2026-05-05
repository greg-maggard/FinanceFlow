import { motion } from "framer-motion";
import { isCheckedThisMonth, streakLength, ymKey } from "../../state/recurring";
import type { NodeState } from "../../state/schema";
import { useStore } from "../../state/store";
import type { NodeId } from "../../state/schema";

export function StreakBadge({ nodeId, tint, glow }: { nodeId: NodeId; tint: string; glow: string }) {
  const state = useStore();
  const node: NodeState = state.nodes[nodeId];
  const months = streakLength(node);
  const checked = isCheckedThisMonth(node);
  const ym = ymKey();

  const toggle = () => {
    const checks = { ...(node.monthlyChecks ?? {}) };
    checks[ym] = !checks[ym];
    if (!checks[ym]) delete checks[ym];
    useStore.setState((s) => ({
      nodes: { ...s.nodes, [nodeId]: { ...s.nodes[nodeId], monthlyChecks: checks } },
    }));
  };

  const label = new Date().toLocaleString("default", { month: "long" });

  return (
    <div className="space-y-3">
      <button
        onClick={toggle}
        className="group relative flex w-full items-center justify-between rounded-2xl px-4 py-3 transition-all"
        style={{
          background: checked
            ? `linear-gradient(135deg, ${tint}, rgba(255,255,255,0.04))`
            : "rgba(255,255,255,0.04)",
          border: `1px solid ${checked ? glow : "rgba(255,255,255,0.10)"}`,
          boxShadow: checked
            ? `inset 0 1px 0 rgba(255,255,255,0.22), 0 0 24px ${glow}`
            : "inset 0 1px 0 rgba(255,255,255,0.08)",
        }}
      >
        <div className="flex items-center gap-3 text-left">
          <motion.div
            animate={{ scale: checked ? 1 : 0.8, rotate: checked ? 0 : -8 }}
            transition={{ type: "spring", stiffness: 300, damping: 18 }}
            className="flex h-8 w-8 items-center justify-center rounded-full"
            style={{
              background: checked ? glow : "rgba(255,255,255,0.06)",
              boxShadow: checked ? `0 0 12px ${glow}` : "none",
            }}
          >
            <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none">
              <path
                d="M3 8 L7 12 L13 4"
                stroke="white"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={checked ? 1 : 0.35}
              />
            </svg>
          </motion.div>
          <div>
            <div className="text-sm font-semibold text-white/95">
              {checked ? `Done for ${label}` : `Mark done for ${label}`}
            </div>
            <div className="text-[11px] text-white/55">
              {months > 0
                ? `${months} month${months === 1 ? "" : "s"} in a row`
                : "Build a streak by repeating each month"}
            </div>
          </div>
        </div>
        {months > 0 && (
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="flex items-baseline gap-1 rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums"
            style={{
              background: glow,
              boxShadow: `0 0 18px ${glow}`,
              color: "white",
            }}
          >
            <span>{months}</span>
            <span className="text-[10px] uppercase tracking-wider opacity-80">
              {months === 1 ? "mo" : "mos"}
            </span>
          </motion.div>
        )}
      </button>
    </div>
  );
}
