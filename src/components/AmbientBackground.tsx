import { motion } from "framer-motion";
import { PHASE_COLORS } from "../theme/phaseColors";
import type { Phase } from "../graph/flowchart";

export function AmbientBackground({ phase }: { phase: Phase }) {
  const c = PHASE_COLORS[phase];
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 80% at 50% 0%, #1f2438 0%, #0c0e18 55%, #07080f 100%)",
        }}
      />
      <motion.div
        animate={{
          background: `radial-gradient(60% 50% at 18% 15%, ${c.glow}, transparent 60%), radial-gradient(50% 60% at 85% 85%, ${c.tint}, transparent 65%), radial-gradient(40% 40% at 60% 50%, ${c.tint}, transparent 70%)`,
        }}
        transition={{ duration: 1.4, ease: "easeInOut" }}
        className="absolute inset-0"
      />
      <motion.div
        aria-hidden
        animate={{ x: [0, 40, 0], y: [0, 24, 0] }}
        transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
        className="absolute -left-32 top-10 h-[520px] w-[520px] rounded-full blur-3xl"
        style={{ background: c.glow, opacity: 0.32 }}
      />
      <motion.div
        aria-hidden
        animate={{ x: [0, -50, 0], y: [0, -30, 0] }}
        transition={{ duration: 22, repeat: Infinity, ease: "easeInOut" }}
        className="absolute -right-40 bottom-0 h-[620px] w-[620px] rounded-full blur-3xl"
        style={{ background: c.tint, opacity: 0.4 }}
      />
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.04] mix-blend-overlay"
        style={{
          backgroundImage:
            "radial-gradient(rgba(255,255,255,0.6) 1px, transparent 1px)",
          backgroundSize: "3px 3px",
        }}
      />
    </div>
  );
}
