# FinanceFlow

An app to track your progress through the
[r/PersonalFinance](https://www.reddit.com/r/personalfinance/wiki/commontopics)
"prime directive" flowchart — interactive, color-coded by phase, with rich
per-node tracking (emergency fund balance, debt list with APRs, IRA/HSA YTD
vs. limits, 529, savings goals).

MVP is a single-page static web app. Data lives in your browser
(`localStorage`) with JSON export/import for backup. The architecture leaves
clean seams for two planned future additions: Plaid/YNAB integration and user
accounts with cloud sync.

## Stack

- Vite + React + TypeScript
- React Flow (`@xyflow/react`) for the interactive graph
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

## Deploying

`npm run build` produces `dist/`, which deploys as-is to GitHub Pages, Vercel,
Netlify, or any static host.

## Extension seams (designed in, not built)

- **`StorageAdapter` interface** (`src/state/storage.ts`) — only
  `LocalStorageAdapter` ships in MVP. A future `RemoteStorageAdapter` for
  Supabase or similar drops in without touching the store.
- **`BalanceProvider` interface** (`src/integrations/balanceProvider.ts`) —
  only `ManualProvider` ships in MVP. Per-field `source: "manual" | "plaid" |
  "ynab"` attribution is already in the schema, so a future Plaid/YNAB
  provider can populate fields without schema churn.
- **`AppState.version`** is in place for forward migrations.
