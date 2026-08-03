import type { Account, BudgetBook, Category, CategoryGroup, Txn } from "../../state/schema";
import { RTA_CATEGORY_ID } from "../../state/schema";

/**
 * Seeded PRNG using mulberry32 algorithm for deterministic random generation.
 */
function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generate a deterministic "big book" for benchmarking.
 * Same input always produces identical output.
 */
export function makeBigBook(txnCount: number): BudgetBook {
  // Seed based on txnCount for determinism
  const rng = mulberry32(12345 + txnCount);

  // Helper to generate random integer in range [min, max]
  const randInt = (min: number, max: number): number => {
    return Math.floor(rng() * (max - min + 1)) + min;
  };

  // Helper to format number to 2 decimals
  const toDecimal = (n: number): number => {
    return Math.round(n * 100) / 100;
  };

  // Create 8 accounts
  const accountKinds: Array<"checking" | "savings" | "cash" | "credit" | "loan" | "tracking"> = [
    "checking",
    "savings",
    "cash",
    "credit",
    "loan",
    "tracking",
    "checking",
    "savings",
  ];

  const accounts: Account[] = [];
  for (let i = 0; i < 8; i++) {
    accounts.push({
      id: `acct-${i}`,
      name: `Account ${i}`,
      kind: accountKinds[i],
      source: "manual",
    });
  }

  // Create 4 category groups
  const groups: CategoryGroup[] = [];
  for (let i = 0; i < 4; i++) {
    groups.push({
      id: `grp-${i}`,
      name: `Group ${i}`,
      order: i,
    });
  }

  // Create 40 categories (every third gets monthlyTarget)
  const categories: Category[] = [];
  for (let i = 0; i < 40; i++) {
    categories.push({
      id: `cat-${i}`,
      groupId: `grp-${i % 4}`,
      name: `Category ${i}`,
      order: i,
      ...(i % 3 === 0 && { monthlyTarget: 100 + i }),
    });
  }

  // Create transactions spread across 24 months (2024-01 to 2025-12)
  const transactions: Txn[] = [];
  const monthStart = new Date(2024, 0, 1); // 2024-01-01
  const monthRange = 24; // 24 months

  for (let i = 0; i < txnCount; i++) {
    // Spread evenly across 24 months
    const monthOffset = Math.floor((i / txnCount) * monthRange);
    const yearOffset = Math.floor((monthStart.getFullYear() - 2024) + Math.floor(monthOffset / 12));
    const monthNum = (monthStart.getMonth() + monthOffset) % 12;

    // Day of month in range 01..28
    const day = (i % 28) + 1;
    const dayStr = String(day).padStart(2, "0");

    const date = new Date(2024 + yearOffset, monthNum, day);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const dateStr = `${year}-${month}-${dayStr}`;

    // Amount: -500 to +500, rounded to 2 decimals
    const amount = toDecimal((rng() - 0.5) * 1000);

    // Category assignment: every 10th gets RTA_CATEGORY_ID with positive amount
    // Of the remainder: 80% get cat-${i % 40}, 20% get no category
    let categoryId: string | undefined;
    let finalAmount = amount;

    if (i % 10 === 0) {
      categoryId = RTA_CATEGORY_ID;
      // Ensure RTA transactions are positive
      finalAmount = Math.abs(amount);
    } else {
      const rand = rng();
      if (rand < 0.8) {
        categoryId = `cat-${i % 40}`;
      }
      // 20% have no category
    }

    transactions.push({
      id: `txn-${i}`,
      accountId: `acct-${i % 8}`,
      date: dateStr,
      amount: finalAmount,
      ...(categoryId && { categoryId }),
      source: "manual",
    });
  }

  // Create assignments: for each of 24 months, assign positive amounts to 20 categories
  const assignments: Record<string, Record<string, number>> = {};
  for (let monthIdx = 0; monthIdx < 24; monthIdx++) {
    const yearOffset = Math.floor(monthIdx / 12);
    const monthNum = monthIdx % 12;
    const year = 2024 + yearOffset;
    const month = String(monthNum + 1).padStart(2, "0");
    const monthKey = `${year}-${month}`;

    const monthAssignments: Record<string, number> = {};

    // Pick 20 categories and assign random amounts (50-500)
    const categoryIndices = new Set<number>();
    while (categoryIndices.size < 20) {
      categoryIndices.add(randInt(0, 39));
    }

    for (const catIdx of categoryIndices) {
      const amount = toDecimal(randInt(50, 500));
      monthAssignments[`cat-${catIdx}`] = amount;
    }

    assignments[monthKey] = monthAssignments;
  }

  return {
    accounts,
    transactions,
    groups,
    categories,
    assignments,
  };
}
