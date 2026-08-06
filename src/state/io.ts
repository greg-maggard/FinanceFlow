import type {
  Account,
  AppState,
  BudgetBook,
  Category,
  Decisions,
  NodeDataMap,
  NodeId,
  NodeState,
  Settings,
  SourcedNumber,
  Txn,
} from "./schema";
import {
  RTA_CATEGORY_ID,
  bigEmergencyFundTarget,
  emergencyFundTarget,
  emptyBudgetBook,
} from "./schema";
import { ymKey } from "./recurring";
import { accountBalance, fromCents, isoDay, toCents } from "../budget/ledger";
import {
  COLLEGE_ACCOUNT_ID,
  GROUP_BILLS,
  GROUP_EF,
  GROUP_GOALS,
  ensureGroup,
} from "../budget/nodeLedger";

export function exportJson(state: AppState): string {
  return JSON.stringify(state, null, 2);
}

export function importJson(raw: string): AppState {
  const parsed = JSON.parse(raw);
  return migrate(parsed);
}

export function migrate(input: unknown, now: Date = new Date()): AppState {
  if (!input || typeof input !== "object") {
    throw new Error("Not a FinanceFlow document.");
  }
  const obj = input as { version?: number };
  if (obj.version === 3) {
    // A `version: 3` tag alone proves nothing about the payload behind it —
    // see F10 in the wave-1 review: casting here unvalidated let a bare
    // `{"version":3}` boot with an active (and immediately overwriting)
    // persistence subscription, and a doc missing `budget.assignments`
    // white-screened with no recovery route. Validate structurally and
    // throw so loadInitial()'s catch routes to RecoveryScreen instead.
    const err = invalidV3Reason(obj);
    if (err) throw new Error(`Stored document isn't a valid FinanceFlow document: ${err}`);
    return obj as AppState;
  }
  if (obj.version === 2) return migrateV2(obj as unknown as V2State, now);
  if (obj.version === 1) return migrateV2(migrateV1(obj as unknown as V1State, now), now);
  // Never silently reset: a document from a newer (or unknown) version must
  // surface as an error the caller can show, not vanish into a fresh state.
  throw new Error(`Unsupported FinanceFlow version: ${String(obj.version)}.`);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Structural check for a `{version: 3}` document, run before it's cast to
 * `AppState`. Returns a human-readable reason it's invalid, or `null` when
 * it's shaped correctly enough to trust. Intentionally shallow (container
 * types, not every field of every row) — deep enough to catch the failure
 * modes a hand-edited or truncated document actually produces.
 */
function invalidV3Reason(obj: Record<string, unknown>): string | null {
  if (!isPlainObject(obj.settings)) return "missing settings.";
  if (!isPlainObject(obj.decisions)) return "missing decisions.";
  if (!isPlainObject(obj.nodes)) return "missing nodes.";
  const budget = obj.budget;
  if (!isPlainObject(budget)) return "missing its budget.";
  if (!Array.isArray(budget.accounts)) return "budget is missing accounts.";
  if (!Array.isArray(budget.transactions)) return "budget is missing transactions.";
  if (!Array.isArray(budget.groups)) return "budget is missing groups.";
  if (!Array.isArray(budget.categories)) return "budget is missing categories.";
  if (!isPlainObject(budget.assignments)) return "budget is missing assignments.";
  return null;
}

// ---------------------------------------------------------------------------
// Legacy payload shapes (v1/v2 documents) — decode/migration-only. The live
// schema no longer carries these; see `NodeDataMap` in schema.ts.

type V2RecurringItem = { id: string; name: string; target: SourcedNumber; funded?: SourcedNumber };
type V2RecurringData = { target: SourcedNumber; funded?: SourcedNumber; items?: V2RecurringItem[] };
type V2EFBucket = { id: string; name: string; target: number; balance: SourcedNumber };
type V2SmallEF = { balance: SourcedNumber; items?: V2EFBucket[] };
type V2BigEF = { targetMonths: number; balance?: SourcedNumber; items?: V2EFBucket[] };
type V2PurchaseGoal = { id: string; name: string; target: number; saved: SourcedNumber; byDate?: string };
type V2SavePurchase = {
  goalName: string;
  target: number;
  saved: SourcedNumber;
  byDate?: string;
  items?: V2PurchaseGoal[];
};
type V2Goal = { id: string; name: string; target: number; saved: number; horizonYears: number };
type V2Goals = { items?: V2Goal[] };
type V2Debts = { debts?: V2Debt[] };
type V2Debt = { id: string; name: string; balance: number; apr: number; minPayment: number; paid: boolean };
type V2College = { monthlyContribution: number; balance?: SourcedNumber; targetAge?: number };

type LegacyNodeState = Omit<NodeState, "data"> & { data?: unknown };

/**
 * Which EF payload node supersedes the other. SmallEF grows into BigEF — one
 * real-world fund — so when BigEF holds any data it is the superset and
 * SmallEF is not seeded a second time. This is a DOMAIN rule, not a v1 rule:
 * it has to hold wherever payload-to-ledger seeding happens, or a v2 document
 * carrying items on both nodes gets both funds' buckets and two starting
 * inflows for one fund's worth of cash.
 */
function efPayloadNode(big: V2BigEF | undefined, small: V2SmallEF | undefined): NodeId | null {
  if (big && ((big.balance?.value ?? 0) > 0 || (big.items?.length ?? 0) > 0)) return "BigEF";
  if (small) return "SmallEF";
  return null;
}

type V1State = {
  version: 1;
  settings: Settings;
  decisions: Decisions;
  nodes: Record<NodeId, LegacyNodeState>;
  shownCelebrations?: NodeId[];
  earnedMedals?: number[];
};

type V2State = Omit<V1State, "version"> & { version: 2; budget?: BudgetBook };

const RECURRING_NODES = [
  "Rent",
  "Food",
  "Essential",
  "Income",
  "Health",
  "MinDebt",
  "NonEssential",
] as const;

// ---------------------------------------------------------------------------
// v1 -> v2: seed the budget book from the node payloads (payloads preserved;
// v2 -> v3 strips them). Deterministic ids — both platforms migrate one
// document identically.
//
// Seeding rule: each funded/saved amount becomes that category's assignment
// in the migration month, and one starting-balance inflow on a seeded Cash
// account covers the total — so every envelope's available matches its v1
// bar exactly and Ready-to-Assign lands at exactly zero.

function migrateV1(v1: V1State, now: Date): V2State {
  const book = emptyBudgetBook();
  const month = ymKey(now);
  const today = isoDay(now);
  const seeded: Record<string, number> = {};

  const addCategory = (cat: Omit<Category, "order">, seed: number) => {
    book.categories.push({ ...cat, order: book.categories.length });
    if (seed > 0) seeded[cat.id] = seed;
  };

  // Bills: the recurring nodes' items (or single target/funded pair).
  book.groups.push({ id: GROUP_BILLS, name: "Bills", order: 0 });
  for (const nodeId of RECURRING_NODES) {
    const data = v1.nodes[nodeId]?.data as V2RecurringData | undefined;
    if (!data) continue;
    if (data.items?.length) {
      for (const item of data.items) {
        addCategory(
          {
            id: `${nodeId}:${item.id}`,
            groupId: GROUP_BILLS,
            name: item.name,
            monthlyTarget: item.target.value,
            nodeId,
          },
          item.funded?.value ?? 0,
        );
      }
    } else if (data.target.value > 0 || (data.funded?.value ?? 0) > 0) {
      addCategory(
        {
          id: nodeId,
          groupId: GROUP_BILLS,
          name: nodeId,
          monthlyTarget: data.target.value,
          nodeId,
        },
        data.funded?.value ?? 0,
      );
    }
  }

  // Emergency fund. SmallEF grows into BigEF, so when BigEF holds any data it
  // is treated as the superset and SmallEF is not seeded a second time.
  book.groups.push({ id: GROUP_EF, name: "Emergency Fund", order: 1 });
  const big = v1.nodes.BigEF?.data as V2BigEF | undefined;
  const small = v1.nodes.SmallEF?.data as V2SmallEF | undefined;
  const efNode = efPayloadNode(big, small);
  if (efNode) {
    const data = (efNode === "BigEF" ? big : small) as V2BigEF & V2SmallEF;
    if (data.items?.length) {
      for (const bucket of data.items) {
        addCategory(
          {
            id: `${efNode}:${bucket.id}`,
            groupId: GROUP_EF,
            name: bucket.name,
            balanceTarget: bucket.target,
            nodeId: efNode,
          },
          bucket.balance.value,
        );
      }
    } else if ((data.balance?.value ?? 0) > 0) {
      const target =
        efNode === "BigEF"
          ? bigEmergencyFundTarget(big!.targetMonths, v1.settings.monthlyExpenses)
          : emergencyFundTarget(v1.settings.monthlyExpenses);
      addCategory(
        {
          id: efNode,
          groupId: GROUP_EF,
          name: "Emergency Fund",
          balanceTarget: target > 0 ? target : undefined,
          nodeId: efNode,
        },
        data.balance!.value,
      );
    }
  }

  // Savings goals: SavePurchase goals plus the long-term Goals list.
  book.groups.push({ id: GROUP_GOALS, name: "Savings Goals", order: 2 });
  const purchase = v1.nodes.SavePurchase?.data as V2SavePurchase | undefined;
  if (purchase?.items?.length) {
    for (const goal of purchase.items) {
      addCategory(
        {
          id: `SavePurchase:${goal.id}`,
          groupId: GROUP_GOALS,
          name: goal.name,
          balanceTarget: goal.target,
          targetDate: goal.byDate,
          nodeId: "SavePurchase",
        },
        goal.saved.value,
      );
    }
  } else if (purchase && (purchase.target > 0 || purchase.saved.value > 0)) {
    addCategory(
      {
        id: "SavePurchase",
        groupId: GROUP_GOALS,
        name: purchase.goalName || "SavePurchase",
        balanceTarget: purchase.target,
        targetDate: purchase.byDate,
        nodeId: "SavePurchase",
      },
      purchase.saved.value,
    );
  }
  const goals = (v1.nodes.Goals?.data as V2Goals | undefined)?.items ?? [];
  for (const goal of goals) {
    addCategory(
      {
        id: `Goals:${goal.id}`,
        groupId: GROUP_GOALS,
        name: goal.name,
        balanceTarget: goal.target,
        nodeId: "Goals",
      },
      goal.saved,
    );
  }

  // Debts become off-budget loan accounts (balance, APR, minimum payment).
  for (const nodeId of ["HighDebt", "ModDebt"] as const) {
    const debts = (v1.nodes[nodeId]?.data as V2Debts | undefined)?.debts ?? [];
    for (const debt of debts) {
      const account: Account = {
        id: `debt:${debt.id}`,
        name: debt.name,
        kind: "loan",
        apr: debt.apr,
        minPayment: debt.minPayment,
        source: "manual",
        nodeId,
      };
      book.accounts.push(account);
      if (debt.balance !== 0) {
        book.transactions.push(startingTxn(account.id, today, -debt.balance));
      }
    }
  }

  // The 529 balance becomes a tracking account.
  const college = v1.nodes.College?.data as V2College | undefined;
  if (college && (college.balance?.value ?? 0) > 0) {
    book.accounts.push({
      id: COLLEGE_ACCOUNT_ID,
      name: "529 Plan",
      kind: "tracking",
      source: "manual",
      nodeId: "College",
    });
    book.transactions.push(startingTxn(COLLEGE_ACCOUNT_ID, today, college.balance!.value));
  }

  // Cash account + one RTA inflow covering everything seeded, so the books
  // open balanced: every available equals its v1 bar and RTA is exactly 0.
  book.accounts.push({ id: "acct:cash", name: "Cash", kind: "cash", source: "manual" });
  let totalC = 0;
  for (const v of Object.values(seeded)) totalC += toCents(v);
  if (totalC > 0) {
    book.transactions.push({
      ...startingTxn("acct:cash", today, fromCents(totalC)),
      categoryId: RTA_CATEGORY_ID,
    });
  }
  if (Object.keys(seeded).length > 0) {
    book.assignments = { [month]: seeded };
  }

  return { ...v1, version: 2, budget: book };
}

// ---------------------------------------------------------------------------
// v2 -> v3: reconcile, then strip.
//
// Both UIs were live during v2, so payloads and ledger may have diverged.
// The ledger wins wherever both describe the same thing (it has the
// transaction history); payload items with no linked ledger entity are
// created with the same deterministic ids the v1 migration used, their
// funded/saved amounts seeded as this month's assignments and covered by one
// RTA inflow so Ready-to-Assign is unchanged. The single payload-wins case:
// a debt explicitly marked paid gets a zeroing adjustment, because that user
// action had no ledger representation. Then every ledger-owned payload field
// is stripped; nodes keep only what the ledger doesn't model.

function migrateV2(v2: V2State, now: Date): AppState {
  const book: BudgetBook = JSON.parse(JSON.stringify(v2.budget ?? emptyBudgetBook()));
  const month = ymKey(now);
  const today = isoDay(now);
  const seeded: Record<string, number> = {};

  const catExists = (id: string) => book.categories.some((c) => c.id === id);
  const accountById = (id: string) => book.accounts.find((a) => a.id === id);
  const ensureGrp = (groupId: string) => {
    const group = ensureGroup(book, groupId);
    if (group) book.groups.push(group);
  };
  const addCat = (cat: Omit<Category, "order">, seed: number) => {
    ensureGrp(cat.groupId);
    book.categories.push({ ...cat, order: book.categories.length });
    if (seed > 0) seeded[cat.id] = seed;
  };

  // 1. Recurring: create missing payload items; ledger wins where ids match.
  for (const nodeId of RECURRING_NODES) {
    const data = v2.nodes[nodeId]?.data as V2RecurringData | undefined;
    if (!data) continue;
    if (data.items?.length) {
      for (const item of data.items) {
        const id = `${nodeId}:${item.id}`;
        if (catExists(id)) continue;
        addCat(
          { id, groupId: GROUP_BILLS, name: item.name, monthlyTarget: item.target.value, nodeId },
          item.funded?.value ?? 0,
        );
      }
    } else if (data.target.value > 0 || (data.funded?.value ?? 0) > 0) {
      if (!catExists(nodeId)) {
        addCat(
          { id: nodeId, groupId: GROUP_BILLS, name: nodeId, monthlyTarget: data.target.value, nodeId },
          data.funded?.value ?? 0,
        );
      }
    }
  }

  // 2. Emergency fund. Supersession is the same domain rule the v1 migration
  // applies (`efPayloadNode`): only the superseding node's payload seeds
  // anything, so a document with items on BOTH nodes doesn't get both funds'
  // buckets. `unionExists` gates exactly one thing — never create the SCALAR
  // MIRROR when the fund is already bucketed in the ledger. Bucket creation is
  // gated by supersession plus `catExists`.
  const big = v2.nodes.BigEF?.data as V2BigEF | undefined;
  const small = v2.nodes.SmallEF?.data as V2SmallEF | undefined;
  const unionExists = book.categories.some(
    (c) => c.nodeId === "SmallEF" || c.nodeId === "BigEF",
  );
  const efNode = efPayloadNode(big, small);
  if (efNode) {
    const data = (efNode === "BigEF" ? big : small) as V2BigEF & V2SmallEF;
    if (data.items?.length) {
      for (const bucket of data.items) {
        const id = `${efNode}:${bucket.id}`;
        if (catExists(id)) continue;
        addCat(
          {
            id,
            groupId: GROUP_EF,
            name: bucket.name,
            balanceTarget: bucket.target,
            nodeId: efNode,
          },
          bucket.balance.value,
        );
      }
    } else if (!unionExists && (data.balance?.value ?? 0) > 0) {
      const target =
        efNode === "BigEF"
          ? bigEmergencyFundTarget(big!.targetMonths, v2.settings.monthlyExpenses)
          : emergencyFundTarget(v2.settings.monthlyExpenses);
      addCat(
        {
          id: efNode,
          groupId: GROUP_EF,
          name: "Emergency Fund",
          balanceTarget: target > 0 ? target : undefined,
          nodeId: efNode,
        },
        data.balance!.value,
      );
    }
  }

  // 3. SavePurchase / Goals. Goals' horizonYears becomes a target date.
  const purchase = v2.nodes.SavePurchase?.data as V2SavePurchase | undefined;
  if (purchase?.items?.length) {
    for (const goal of purchase.items) {
      const id = `SavePurchase:${goal.id}`;
      if (catExists(id)) continue;
      addCat(
        {
          id,
          groupId: GROUP_GOALS,
          name: goal.name,
          balanceTarget: goal.target,
          targetDate: goal.byDate,
          nodeId: "SavePurchase",
        },
        goal.saved.value,
      );
    }
  } else if (purchase && (purchase.target > 0 || purchase.saved.value > 0)) {
    if (!catExists("SavePurchase")) {
      addCat(
        {
          id: "SavePurchase",
          groupId: GROUP_GOALS,
          name: purchase.goalName || "SavePurchase",
          balanceTarget: purchase.target,
          targetDate: purchase.byDate,
          nodeId: "SavePurchase",
        },
        purchase.saved.value,
      );
    }
  }
  for (const goal of (v2.nodes.Goals?.data as V2Goals | undefined)?.items ?? []) {
    const id = `Goals:${goal.id}`;
    const existing = book.categories.find((c) => c.id === id);
    if (existing) {
      if (!existing.targetDate) existing.targetDate = horizonDate(now, goal.horizonYears);
      continue;
    }
    addCat(
      {
        id,
        groupId: GROUP_GOALS,
        name: goal.name,
        balanceTarget: goal.target,
        targetDate: horizonDate(now, goal.horizonYears),
        nodeId: "Goals",
      },
      goal.saved,
    );
  }

  // 4. Debts: backfill nodeId on matched accounts; create missing ones; honor
  // an explicit paid flag the ledger couldn't represent.
  for (const nodeId of ["HighDebt", "ModDebt"] as const) {
    const debts = (v2.nodes[nodeId]?.data as V2Debts | undefined)?.debts ?? [];
    for (const debt of debts) {
      const id = `debt:${debt.id}`;
      const existing = accountById(id);
      if (existing) {
        if (!existing.nodeId) existing.nodeId = nodeId;
        const balanceC = toCents(accountBalance(book, id));
        if (debt.paid && balanceC < 0) {
          book.transactions.push({
            id: `txn:adjust:v3:debt:${debt.id}`,
            accountId: id,
            date: today,
            payee: "Balance adjustment",
            memo: "Marked paid",
            amount: fromCents(-balanceC),
            source: "manual",
          });
        }
      } else {
        book.accounts.push({
          id,
          name: debt.name,
          kind: "loan",
          apr: debt.apr,
          minPayment: debt.minPayment,
          source: "manual",
          nodeId,
        });
        if (debt.balance !== 0) {
          book.transactions.push(startingTxn(id, today, -debt.balance));
        }
      }
    }
  }

  // 5. College: ensure/backfill the tracking account.
  const college = v2.nodes.College?.data as V2College | undefined;
  if (college) {
    const existing = accountById(COLLEGE_ACCOUNT_ID);
    if (existing) {
      if (!existing.nodeId) existing.nodeId = "College";
    } else if ((college.balance?.value ?? 0) > 0) {
      book.accounts.push({
        id: COLLEGE_ACCOUNT_ID,
        name: "529 Plan",
        kind: "tracking",
        source: "manual",
        nodeId: "College",
      });
      book.transactions.push(startingTxn(COLLEGE_ACCOUNT_ID, today, college.balance!.value));
    }
  }

  // 6. Seed cover: created categories' amounts become this month's
  // assignments, balanced by one RTA inflow — migration never moves RTA.
  let totalC = 0;
  for (const v of Object.values(seeded)) totalC += toCents(v);
  if (Object.keys(seeded).length > 0) {
    book.assignments[month] = { ...(book.assignments[month] ?? {}), ...seeded };
  }
  if (totalC > 0) {
    if (!accountById("acct:cash")) {
      book.accounts.push({ id: "acct:cash", name: "Cash", kind: "cash", source: "manual" });
    }
    book.transactions.push({
      id: "txn:start:v3",
      accountId: "acct:cash",
      date: today,
      payee: "Starting balance",
      amount: fromCents(totalC),
      categoryId: RTA_CATEGORY_ID,
      source: "manual",
    });
  }

  // Phase 2 — strip: nodes keep only what the ledger doesn't model.
  const nodes = {} as Record<NodeId, NodeState>;
  for (const [id, legacy] of Object.entries(v2.nodes) as [NodeId, LegacyNodeState][]) {
    const { data, ...rest } = legacy;
    const node: NodeState = { ...rest };
    if (data !== undefined) {
      if (id === "BigEF") {
        const months = (data as V2BigEF).targetMonths;
        node.data = {
          targetMonths: (months === 4 || months === 5 || months === 6 ? months : 3),
        } satisfies NodeDataMap["BigEF"];
      } else if (id === "College") {
        const c = data as V2College;
        node.data = {
          monthlyContribution: c.monthlyContribution ?? 0,
          ...(c.targetAge !== undefined ? { targetAge: c.targetAge } : {}),
        } satisfies NodeDataMap["College"];
      } else if (id === "Match" || id === "IRA" || id === "HSA" || id === "Increase401k") {
        node.data = data as NodeState["data"];
      }
      // Everything else (recurring, EFs, SavePurchase, Goals, debts) is
      // ledger-owned now — the payload is dropped.
    }
    nodes[id] = node;
  }

  return {
    version: 3,
    settings: v2.settings,
    decisions: v2.decisions,
    nodes,
    budget: book,
    shownCelebrations: v2.shownCelebrations ?? [],
    earnedMedals: v2.earnedMedals ?? [],
  };
}

/** `now` shifted by a (possibly fractional) number of years, as a local day. */
function horizonDate(now: Date, years: number): string {
  const d = new Date(now);
  d.setMonth(d.getMonth() + Math.round(years * 12));
  return isoDay(d);
}

function startingTxn(accountId: string, date: string, amount: number): Txn {
  return {
    id: `txn:start:${accountId}`,
    accountId,
    date,
    payee: "Starting balance",
    amount,
    source: "manual",
  };
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
