import type { BudgetBook, Cents, Txn } from "../state/schema";
import {
  SYSTEM_GROUP_ID,
  SYSTEM_ORDER,
  UNCATEGORIZED_CATEGORY_ID,
  centsFromDollars,
} from "../state/schema";
import type { BookOps } from "./nodeLedger";

/**
 * Plaid snapshot import: parse, map, dedupe — as a pure planner.
 *
 * The source is the nightly JSON snapshot the local `plaid-mcp` server writes
 * to Google Drive (`~/projects/plaid-mcp`, `get_accounts` + `get_transactions`).
 * Nothing here fetches anything: this takes the already-read document and the
 * current book and returns `BookOps` plus an honest account of what it refused
 * to do. Mirrors `Domain/PlaidImport.swift`; `PlaidImportTests` on both sides
 * pin the two engines to the same ops for the same committed fixture.
 *
 * Three properties this file exists to guarantee:
 *
 * 1. **Sign.** Plaid's convention is INVERTED relative to this app: a positive
 *    `amount` is money OUT. Every amount is negated on the way in, so a Plaid
 *    +4.50 coffee lands as a -4.50 transaction.
 * 2. **Idempotence.** Re-importing the same file — on either platform, any
 *    number of times — adds nothing. That rests on `plaidTxnId` being a
 *    function of the row alone, computed identically on both platforms.
 * 3. **No guessing.** A row whose account isn't linked is reported, never
 *    attached to some other account; and nothing is auto-categorized from
 *    Plaid's taxonomy. Envelope names are personal, and a confidently wrong
 *    envelope is worse than a blank one because it silently misstates a
 *    balance the user is making decisions against. Everything lands in
 *    `cat:uncategorized` for the user to sort.
 */

// ---------------------------------------------------------------------------
// The snapshot document
//
// Every field is optional and nullable because this is JSON that arrived from
// another process: Plaid itself returns `merchant_name: null` routinely, and
// the emitter passes `t.get(...)` straight through. A missing field must
// degrade to a defined default, never throw — a single odd row cannot be
// allowed to cost the user the whole night's import.

export type PlaidSnapshotTxn = {
  /** Plaid's own stable id, when the emitter carries it. See `plaidTxnIdFor`. */
  transaction_id?: string | null;
  account_id?: string | null;
  /** "YYYY-MM-DD". */
  date?: string | null;
  name?: string | null;
  merchant_name?: string | null;
  /** Dollars, Plaid sign convention: POSITIVE = money OUT. */
  amount?: number | null;
  /** Plaid's personal-finance-category primary. Deliberately unused — see above. */
  category?: string | null;
  pending?: boolean | null;
};

export type PlaidSnapshotAccount = {
  account_id?: string | null;
  name?: string | null;
  /** Dollars. For credit accounts this is the amount OWED (a positive number). */
  current_balance?: number | null;
  available_balance?: number | null;
};

export type PlaidSnapshot = {
  accounts?: PlaidSnapshotAccount[] | null;
  transactions?: PlaidSnapshotTxn[] | null;
};

export type PlaidImportSkipped = {
  /** Rows already in the book under the same `plaidTxnId` (or repeated in this file). */
  duplicates: number;
  /** Rows Plaid had not posted yet. */
  pending: number;
  /** Plaid `account_id`s with no local account, in first-appearance order. */
  unmappedAccounts: string[];
};

export type PlaidImportPlan = {
  ops: BookOps;
  skipped: PlaidImportSkipped;
};

/** Prefix of the local `Txn.id` derived from a `plaidTxnId`. */
export const PLAID_TXN_ID_PREFIX = "txn:plaid:";

/**
 * The local transaction id for an imported row — a pure function of
 * `plaidTxnId`, so both platforms produce the same id for the same row and a
 * book that round-trips through export/import stays byte-stable.
 */
export function plaidLocalTxnId(plaidTxnId: string): string {
  return `${PLAID_TXN_ID_PREFIX}${plaidTxnId}`;
}

/**
 * The natural key of a row: everything about it that a nightly re-export
 * cannot change. Deliberately excludes `merchant_name` (Plaid enriches it over
 * time, and a row that gained a merchant name overnight is the same row) and
 * `pending`/`category` (both change as a transaction settles).
 *
 * Spelled as one string with `|` separators so the Swift mirror is literally
 * the same expression. Both platforms interpolate the same integer cents and
 * the same raw `name`, so both produce the same bytes.
 */
function naturalKey(plaidAccountId: string, date: string, amount: Cents, name: string): string {
  return `${plaidAccountId}|${date}|${amount}|${name}`;
}

/**
 * The row's dedupe identity.
 *
 * Plaid's real `transaction_id` is authoritative and is used whenever the
 * snapshot carries it. The nightly emitter currently does not
 * (`server.py` emits `{date, name, merchant_name, amount, category,
 * account_id, pending}`), so absent one we synthesize a key from the fields
 * that identify the transaction, plus `ordinal` — its position among rows in
 * THIS file sharing that natural key, which is what separates two genuinely
 * distinct $4.50 coffees bought from the same shop on the same day.
 *
 * The ordinal is counted over every non-pending row in file order regardless
 * of whether it maps or dedupes, so linking an account later, or a pending row
 * posting overnight, does not renumber rows that were already imported.
 *
 * Caveat, stated out loud: if the emitter starts including `transaction_id`,
 * rows imported under a synthetic key will import once more under the real
 * one. That is a one-time, visible duplication on a shape change, and it is
 * the right trade against permanently ignoring the stabler id.
 */
function plaidTxnIdFor(row: PlaidSnapshotTxn, natural: string, ordinal: number): string {
  const given = row.transaction_id;
  if (typeof given === "string" && given.length > 0) return given;
  return `syn:${natural}#${ordinal}`;
}

/**
 * Plan the import of `snapshot` into `book`.
 *
 * Rows are classified in a fixed order — pending, then unmapped, then
 * duplicate — and the order is observable, so it is part of the contract the
 * Swift mirror implements. Pending comes first because an unposted row is not
 * a transaction yet whatever account it belongs to; it will be classified
 * again, properly, once it settles.
 *
 * The plan is empty when nothing is importable: no ops at all, not ops that
 * happen to be no-ops. That is what makes a second run of the same file a
 * genuine no-op rather than a write that merely lands on the same values.
 */
export function planPlaidImport(book: BudgetBook, snapshot: PlaidSnapshot): PlaidImportPlan {
  const rows = snapshot.transactions ?? [];

  // Plaid account id -> local account id. First mapping wins, so a book that
  // somehow linked one Plaid account twice resolves deterministically.
  const localAccountId = new Map<string, string>();
  for (const a of book.accounts) {
    if (a.plaidAccountId && !localAccountId.has(a.plaidAccountId)) {
      localAccountId.set(a.plaidAccountId, a.id);
    }
  }

  // Seeded from the book, then extended as rows are accepted, so a file that
  // repeats a row cannot emit two transactions carrying the same id.
  const claimed = new Set<string>();
  for (const t of book.transactions) {
    if (t.plaidTxnId) claimed.add(t.plaidTxnId);
  }

  const ordinals = new Map<string, number>();
  const addTxns: Txn[] = [];
  const unmappedAccounts: string[] = [];
  const unmappedSeen = new Set<string>();
  let duplicates = 0;
  let pending = 0;

  for (const row of rows) {
    if (row.pending === true) {
      pending += 1;
      continue;
    }

    const plaidAccountId = row.account_id ?? "";
    // `Txn.date` is "YYYY-MM-DD" by convention; take the day prefix so an
    // emitter that ever writes a full timestamp still buckets into the right
    // month instead of quietly landing a row the ledger sorts differently.
    const date = (row.date ?? "").slice(0, 10);
    const name = row.name ?? "";
    // Negate in DOLLARS, then apply the one rounding rule (money-migration-v4
    // §4) once, to the value that actually lands in the ledger. Rounding first
    // and negating after would apply the half-toward-+infinity rule to the
    // Plaid-signed number instead of the stored one, and the two differ on a
    // half-cent amount.
    const amount = centsFromDollars(-(row.amount ?? 0));

    const natural = naturalKey(plaidAccountId, date, amount, name);
    const ordinal = ordinals.get(natural) ?? 0;
    ordinals.set(natural, ordinal + 1);
    const plaidTxnId = plaidTxnIdFor(row, natural, ordinal);

    const accountId = localAccountId.get(plaidAccountId);
    if (accountId === undefined) {
      if (!unmappedSeen.has(plaidAccountId)) {
        unmappedSeen.add(plaidAccountId);
        unmappedAccounts.push(plaidAccountId);
      }
      continue;
    }

    if (claimed.has(plaidTxnId)) {
      duplicates += 1;
      continue;
    }
    claimed.add(plaidTxnId);

    // `merchant_name` is Plaid's cleaned-up name ("Coffee Roasters") and the
    // raw `name` is the statement line ("COFFEE ROASTERS #22 SQ*"); prefer the
    // former and fall back rather than leaving the payee blank.
    const payee = row.merchant_name || name || undefined;

    addTxns.push({
      id: plaidLocalTxnId(plaidTxnId),
      accountId,
      date,
      payee,
      amount,
      categoryId: UNCATEGORIZED_CATEGORY_ID,
      source: "plaid",
      plaidTxnId,
    });
  }

  const ops: BookOps = {};
  if (addTxns.length > 0) {
    // Every imported row is categorized, so the catch-all envelope has to
    // exist by the time they land. `applyBookOps` applies ops verbatim (it
    // does not call `ensureUncategorized`), so materializing it is this
    // planner's job — same rows `ensureUncategorized` would create.
    if (!book.groups.some((g) => g.id === SYSTEM_GROUP_ID)) {
      ops.addGroups = [{ id: SYSTEM_GROUP_ID, name: "System", order: SYSTEM_ORDER }];
    }
    if (!book.categories.some((c) => c.id === UNCATEGORIZED_CATEGORY_ID)) {
      ops.addCategories = [
        {
          id: UNCATEGORIZED_CATEGORY_ID,
          groupId: SYSTEM_GROUP_ID,
          name: "Uncategorized",
          order: SYSTEM_ORDER,
        },
      ];
    }
    ops.addTxns = addTxns;
  }

  return { ops, skipped: { duplicates, pending, unmappedAccounts } };
}
