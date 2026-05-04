import { AnimatePresence, motion } from "framer-motion";
import { useMemo, useState } from "react";
import { GRAPH_BY_ID, PHASE_LABELS } from "../../graph/flowchart";
import { PHASE_COLORS } from "../../theme/phaseColors";
import { IDENTITY, RECURRING } from "../../theme/identity";
import { EASE_FLOW, M } from "../../theme/motion";
import type { NodeId } from "../../state/schema";
import { useStore } from "../../state/store";
import { useUI } from "../../state/uiStore";
import { deriveStatus } from "../../graph/derive";
import { GlassCard } from "../glass/GlassCard";
import { GlassButton } from "../glass/GlassButton";
import { GoalBar } from "../glass/GoalBar";
import { GlassTextarea } from "../glass/GlassInput";
import { progressOf } from "./progressOf";
import { FORM_BY_NODE } from "./forms";
import { StreakBadge } from "./StreakBadge";
import { advance, findCurrentNode } from "./advance";

export function FocusCard({ nodeId }: { nodeId: NodeId }) {
  const node = GRAPH_BY_ID[nodeId];
  const state = useStore();
  const triggerCelebration = useUI((s) => s.triggerCelebration);
  const setFocus = useUI((s) => s.setFocus);
  const pendingCelebration = useUI((s) => s.pendingCelebration);
  const phaseColor = PHASE_COLORS[node.phase];
  const [showForm, setShowForm] = useState(true);
  const [showNotes, setShowNotes] = useState(false);

  const nodeState = state.nodes[nodeId];
  const Form = FORM_BY_NODE[nodeId];
  const progress = progressOf(state, nodeId);
  const recurring = RECURRING.has(nodeId);
  const identity = IDENTITY[nodeId];

  const status = useMemo(() => deriveStatus(state), [state]);
  const isOnPath = status[nodeId] === "current";
  const isFreshCelebration = pendingCelebration === nodeId;
  const fullCelebration = isFreshCelebration && isOnPath;
  const upNextId = useMemo(() => {
    if (isOnPath || nodeState.completed) return null;
    const cur = findCurrentNode();
    return cur === nodeId ? null : cur;
  }, [nodeId, isOnPath, nodeState.completed]);

  const onComplete = () => {
    if (!nodeState.completed) {
      useStore.getState().toggleComplete(nodeId);
      triggerCelebration(nodeId);
    }
    advance(nodeId);
  };

  const onDecide = (answer: "yes" | "no") => {
    if (node.decisionId) {
      useStore.getState().setDecision(node.decisionId, answer);
      triggerCelebration(nodeId);
      advance(nodeId);
    }
  };

  const ready =
    node.kind === "decision" ||
    nodeState.completed ||
    (progress.kind === "goal" && progress.ready) ||
    progress.kind === "none";

  const buttonGlow = ready && !nodeState.completed && isOnPath;

  return (
    <div className="mx-auto w-full max-w-xl">
      <GlassCard
        intensity="strong"
        tint={phaseColor.tint}
        className="relative px-7 py-7 sm:px-8 sm:py-8"
      >
        {/* Specular sweep on fresh in-order completion */}
        <AnimatePresence>
          {fullCelebration && (
            <motion.div
              key={`sweep-${nodeState.completedAt ?? nodeId}`}
              aria-hidden
              className="pointer-events-none absolute inset-0 overflow-hidden"
              style={{ borderRadius: "inherit" }}
            >
              <motion.div
                className="absolute inset-y-[-20%] w-[42%] -skew-x-12"
                initial={{ x: "-180%", opacity: 0 }}
                animate={{ x: "260%", opacity: [0, 0.85, 0] }}
                transition={{ duration: 1.4, ease: EASE_FLOW }}
                style={{
                  background: `linear-gradient(90deg, transparent, ${phaseColor.glow} 45%, ${phaseColor.glow} 55%, transparent)`,
                  filter: "blur(10px)",
                }}
              />
            </motion.div>
          )}
        </AnimatePresence>

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
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={M.fade}
                className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                style={{
                  background: "rgba(52, 211, 153, 0.14)",
                  color: "#a7f3d0",
                  border: "1px solid rgba(52, 211, 153, 0.32)",
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
            <p className="text-sm italic text-white/55">{node.sublabel}</p>
          )}
          <AnimatePresence>
            {identity && nodeState.completed && (
              <motion.p
                key={fullCelebration ? `identity-fresh-${nodeState.completedAt}` : "identity-static"}
                initial={fullCelebration ? { opacity: 0, y: 6 } : false}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={
                  fullCelebration
                    ? { duration: 0.7, ease: EASE_FLOW, delay: 0.55 }
                    : M.fadeQuick
                }
                className="pt-3 text-[13px] italic leading-relaxed"
                style={{ color: phaseColor.text, opacity: 0.85 }}
              >
                {identity}
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        <div className="my-6 h-px bg-gradient-to-r from-transparent via-white/12 to-transparent" />

        {node.kind === "decision" ? (
          <div className="space-y-4">
            <p className="text-sm text-white/65">Choose to continue.</p>
            <div className="grid grid-cols-2 gap-3">
              <GlassButton variant="yes" size="lg" onClick={() => onDecide("yes")}>
                Yes
              </GlassButton>
              <GlassButton variant="no" size="lg" onClick={() => onDecide("no")}>
                No
              </GlassButton>
            </div>
            {state.decisions[node.decisionId!] && (
              <p className="text-center text-xs text-white/45">
                Currently:{" "}
                <span className="font-semibold uppercase">
                  {state.decisions[node.decisionId!]}
                </span>
                . Re-answer to change route.
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
                  <span>{recurring ? "Edit goal" : "Details"}</span>
                  <span className="text-base">{showForm ? "−" : "+"}</span>
                </button>
                <AnimatePresence initial={false}>
                  {showForm && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={M.fadeQuick}
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
                    transition={M.fadeQuick}
                    className="overflow-hidden"
                  >
                    <div className="pt-3">
                      <GlassTextarea
                        rows={3}
                        value={nodeState.notes}
                        placeholder="Anything you want to remember…"
                        onChange={(e) => useStore.getState().setNotes(nodeId, e.target.value)}
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
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
                    ? `${Math.max(0, Math.round(progress.max - progress.value)).toLocaleString()} to target`
                    : recurring
                      ? "Recurring — keep your streak."
                      : "Mark complete when ready."}
                </span>
              )}
              <GlassButton
                variant="primary"
                size="lg"
                tint={isOnPath ? phaseColor.tint : "rgba(255,255,255,0.06)"}
                glow={buttonGlow}
                onClick={onComplete}
                style={{ minWidth: 140 }}
              >
                {nodeState.completed ? "Next step →" : "Mark complete"}
              </GlassButton>
            </div>

            {upNextId && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={M.fadeQuick}
                className="flex items-center justify-center gap-1.5 pt-1 text-[11px] text-white/45"
              >
                <span>You're ahead of yourself.</span>
                <button
                  type="button"
                  onClick={() => setFocus(upNextId, "backward")}
                  className="font-medium text-white/65 hover:text-white/95"
                >
                  Back to {GRAPH_BY_ID[upNextId].label.split(/[\n,]/)[0]}
                </button>
              </motion.div>
            )}
          </div>
        )}
      </GlassCard>
    </div>
  );
}
