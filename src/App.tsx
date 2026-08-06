import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AmbientBackground } from "./components/AmbientBackground";
import { TopBar } from "./components/TopBar";
import { PhaseTrail } from "./components/PhaseTrail";
import { SettingsModal } from "./components/SettingsModal";
import { OverviewSheet } from "./components/OverviewSheet";
import { CelebrationLayer } from "./components/CelebrationLayer";
import { RecoveryScreen } from "./components/RecoveryScreen";
import { FocusStage } from "./components/focus/FocusStage";
import { BudgetScreen } from "./components/budget/BudgetScreen";
import { findCurrentNode } from "./components/focus/advance";
import { useUI } from "./state/uiStore";
import { getBootRecovery } from "./state/store";
import { GRAPH_BY_ID } from "./graph/flowchart";
import { M } from "./theme/motion";

export default function App() {
  // Checked once at module init (see src/state/store.ts loadInitial()) and
  // never toggles within a session, so branching before any hooks run here
  // is safe: this component either always takes this path or never does.
  const bootRecovery = getBootRecovery();
  if (bootRecovery) {
    return <RecoveryScreen message={bootRecovery.message} raw={bootRecovery.raw} />;
  }
  return <AppShell />;
}

function AppShell() {
  const focusedId = useUI((s) => s.focusedId);
  const setFocus = useUI((s) => s.setFocus);
  const view = useUI((s) => s.view);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    if (!focusedId) setFocus(findCurrentNode());
  }, [focusedId, setFocus]);

  const activeId = focusedId ?? "Start";
  const activePhase = useMemo(() => GRAPH_BY_ID[activeId].phase, [activeId]);

  return (
    <div className="relative flex min-h-screen flex-col text-white/95">
      <AmbientBackground phase={activePhase} />
      <TopBar onOpenSettings={() => setSettingsOpen(true)} />

      <main className="flex flex-1 items-center justify-center pb-32 pt-24">
        <AnimatePresence mode="wait" initial={false}>
          {view === "focus" && (
            <motion.div
              key="focus-stage"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={M.fade}
              className="flex w-full"
            >
              <FocusStage activeId={activeId} />
            </motion.div>
          )}
          {view === "budget" && (
            <motion.div
              key="budget-screen"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={M.fade}
              className="flex w-full self-start"
            >
              <BudgetScreen />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <OverviewSheet />
      <AnimatePresence>
        {view === "focus" && <PhaseTrail key="trail" activePhase={activePhase} />}
      </AnimatePresence>
      <CelebrationLayer />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
