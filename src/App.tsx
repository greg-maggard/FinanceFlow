import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AmbientBackground } from "./components/AmbientBackground";
import { TopBar } from "./components/TopBar";
import { PhaseTrail } from "./components/PhaseTrail";
import { SettingsModal } from "./components/SettingsModal";
import { OverviewSheet } from "./components/OverviewSheet";
import { CelebrationLayer } from "./components/CelebrationLayer";
import { FocusStage } from "./components/focus/FocusStage";
import { findCurrentNode } from "./components/focus/advance";
import { useUI } from "./state/uiStore";
import { GRAPH_BY_ID } from "./graph/flowchart";
import { M } from "./theme/motion";

export default function App() {
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

      <main
        className="flex flex-1 items-center justify-center pb-32 pt-24"
        onClick={() => view === "focus" && useUI.getState().setView("overview")}
      >
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
        </AnimatePresence>
      </main>

      <OverviewSheet />
      <PhaseTrail activePhase={activePhase} />
      <CelebrationLayer />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
