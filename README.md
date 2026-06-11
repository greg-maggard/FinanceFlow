# FinanceFlow

An app to track your progress through the
[r/PersonalFinance](https://www.reddit.com/r/personalfinance/wiki/commontopics)
"prime directive" flowchart — interactive, color-coded by phase, with rich
per-node tracking (emergency fund balance, debt list with APRs, IRA/HSA YTD
vs. limits, 529, savings goals).

A single-page static web app. Data lives in your browser (`localStorage`)
with JSON export/import for backup. The architecture leaves clean seams for
two planned future additions: Plaid integration and user accounts with cloud
sync.

A native SwiftUI iOS port with full feature parity lives in
[`ios/`](ios/README.md).

## Stack

- Vite + React + TypeScript
- Framer Motion for the focus-stage and phase-trail animations
- Zustand for state
- Tailwind CSS
- Vitest for unit tests

## Develop

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # vitest
npm run build    # static dist/
```

CI (GitHub Actions) runs the web tests + build and the FinanceFlowKit Swift
tests on every PR — see `.github/workflows/`.

## Deploying

`npm run build` produces `dist/`, which deploys as-is to GitHub Pages, Vercel,
Netlify, or any static host.

## One book, two faces

The envelope ledger (`AppState.budget`) is the single source of truth for all
money: the Budget screen and the flowchart nodes are two editors over the same
accounts, categories, and assignments (`src/budget/nodeLedger.ts` is the
node ↔ ledger view layer). The earlier YNAB integration is retired —
FinanceFlow *is* the budget now.

## Extension seams (designed in, not built)

- **`StorageAdapter` interface** (`src/state/storage.ts`) — only
  `LocalStorageAdapter` ships today. A future `RemoteStorageAdapter` for
  Supabase or similar drops in without touching the store.
- **`BalanceProvider` interface** (`src/integrations/balanceProvider.ts`) —
  only `ManualProvider` is wired. Per-field `source: "manual" | "plaid" |
  "ynab"` attribution is already in the schema, so a future Plaid provider
  can populate fields without schema churn.
- **`AppState.version`** is in place for forward migrations.
