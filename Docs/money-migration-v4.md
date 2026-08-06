# Schema v4: Integer Cents on the Wire

**Status:** IMPLEMENTED (both platforms, one branch). The §7 fixture pair lives at
`fixtures/migration/{v3-nasty,v4-expected}.json` and is asserted by
`src/state/io.test.ts` and `ios/.../SharedMigrationFixtureTests.swift`.
One correction to this document was required during implementation — see §4.
**Scope:** Both platforms (web `src/`, iOS `ios/`). One document format, one migration, shipped together.
**Written:** 2026-07-06. Designed to be execution-ready without further design decisions.

---

## 1. Why

Money is currently stored as **dollars in a JSON number** (`"amount": 33.33`). The two
platforms protect themselves from float drift in *different* ways:

- **Web** (`src/budget/ledger.ts`): every dollars-as-`number` operand is rounded to
  cents (`toCents = Math.round(n * 100)`) on the way into arithmetic, summed as
  integers, converted back at the boundary. Exact — but only by *discipline*: every
  new arithmetic site must remember to route through `toCents`.
- **iOS** (`FinanceFlowKit/Models/Values.swift`): money is `Decimal` end-to-end.
  Exact base-10 arithmetic, no rounding at all.

### The live parity bug

Neither platform's input field rounds to cents before persisting:

- Web `NumberField` (`src/components/glass/NumberField.tsx:26-34`) stores whatever
  `Number(v)` parses — `"33.333"` persists as `33.333`.
- iOS `parseNumericField` (`ios/.../Components/Fields.swift:52-59`) parses digits+dot
  to `Decimal` — `"33.333"` persists as `33.333`.

Given a document containing `monthlyTarget: 33.333` and assignment `33.33`:

- **Web** computes with both rounded to cents → `3333 >= 3333` → **ready**.
- **iOS** compares exact Decimals → `33.33 >= 33.333` is false → **not ready**.

Same document, different ready flags — and by the same mechanism, Ready-to-Assign and
category availables can differ by a cent between platforms. Storing **integer cents**
makes sub-cent states *unrepresentable*: both platforms become deterministic by
construction, and the web's per-site rounding discipline is no longer load-bearing.

### Secondary wins

- Web arithmetic sites drop the `toCents`/`fromCents` round-trips (~15 call sites).
- iOS drops `Decimal` for money (`Int` cents is simpler, faster, and can't be
  constructed wrong — see the float-literal CAUTION in `Values.swift:15-17`).
- JSON integers survive every parser exactly; no more relying on Swift's
  Decimal-from-JSON exactness or JS double parsing of decimal literals.

---

## 2. Design decisions (settled — do not relitigate)

| # | Decision | Choice | Rationale |
|---|---|---|---|
| D1 | Wire representation | Integer cents as plain JSON numbers (`"amount": 3333`) | Exact in JS to 2^53 and in Swift `Int`; no string encoding complexity |
| D2 | Field names | **Unchanged** (no `amountCents` renames) | The `version: 4` gate already makes old readers throw (`io.ts:49`, `IO.swift` default case) instead of misreading; renaming doubles the churn for safety we already have |
| D3 | Web in-memory type | Branded `Cents` type + `cents()` constructor | Compile-time unit safety during the port; brand is a plain `number` at runtime |
| D4 | iOS in-memory type | `Money` struct wrapping `cents: Int`, Codable as a bare Int | Real type safety; formatting/parse helpers hang off it; synthesized Codable via `singleValueContainer` |
| D5 | Rounding rule (migration + input parse) | `cents = floor(d × 100 + 0.5)` computed in **IEEE-754 double** on both platforms | See §4 — the only rule that is bit-identical across JS and Swift |
| D6 | v1/v2 legacy migrations | Untouched — still run in dollars | Chain becomes v1→v2→v3→v4; the v4 step is one pure function over a v3 document |
| D7 | Backup before first v4 write | Web: copy current store to `financeflow:premigration:v3` (one-time, its OWN key — the rolling `financeflow:backup:v<n>` snapshot would otherwise starve it). iOS: copy `state.json` → `state.v3-backup.json` before first v4 save. **A failed copy gates the migration** on both platforms: block and surface recovery rather than overwrite unbacked bytes | Consistent with the quarantine-never-clobber ethos; migration bugs stay recoverable |
| D8 | Percentages and rates | **Not converted** — they are not money | `Account.apr`, `Match.matchPct`/`currentContribPct`, `Increase401k.currentPct`/`targetPct` stay as-is |

**Non-goals:** field renames; multi-currency; `ShortID` changes; touching the v1/v2
legacy decode types; any behavioral change beyond exactness.

---

## 3. Field inventory: what converts

Every field below changes meaning from dollars-as-float to integer cents. Names stay
identical (D2). TS refs are `src/state/schema.ts`; Swift refs are in `FinanceFlowKit`.

| Field | TS | Swift | Notes |
|---|---|---|---|
| `Txn.amount` | schema.ts:132 | BudgetBook.swift:72 | Sign convention unchanged (outflow negative) |
| `BudgetBook.assignments[month][catId]` | schema.ts:175 | BudgetBook.swift:164 | Values only; keys unchanged |
| `Category.monthlyTarget?` | schema.ts:154 | BudgetBook.swift:126 | |
| `Category.balanceTarget?` | schema.ts:156 | BudgetBook.swift:128 | |
| `Account.minPayment?` | schema.ts:111 | BudgetBook.swift:31 | `apr` (line above it) does NOT convert |
| `Settings.monthlyExpenses?` | schema.ts:89 | Settings.swift:5 | |
| `Settings.preTaxIncome?` | schema.ts:90 | Settings.swift:6 | |
| `Settings.iraAnnualLimit` | schema.ts:91 | Settings.swift:7 | Default becomes `700000` |
| `Settings.hsaSelfLimit` | schema.ts:92 | Settings.swift:8 | Default becomes `430000` |
| `Settings.hsaFamilyLimit` | schema.ts:93 | Settings.swift:9 | Default becomes `855000` |
| `SourcedNumber.value` | schema.ts:20 | Values.swift:22 | Only live uses are IRA/HSA `ytdContribution` — both money |
| `IRA.annualLimit`, `HSA.annualLimit` | schema.ts:35,41 | Values.swift:196,221 | |
| `College.monthlyContribution` | schema.ts:43 | Values.swift:287 | `targetAge` does NOT convert |

Derived-value functions that change units (not wire fields, but same rule):
`emergencyFundTarget` / `bigEmergencyFundTarget` (schema.ts:244-252 and the Swift
mirror) now return cents — the `1000` floor becomes `100_000`.

**Fields that must NOT convert** (audit checklist for review): `Account.apr`,
`Match.matchPct`, `Match.currentContribPct`, `Increase401k.currentPct`,
`Increase401k.targetPct`, `BigEF.targetMonths`, `College.targetAge`,
`Goal.horizonYears` (legacy, v2-only), all dates/ids/enums.

---

## 4. The rounding rule (D5) — read this twice

The v3→v4 migration and both platforms' input parsing use **one formula**:

```
cents(d) = floor(d * 100 + 0.5)        // evaluated in IEEE-754 double
```

- **Web:** `Math.floor(d * 100 + 0.5)` (matches `Math.round` for our domain, but we
  spell it as the formula so the two platforms are literally the same expression).
- **iOS:** convert to double first, then the same expression:
  `Int((NSDecimalNumber(decimal: d).doubleValue * 100 + 0.5).rounded(.down))`.

Why double, when iOS has exact `Decimal`? Because the *web* can only see the
IEEE-double image of what's in the JSON, and JSON-number → nearest-double is
identical everywhere. Routing both platforms through double makes migration
**bit-identical by construction**, whatever that image happens to be. Sub-cent
values are rare (typed-input edge case) but they are the entire reason this
migration exists — the rule must be airtight for exactly those.

> **Correction (found during implementation).** The original text of this section
> illustrated the rule with: "a stored `33.335` would migrate to `3334` on iOS
> (Decimal sees the exact half, rounds away from zero) but `3333` on web (the
> nearest double to 33.335 is fractionally below the half)." **The worked example
> was wrong about the double.** The nearest double to `33.335` is
> `33.33500000000000085265…`, which is fractionally *above* the decimal value, so
> `d * 100` rounds to exactly `3333.5` and `floor(3333.5 + 0.5)` is **3334** — the
> same answer exact `Decimal` would give, not a different one. The RULE (D5) is
> unaffected and is what both platforms implement; only the illustration was
> incorrect. `33.335 → 3334` is pinned in the §7 fixture and asserted by name on
> both platforms.

Negative amounts (outflows) hit this too: the formula rounds a scaled `-1234.5`
(i.e. `-12.345` dollars) to `-1234` on both platforms. Do not substitute
`NSDecimalRound(.plain)` (rounds half away from zero → `-1235`) or Swift's
`.toNearestOrAwayFromZero`. The migration test fixture (§7) pins these cases,
including the exactly-representable halves `±0.125` where the double is not an
approximation at all.

---

## 5. Web implementation plan

Work through in order; each step compiles and passes tests before the next.

1. **`src/state/schema.ts`** — add the branded type and constructor:
   ```ts
   /** Integer cents. The brand is erased at runtime; migrate() casts once at the boundary. */
   export type Cents = number & { readonly __cents?: unique symbol };
   export const cents = (n: number): Cents => n as Cents;
   ```
   Retype every field in §3 as `Cents`; bump `AppState.version` to `4`;
   `DEFAULT_SETTINGS` limits ×100; `emergencyFundTarget`/`bigEmergencyFundTarget`
   return `Cents` (floor `100_000`; `months * monthlyExpenses` is already
   integer-exact). `makeInitialState()` emits `version: 4`.
2. **`src/state/io.ts`** — add `migrateV3(v3: V3State): AppState` implementing §4
   over the §3 field list (walk `budget.transactions`, `budget.assignments`,
   `budget.categories`, `budget.accounts`, `settings`, and the four node payload
   shapes that carry money). Extend the `migrate()` switch: `version === 4` returns,
   `3` runs `migrateV3`, `2`/`1` chain through. Keep `migrateV1`/`migrateV2` in
   dollars (D6) — they still use the old local `toCents` helpers, which move into
   `io.ts` as private functions when step 3 deletes them from the ledger.
3. **`src/budget/ledger.ts`** — delete `toCents`/`fromCents` and all round-trips:
   `accountBalance`, `snapshot` sum `Cents` directly (the cent-tables code shape
   stays; the conversions at entry/exit go). `pairTransfer` takes `Cents`.
4. **`src/budget/nodeLedger.ts`** — same treatment: `recurringTotals`, `efBalance`,
   `efTarget`, `purchaseTotals`, `debtRows`, `debtTotals`, `planBalanceEdit`,
   `planAccountBalanceTo` all operate on `Cents` with no conversion.
5. **`src/graph/derive.ts`** (`monthlyBudgetSummary`), **`src/components/focus/progressOf.ts`** —
   drop conversions; comparisons already plain `>=`, now on integers.
6. **Parse boundary — `src/components/glass/NumberField.tsx`**: parse with the §4
   formula (`cents(Math.floor(Number(v) * 100 + 0.5))`); display by formatting
   `c / 100`. Callers that fed it dollars (forms.tsx, Editors) now feed `Cents`.
7. **Display boundary — `src/components/budget/bits.tsx`** `dollars()`: take
   `Cents`, format `c / 100` via the existing `Intl.NumberFormat` logic (whole-dollar
   vs 2-decimal branch keys off `c % 100 === 0`). Sweep the `Math.round(x * 100)`
   zero/negative checks (AccountsSection.tsx:21, BudgetScreen.tsx:52,
   CategoryGroups.tsx:32, TransactionsSection.tsx:114,258) to direct integer checks;
   `GoalBar.tsx:73-74` rounds `c / 100` for its compact labels.
8. **Persistence bootstrap — `src/state/store.ts` `loadInitial()`**: before saving a
   freshly migrated v4 state, write the raw pre-migration string to
   `financeflow:premigration:v3` if that key is empty (D7). If that write fails,
   do NOT adopt the migrated state — set `bootRecovery` so persistence stays
   suspended and RecoveryScreen offers the original bytes for download.
9. **Tests** — update fixtures (`0.1` → `10`, `1000` → `100_000`, …) in
   `ledger.test.ts`, `nodeLedger.test.ts`, `progressOf.test.ts`, `store.test.ts`;
   `io.test.ts` gains v3→v4 cases and keeps v1→v4 / v2→v4 chain tests. Add the
   shared fixture test from §7.

## 6. iOS implementation plan

1. **`Money` type** (new file `FinanceFlowKit/Models/Money.swift`):
   ```swift
   /// Integer cents. Codable as a bare JSON number — the v4 wire format.
   struct Money: Hashable, Codable, Comparable, AdditiveArithmetic {
       var cents: Int
       // init(from:)/encode(to:) via singleValueContainer (bare Int).
       // +, -, prefix -, <, min/max, .zero; NO * or / on Money×Money.
       var decimalDollars: Decimal { Decimal(cents) / 100 }   // display only
       static func fromUserInput(_ d: Decimal) -> Money        // §4 formula via doubleValue
   }
   ```
2. **Models** — retype the §3 fields in `BudgetBook.swift`, `Settings.swift`
   (defaults ×100), `Values.swift` (`SourcedNumber.value`, IRA/HSA `annualLimit`,
   `CollegeData.monthlyContribution`) as `Money`. Legacy v2-only fields and the
   migration-only types stay `Decimal` (D6). Percent/rate fields stay `Decimal` (D8).
3. **`Migrate.swift`** — add `v3ToV4(_:)` mirroring the web's field walk, using the
   §4 double formula. **`IO.swift`** version switch: `case 4: return state`, `case 3:
   v3ToV4`, 2/1 chain. The `AppState.version` constant becomes 4.
4. **Domain** — `Ledger.swift`, `NodeLedger.swift`, `Budget.swift`, `Progress.swift`:
   mechanical `Decimal` → `Money` on sums/comparisons; `asDouble` display hooks
   become `decimalDollars`-based. EF target helpers return `Money` (floor
   `Money(cents: 100_000)`).
5. **Parse boundary — `Fields.swift`**: `parseNumericField` still produces `Decimal`;
   `NumberField` converts via `Money.fromUserInput` (§4). `PercentField` untouched.
6. **Display — `UIKit.swift`**: `CurrencyFormat.string(_: Money)` formats
   `decimalDollars`; whole-amount branch keys off `cents % 100 == 0`.
7. **Bootstrap backup (D7)** — in the AppStore bootstrap, before the first save of a
   migrated v4 state, copy `state.json` → `state.v3-backup.json` if absent.
8. **Tests** — `JSONWireFormatTests` now proves money encodes as bare *integers*;
   `MigrationTests` adds v3→v4 plus full v1→v4 chain; `LedgerTests` /
   `NodeLedgerTests` / `ProgressTests` fixtures ×100. Add the §7 shared-fixture test.

## 7. Cross-platform determinism test (the keystone)

Commit two fixture files (suggest `fixtures/migration/v3-nasty.json` and
`v4-expected.json` at repo root, referenced by both test suites):

- `v3-nasty.json`: a v3 document salted with the hostile cases — `0.1`/`0.2` sums,
  `33.333`, `33.335`, `-12.345`, `-1234.5`-style negative halves, a sub-cent
  assignment, large balances (`1234567.89`), zero and missing optionals.
- `v4-expected.json`: its exact v4 image (generated once from the web
  implementation, then **verified by hand against §4** before committing — this
  file is the contract).

Both vitest and swift-testing assert: `migrate(v3-nasty) == v4-expected`,
field-for-field. If both platforms match the same committed bytes, migration
divergence is impossible. This test is the single most important deliverable
after the migration itself.

**Rider (implemented with v4): the uncategorized back-fill.** `migrateV3` (web)
and `Migration.v3ToV4` (Swift) also move every on-budget row that never entered an
envelope onto `cat:uncategorized`, creating `g:system` and the envelope in the same
pass. The rows selected are exactly those `bookIntegrity` counts in its
`unbudgetedSpending` residual: on an on-budget account, no `categoryId`, and not
one leg of an on-budget → on-budget transfer (that pair cancels in the cash total,
so giving it an envelope would invent activity that never happened). w1-bug3 made
this state unreachable from the UI going forward but deliberately did not rewrite
history; v4 is the one document rewrite, with one backup, where it gets fixed.

**Consequence, stated plainly:** an uncategorized outflow that used to sit outside
the envelope system now reads as overspending in Uncategorized, and a *past*
month's overspend sweeps into Ready-to-Assign. So §8.3's "balances unchanged to
the cent" holds for every envelope and account balance, but Ready-to-Assign
legitimately drops by the total of any previously-uncategorized on-budget
spending. That is the correction, not a regression — the money always left, the
book just wasn't saying where from. After this pass `unbudgetedSpending` is 0 and
stays 0, which is what makes `bookIntegrity().drift === 0` an unconditional
invariant from v4 forward.

## 8. Rollout sequencing

Single user (Greg), two apps, document shared via export/import — sequencing is easy
but strict:

1. Implement web + iOS **on one branch**; neither merges alone.
2. Run both test suites; run the §7 fixture test on both.
3. Device-test iOS: install, confirm the v3→v4 migration of the real on-device
   document (backup file appears, balances/ready flags unchanged to the cent).
4. Web: open with production localStorage copied into a dev profile first if
   paranoid; the `financeflow:premigration:v3` key is the safety net.
5. Merge. From then on, exports are v4; a stale v3 app refuses them loudly
   (`Unsupported FinanceFlow version`) rather than corrupting — re-update, done.

**Do not** interleave with other schema work; v4 should be the only change in its PR
pair so the fixture contract stays reviewable.

## 9. Known stale notes to ignore

- SESSION-STATE.md previously said iOS "kept `Double` for web parity" with a
  "half-cent epsilon" on ready checks. **Both statements are outdated**: iOS money is
  `Decimal` (Values.swift:4-17), no epsilon exists on either platform (the only
  trace is a comment in Progress.swift:23 noting the tolerance is no longer needed).
  This spec supersedes those notes.
