import type { AppState } from "./schema";

export function exportJson(state: AppState): string {
  return JSON.stringify(state, null, 2);
}

export function importJson(raw: string): AppState {
  const parsed = JSON.parse(raw);
  return migrate(parsed);
}

export function migrate(input: unknown): AppState {
  if (!input || typeof input !== "object") {
    throw new Error("Not a FinanceFlow document.");
  }
  const obj = input as Partial<AppState> & { version?: number };
  if (obj.version === 1) return obj as AppState;
  // Never silently reset: a document from a newer (or unknown) version must
  // surface as an error the caller can show, not vanish into a fresh state.
  throw new Error(`Unsupported FinanceFlow version: ${String(obj.version)}.`);
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
