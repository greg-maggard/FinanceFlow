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
import { FORM_BY_NODE, MENU_BY_NODE } from "./forms";
import { StreakChip } from "./StreakBadge";
import { advance, findCurrentNode } from "./advance";
import { KebabMenu } from "../glass/KebabMenu";
import { isCheckedThisMonth, ymKey } from "../../state/recurring";
import { fromCents, snapshot, toCents } from "../../budget/ledger";
import { nodeRows } from "../../budget/nodeLedger";
import { dollars } from "../budget/bits";

function monthNameFor(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString(undefined, { month: "long" });
}

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
  const Menu = MENU_BY_NODE[nodeId];
  const progress = progressOf(state, nodeId);
  const recurring = RECURRING.has(nodeId);
  const identity = IDENTITY[nodeId];

  /**
   * What's still sitting in the node's envelopes. `funded` answers "is this
   * month covered?" and counts money that has already gone out the door, so
   * after any spending it disagrees with the Budget screen's available —
   * showing both saves the user from reconciling the two.
   */
  const leftThisMonth = useMemo(() => {
    if (!recurring) return 0;
    const rows = nodeRows(state.budget, snapshot(state.budget, ymKey()), nodeId);
    return fromCents(rows.reduce((c, r) => c + toCents(r.available), 0));
  }, [recurring, nodeId, state.budget]);

  const status = useMemo(() => deriveStatus(state), [state]);
  const isOnPath = status[nodeId] === "current";
  const isFreshCelebration = pendingCelebration?.id === nodeId;
  const fullCelebration = isFreshCelebration && (pendingCelebration?.onPath ?? false);

  const isMarkedDone = nodeState.completed;
  const checkedThisMonth = recurring && isCheckedThisMonth(nodeState);

  const upNextId = useMemo(() => {
    if (isOnPath || isMarkedDone) return null;
    const cur = findCurrentNode();
    return cur === nodeId ? null : cur;
  }, [nodeId, isOnPath, isMarkedDone]);

  const canMarkComplete = !isMarkedDone && (progress.kind !== "goal" || progress.ready);

  const markRecurringDone = (done: boolean) => {
    useStore.setState((s) => {
      const node = s.nodes[nodeId];
      const checks = { ...(node.monthlyChecks ?? {}) };
      if (done) checks[ymKey()] = true;
      else delete checks[ymKey()];
      return {
        nodes: { ...s.nodes, [nodeId]: { ...node, monthlyChecks: checks } },
      };
    });
  };

  const onMarkComplete = () => {
    if (!canMarkComplete) return;
    const wasOnPath = isOnPath;
    useStore.getState().toggleComplete(nodeId);
    triggerCelebration(nodeId, wasOnPath);
    advance(nodeId);
  };

  const onReopen = () => {
    useStore.getState().toggleComplete(nodeId);
  };

  const onToggleCheckIn = () => {
    markRecurringDone(!checkedThisMonth);
  };

  const onDecide = (answer: "yes" | "no") => {
    if (node.decisionId) {
      const wasOnPath = isOnPath;
      useStore.getState().setDecision(node.decisionId, answer);
      triggerCelebration(nodeId, wasOnPath);
      advance(nodeId);
    }
  };

  const buttonGlow = canMarkComplete && isOnPath;

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
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
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
              {isMarkedDone && (
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
              {recurring && <StreakChip node={nodeState} glow={phaseColor.glow} />}
            </div>
            {Menu && (
              <KebabMenu ariaLabel="Goal settings">
                <Menu />
              </KebabMenu>
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
              <div className="space-y-2">
                <GoalBar
                  value={progress.value}
                  max={progress.max}
                  tint={phaseColor.base}
                  glow={phaseColor.glow}
                  caption={nodeState.completed ? "Done" : "Toward target"}
                />
                {recurring && (
                  <p className="text-[11px] tabular-nums text-white/55">
                    Funded {dollars(progress.value)} of {dollars(progress.max)} ·{" "}
                    {dollars(leftThisMonth)} left this month
                  </p>
                )}
              </div>
            )}

            {Form && recurring && (
              <div>
                <Form />
              </div>
            )}

            {Form && !recurring && (
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

            <div
              className={`flex min-h-[44px] items-center gap-3 pt-2 ${
                recurring ? "justify-between" : "justify-end"
              }`}
            >
              {recurring && (
                <button
                  type="button"
                  onClick={onToggleCheckIn}
                  aria-pressed={checkedThisMonth}
                  className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    checkedThisMonth
                      ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-200"
                      : "border-white/15 bg-white/5 text-white/60 hover:text-white/85"
                  }`}
                >
                  <span aria-hidden>{checkedThisMonth ? "✓" : "○"}</span>
                  {checkedThisMonth
                    ? `Checked in for ${monthNameFor(ymKey())}`
                    : `Check in for ${monthNameFor(ymKey())}`}
                </button>
              )}
              <AnimatePresence mode="wait" initial={false}>
                {isMarkedDone ? (
                  <motion.div
                    key="reopen"
                    initial={{ opacity: 0, y: 6, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.96 }}
                    transition={{ duration: 0.45, ease: EASE_FLOW }}
                  >
                    <GlassButton variant="secondary" size="lg" onClick={onReopen}>
                      Reopen
                    </GlassButton>
                  </motion.div>
                ) : canMarkComplete ? (
                  <motion.div
                    key="mark"
                    initial={{ opacity: 0, y: 6, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.96 }}
                    transition={{ duration: 0.45, ease: EASE_FLOW }}
                  >
                    <GlassButton
                      variant="primary"
                      size="lg"
                      tint={phaseColor.tint}
                      glow={buttonGlow}
                      onClick={onMarkComplete}
                      style={{ minWidth: 140 }}
                    >
                      Mark complete
                    </GlassButton>
                  </motion.div>
                ) : null}
              </AnimatePresence>
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
