import type {
  Account,
  AppState,
  Category,
  NodeDataMap,
  NodeId,
  Txn,
} from "./schema";
import {
  RTA_CATEGORY_ID,
  bigEmergencyFundTarget,
  emergencyFundTarget,
  emptyBudgetBook,
} from "./schema";
import { ymKey } from "./recurring";
import { fromCents, isoDay, toCents } from "../budget/ledger";

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
  const obj = input as Partial<AppState> & { version?: number };
  if (obj.version === 2) return obj as AppState;
  if (obj.version === 1) return migrateV1(obj as unknown as V1State, now);
  // Never silently reset: a document from a newer (or unknown) version must
  // surface as an error the caller can show, not vanish into a fresh state.
  throw new Error(`Unsupported FinanceFlow version: ${String(obj.version)}.`);
}

// ---------------------------------------------------------------------------
// v1 -> v2: seed the budget book from the node payloads.
//
// The v1 payloads stay untouched (the UI still reads them until it switches
// to the ledger), so this is purely additive bootstrap data. Every generated
// id derives from a stable v1 id, making the migration deterministic — the
// web and iOS apps migrate the same document to the same book.
//
// Seeding rule: each funded/saved amount becomes that category's assignment
// in the migration month, and one starting-balance inflow on a seeded Cash
// account covers the total — so every envelope's available matches its v1
// bar exactly and Ready-to-Assign lands at exactly zero.

type V1State = Omit<AppState, "version" | "budget"> & { version: 1 };

const RECURRING_NODES = [
  "Rent",
  "Food",
  "Essential",
  "Income",
  "Health",
  "MinDebt",
  "NonEssential",
] as const;

function migrateV1(v1: V1State, now: Date): AppState {
  const book = emptyBudgetBook();
  const month = ymKey(now);
  const today = isoDay(now);
  const seeded: Record<string, number> = {};

  const addCategory = (cat: Omit<Category, "order">, seed: number) => {
    book.categories.push({ ...cat, order: book.categories.length });
    if (seed > 0) seeded[cat.id] = seed;
  };

  // Bills: the recurring nodes' items (or single target/funded pair).
  book.groups.push({ id: "g:bills", name: "Bills", order: 0 });
  for (const nodeId of RECURRING_NODES) {
    const data = v1.nodes[nodeId]?.data as NodeDataMap[(typeof RECURRING_NODES)[number]] | undefined;
    if (!data) continue;
    if (data.items?.length) {
      for (const item of data.items) {
        addCategory(
          {
            id: `${nodeId}:${item.id}`,
            groupId: "g:bills",
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
          groupId: "g:bills",
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
  book.groups.push({ id: "g:ef", name: "Emergency Fund", order: 1 });
  const big = v1.nodes.BigEF?.data as NodeDataMap["BigEF"] | undefined;
  const small = v1.nodes.SmallEF?.data as NodeDataMap["SmallEF"] | undefined;
  const efNode: NodeId | null =
    big && (big.balance.value > 0 || (big.items?.length ?? 0) > 0)
      ? "BigEF"
      : small
        ? "SmallEF"
        : null;
  if (efNode) {
    const data = (efNode === "BigEF" ? big : small)!;
    if (data.items?.length) {
      for (const bucket of data.items) {
        addCategory(
          {
            id: `${efNode}:${bucket.id}`,
            groupId: "g:ef",
            name: bucket.name,
            balanceTarget: bucket.target,
            nodeId: efNode,
          },
          bucket.balance.value,
        );
      }
    } else if (data.balance.value > 0) {
      const target =
        efNode === "BigEF"
          ? bigEmergencyFundTarget(
              (data as NodeDataMap["BigEF"]).targetMonths,
              v1.settings.monthlyExpenses,
            )
          : emergencyFundTarget(v1.settings.monthlyExpenses);
      addCategory(
        {
          id: efNode,
          groupId: "g:ef",
          name: "Emergency Fund",
          balanceTarget: target > 0 ? target : undefined,
          nodeId: efNode,
        },
        data.balance.value,
      );
    }
  }

  // Savings goals: SavePurchase goals plus the long-term Goals list.
  book.groups.push({ id: "g:goals", name: "Savings Goals", order: 2 });
  const purchase = v1.nodes.SavePurchase?.data as NodeDataMap["SavePurchase"] | undefined;
  if (purchase?.items?.length) {
    for (const goal of purchase.items) {
      addCategory(
        {
          id: `SavePurchase:${goal.id}`,
          groupId: "g:goals",
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
        groupId: "g:goals",
        name: purchase.goalName || "SavePurchase",
        balanceTarget: purchase.target,
        targetDate: purchase.byDate,
        nodeId: "SavePurchase",
      },
      purchase.saved.value,
    );
  }
  const goals = v1.nodes.Goals?.data as NodeDataMap["Goals"] | undefined;
  for (const goal of goals?.items ?? []) {
    addCategory(
      {
        id: `Goals:${goal.id}`,
        groupId: "g:goals",
        name: goal.name,
        balanceTarget: goal.target,
        nodeId: "Goals",
      },
      goal.saved,
    );
  }

  // Debts become off-budget loan accounts (balance, APR, minimum payment).
  for (const nodeId of ["HighDebt", "ModDebt"] as const) {
    const data = v1.nodes[nodeId]?.data as NodeDataMap["HighDebt"] | undefined;
    for (const debt of data?.debts ?? []) {
      const account: Account = {
        id: `debt:${debt.id}`,
        name: debt.name,
        kind: "loan",
        apr: debt.apr,
        minPayment: debt.minPayment,
        source: "manual",
      };
      book.accounts.push(account);
      if (debt.balance !== 0) {
        book.transactions.push(startingTxn(account.id, today, -debt.balance));
      }
    }
  }

  // The 529 balance becomes a tracking account.
  const college = v1.nodes.College?.data as NodeDataMap["College"] | undefined;
  if (college && college.balance.value > 0) {
    book.accounts.push({
      id: "acct:college",
      name: "529 Plan",
      kind: "tracking",
      source: "manual",
    });
    book.transactions.push(startingTxn("acct:college", today, college.balance.value));
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

  const { version: _v, ...rest } = v1;
  return { ...rest, version: 2, budget: book };
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
