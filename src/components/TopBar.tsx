import { useMemo } from "react";
import { useStore } from "../state/store";
import { applyPwaUpdate, useUI } from "../state/uiStore";
import { downloadJson } from "../state/io";
import { overallProgress } from "../graph/derive";

export function TopBar({ onOpenSettings }: { onOpenSettings: () => void }) {
  // Selector-scoped rather than a bare `useStore()`: this header is always
  // mounted, so a whole-store subscription would re-render it (and recompute
  // `overallProgress`) on every keystroke anywhere in the app, including
  // Budget-screen edits that never touch `nodes`/`decisions`.
  const nodes = useStore((s) => s.nodes);
  const decisions = useStore((s) => s.decisions);
  const view = useUI((s) => s.view);
  const setView = useUI((s) => s.setView);
  const saveError = useUI((s) => s.saveError);
  const clearSaveError = useUI((s) => s.clearSaveError);
  const needRefresh = useUI((s) => s.needRefresh);
  const progress = useMemo(() => overallProgress({ nodes, decisions }), [nodes, decisions]);

  return (
    // Header and banner share one fixed wrapper so the banner is pinned
    // directly below the header regardless of the header's actual height.
    <div
      className="fixed inset-x-0 top-0 z-30 flex flex-col"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <header
        className="flex items-center justify-between px-5 py-3"
        style={{
          background: "linear-gradient(180deg, rgba(7,8,15,0.7), rgba(7,8,15,0))",
        }}
      >
      <div className="flex items-center gap-3">
        <h1 className="text-sm font-semibold tracking-[0.18em] text-white/90">
          FINANCEFLOW
        </h1>
        <div className="hidden sm:flex items-center gap-2 text-[11px] tabular-nums text-white/55">
          <span>{progress.done}/{progress.total}</span>
          <div
            className="h-1 w-24 overflow-hidden rounded-full"
            style={{ background: "rgba(255,255,255,0.08)" }}
          >
            <div
              className="h-full rounded-full bg-white/70"
              style={{ width: `${progress.pct}%`, transition: "width 0.4s" }}
            />
          </div>
          <span className="font-medium text-white/75">{progress.pct}%</span>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => setView(view === "budget" ? "focus" : "budget")}
          className="rounded-full px-3 py-1.5 text-[11px] font-medium text-white/70 hover:text-white/95"
          style={{
            background:
              view === "budget" ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.10)",
          }}
        >
          {view === "budget" ? "Focus" : "Budget"}
        </button>
        {view !== "overview" && (
          <button
            onClick={() => setView("overview")}
            className="rounded-full px-3 py-1.5 text-[11px] font-medium text-white/70 hover:text-white/95"
            style={{
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.10)",
            }}
          >
            Overview
          </button>
        )}
        <button
          onClick={onOpenSettings}
          aria-label="Settings"
          className="flex h-8 w-8 items-center justify-center rounded-full text-white/70 hover:text-white/95"
          style={{
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.10)",
          }}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path
              d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
            />
          </svg>
        </button>
      </div>
      </header>
      {saveError && (
        // Persistent, not a toast: no auto-dismiss timer. Stays until the
        // next successful save clears it (see store.ts writeNow) or the
        // user dismisses it explicitly.
        <div
          role="alert"
          className="flex items-center justify-between gap-3 px-5 py-2 text-[12px]"
          style={{
            background: "rgba(127,29,29,0.92)",
            borderTop: "1px solid rgba(248,113,113,0.35)",
            borderBottom: "1px solid rgba(248,113,113,0.35)",
          }}
        >
          <span className="text-red-100">{saveError}</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => downloadJson(useStore.getState())}
              className="rounded-full px-3 py-1 text-[11px] font-semibold text-white"
              style={{
                background: "rgba(248,113,113,0.35)",
                border: "1px solid rgba(248,113,113,0.6)",
              }}
            >
              Export
            </button>
            <button
              onClick={clearSaveError}
              aria-label="Dismiss"
              className="px-1 text-red-100/70 hover:text-red-50"
            >
              ×
            </button>
          </div>
        </div>
      )}
      {needRefresh && (
        // Non-blocking: an update is ready but the current tab keeps
        // working normally until the user chooses to reload. See
        // applyPwaUpdate() in state/uiStore.ts and the registerType:
        // "prompt" note in vite.config.ts for why this can't be silent.
        <div
          role="status"
          className="flex items-center justify-between gap-3 px-5 py-2 text-[12px]"
          style={{
            background: "rgba(12,14,22,0.92)",
            borderTop: "1px solid rgba(255,255,255,0.14)",
            borderBottom: "1px solid rgba(255,255,255,0.14)",
          }}
        >
          <span className="text-white/80">
            Update available — refreshes now, your data is safe
          </span>
          <button
            onClick={applyPwaUpdate}
            className="rounded-full px-3 py-1 text-[11px] font-semibold text-white"
            style={{
              background: "rgba(255,255,255,0.14)",
              border: "1px solid rgba(255,255,255,0.28)",
            }}
          >
            Refresh
          </button>
        </div>
      )}
    </div>
  );
}
