import { create } from "zustand";
import type { AppState, Decision, DecisionId, NodeDataMap, NodeId, Settings } from "./schema";
import { makeInitialState } from "./schema";
import { LocalStorageAdapter } from "./storage";
import type { StorageAdapter } from "./storage";

type Store = AppState & {
  setDecision: (id: DecisionId, value: Decision) => void;
  toggleComplete: (id: NodeId) => void;
  setNotes: (id: NodeId, notes: string) => void;
  setNodeData: <K extends keyof NodeDataMap>(id: K, data: NodeDataMap[K]) => void;
  patchNodeData: <K extends keyof NodeDataMap>(id: K, patch: Partial<NodeDataMap[K]>) => void;
  setSettings: (patch: Partial<Settings>) => void;
  setCategoryMap: (nodeId: NodeId, categoryId: string | null) => void;
  reset: () => void;
  replaceAll: (state: AppState) => void;
};

const adapter: StorageAdapter = new LocalStorageAdapter();

function loadInitial(): AppState {
  if (typeof localStorage === "undefined") return makeInitialState();
  try {
    const raw = localStorage.getItem("financeflow:state:v1");
    if (raw) {
      const parsed = JSON.parse(raw) as AppState;
      if (parsed.version === 1) return parsed;
    }
  } catch {
    // fall through
  }
  return makeInitialState();
}

export const useStore = create<Store>((set) => ({
  ...loadInitial(),
  setDecision: (id, value) =>
    set((s) => ({ decisions: { ...s.decisions, [id]: value } })),
  toggleComplete: (id) =>
    set((s) => {
      const node = s.nodes[id];
      const completed = !node.completed;
      return {
        nodes: {
          ...s.nodes,
          [id]: {
            ...node,
            completed,
            completedAt: completed ? new Date().toISOString() : undefined,
          },
        },
      };
    }),
  setNotes: (id, notes) =>
    set((s) => ({ nodes: { ...s.nodes, [id]: { ...s.nodes[id], notes } } })),
  setNodeData: (id, data) =>
    set((s) => ({ nodes: { ...s.nodes, [id]: { ...s.nodes[id], data } } })),
  patchNodeData: (id, patch) =>
    set((s) => ({
      nodes: {
        ...s.nodes,
        [id]: {
          ...s.nodes[id],
          data: { ...(s.nodes[id].data as object), ...patch } as NodeDataMap[typeof id],
        },
      },
    })),
  setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
  setCategoryMap: (nodeId, categoryId) =>
    set((s) => {
      const next = { ...(s.categoryMap ?? {}) };
      if (categoryId) next[nodeId] = categoryId;
      else delete next[nodeId];
      return { categoryMap: next };
    }),
  reset: () => set(() => ({ ...makeInitialState() })),
  replaceAll: (state) => set(() => ({ ...state })),
}));

if (typeof window !== "undefined") {
  useStore.subscribe((s) => {
    const snapshot: AppState = {
      version: s.version,
      settings: s.settings,
      decisions: s.decisions,
      nodes: s.nodes,
      shownCelebrations: s.shownCelebrations,
      earnedMedals: s.earnedMedals,
      categoryMap: s.categoryMap,
    };
    void adapter.save(snapshot);
  });
}

export { adapter };
