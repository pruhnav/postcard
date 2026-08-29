# Hosted demo — Netlify frontend + tunnelled backend

The backend (API, ClickHouse, Postgres, LibreChat, Mongo) keeps running on your
machine. Only the React frontend is hosted, on Netlify. Two tunnels bridge them:

| tunnel | exposes | used for |
|---|---|---|
| **ngrok** (static domain) | API server `:3001` | every avatar turn, the console panels, Tavus's LLM callback |
| **cloudflared** | LibreChat `:3081` | the "Ask about her" chat — opens in a new tab from the console |

```
Netlify (frontend)
   │  REACT_APP_API           → https://helper-prepaid-overhaul.ngrok-free.dev
   │  REACT_APP_LIBRECHAT_URL → https://<random>.trycloudflare.com
   ▼
your laptop:  ngrok → :3001 (API) ─┬─ ClickHouse :8123 (docker)
              cloudflared → :3081  ├─ Postgres (ClickHouse Cloud managed)
              (LibreChat, docker)  └─ Nebius (LLM)
```

## Bring the backend up

```bash
docker compose up -d                        # ClickHouse, LibreChat, Mongo
nohup npm run server > /tmp/postcard-server.log 2>&1 &

# API tunnel (keeps the reserved domain)
nohup ngrok start api > /dev/null 2>&1 &
API_URL=https://helper-prepaid-overhaul.ngrok-free.dev

# LibreChat tunnel (random URL each start)
nohup cloudflared tunnel --url http://localhost:3081 > /tmp/cf.log 2>&1 &
sleep 8
CHAT_URL=$(grep -oE 'https://[a-z-]+\.trycloudflare\.com' /tmp/cf.log | head -1)
echo "API:  $API_URL"
echo "CHAT: $CHAT_URL"
```

Point LibreChat at its public URL and restart it:

```bash
sed -i '' "s#DOMAIN_CLIENT: .*#DOMAIN_CLIENT: $CHAT_URL#; s#DOMAIN_SERVER: .*#DOMAIN_SERVER: $CHAT_URL#" docker-compose.yml
docker compose up -d librechat
```

## Deploy the frontend

**Netlify → Add new site → Import from Git →** pick the repo. `netlify.toml`
already sets the build command, publish dir and SPA redirect. Set the two env
vars — in `netlify.toml` (commit + push) or **Site settings → Environment
variables** (then Deploys → Trigger deploy):

```
REACT_APP_API           = <API_URL>
REACT_APP_LIBRECHAT_URL = <CHAT_URL>
```

## Point Tavus at the API tunnel

Only needed the first time, or whenever the ngrok URL changes:

```bash
source .env
curl -s -X PATCH https://tavusapi.com/v2/personas/$TAVUS_PERSONA_ID \
  -H "x-api-key: $TAVUS_API_KEY" -H 'content-type: application/json' \
  -d "[{\"op\":\"replace\",\"path\":\"/layers/llm/base_url\",\"value\":\"$API_URL/api/llm\"}]"
sed -i '' "s#^TAVUS_CALLBACK_URL=.*#TAVUS_CALLBACK_URL=$API_URL/api/tavus/webhook#" .env
# restart: pkill -f server/index.js ; nohup npm run server &
```

## When a tunnel restarts (URL changes)

- **ngrok** keeps `helper-prepaid-overhaul.ngrok-free.dev` (it's reserved) — nothing to do.
- **cloudflared** gets a new `*.trycloudflare.com` each time. Then:
  1. `DOMAIN_CLIENT`/`DOMAIN_SERVER` in `docker-compose.yml` → `docker compose up -d librechat`
  2. `REACT_APP_LIBRECHAT_URL` on Netlify → trigger a redeploy

A [Cloudflare named tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
(free, needs a domain) gives a stable URL and removes step 2 forever.

## Notes

- The frontend adds `ngrok-skip-browser-warning` to API calls so ngrok's free
  interstitial doesn't break `fetch` (`src/index.js`).
- The console's chat panel embeds LibreChat in an iframe **and** offers
  "open full screen ↗". On the hosted site the iframe won't stay logged in
  (LibreChat's `SameSite=Strict` cookie, cross-site) — use the link.
- `getUserMedia` on `/her` needs HTTPS — Netlify provides it.
