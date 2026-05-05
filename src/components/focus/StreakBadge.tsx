import { motion } from "framer-motion";
import { streakLength } from "../../state/recurring";
import type { NodeState } from "../../state/schema";

export function StreakChip({
  node,
  glow,
}: {
  node: NodeState;
  glow: string;
}) {
  const months = streakLength(node);
  if (months <= 0) return null;
  return (
    <motion.span
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 22 }}
      className="rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums"
      style={{
        background: glow,
        color: "white",
        boxShadow: `0 0 14px ${glow}`,
      }}
    >
      {months} {months === 1 ? "mo" : "mos"}
    </motion.span>
  );
}
