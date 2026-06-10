import { useRef } from "react";
import { useStore } from "../state/store";
import { useUI } from "../state/uiStore";
import { downloadJson, importJson } from "../state/io";
import { overallProgress } from "../graph/derive";

export function TopBar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const state = useStore();
  const view = useUI((s) => s.view);
  const setView = useUI((s) => s.setView);
  const fileRef = useRef<HTMLInputElement>(null);
  const progress = overallProgress(state);

  const onImport = async (file: File) => {
    const text = await file.text();
    try {
      useStore.getState().replaceAll(importJson(text));
    } catch {
      alert("Could not parse that file as FinanceFlow JSON.");
    }
  };

  return (
    <header
      className="fixed inset-x-0 top-0 z-30 flex items-center justify-between px-5 py-3"
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
          className="rounded-full px-3 py-1.5 text-[11px] font-medium text-white/70 hover:text-white/95"
          style={{
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.10)",
          }}
        >
          Settings
        </button>
        <button
          onClick={() => downloadJson(state)}
          className="rounded-full px-3 py-1.5 text-[11px] font-medium text-white/70 hover:text-white/95"
          style={{
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.10)",
          }}
        >
          Export
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          className="rounded-full px-3 py-1.5 text-[11px] font-medium text-white/70 hover:text-white/95"
          style={{
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.10)",
          }}
        >
          Import
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onImport(f);
            e.target.value = "";
          }}
        />
        <button
          onClick={() => {
            if (confirm("Reset all progress? This cannot be undone.")) {
              useStore.getState().reset();
            }
          }}
          className="rounded-full px-3 py-1.5 text-[11px] font-medium text-red-300/80 hover:text-red-200"
          style={{
            background: "rgba(248,113,113,0.06)",
            border: "1px solid rgba(248,113,113,0.18)",
          }}
        >
          Reset
        </button>
      </div>
    </header>
  );
}
