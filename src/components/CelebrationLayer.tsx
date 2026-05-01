import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo } from "react";
import { useUI } from "../state/uiStore";
import { useStore } from "../state/store";
import { GRAPH_BY_ID } from "../graph/flowchart";
import { PHASE_COLORS } from "../theme/phaseColors";
import { IDENTITY, MEDALS } from "../theme/identity";
import { EASE_FLOW, M } from "../theme/motion";

const PARTICLE_COUNT = 26;

function makeParticles(seed: number) {
  return Array.from({ length: PARTICLE_COUNT }).map((_, i) => {
    const angle = (i / PARTICLE_COUNT) * Math.PI * 2 + (seed % 1);
    const dist = 90 + ((seed * (i + 1)) % 80);
    return {
      x: Math.cos(angle) * dist,
      y: Math.sin(angle) * dist,
      delay: ((i * 13 + seed) % 100) / 1000,
      size: 4 + ((seed * 7 + i) % 6),
    };
  });
}

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

  const particles = useMemo(
    () =>
      pendingCelebration
        ? makeParticles(state.nodes[pendingCelebration].completedAt?.length ?? Math.random())
        : [],
    [pendingCelebration, state.nodes],
  );

  const identity = pendingCelebration ? IDENTITY[pendingCelebration] : null;

  return (
    <>
      <AnimatePresence>
        {pendingCelebration && phaseColor && (
          <motion.div
            key={pendingCelebration}
            className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center"
            initial={{ opacity: 1 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: [0.5, 1.5, 1.05], opacity: [0, 1, 0] }}
              transition={{ duration: 1.6, ease: EASE_FLOW }}
              className="absolute h-72 w-72 rounded-full"
              style={{
                background: `radial-gradient(circle, ${phaseColor.glow}, transparent 70%)`,
                filter: "blur(10px)",
              }}
            />
            {particles.map((p, i) => (
              <motion.span
                key={i}
                initial={{ x: 0, y: 0, opacity: 0, scale: 0.5 }}
                animate={{ x: p.x, y: p.y, opacity: [0, 1, 0], scale: [0.5, 1, 0.4] }}
                transition={{ duration: 1.4, delay: p.delay, ease: EASE_FLOW }}
                className="absolute rounded-full"
                style={{
                  width: p.size,
                  height: p.size,
                  background: phaseColor.base,
                  boxShadow: `0 0 14px ${phaseColor.glow}`,
                }}
              />
            ))}
            {identity && (
              <motion.div
                initial={{ y: 22, opacity: 0, scale: 0.96 }}
                animate={{ y: 0, opacity: 1, scale: 1 }}
                exit={{ y: -16, opacity: 0, scale: 0.98 }}
                transition={{ ...M.flow, delay: 0.18 }}
                className="absolute top-[28%] rounded-2xl px-5 py-2.5 text-sm font-semibold"
                style={{
                  background: "rgba(12,14,22,0.65)",
                  backdropFilter: "blur(24px) saturate(180%)",
                  WebkitBackdropFilter: "blur(24px) saturate(180%)",
                  border: `1px solid ${phaseColor.base}`,
                  color: phaseColor.text,
                  boxShadow: `0 0 24px ${phaseColor.glow}`,
                }}
              >
                {identity}
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {pendingMedal !== null && (
          <motion.div
            key={`medal-${pendingMedal}`}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-md"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={clearMedal}
          >
            <MedalCard phase={pendingMedal as keyof typeof MEDALS} onClose={clearMedal} />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function MedalCard({ phase, onClose }: { phase: keyof typeof MEDALS; onClose: () => void }) {
  const c = PHASE_COLORS[phase];
  const m = MEDALS[phase];
  return (
    <motion.div
      initial={{ scale: 0.7, opacity: 0, y: 26 }}
      animate={{ scale: 1, opacity: 1, y: 0 }}
      exit={{ scale: 0.86, opacity: 0 }}
      transition={M.flow}
      onClick={(e) => e.stopPropagation()}
      className="relative max-w-sm rounded-3xl px-8 py-9 text-center"
      style={{
        background: `linear-gradient(135deg, ${c.tint}, rgba(12,14,22,0.7))`,
        border: `1px solid ${c.base}`,
        backdropFilter: "blur(48px) saturate(180%)",
        WebkitBackdropFilter: "blur(48px) saturate(180%)",
        boxShadow: `0 0 48px ${c.glow}, inset 0 1px 0 rgba(255,255,255,0.2)`,
      }}
    >
      <motion.div
        animate={{ rotate: [0, -6, 6, 0] }}
        transition={{ duration: 2.2, ease: "easeInOut" }}
        className="mx-auto mb-5 flex h-28 w-28 items-center justify-center rounded-full text-5xl"
        style={{
          background: `radial-gradient(circle, ${c.glow}, ${c.tint})`,
          boxShadow: `0 0 36px ${c.glow}`,
          border: `1.5px solid ${c.base}`,
        }}
      >
        ✨
      </motion.div>
      <div className="text-[11px] uppercase tracking-[0.3em] text-white/55">
        Step {phase} unlocked
      </div>
      <h2
        className="mt-1 text-2xl font-semibold tracking-tight"
        style={{ color: c.text }}
      >
        {m.title}
      </h2>
      <p className="mt-2 text-sm text-white/70">{m.subtitle}</p>
      <button
        type="button"
        onClick={onClose}
        className="mt-6 rounded-full px-5 py-2 text-sm font-medium text-white/90"
        style={{
          background: c.tint,
          border: `1px solid ${c.base}`,
          boxShadow: `0 0 24px ${c.glow}`,
        }}
      >
        Continue
      </button>
    </motion.div>
  );
}
