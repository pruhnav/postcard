-- ClickHouse. The conversation side of Postcard: every sentence the
-- grandmother says, everything the pipeline derives from it, and the
-- aggregates the console reads. Append-only. Nothing here is ever updated —
-- if a fact needs editing it belongs in Postgres (see schema.sql).
--
-- For judges: after a conversation you can watch these fill in real time.
--   SELECT * FROM utterances            ORDER BY ts DESC LIMIT 20;
--   SELECT * FROM conversation_summaries ORDER BY created_at DESC;
--   SELECT ts, kind, source_text, payload, applied, postgres_id
--     FROM extractions ORDER BY ts DESC;                -- the star of the show
--   SELECT * FROM mentions ORDER BY mentions DESC;      -- running name counts


-- ── Every turn, both speakers, with the embedding on the row ─────────
CREATE TABLE IF NOT EXISTS utterances
(
    family_id   String,
    session_id  String,
    ts          DateTime64(3),
    speaker     Enum8('elder' = 1, 'avatar' = 2),
    text        String,
    embedding   Array(Float32),
    entities    Array(String),
    topics      Array(String),
    distress    UInt8 DEFAULT 0,
    is_repeat   UInt8 DEFAULT 0
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(ts)
ORDER BY (family_id, ts);

-- Optional once the table is large. all-MiniLM-L6-v2 is 384-dimensional.
-- ALTER TABLE utterances ADD INDEX emb_idx embedding TYPE vector_similarity('hnsw', 'cosineDistance', 384);


-- ── The daily summary, kept ─────────────────────────────────────────
-- Generated at the end of a conversation and when Ruby taps "write today up".
CREATE TABLE IF NOT EXISTS conversation_summaries
(
    family_id   String,
    session_id  String,
    on_date     Date,
    summary     String,
    mood        String DEFAULT '',
    turn_count  UInt32 DEFAULT 0,
    trigger     String DEFAULT 'manual',   -- manual | conversation_end
    created_at  DateTime64(3) DEFAULT now64(3)
)
ENGINE = MergeTree
ORDER BY (family_id, created_at);


-- ── The extraction audit log ────────────────────────────────────────
-- One row every time the pipeline pulls a structured fact out of something
-- she said. `applied` and `postgres_id` record whether it made it into the
-- curated store and where. This is the table that shows both databases
-- working together.
CREATE TABLE IF NOT EXISTS extractions
(
    family_id    String,
    ts           DateTime64(3) DEFAULT now64(3),
    session_id   String,
    kind         String,        -- medicine | reminder | memory | note | person | medicine_taken
    payload      String,        -- JSON: the structured fields written to Postgres
    source_text  String,        -- her actual words that triggered it
    confidence   Float32 DEFAULT 0,
    applied      UInt8 DEFAULT 0,
    postgres_id  String DEFAULT '',
    note         String DEFAULT ''      -- e.g. "skipped: already known"
)
ENGINE = MergeTree
ORDER BY (family_id, ts);


-- ── How often she repeats herself, by day ───────────────────────────
CREATE TABLE IF NOT EXISTS daily_stats
(
    family_id   String,
    day         Date,
    said        UInt64,
    repeats     UInt64,
    distress    Float64
)
ENGINE = SummingMergeTree
ORDER BY (family_id, day);

CREATE MATERIALIZED VIEW IF NOT EXISTS daily_stats_mv TO daily_stats AS
SELECT
    family_id,
    toDate(ts)      AS day,
    count()         AS said,
    sum(is_repeat)  AS repeats,
    avg(distress)   AS distress
FROM utterances
WHERE speaker = 'elder'
GROUP BY family_id, day;


-- ── When in her day she sounds unsettled ────────────────────────────
CREATE TABLE IF NOT EXISTS distress_by_hour
(
    family_id     String,
    hour          UInt8,
    distress_avg  AggregateFunction(avg, UInt8)
)
ENGINE = AggregatingMergeTree
ORDER BY (family_id, hour);

CREATE MATERIALIZED VIEW IF NOT EXISTS distress_by_hour_mv TO distress_by_hour AS
SELECT
    family_id,
    toHour(ts)          AS hour,
    avgState(distress)  AS distress_avg
FROM utterances
WHERE speaker = 'elder'
GROUP BY family_id, hour;


-- ── Every name she has ever used, with a running count ──────────────
CREATE TABLE IF NOT EXISTS mentions
(
    family_id   String,
    name        String,
    mentions    UInt64,
    first_heard SimpleAggregateFunction(min, DateTime64(3)),
    last_heard  SimpleAggregateFunction(max, DateTime64(3))
)
ENGINE = AggregatingMergeTree
ORDER BY (family_id, name);

CREATE MATERIALIZED VIEW IF NOT EXISTS mentions_mv TO mentions AS
SELECT
    family_id,
    arrayJoin(entities) AS name,
    count()             AS mentions,
    min(ts)             AS first_heard,
    max(ts)             AS last_heard
FROM utterances
WHERE speaker = 'elder'
GROUP BY family_id, name;
