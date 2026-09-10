import { create } from "zustand";
import type {
  Account,
  AppState,
  Category,
  Cents,
  Decision,
  DecisionId,
  MonthKey,
  NodeDataMap,
  NodeId,
  Settings,
  Txn,
} from "./schema";
import {
  UNCATEGORIZED_CATEGORY_ID,
  cents,
  ensureUncategorized,
  makeInitialState,
  newId,
} from "./schema";
import { pairTransfer } from "../budget/ledger";
import type { BookOps } from "../budget/nodeLedger";
import { migrate } from "./io";
import {
  LocalStorageAdapter,
  StorageError,
  backupPreMigration,
  maybePromoteBackup,
} from "./storage";
import type { StorageAdapter } from "./storage";
import { useUI } from "./uiStore";

/**
 * Everything `undoDeleteCategory` needs to invert a `deleteCategory` call
 * over whatever the budget looks like *now*, rather than replacing the
 * whole slice with a pre-delete snapshot (w3-search-undo Finding 4: the
 * snapshot approach silently destroys edits made during the toast's
 * five-second window). Each field is scoped to exactly the rows
 * `deleteCategory` touched:
 *   - `category`: the deleted row itself, re-inserted verbatim.
 *   - `txnIds`: ids of the transactions `deleteCategory` retargeted onto
 *     `reassignTo`. Undo only reclaims a txn if it's *still* sitting on
 *     `reassignTo` — one the user re-categorized again during the window,
 *     or that was deleted, is left alone rather than clobbered.
 *   - `assignments`: the deleted category's original per-month assigned
 *     cents, keyed by month. When `carriesActivity`, that amount was merged
 *     into `reassignTo`'s entry for the same month.
 *   - `merged`: what `reassignTo`'s entry held *immediately after* that
 *     merge, per month. Undo unwinds the merge only when the entry still
 *     holds exactly this value; if the user overwrote it during the toast
 *     window, their value is the intended one and is left untouched.
 *     Subtracting blindly instead preserved the user's *delta*, not their
 *     assignment — typing $150 over a merged $200 undid to −$50, a negative
 *     assignment no other code path can produce (Wave 3 recheck, F4).
 */
export type CategoryDeleteUndo = {
  category: Category;
  reassignTo: string;
  carriesActivity: boolean;
  txnIds: string[];
  assignments: Record<MonthKey, Cents>;
  merged: Record<MonthKey, Cents>;
};

type Store = AppState & {
  setDecision: (id: DecisionId, value: Decision) => void;
  toggleComplete: (id: NodeId) => void;
  setNotes: (id: NodeId, notes: string) => void;
  setNodeData: <K extends keyof NodeDataMap>(id: K, data: NodeDataMap[K]) => void;
  patchNodeData: <K extends keyof NodeDataMap>(id: K, patch: Partial<NodeDataMap[K]>) => void;
  setSettings: (patch: Partial<Settings>) => void;
  assign: (month: MonthKey, categoryId: string, amount: Cents) => void;
  addAccount: (account: Account) => void;
  updateAccount: (account: Account) => void;
  addTxn: (txn: Txn) => void;
  updateTxn: (txn: Txn) => void;
  /** Returns the removed row(s) — a transfer's two legs come back together —
   *  so a caller can park them for a w3-search-undo toast instead of the
   *  delete being silently unrecoverable. Empty array when `id` wasn't found
   *  (a no-op set, matching the old void behavior for callers that ignore
   *  the return). */
  deleteTxn: (id: string) => Txn[];
  /** Re-inserts previously-removed rows (w3-search-undo's undo action). The
   *  rows still carry their original categoryId, and that envelope already
   *  existed when they were deleted, so this never needs to materialize
   *  Uncategorized the way addTxn/updateTxn do. */
  restoreTxns: (txns: Txn[]) => void;
  addTransfer: (args: {
    from: string;
    to: string;
    amount: Cents;
    date: string;
    payee?: string;
    categoryId?: string;
  }) => void;
  addGroup: (name: string) => void;
  addCategory: (groupId: string, name: string) => void;
  updateCategory: (category: Category) => void;
  /** Returns an inverse patch (`null` for a no-op — the catch-all itself, or
   *  `id === reassignTo`) so a caller can hand it to `undoDeleteCategory`
   *  instead of parking a whole pre-delete book slice for w3-search-undo. */
  deleteCategory: (id: string, reassignTo: string) => CategoryDeleteUndo | null;
  /** Applies `deleteCategory`'s inverse patch over the *current* budget —
   *  re-adding the category, un-reassigning transactions still sitting on
   *  `reassignTo`, and moving each month's assigned dollars back — rather
   *  than replacing the whole slice. This is what makes undo safe to fire
   *  after edits happened during the toast's five-second window: an
   *  assignment or a new transaction made after the delete survives undo
   *  instead of being silently discarded along with the whole slice. */
  undoDeleteCategory: (patch: CategoryDeleteUndo) => void;
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

/** The key name is historic — migrate() upgrades v1/v2 documents in place. */
const STORAGE_KEY = "financeflow:state:v1";

/**
 * Shown by RecoveryScreen when the pre-migration backup couldn't be written,
 * so the upgrade was blocked rather than performed unbacked. Mirrored on iOS
 * as `AppStore.backupBlockedMessage` — same situation, same promise: nothing
 * has been changed.
 */
export const MIGRATION_BLOCKED_MESSAGE =
  "FinanceFlow couldn't save a backup copy of your data before upgrading it to the new format — " +
  "this browser's storage is full. Your existing data has NOT been changed, and nothing is being " +
  "saved this session. Download your data below, then free up space and reload.";

/** Raw stored bytes, if any — for App.tsx's error boundary (F10 belt-and-
 *  braces) to hand to RecoveryScreen when a render crash happens *after*
 *  a successful boot, so the user still gets a download button instead of
 *  a bare white screen. */
export function getStoredRaw(): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(STORAGE_KEY);
}

function loadInitial(): AppState {
  if (typeof localStorage === "undefined") return makeInitialState();
  const raw = localStorage.getItem(STORAGE_KEY);
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
    const migrated = migrate(parsed);
    // D7: the document just changed schema version, and the debounced write
    // below will replace the stored bytes with the v4 image within one
    // debounce cycle. Stash the ORIGINAL bytes under their own version key
    // first, so a bad migration stays recoverable from inside the app
    // (RecoveryScreen / SettingsModal read this key). `maybePromoteBackup`'s
    // rolling snapshot is throttled to once a day and cannot be relied on to
    // fire at this one instant — see storage.ts.
    //
    // The backup GATES the migration. Its failure was previously swallowed
    // while the overwrite proceeded anyway, and the two are correlated rather
    // than independent: writing the backup ADDS a second whole copy of the
    // document, the live save merely REPLACES one, so under quota pressure the
    // backup is exactly what fails and the overwrite exactly what succeeds —
    // pre-migration bytes gone, no copy, no signal. Route to the blocking
    // recovery screen instead. Setting `bootRecovery` suspends the persistence
    // subscription below, so the original bytes stay in localStorage
    // untouched and RecoveryScreen's "Download my data" hands the user those
    // very bytes.
    const storedVersion = (parsed as { version?: unknown }).version;
    if (typeof storedVersion === "number" && storedVersion < migrated.version) {
      if (!backupPreMigration(storedVersion, raw)) {
        bootRecovery = { message: MIGRATION_BLOCKED_MESSAGE, raw };
        return makeInitialState();
      }
    }
    return migrated;
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
    set((s) => {
      // First spend with no envelope of its own brings the catch-all into being.
      const book =
        txn.categoryId === UNCATEGORIZED_CATEGORY_ID ? ensureUncategorized(s.budget) : s.budget;
      return { budget: { ...book, transactions: [...book.transactions, txn] } };
    }),
  updateTxn: (txn) =>
    set((s) => {
      // Same rule as addTxn: an edit can retarget a row onto the catch-all
      // envelope too (CategorySelect offers it), so it has to be able to
      // materialize the envelope just like a fresh entry would.
      const book =
        txn.categoryId === UNCATEGORIZED_CATEGORY_ID ? ensureUncategorized(s.budget) : s.budget;
      return {
        budget: {
          ...book,
          transactions: book.transactions.map((t) => (t.id === txn.id ? txn : t)),
        },
      };
    }),
  deleteTxn: (id) => {
    let removed: Txn[] = [];
    set((s) => {
      const txn = s.budget.transactions.find((t) => t.id === id);
      if (!txn) return {};
      // A transfer's two rows live and die together.
      const ids = new Set([id, ...(txn.transferPairId ? [txn.transferPairId] : [])]);
      removed = s.budget.transactions.filter((t) => ids.has(t.id));
      return {
        budget: {
          ...s.budget,
          transactions: s.budget.transactions.filter((t) => !ids.has(t.id)),
        },
      };
    });
    return removed;
  },
  restoreTxns: (txns) =>
    set((s) => ({
      budget: { ...s.budget, transactions: [...s.budget.transactions, ...txns] },
    })),
  addTransfer: (args) =>
    set((s) => {
      const pair = pairTransfer(s.budget.accounts, args);
      // A cross-boundary transfer parks a category on its on-budget leg, so
      // it can carry the catch-all just like a plain expense — and an id with
      // no row behind it is an envelope snapshot() computes but no screen
      // renders. Materialize it here too (pairTransfer strips the category
      // from same-side pairs, so this reads the rows, not the argument).
      const book = pair.some((t) => t.categoryId === UNCATEGORIZED_CATEGORY_ID)
        ? ensureUncategorized(s.budget)
        : s.budget;
      return { budget: { ...book, transactions: [...book.transactions, ...pair] } };
    }),
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
  // Both of a deleted envelope's terms move together: its transactions and
  // every month's assigned dollars land on `reassignTo`. Because activity and
  // funding arrive at the same envelope, assigned-through and activity-through
  // are invariant, so Sigma available and Ready-to-Assign are invariant and
  // bookIntegrity().drift stays 0 by construction. (Dropping the assignments —
  // "returning them to Ready-to-Assign" — conjured the spent dollars instead.)
  // An envelope no transaction ever touched has no activity to carry, so there
  // is nothing to keep together: its assignments are simply released back to
  // Ready-to-Assign, which is money-preserving precisely because activity is 0.
  deleteCategory: (id, reassignTo) => {
    let patch: CategoryDeleteUndo | null = null;
    set((s) => {
      // The catch-all itself is not deletable — there would be nowhere to put
      // what it holds.
      if (id === UNCATEGORIZED_CATEGORY_ID || id === reassignTo) return {};
      const category = s.budget.categories.find((c) => c.id === id);
      if (!category) return {};
      const carriesActivity = s.budget.transactions.some((t) => t.categoryId === id);
      const book =
        carriesActivity && reassignTo === UNCATEGORIZED_CATEGORY_ID
          ? ensureUncategorized(s.budget)
          : s.budget;

      const originalAssignments: Record<MonthKey, Cents> = {};
      const mergedValues: Record<MonthKey, Cents> = {};
      const assignments: AppState["budget"]["assignments"] = {};
      for (const [month, table] of Object.entries(book.assignments)) {
        const { [id]: moved, ...rest } = table;
        if (moved !== undefined) {
          originalAssignments[month] = moved;
          if (carriesActivity) {
            const merged = (rest[reassignTo] ?? 0) + moved;
            mergedValues[month] = cents(merged);
            if (merged !== 0) rest[reassignTo] = cents(merged);
            else delete rest[reassignTo];
          }
        }
        if (Object.keys(rest).length > 0) assignments[month] = rest;
      }

      const txnIds = book.transactions.filter((t) => t.categoryId === id).map((t) => t.id);

      patch = {
        category,
        reassignTo,
        carriesActivity,
        txnIds,
        assignments: originalAssignments,
        merged: mergedValues,
      };

      return {
        budget: {
          ...book,
          categories: book.categories.filter((c) => c.id !== id),
          transactions: book.transactions.map((t) =>
            t.categoryId === id ? { ...t, categoryId: reassignTo } : t,
          ),
          assignments,
        },
      };
    });
    return patch;
  },
  // Inverts `deleteCategory` over the *current* budget rather than replacing
  // the slice wholesale (w3-search-undo Finding 4) — see `CategoryDeleteUndo`
  // for why each field is applied the way it is. Every step is scoped by
  // `patch`, so an assignment or transaction added to `reassignTo` during the
  // toast's five-second window survives: it's simply never touched.
  undoDeleteCategory: (patch) =>
    set((s) => {
      const { category, reassignTo, carriesActivity, txnIds, assignments: original, merged } = patch;
      const categories = s.budget.categories.some((c) => c.id === category.id)
        ? s.budget.categories
        : [...s.budget.categories, category];

      const reclaim = new Set(txnIds);
      const transactions = s.budget.transactions.map((t) =>
        reclaim.has(t.id) && t.categoryId === reassignTo ? { ...t, categoryId: category.id } : t,
      );

      const assignments: AppState["budget"]["assignments"] = { ...s.budget.assignments };
      for (const [month, moved] of Object.entries(original)) {
        const table = { ...(assignments[month] ?? {}) };
        if (carriesActivity) {
          // Unwind the merge only if the target still holds exactly what the
          // merge produced. If the user overwrote it during the toast window,
          // their value is the assignment they intend — keep it. (Blind
          // subtraction preserved their delta instead, minting negative
          // assignments; see CategoryDeleteUndo's doc.)
          const current = table[reassignTo] ?? 0;
          if (current === (merged[month] ?? 0)) {
            const preMerge = current - moved;
            if (preMerge !== 0) table[reassignTo] = cents(preMerge);
            else delete table[reassignTo];
          }
        }
        table[category.id] = moved;
        assignments[month] = table;
      }

      return { budget: { ...s.budget, categories, transactions, assignments } };
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
type PersistedFields = Pick<
  AppState,
  "version" | "settings" | "decisions" | "nodes" | "budget" | "shownCelebrations" | "earnedMedals"
>;

/**
 * What actually gets written to localStorage: the seven persisted fields
 * plus a monotonic write counter (F12). `writeSeq` is deliberately outside
 * `slicesEqual`'s comparison below — it changes on every call to
 * `toPersistedSlice` (see `writeSeq` var), so if equality checked it, the
 * no-redundant-write dedupe in `scheduleSave`/`flushSave` would never fire
 * and every keystroke would hit localStorage again. `migrate()` tolerates
 * its absence (older documents, or a v3 document written before this
 * field existed), so no version bump is needed — see io.ts.
 */
type PersistedSlice = PersistedFields & { writeSeq: number };

/**
 * Monotonic counter for this tab, seeded from whatever `writeSeq` (if any)
 * was already on disk at boot so a fresh tab's own first write still sorts
 * after anything a previous session wrote. Bumped once per actual write in
 * `writeNow` — not per mutation — so the value on disk always matches the
 * value this tab believes it last wrote (compared against in the `storage`
 * listener below).
 */
function readStoredWriteSeq(): number {
  if (typeof localStorage === "undefined") return 0;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return 0;
  try {
    const parsed = JSON.parse(raw) as { writeSeq?: unknown };
    return typeof parsed.writeSeq === "number" ? parsed.writeSeq : 0;
  } catch {
    return 0;
  }
}

let writeSeq = readStoredWriteSeq();

function toPersistedSlice(s: AppState): PersistedSlice {
  return {
    version: s.version,
    settings: s.settings,
    decisions: s.decisions,
    nodes: s.nodes,
    budget: s.budget,
    shownCelebrations: s.shownCelebrations,
    earnedMedals: s.earnedMedals,
    writeSeq,
  };
}

let lastSaved: PersistedSlice | null = null;
let pending: PersistedSlice | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

// Intentionally does not compare `writeSeq` — see PersistedSlice above.
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

/** F12: shown by TopBar's blocking overlay when the `storage` listener below
 *  sees another tab/window has written a newer document. */
const STALE_TAB_MESSAGE = "Another window updated your budget — reload to continue";

function writeNow(pendingSlice: PersistedSlice): void {
  // The counter only advances here, at the one place an actual write
  // happens — not in toPersistedSlice, which runs on every mutation whether
  // or not it ends up debounced away. Re-stamp so the bytes on disk (and
  // `lastSaved`, for future dedupe checks) carry the value that was just
  // claimed, regardless of what `pendingSlice.writeSeq` happened to be.
  writeSeq += 1;
  const slice: PersistedSlice = { ...pendingSlice, writeSeq };
  lastSaved = slice;
  pending = null;
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  // w3-backup-key: promote whatever is currently live to its own versioned
  // backup key *before* it's overwritten below. Read directly from
  // localStorage (not `lastSaved`/`slice`) so this is always the actual bytes
  // about to be replaced, not this tab's in-memory idea of them — see
  // storage.ts for the 24h-interval / one-generation-per-version logic and
  // the threat-model comment.
  maybePromoteBackup(typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null);
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
let unsubscribePersistence: (() => void) | null = null;
if (typeof window !== "undefined" && !bootRecovery) {
  unsubscribePersistence = useStore.subscribe((s) => {
    scheduleSave(toPersistedSlice(s));
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushSave();
  });
  window.addEventListener("pagehide", () => {
    flushSave();
  });

  // F12: multi-tab last-writer-wins. The browser only ever dispatches
  // `storage` to *other* windows/tabs than the one that wrote — so this
  // fires exactly when some other surface (another tab, or the installed
  // PWA) has persisted a document, never for this tab's own writes. If that
  // document's writeSeq is ahead of the one this tab last wrote, some other
  // surface has a newer document than what's in this tab's memory; suspend
  // before this tab's own (possibly stale) in-memory state can debounce its
  // way over it, and surface a blocking, non-dismissable banner — the only
  // safe way out is the reload it asks for.
  window.addEventListener("storage", (e) => {
    if (e.key !== STORAGE_KEY || !e.newValue) return;
    let parsed: { writeSeq?: unknown } | null = null;
    try {
      parsed = JSON.parse(e.newValue);
    } catch {
      return;
    }
    const storedSeq = typeof parsed?.writeSeq === "number" ? parsed.writeSeq : 0;
    if (storedSeq > writeSeq) {
      suspendPersistence();
      useUI.getState().setStaleTab(STALE_TAB_MESSAGE);
    }
  });
}

/**
 * F10 belt-and-braces: called from App.tsx's error boundary when AppShell
 * throws mid-render on a document that passed migrate()'s validation but is
 * broken in some way that validation doesn't (and can't exhaustively) check.
 * Stops any further write — including one already coalescing in the
 * debounce timer — so a crash can never overwrite the original bytes still
 * sitting in localStorage. Idempotent and safe to call even when persistence
 * was never started (boot recovery already suspended it).
 */
export function suspendPersistence(): void {
  if (unsubscribePersistence) {
    unsubscribePersistence();
    unsubscribePersistence = null;
  }
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  pending = null;
}

export { adapter };
