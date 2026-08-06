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
import type { BookOps } from "../budget/nodeLedger";
import { migrate } from "./io";
import { LocalStorageAdapter, StorageError } from "./storage";
import type { StorageAdapter } from "./storage";
import { useUI } from "./uiStore";

type Store = AppState & {
  setDecision: (id: DecisionId, value: Decision) => void;
  toggleComplete: (id: NodeId) => void;
  setNotes: (id: NodeId, notes: string) => void;
  setNodeData: <K extends keyof NodeDataMap>(id: K, data: NodeDataMap[K]) => void;
  patchNodeData: <K extends keyof NodeDataMap>(id: K, patch: Partial<NodeDataMap[K]>) => void;
  setSettings: (patch: Partial<Settings>) => void;
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
  deleteCategory: (id: string) => void;
  applyBookOps: (ops: BookOps) => void;
  reset: () => void;
  replaceAll: (state: AppState) => void;
};

const adapter: StorageAdapter = new LocalStorageAdapter();

if (typeof localStorage !== "undefined") {
  // One-time cleanup: the retired YNAB integration stored a personal access
  // token under this key; never leave a secret orphaned in localStorage.
  localStorage.removeItem("financeflow:ynab:v1");
}

/** Describes a stored document that could not be loaded, for App.tsx's blocking recovery screen. */
export interface BootRecovery {
  message: string;
  raw: string;
}

// Set (at most once, during module init) when the stored document exists but
// couldn't be parsed or migrated. When set, loadInitial() falls back to a
// fresh in-memory state for rendering purposes only — the persistence
// subscription below is suspended so nothing ever overwrites the original
// bytes still sitting in localStorage. Read via getBootRecovery().
let bootRecovery: BootRecovery | null = null;

export function getBootRecovery(): BootRecovery | null {
  return bootRecovery;
}

function loadInitial(): AppState {
  if (typeof localStorage === "undefined") return makeInitialState();
  const raw = localStorage.getItem("financeflow:state:v1");
  // migrate() upgrades v1/v2 documents in place; the key name is historic.
  if (!raw) return makeInitialState();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    // Bytes aren't even JSON: unreadable, not empty. Never silently reset —
    // surface it so the user can recover the raw document.
    bootRecovery = { message: `Stored data isn't valid JSON: ${(err as Error).message}`, raw };
    return makeInitialState();
  }

  try {
    return migrate(parsed);
  } catch (err) {
    // migrate() throws deliberately for a future-version or corrupt document
    // (see io.ts) instead of resetting. Falling through here would destroy
    // it via the debounced persistence write within SAVE_DEBOUNCE_MS.
    bootRecovery = { message: (err as Error).message, raw };
    return makeInitialState();
  }
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
  // A planner's batch lands in one set() — one autosave, no partial states.
  applyBookOps: (ops) =>
    set((s) => {
      const b = s.budget;
      let groups = b.groups;
      let accounts = b.accounts;
      let categories = b.categories;
      let transactions = b.transactions;
      let assignments = b.assignments;
      if (ops.addGroups?.length) groups = [...groups, ...ops.addGroups];
      if (ops.addAccounts?.length) accounts = [...accounts, ...ops.addAccounts];
      if (ops.updateAccounts?.length)
        accounts = accounts.map((a) => ops.updateAccounts!.find((u) => u.id === a.id) ?? a);
      if (ops.addCategories?.length) categories = [...categories, ...ops.addCategories];
      if (ops.updateCategories?.length)
        categories = categories.map((c) => ops.updateCategories!.find((u) => u.id === c.id) ?? c);
      if (ops.addTxns?.length) transactions = [...transactions, ...ops.addTxns];
      if (ops.updateTxns?.length)
        transactions = transactions.map((t) => ops.updateTxns!.find((u) => u.id === t.id) ?? t);
      if (ops.deleteTxnIds?.length) {
        const dead = new Set(ops.deleteTxnIds);
        transactions = transactions.filter((t) => !dead.has(t.id));
      }
      if (ops.setAssignments?.length) {
        assignments = { ...assignments };
        for (const sa of ops.setAssignments) {
          const table = { ...(assignments[sa.month] ?? {}) };
          if (sa.amount > 0) table[sa.categoryId] = sa.amount;
          else delete table[sa.categoryId];
          if (Object.keys(table).length > 0) assignments[sa.month] = table;
          else delete assignments[sa.month];
        }
      }
      return { budget: { ...b, groups, accounts, categories, transactions, assignments } };
    }),
  // Deleting never loses money: the category's transactions stay (uncategorized)
  // and its assignments vanish, so those dollars flow back to Ready-to-Assign.
  deleteCategory: (id) =>
    set((s) => {
      const assignments: AppState["budget"]["assignments"] = {};
      for (const [month, table] of Object.entries(s.budget.assignments)) {
        const { [id]: _gone, ...rest } = table;
        if (Object.keys(rest).length > 0) assignments[month] = rest;
      }
      return {
        budget: {
          ...s.budget,
          categories: s.budget.categories.filter((c) => c.id !== id),
          transactions: s.budget.transactions.map((t) => {
            if (t.categoryId !== id) return t;
            const { categoryId: _cleared, ...rest } = t;
            return rest;
          }),
          assignments,
        },
      };
    }),
  reset: () => set(() => ({ ...makeInitialState() })),
  replaceAll: (state) => set(() => ({ ...state })),
}));

// Debounced, non-redundant persistence. NumberField and friends commit on
// every keystroke, and adapter.save() serializes the entire app state, so a
// naive save-on-every-set() would stringify+setItem the whole document per
// keystroke. We coalesce bursts (trailing-edge debounce) and skip the write
// entirely when nothing in the persisted slice actually changed.
const SAVE_DEBOUNCE_MS = 300;

/** The seven fields that make it into the persisted document, by reference. */
type PersistedSlice = Pick<
  AppState,
  "version" | "settings" | "decisions" | "nodes" | "budget" | "shownCelebrations" | "earnedMedals"
>;

function toPersistedSlice(s: AppState): PersistedSlice {
  return {
    version: s.version,
    settings: s.settings,
    decisions: s.decisions,
    nodes: s.nodes,
    budget: s.budget,
    shownCelebrations: s.shownCelebrations,
    earnedMedals: s.earnedMedals,
  };
}

let lastSaved: PersistedSlice | null = null;
let pending: PersistedSlice | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function slicesEqual(a: PersistedSlice, b: PersistedSlice): boolean {
  return (
    a.version === b.version &&
    a.settings === b.settings &&
    a.decisions === b.decisions &&
    a.nodes === b.nodes &&
    a.budget === b.budget &&
    a.shownCelebrations === b.shownCelebrations &&
    a.earnedMedals === b.earnedMedals
  );
}

/** Banner/UI copy for a failed persistence write, kept in one place so the
 *  message the user sees always matches what TopBar renders. */
const SAVE_ERROR_MESSAGE = "Couldn't save your changes. Export a backup now.";
const SAVE_ERROR_MESSAGE_QUOTA =
  "Couldn't save your changes — storage is full. Export a backup now.";

function writeNow(slice: PersistedSlice): void {
  lastSaved = slice;
  pending = null;
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  // Optimistic: `lastSaved` is set before the write so the synchronous
  // dedupe in `scheduleSave` stays synchronous. If the write actually fails
  // (quota exceeded, Safari private mode), clear the marker so the next
  // mutation retries instead of being skipped as already-durable.
  void adapter.save(slice).then(
    () => {
      useUI.getState().setLastSaved(Date.now());
      // Cheap no-op guard: avoid a redundant set() on the common all-good path.
      if (useUI.getState().saveError) useUI.getState().clearSaveError();
    },
    (err) => {
      lastSaved = null;
      console.error("[financeflow] persist failed", err);
      const quotaExceeded = err instanceof StorageError && err.quotaExceeded;
      useUI.getState().setSaveError(quotaExceeded ? SAVE_ERROR_MESSAGE_QUOTA : SAVE_ERROR_MESSAGE);
    },
  );
}

/** Force any pending debounced save to write immediately, synchronously. */
export function flushSave(): void {
  if (pending && (!lastSaved || !slicesEqual(pending, lastSaved))) {
    writeNow(pending);
  } else if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
    pending = null;
  }
}

function scheduleSave(slice: PersistedSlice): void {
  if (lastSaved && slicesEqual(slice, lastSaved)) return;
  pending = slice;
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (pending) writeNow(pending);
  }, SAVE_DEBOUNCE_MS);
}

// Suspended for the session when boot recovery is active: the in-memory
// state is a throwaway fresh state, and persisting it would overwrite the
// real (unreadable) document sitting in localStorage within one debounce
// cycle. App.tsx renders a blocking recovery screen instead of the app.
if (typeof window !== "undefined" && !bootRecovery) {
  useStore.subscribe((s) => {
    scheduleSave(toPersistedSlice(s));
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushSave();
  });
  window.addEventListener("pagehide", () => {
    flushSave();
  });
}

export { adapter };
