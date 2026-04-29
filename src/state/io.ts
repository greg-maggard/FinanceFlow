import type { AppState } from "./schema";
import { makeInitialState } from "./schema";

export function exportJson(state: AppState): string {
  return JSON.stringify(state, null, 2);
}

export function importJson(raw: string): AppState {
  const parsed = JSON.parse(raw);
  return migrate(parsed);
}

export function migrate(input: unknown): AppState {
  if (!input || typeof input !== "object") return makeInitialState();
  const obj = input as Partial<AppState> & { version?: number };
  if (obj.version === 1) return obj as AppState;
  return makeInitialState();
}

export function downloadJson(state: AppState, filename = "financeflow.json"): void {
  const blob = new Blob([exportJson(state)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
