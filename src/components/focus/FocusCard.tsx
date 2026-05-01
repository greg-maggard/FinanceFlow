import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { GRAPH_BY_ID, PHASE_LABELS } from "../../graph/flowchart";
import { PHASE_COLORS } from "../../theme/phaseColors";
import { IDENTITY, RECURRING } from "../../theme/identity";
import { M } from "../../theme/motion";
import type { NodeId } from "../../state/schema";
import { useStore } from "../../state/store";
import { useUI } from "../../state/uiStore";
import { GlassCard } from "../glass/GlassCard";
import { GlassButton } from "../glass/GlassButton";
import { GoalBar } from "../glass/GoalBar";
import { GlassTextarea } from "../glass/GlassInput";
import { progressOf } from "./progressOf";
import { FORM_BY_NODE } from "./forms";
import { StreakBadge } from "./StreakBadge";
import { advanceFromCurrent } from "./advance";

export function FocusCard({ nodeId }: { nodeId: NodeId }) {
  const node = GRAPH_BY_ID[nodeId];
  const state = useStore();
  const triggerCelebration = useUI((s) => s.triggerCelebration);
  const phaseColor = PHASE_COLORS[node.phase];
  const [showForm, setShowForm] = useState(true);
  const [showNotes, setShowNotes] = useState(false);

  const nodeState = state.nodes[nodeId];
  const Form = FORM_BY_NODE[nodeId];
  const progress = progressOf(state, nodeId);
  const recurring = RECURRING.has(nodeId);
  const identity = IDENTITY[nodeId];

  const onComplete = () => {
    if (!nodeState.completed) {
      useStore.getState().toggleComplete(nodeId);
      triggerCelebration(nodeId);
    }
    advanceFromCurrent();
  };

  const onDecide = (answer: "yes" | "no") => {
    if (node.decisionId) {
      useStore.getState().setDecision(node.decisionId, answer);
      triggerCelebration(nodeId);
      advanceFromCurrent();
    }
  };

  const ready =
    node.kind === "decision" ||
    nodeState.completed ||
    (progress.kind === "goal" && progress.ready) ||
    progress.kind === "none";

  return (
    <motion.div
      layoutId="focus-card"
      key={nodeId}
      initial={{ opacity: 0, scale: 0.92, y: 28, filter: "blur(8px)" }}
      animate={{ opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
      exit={{ opacity: 0, scale: 0.94, y: -22, filter: "blur(14px)" }}
      transition={M.flow}
      onClick={(e) => e.stopPropagation()}
      className="mx-auto w-full max-w-xl"
    >
      <GlassCard
        intensity="strong"
        tint={phaseColor.tint}
        className="px-7 py-7 sm:px-8 sm:py-8"
      >
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span
              className="rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em]"
              style={{
                background: phaseColor.tint,
                color: phaseColor.text,
                border: `1px solid ${phaseColor.base}`,
              }}
            >
              {PHASE_LABELS[node.phase].replace(/^Step \d+: /, "")}
            </span>
            {nodeState.completed && (
              <motion.span
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 320, damping: 20 }}
                className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                style={{
                  background: "rgba(52, 211, 153, 0.18)",
                  color: "#a7f3d0",
                  border: "1px solid rgba(52, 211, 153, 0.4)",
                }}
              >
                Complete
              </motion.span>
            )}
          </div>
          <h1 className="text-2xl font-semibold leading-tight tracking-tight text-white">
            {node.label}
          </h1>
          {node.sublabel && (
            <p className="text-sm italic text-white/60">{node.sublabel}</p>
          )}
          {identity && nodeState.completed && (
            <motion.p
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              className="pt-2 text-sm font-medium"
              style={{ color: phaseColor.text }}
            >
              {identity}
            </motion.p>
          )}
        </div>

        <div className="my-6 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />

        {node.kind === "decision" ? (
          <div className="space-y-4">
            <p className="text-sm text-white/70">Choose to continue.</p>
            <div className="grid grid-cols-2 gap-3">
              <GlassButton variant="yes" size="lg" onClick={() => onDecide("yes")}>
                Yes
              </GlassButton>
              <GlassButton variant="no" size="lg" onClick={() => onDecide("no")}>
                No
              </GlassButton>
            </div>
            {state.decisions[node.decisionId!] && (
              <p className="text-center text-xs text-white/50">
                Currently: <span className="font-semibold uppercase">{state.decisions[node.decisionId!]}</span>. Re-answer to change route.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-5">
            {progress.kind === "goal" && (
              <GoalBar
                value={progress.value}
                max={progress.max}
                tint={phaseColor.base}
                glow={phaseColor.glow}
                caption={nodeState.completed ? "Done" : "Toward target"}
              />
            )}

            {recurring && (
              <StreakBadge nodeId={nodeId} tint={phaseColor.tint} glow={phaseColor.glow} />
            )}

            {Form && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowForm((v) => !v)}
                  className="flex w-full items-center justify-between text-left text-xs uppercase tracking-[0.2em] text-white/55 hover:text-white/80"
                >
                  <span>Details</span>
                  <span className="text-base">{showForm ? "−" : "+"}</span>
                </button>
                <AnimatePresence initial={false}>
                  {showForm && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.25, ease: "easeOut" }}
                      className="overflow-hidden"
                    >
                      <div className="pt-4">
                        <Form />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            <div>
              <button
                type="button"
                onClick={() => setShowNotes((v) => !v)}
                className="flex w-full items-center justify-between text-left text-xs uppercase tracking-[0.2em] text-white/55 hover:text-white/80"
              >
                <span>Notes</span>
                <span className="text-base">{showNotes ? "−" : "+"}</span>
              </button>
              <AnimatePresence initial={false}>
                {showNotes && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.25, ease: "easeOut" }}
                    className="overflow-hidden"
                  >
                    <div className="pt-3">
                      <GlassTextarea
                        rows={3}
                        value={nodeState.notes}
                        placeholder="Anything you want to remember…"
                        onChange={(e) =>
                          useStore.getState().setNotes(nodeId, e.target.value)
                        }
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="flex items-center justify-between gap-3 pt-2">
              {nodeState.completed ? (
                <GlassButton
                  variant="secondary"
                  size="lg"
                  onClick={() => useStore.getState().toggleComplete(nodeId)}
                >
                  Reopen
                </GlassButton>
              ) : (
                <span className="text-xs text-white/45">
                  {progress.kind === "goal" && !progress.ready
                    ? `${Math.max(0, Math.round(progress.max - progress.value)).toLocaleString()} to target — but you can mark complete anytime.`
                    : recurring
                      ? "Recurring — keep your streak."
                      : "Mark complete when ready."}
                </span>
              )}
              <GlassButton
                variant="primary"
                size="lg"
                tint={phaseColor.tint}
                glow={ready && !nodeState.completed}
                onClick={onComplete}
                style={{ minWidth: 140 }}
              >
                {nodeState.completed ? "Continue →" : "Mark complete"}
              </GlassButton>
            </div>
          </div>
        )}
      </GlassCard>
    </motion.div>
  );
}
