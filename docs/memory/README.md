# Memory Retro Atoms

This directory holds **portable, durable extracts** from FinanceFlow Claude
Code conversations, ready to be loaded into Mem0 and Supermemory when those
MCP servers are reachable from the Claude Code Web sandbox.

## What's here

- **`retro-atoms.json`** — curated atoms extracted from 198 session transcripts
  spanning 2026-04-29 → 2026-05-11. 15 Mem0 entries, 2 Supermemory entries.
  Each has an `id`, the durable text/content, categories/title, and the
  rationale for keeping it.

## Why a file instead of direct MCP load

As of May 2026, Mem0 and Supermemory Connectors added on the user's
claude.ai account do not propagate to the Claude Code Web sandbox's MCP
manifest. The sandbox host-managed config (`/tmp/mcp-config-cse_*.json`)
ships only Google Workspace + GitHub.

The atoms were extracted while the data was reachable (transcripts live on
the sandbox writable rootfs) and parked here for durable storage via Git,
since GitHub is the one persistence surface available from any session.

## Loading atoms when MCPs become available

### Option A — via MCP tools (preferred, once propagation works)

Future Claude session can read this file and call:

- `add_memory` (Mem0) for each item in the `mem0` array — pass `text` as the
  memory content, and `categories` as tags if the tool supports them.
- Supermemory's save tool for each item in `supermemory` — pass `title`,
  `description`, and `content` to preserve the source document verbatim.

Idempotency: each atom has a stable `id`. Search before saving to avoid
duplicates if the load is re-run.

### Option B — direct API (fallback)

If the MCPs still aren't available, load via curl using the user's API keys:

```bash
# Mem0 — load each atom
for atom in $(jq -c '.mem0[]' retro-atoms.json); do
  text=$(echo "$atom" | jq -r '.text')
  curl -X POST https://api.mem0.ai/v1/memories/ \
    -H "Authorization: Token $MEM0_API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"messages\":[{\"role\":\"user\",\"content\":\"$text\"}]}"
done

# Supermemory — load each long-form item
for item in $(jq -c '.supermemory[]' retro-atoms.json); do
  curl -X POST https://api.supermemory.ai/v3/memories \
    -H "Authorization: Bearer $SUPERMEMORY_API_KEY" \
    -H "Content-Type: application/json" \
    -d "$item"
done
```

(Exact endpoints/payloads should be verified against the current API docs
before running. Above is illustrative shape, not a tested script.)

## Extraction methodology

The full process is reproducible:

1. Walk `~/.claude/projects/-home-user-FinanceFlow/*.jsonl` (198 files).
2. Filter to `type == "user"` lines; strip synthetic / tool-result / system
   reminder noise.
3. Dedup by exact text → in this corpus, 2,825 raw user turns collapsed to
   34 unique human-typed turns (98.8% reduction; the bulk were session
   replays).
4. Review the 34 unique turns; extract durable cross-surface atoms per the
   protocol in `~/.claude/CLAUDE.md`.

The extractor script lives at `/tmp/extract_user_turns.py` in the sandbox
where this was run; it's not committed here (it's regenerable in seconds).
