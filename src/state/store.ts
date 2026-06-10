import { create } from "zustand";
import type {
  Account,
  AppState,
  Category,
  Decision,
  DecisionId,
  MonthKey,
  NodeDataMap,
  NodeId,
  Settings,
  Txn,
} from "./schema";
import { makeInitialState, newId } from "./schema";
import { pairTransfer } from "../budget/ledger";
import { migrate } from "./io";
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
  assign: (month: MonthKey, categoryId: string, amount: number) => void;
  addAccount: (account: Account) => void;
  updateAccount: (account: Account) => void;
  addTxn: (txn: Txn) => void;
  updateTxn: (txn: Txn) => void;
  deleteTxn: (id: string) => void;
  addTransfer: (args: {
    from: string;
    to: string;
    amount: number;
    date: string;
    payee?: string;
    categoryId?: string;
  }) => void;
  addGroup: (name: string) => void;
  addCategory: (groupId: string, name: string) => void;
  updateCategory: (category: Category) => void;
  reset: () => void;
  replaceAll: (state: AppState) => void;
};

const adapter: StorageAdapter = new LocalStorageAdapter();

function loadInitial(): AppState {
  if (typeof localStorage === "undefined") return makeInitialState();
  try {
    const raw = localStorage.getItem("financeflow:state:v1");
    // migrate() upgrades v1 documents in place; the key name is historic.
    if (raw) return migrate(JSON.parse(raw));
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
  assign: (month, categoryId, amount) =>
    set((s) => {
      const months = { ...s.budget.assignments };
      const table = { ...(months[month] ?? {}) };
      if (amount > 0) table[categoryId] = amount;
      else delete table[categoryId];
      if (Object.keys(table).length > 0) months[month] = table;
      else delete months[month];
      return { budget: { ...s.budget, assignments: months } };
    }),
  addAccount: (account) =>
    set((s) => ({ budget: { ...s.budget, accounts: [...s.budget.accounts, account] } })),
  updateAccount: (account) =>
    set((s) => ({
      budget: {
        ...s.budget,
        accounts: s.budget.accounts.map((a) => (a.id === account.id ? account : a)),
      },
    })),
  addTxn: (txn) =>
    set((s) => ({ budget: { ...s.budget, transactions: [...s.budget.transactions, txn] } })),
  updateTxn: (txn) =>
    set((s) => ({
      budget: {
        ...s.budget,
        transactions: s.budget.transactions.map((t) => (t.id === txn.id ? txn : t)),
      },
    })),
  deleteTxn: (id) =>
    set((s) => {
      const txn = s.budget.transactions.find((t) => t.id === id);
      if (!txn) return {};
      // A transfer's two rows live and die together.
      const ids = new Set([id, ...(txn.transferPairId ? [txn.transferPairId] : [])]);
      return {
        budget: {
          ...s.budget,
          transactions: s.budget.transactions.filter((t) => !ids.has(t.id)),
        },
      };
    }),
  addTransfer: (args) =>
    set((s) => ({
      budget: {
        ...s.budget,
        transactions: [...s.budget.transactions, ...pairTransfer(s.budget.accounts, args)],
      },
    })),
  addGroup: (name) =>
    set((s) => ({
      budget: {
        ...s.budget,
        groups: [...s.budget.groups, { id: newId(), name, order: s.budget.groups.length }],
      },
    })),
  addCategory: (groupId, name) =>
    set((s) => ({
      budget: {
        ...s.budget,
        categories: [
          ...s.budget.categories,
          { id: newId(), groupId, name, order: s.budget.categories.length },
        ],
      },
    })),
  updateCategory: (category) =>
    set((s) => ({
      budget: {
        ...s.budget,
        categories: s.budget.categories.map((c) => (c.id === category.id ? category : c)),
      },
    })),
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
      budget: s.budget,
      shownCelebrations: s.shownCelebrations,
      earnedMedals: s.earnedMedals,
      categoryMap: s.categoryMap,
    };
    void adapter.save(snapshot);
  });
}

export { adapter };
