import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo } from "react";
import { useUI } from "../state/uiStore";
import { useStore } from "../state/store";
import { GRAPH_BY_ID } from "../graph/flowchart";
import { PHASE_COLORS } from "../theme/phaseColors";
import { MEDALS } from "../theme/identity";
import { deriveStatus } from "../graph/derive";
import { EASE_FLOW, M } from "../theme/motion";

export function CelebrationLayer() {
  const pendingCelebration = useUI((s) => s.pendingCelebration);
  const clearCelebration = useUI((s) => s.clearCelebration);
  const pendingMedal = useUI((s) => s.pendingMedal);
  const clearMedal = useUI((s) => s.clearMedal);
  const state = useStore();

  useEffect(() => {
    if (!pendingCelebration) return;
    const t = setTimeout(() => clearCelebration(), 1900);
    return () => clearTimeout(t);
  }, [pendingCelebration, clearCelebration]);

  const phaseColor = useMemo(() => {
    if (pendingCelebration) return PHASE_COLORS[GRAPH_BY_ID[pendingCelebration].phase];
    return null;
  }, [pendingCelebration]);

  // Determine if the celebration is on-path or muted (out-of-order)
  const isOnPath = useMemo(() => {
    if (!pendingCelebration) return false;
    const status = deriveStatus(state);
    return status[pendingCelebration] === "current" || state.nodes[pendingCelebration].completed;
  }, [pendingCelebration, state]);

  return (
    <>
      {/* Ambient atmospheric bloom that briefly intensifies the phase color */}
      <AnimatePresence>
        {pendingCelebration && phaseColor && isOnPath && (
          <motion.div
            key={`bloom-${pendingCelebration}-${state.nodes[pendingCelebration].completedAt ?? ""}`}
            aria-hidden
            className="pointer-events-none fixed inset-0 z-10"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.55, 0] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.7, ease: EASE_FLOW }}
            style={{
              background: `radial-gradient(60% 50% at 50% 45%, ${phaseColor.glow}, transparent 70%)`,
              filter: "blur(6px)",
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {pendingMedal !== null && (
          <MedalTakeover
            key={`medal-${pendingMedal}`}
            phase={pendingMedal as keyof typeof MEDALS}
            onClose={clearMedal}
          />
        )}
      </AnimatePresence>
    </>
  );
}

function MedalTakeover({ phase, onClose }: { phase: keyof typeof MEDALS; onClose: () => void }) {
  const c = PHASE_COLORS[phase];
  const m = MEDALS[phase];

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={M.morph}
      onClick={onClose}
    >
      {/* Atmospheric takeover */}
      <motion.div
        aria-hidden
        className="absolute inset-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.8, ease: EASE_FLOW }}
        style={{
          background: `radial-gradient(80% 60% at 50% 50%, ${c.glow} 0%, ${c.tint} 35%, rgba(7,8,15,0.92) 75%)`,
        }}
      />

      {/* Slow specular sweep */}
      <motion.div
        aria-hidden
        className="absolute inset-0 overflow-hidden"
      >
        <motion.div
          initial={{ x: "-50%", opacity: 0 }}
          animate={{ x: "50%", opacity: [0, 0.8, 0] }}
          transition={{ duration: 2.4, ease: EASE_FLOW, delay: 0.4 }}
          className="absolute inset-y-[-20%] left-0 w-[60%] -skew-x-12"
          style={{
            background: `linear-gradient(90deg, transparent, ${c.glow}, transparent)`,
            filter: "blur(40px)",
          }}
        />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 28 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.9, ease: EASE_FLOW, delay: 0.25 }}
        onClick={(e) => e.stopPropagation()}
        className="relative z-10 max-w-md px-8 text-center"
      >
        <div
          className="text-[10px] font-medium uppercase tracking-[0.42em]"
          style={{ color: c.text, opacity: 0.65 }}
        >
          Step {phase} unlocked
        </div>
        <h2
          className="mt-5 text-[34px] font-semibold leading-tight tracking-tight"
          style={{ color: c.text }}
        >
          {m.title}
        </h2>
        <p className="mt-4 text-sm leading-relaxed text-white/65">{m.subtitle}</p>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.45 }}
          transition={{ delay: 1.6, duration: 0.6 }}
          className="mt-14 text-[10px] uppercase tracking-[0.4em] text-white/35"
        >
          Tap to continue
        </motion.p>
      </motion.div>
    </motion.div>
  );
}
