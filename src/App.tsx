import { useEffect, useMemo, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { AmbientBackground } from "./components/AmbientBackground";
import { TopBar } from "./components/TopBar";
import { PhaseTrail } from "./components/PhaseTrail";
import { SettingsModal } from "./components/SettingsModal";
import { OverviewSheet } from "./components/OverviewSheet";
import { CelebrationLayer } from "./components/CelebrationLayer";
import { FocusCard } from "./components/focus/FocusCard";
import { findCurrentNode } from "./components/focus/advance";
import { useUI } from "./state/uiStore";
import { GRAPH_BY_ID } from "./graph/flowchart";

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
    <div className="relative min-h-screen text-white/95">
      <AmbientBackground phase={activePhase} />
      <TopBar onOpenSettings={() => setSettingsOpen(true)} />

      <main className="flex min-h-screen items-center justify-center px-5 pb-32 pt-24">
        <AnimatePresence mode="wait">
          {view === "focus" && (
            <FocusCard key={activeId} nodeId={activeId} />
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
