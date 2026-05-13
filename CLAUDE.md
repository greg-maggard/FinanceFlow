# FinanceFlow — Project Instructions

> Project-local Claude Code instructions. Auto-loaded on every session opened
> in this repo. Pairs with the global protocol at `~/.claude/CLAUDE.md`.

## On session start, before responding

1. Read `docs/memory/retro-atoms.json`. It contains 15 Mem0-bound atoms and 2
   Supermemory-bound long-form items extracted from prior FinanceFlow
   sessions. Treat these as authoritative durable context for the user, this
   project, and shared design preferences. Cite them when relevant rather
   than re-deriving.
2. If Mem0 and/or Supermemory MCP tools are available in the session and the
   atoms haven't yet been loaded into those services, propose loading them
   (idempotent — each atom has a stable `id`; search before adding to avoid
   dupes).
3. Read `SESSION-STATE.md` (project root) if it exists, per the global WAL
   protocol.

## Project-specific conventions

- **Stack**: Vite + React + TypeScript, Tailwind, Framer Motion, Zustand.
- **Branches**: `main` is source of truth (PR #1 merged at `0a01d48`). Work
  on feature branches off `main`. Merge via PR, normal merge commit
  (not squash) — commit history matters for design iteration provenance.
- **YNAB credentials**: PAT lives in a separate persisted Zustand store
  (`src/state/ynabStore.ts`), explicitly NOT in main `AppState`. JSON
  export/import must never include the token.
- **Card action rules (do not regress)**: no `Mark complete` or `Next step`
  button until the goal bar hits 100%; single contextual action visible at a
  time; recurring tasks use monthly check (`monthlyChecks[currentMonth]`),
  not the permanent `completed` flag; streak is a small non-interactive chip
  in the header (no fire emoji).
- **Design defaults**: liquid-glass / iOS 26 visionOS aesthetic; slow,
  flowing animations (default to longer durations, softer springs, direction-
  aware morphs); psychology-rooted engagement (no gimmicky celebrations).

## Working-style defaults

- Claude drives most dev work; user pulls locally on Mac as needed. Push
  proactively after substantive changes.
- User communicates via numbered bullets per turn. Mirror that structure
  when replying to multi-point feedback.
