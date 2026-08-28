# Where each service is used

Four moving parts. Each does one job and the seams are visible.

```
        HER SIDE                                       RUBY'S SIDE
   ┌──────────────┐                              ┌────────────────────────┐
   │  Tavus       │   speech        /api/llm    │  Console (/console)      │
   │  avatar      │ ───────────────────────────▶│  · transcript           │
   │  (/her)      │◀───────────────────────────  │  · medicine / patterns  │
   └──────┬───────┘   reply                      │  · "Ask about her"  ────┼──┐
          │                                      └────────────────────────┘  │
          │ every turn                                                        │
          ▼                                                                   ▼
   ┌─────────────────────────── server/ ───────────────────────┐     ┌──────────────┐
   │  buildSystem  →  recall  →  reply  →  ingest → extract     │     │  LibreChat   │
   └───────┬───────────────────────────────────┬───────────────┘     │  agent       │
           │                                   │                     │  (Docker)    │
           ▼                                   ▼                     └──────┬───────┘
   ┌───────────────┐                   ┌───────────────┐                    │ MCP /mcp
   │  ClickHouse   │                   │  Postgres     │◀───────────────────┘
   │  conversation │──── teaches ─────▶│  curated store│
   └───────────────┘                   └───────────────┘
```

## Tavus — the avatar she talks to

- `server/tavus.js` creates one conversation per session and can make the avatar
  **speak** a reminder mid-call.
- Configured to call **our** endpoint (`POST /api/llm/chat/completions`) as its
  model, so every turn runs through `server/index.js` — retrieval and the
  persona happen *inside* the conversation, not in a Tavus dashboard.
- `POST /api/tavus/webhook` receives transcript events and the end-of-call
  event (which triggers a summary).

## ClickHouse — everything the conversation produces

One append-only stream plus what we derive from it. Nothing here is ever
updated. Judges can watch these fill in the ClickHouse console during a demo:

| Table | Written by | What it holds |
|---|---|---|
| `utterances` | `server/index.js` `write()` | every turn, both speakers, + a 384-d embedding |
| `conversation_summaries` | `generateSummary()` | the kept end-of-call / on-demand summary + her mood |
| `extractions` | `server/extract.js` `audit()` | **one row per fact pulled from a conversation**, with `applied` and `postgres_id` showing whether it reached Postgres |
| `daily_stats` (MV) | materialized from `utterances` | repeats per day |
| `distress_by_hour` (MV) | materialized from `utterances` | when in her day she sounds unsettled |
| `mentions` (MV) | materialized from `utterances` | running count of every name she's used |

Reads: `server/ch.js` — `recall()` (vector search on every turn),
`isRepeat()`, `trends()`, `unknownNames()`, `recentExtractions()`,
`recentSummaries()`.

```sql
-- the money query for judges
SELECT ts, kind, source_text, applied, postgres_id, note
FROM extractions ORDER BY ts DESC;
```

## Postgres — the curated store the avatar speaks from

Small, transactional, and the **only** place a new fact about Ruby's world can
come from. `schema.sql`, all access through `server/db.js`.

| Table | Source of rows |
|---|---|
| `families` | `.env` on first boot, or `/setup` |
| `relations`, `memories`, `medicines`, `updates`, `reminders` | `/setup` (`source='ruby'`, verified) **and** the extraction pipeline (`source='conversation'`, `unverified=true`) |
| `medicine_log` | reminder spoken, or she says she took something |
| `gaps` | a name nobody has explained → the six-day loop |
| `frames` | latest still from her screen |

An auto-extracted row is used by the avatar immediately (marked tentative in the
system prompt) and shows in `/api/pending` until Ruby confirms it with
`/api/verify` or the `confirm_fact` MCP tool.

```sql
SELECT 'medicine' t, name, source, unverified FROM medicines
UNION ALL SELECT 'memory', title, source, unverified FROM memories
UNION ALL SELECT 'reminder', text, source, unverified FROM reminders
ORDER BY unverified DESC;
```

## LibreChat — the "Ask about her" chat in the console

- Runs in Docker (`docker-compose.yml`), embedded as the console's right column
  (`src/pages/Dashboard.js`, `REACT_APP_LIBRECHAT_URL`).
- Talks to the **Postcard MCP server** at `http://host.docker.internal:3001/mcp`
  (`mcp/tools.js`, mounted in `server/index.js`; also runnable as stdio via
  `npm run mcp`).
- Nine tools, each hitting ClickHouse or Postgres directly: `what_she_said_today`,
  `search_her_words`, `day_summary`, `extraction_log`, `facts_to_confirm`,
  `confirm_fact`, `unknown_people`, `patterns`, `teach_avatar`.

## The one place both databases meet

`server/extract.js`. After she speaks:

1. the LLM pulls structured facts out of **her exact words** (never inferred)
2. each fact → an audit row in ClickHouse `extractions`
3. each fact → an upsert into the matching Postgres table, `source='conversation'`,
   `unverified=true`, and the audit row's `postgres_id` is filled in

That is the architecture in one function: the conversation side teaching the
curated side, on the record.
