# Running Postcard — what to know

Everything is up right now. This is how it's wired and how to bring it back.

## The URLs

| | URL | login |
|---|---|---|
| **Console** (Ruby's side) | http://app.localhost:3002/console | — |
| Setup (curated context) | http://app.localhost:3002/setup | — |
| Her screen (the avatar) | http://app.localhost:3002/her | — |
| **ClickHouse** (for judges) | http://localhost:8123/play | `default` / `postcard` |
| **LibreChat** | http://chat.localhost:3081 | register any email, no verification needed |
| API | http://localhost:3001 | — |

> The frontend is on **3002** and LibreChat on **3081** because you already had
> something on 3000 and a LibreChat on 3080.
>
> **Open the console as `app.localhost`, not `localhost`.** LibreChat's login
> cookie is `SameSite=Strict`, so it only works inside the console's iframe when
> the two share a site. `app.localhost` and `chat.localhost` are both the
> `localhost` site; plain `localhost:3002` + `localhost:3081` are cross-site and
> the embedded chat silently fails to stay logged in.

## The five processes

| process | command | notes |
|---|---|---|
| API server | `npm run server` | port 3001; first boot downloads ~90 MB embedding weights |
| Frontend | `PORT=3002 npm start` | port 3002 |
| ngrok | `ngrok http 3001` | public tunnel so Tavus can reach the API |
| Docker | `docker compose up -d` | ClickHouse, LibreChat, Mongo |
| Postgres | — | hosted (your ClickHouse Cloud managed Postgres), nothing to run |

## The one manual step — the LibreChat agent

LibreChat is running with the 9 Postcard MCP tools connected and Nebius as the
model provider. You just have to build the agent once:

1. http://chat.localhost:3081 → register (any email, password ≥ 8 chars)
2. **Agents → Create**
   - Name: `Amama`
   - Model: **Nebius / Qwen3-30B-A3B-Instruct-2507**
   - Tools: add all nine `postcard` tools
   - Instructions: paste the block from the bottom of `librechat.yaml`
3. Save. It appears in the console's right-hand panel.

## Tavus

- New persona **`pd0e2bea2836`** ("Ruby Postcard"), replica **Olivia** (`rc2146c13e81`).
  Its LLM layer points at `<ngrok>/api/llm`, so every turn runs through our server
  (retrieval + persona + extraction).
- **Change the face**: `PATCH https://tavusapi.com/v2/personas/pd0e2bea2836`
  with `{"default_replica_id":"<id>"}`. Replicas on your account: Luna, Olivia,
  Gloria, Anna, Mary, Jackie, Raj, Charlie, Benjamin, Steph.
- **1 concurrent conversation** on your plan. The server auto-ends a stale one
  before starting a new one, so a page refresh is fine.

## If ngrok restarts (URL changes)

The free tunnel gets a new URL each launch. When that happens:

```bash
NEW=$(curl -s localhost:4040/api/tunnels | python3 -c "import json,sys;print(json.load(sys.stdin)['tunnels'][0]['public_url'])")
# 1. update .env
sed -i '' "s#^TAVUS_CALLBACK_URL=.*#TAVUS_CALLBACK_URL=$NEW/api/tavus/webhook#" .env
# 2. re-point the persona's LLM layer
curl -s -X PATCH https://tavusapi.com/v2/personas/pd0e2bea2836 \
  -H "x-api-key: $TAVUS_API_KEY" -H 'content-type: application/json' \
  -d "[{\"op\":\"replace\",\"path\":\"/layers/llm/base_url\",\"value\":\"$NEW/api/llm\"}]"
# 3. restart the API server
```

A paid ngrok static domain (or `cloudflared tunnel`) avoids this entirely.

## Cold start from nothing

```bash
docker compose up -d
npm run schema
nohup npm run server > /tmp/postcard-server.log 2>&1 &
nohup ngrok http 3001 > /dev/null 2>&1 &        # then re-point persona as above
PORT=3002 BROWSER=none nohup npm start > /tmp/postcard-web.log 2>&1 &
npm run seed:context     # only the first time — loads the Amama/Ruby cast
```

## Demo, in order

1. Console on one screen, `localhost:8123/play` on another.
2. Open `/her`, talk to the avatar (or type through the console).
3. She mentions a new tablet / a name / an appointment. Refresh the ClickHouse
   query `SELECT * FROM extractions ORDER BY ts DESC` — rows appear, `applied=1`,
   with a `postgres_id`.
4. Ask the LibreChat "Amama" agent: *"what did she talk about today?"* /
   *"anything to confirm?"* → say *"yes confirm the vitamin D"*.
5. `SELECT * FROM conversation_summaries` — the day, written up.

## Known limits

- Extraction is LLM-driven (Qwen3-30B on Nebius) — occasionally misses a fact on
  one turn; the summary still captures it from the transcript.
- ngrok free: URL churns on restart (see above).
- Tavus plan: 1 concurrent conversation; trial minutes apply.
- ClickHouse is the local Docker one — fine for the demo; swap `CLICKHOUSE_URL`
  for a Cloud service later if you want a hosted console.
