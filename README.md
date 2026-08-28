# Postcard

*The small thing you send home when you can't be there.*

A granddaughter moved from Chennai to the US. Her grandmother is seventy, alone
most days, and eleven and a half hours behind. They talk about once a week.

Postcard is what fills the other six days: an avatar of the granddaughter that her
grandmother can talk to whenever she wants, and a console on the other side of
the world that tells the granddaughter what she missed.

It remembers everything her grandmother says. It knows only what the
granddaughter has told it about herself.

---

## The idea in one paragraph

Companion products usually fail in one of two ways. Either they invent things to
keep the conversation going, which is corrosive when the person on the other end
trusts them, or they forget everything past the last few messages, which makes
them useless for the one job a companion has.

Postcard fixes both by splitting memory in two. What the avatar knows about the
granddaughter lives in Postgres: a handful of relationships, five memories,
whatever news she has written down this week. Small, curated, and nothing else
can write to it, which is what makes "never invent anything" enforceable rather
than aspirational. What the avatar knows about the grandmother lives in
ClickHouse: every sentence she has ever said, retrievable by meaning, growing
forever.

When she mentions a name nobody has explained, the avatar stays warm and curious
rather than guessing, and the name goes into a queue. The granddaughter answers
it that evening, and the next conversation has the context. The system gets
better at being family without anyone doing data entry.

---

## What it does

**Her side.** One screen. The avatar full bleed, a clock large enough to read
from a chair, her own face in the corner so she knows the camera is on, and
reminders that the avatar says out loud at the right time. No menus, no buttons
except one that says Done.

**The other side.** A console with two clocks, hers and yours. A still from her
room. What she talked about today. Which medicines she confirmed. Names nobody
has explained yet, with a count. And how often she repeated herself today
compared with her own thirty-day average, which is the kind of thing no one
notices from a weekly phone call.

**In between.** Every utterance is scored, embedded, and written to ClickHouse.
Retrieval runs on every turn, so a temple she mentioned in April comes back in
August without anyone tagging anything.

---

## Architecture

```
her browser ──── Tavus avatar ──── POST /api/llm/chat/completions
                                            │
                              embed ────────┤
                                            ├──── ClickHouse: recall by meaning
                              Postgres ─────┤     (everything she has ever said)
                              (who, what,   │
                               memories)    └──── reply
                                            
                                   then, off the response path:
                                   score · extract names · detect repeat
                                   write both turns to ClickHouse
                                   log any gap to Postgres
```

The important line is the first one. Tavus is configured to call our own
endpoint as its model, so retrieval happens **inside** the conversation. The
alternative, letting Tavus run the persona on a static context blob, leaves
everything clever sitting in a dashboard beside the conversation instead of in
it.

**Postgres** holds `families`, `relations`, `memories`, `updates`, `medicines`,
`medicine_log`, `reminders`, `gaps`, `frames`. Small, mutable, transactional.

**ClickHouse** holds one table, `utterances`, append-only, with the embedding on
each row. Three materialized views ride on top: repeats per day, distress by
hour, and a running mention count per name. Every number on the console comes
out of those.

---

## Running it

```bash
npm install
cp .env.example .env.local     # fill it in
psql "$DATABASE_URL" -f schema.sql
clickhouse-client --queries-file clickhouse/schema.sql   # or paste into the Cloud SQL console

npm run server                 # :3001
npm start                      # :3000
```

Then:

- `/setup` — write the context. People, memories, medicines, news about you.
- `/her` — open on her device.
- `/console` — open on yours.

### Tavus

Two things must be configured on the persona, not in this repo:

1. **Model endpoint** points at `https://<your-tunnel>/api/llm/chat/completions`.
   Use ngrok in development: `ngrok http 3001`.
2. **Callback URL** points at `https://<your-tunnel>/api/tavus/webhook`, and goes
   in `TAVUS_CALLBACK_URL`.

Without the first, the avatar has no memory and the whole premise is gone.

### Seed the history

```bash
npm run seed -- --days 90
```

Every panel on the console reads an aggregate. With one afternoon of real data
they each show a single point. This generates months of plausible conversation
from the persona document and the context in Postgres, with a repetition rate
that climbs and a name that starts appearing near the end. Run it the night
before, not during.

### LibreChat

Point `librechat.yaml` at `mcp/server.js`, start LibreChat on :3080, and create
an agent with the five Postcard tools enabled. The console embeds it in the right
column, so "what did she talk about today" is a tool call against ClickHouse
rather than another endpoint.

---

## The persona

`docs/persona.md` is loaded into the system prompt on every turn. Edit that file,
restart the server, and the avatar's behaviour changes. It is the most important
file in this repository and it contains no code.

The guardrails that matter:

- Never invent a fact about the granddaughter's life. With no fresh news, warm
  generalities beat invented specifics.
- Never tell her she is repeating herself. Answer fresh and warm every time. The
  console counts the repeats; the avatar never mentions them.
- Never bring up her late husband. If she brings him up fondly, ask for the
  story. If she sounds confused about it, be gentle, do not try to settle it, and
  flag it as high priority for a human.
- No medical advice beyond asking whether she took what she was prescribed.
- No promises about visits or calls.

---

## Demo, in order

1. `/her` on a phone, `/console` on a laptop. Both visible.
2. She says something about a place from months ago. The avatar answers with a
   detail from a conversation in the seeded history. Show the retrieved rows.
3. A medicine reminder fires. The avatar says it out loud, in character. The
   console flips to confirmed when she answers.
4. She mentions Ravi. The console shows Ravi with nine mentions and her own
   words around each one. Type who Ravi is. She mentions him again and the
   avatar knows.
5. The patterns panel: repeated questions today against her own average.

Step 4 is the one to spend time on. It is the only part of this that cannot be
built with a prompt.

---

## What this is not

Not a medical device, not a monitoring system, and not a substitute for the
weekly call. There is no location tracking and no motion detection, which earlier
versions of this idea had and which turn a granddaughter into a supervisor.

She knows the avatar is something her granddaughter set up. The deflection line
is true: the avatar really does ask, and the answer really does come back
tomorrow.
