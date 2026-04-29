import { useRef } from "react";
import { useStore } from "../state/store";
import { overallProgress } from "../graph/derive";
import { downloadJson, importJson } from "../state/io";

export function Header({ onOpenSettings }: { onOpenSettings: () => void }) {
  const state = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const progress = overallProgress(state);

  const onImport = async (file: File) => {
    const text = await file.text();
    try {
      const next = importJson(text);
      useStore.getState().replaceAll(next);
    } catch {
      alert("Could not parse that file as FinanceFlow JSON.");
    }
  };

  return (
    <header className="flex items-center gap-3 px-4 py-2 border-b border-slate-200 bg-white">
      <h1 className="font-semibold text-lg">FinanceFlow</h1>
      <div className="text-xs text-slate-500">r/PersonalFinance flowchart tracker</div>

      <div className="ml-4 flex items-center gap-2 flex-1 max-w-xs">
        <div className="text-xs text-slate-600 whitespace-nowrap">
          {progress.done}/{progress.total} tasks
        </div>
        <div className="h-2 flex-1 rounded bg-slate-200 overflow-hidden">
          <div className="h-full bg-emerald-500" style={{ width: `${progress.pct}%` }} />
        </div>
        <div className="text-xs font-medium w-10 text-right">{progress.pct}%</div>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={onOpenSettings}
          className="text-xs rounded border border-slate-300 px-2 py-1 hover:bg-slate-50"
        >
          Settings
        </button>
        <button
          type="button"
          onClick={() => downloadJson(state)}
          className="text-xs rounded border border-slate-300 px-2 py-1 hover:bg-slate-50"
        >
          Export
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="text-xs rounded border border-slate-300 px-2 py-1 hover:bg-slate-50"
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
          type="button"
          onClick={() => {
            if (confirm("Reset all progress? This cannot be undone.")) {
              useStore.getState().reset();
            }
          }}
          className="text-xs rounded border border-red-300 text-red-700 px-2 py-1 hover:bg-red-50"
        >
          Reset
        </button>
      </div>
    </header>
  );
}
