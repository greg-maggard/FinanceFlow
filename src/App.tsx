import { Component, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AmbientBackground } from "./components/AmbientBackground";
import { TopBar } from "./components/TopBar";
import { SettingsModal } from "./components/SettingsModal";
import { OverviewSheet } from "./components/OverviewSheet";
import { CelebrationLayer } from "./components/CelebrationLayer";
import { RecoveryScreen } from "./components/RecoveryScreen";
import { StaleTabBanner } from "./components/StaleTabBanner";
import { AddTransactionFab } from "./components/AddTransactionFab";
import { FocusStage } from "./components/focus/FocusStage";
import { BudgetScreen } from "./components/budget/BudgetScreen";
import { findCurrentNode } from "./components/focus/advance";
import { useUI } from "./state/uiStore";
import { getBootRecovery, getStoredRaw, suspendPersistence } from "./state/store";
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
  return (
    <AppErrorBoundary>
      <AppShell />
    </AppErrorBoundary>
  );
}

type BoundaryState = { error: Error | null };

/**
 * F10 belt-and-braces: migrate()'s structural validation catches a claimed
 * v3 document that's missing or mistyped a required container, but it can't
 * exhaustively rule out every shape that crashes something deeper in render
 * (a category referencing a group that isn't there, for instance). Rather
 * than a bare white screen with no way out, fall back to the same
 * RecoveryScreen the boot-time guard uses, and suspend persistence so the
 * crash can't get written back over the original bytes.
 */
export class AppErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error): void {
    suspendPersistence();
    console.error("[financeflow] AppShell crashed after boot", error);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <RecoveryScreen
          message={`FinanceFlow hit an error and can't continue: ${this.state.error.message}`}
          raw={getStoredRaw() ?? ""}
        />
      );
    }
    return this.props.children;
  }
}

function AppShell() {
  const focusedId = useUI((s) => s.focusedId);
  const view = useUI((s) => s.view);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    // Covers both first-ever launch (focusedId still null) and a persisted
    // focusedId that's no longer a valid NodeId (e.g. after a graph change)
    // — w2-persist-view. Written via setState rather than setFocus() so it
    // doesn't also force view to "focus", which would stomp the persisted
    // view on every cold boot.
    if (!focusedId || !GRAPH_BY_ID[focusedId]) {
      useUI.setState({ focusedId: findCurrentNode() });
    }
  }, [focusedId]);

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
      <CelebrationLayer />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      {/* Persistent across every view (w2-fastentry) — mounted at shell level
          rather than per-view so navigating never hides it. */}
      <AddTransactionFab />
      <StaleTabBanner />
    </div>
  );
}
