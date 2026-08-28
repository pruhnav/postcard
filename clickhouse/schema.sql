-- ClickHouse. One append-only stream, plus aggregates over it.
-- Nothing here is ever updated. If a fact needs editing it belongs in Postgres.

CREATE TABLE IF NOT EXISTS utterances
(
    family_id   UUID,
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

-- Optional once the table is large. Not needed at demo scale, and adding it
-- later is a single ALTER, so leave it out until the row count justifies it.
-- ALTER TABLE utterances ADD INDEX emb_idx embedding TYPE vector_similarity('hnsw', 'cosineDistance', 1536);


-- ── How often she repeats herself, by day ────────────────────────────
CREATE TABLE IF NOT EXISTS daily_stats
(
    family_id   UUID,
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
    toDate(ts)                      AS day,
    count()                         AS said,
    sum(is_repeat)                  AS repeats,
    avg(distress)                   AS distress
FROM utterances
WHERE speaker = 'elder'
GROUP BY family_id, day;


-- ── When in her day she sounds unsettled ─────────────────────────────
CREATE TABLE IF NOT EXISTS distress_by_hour
(
    family_id     UUID,
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


-- ── Every name she has ever used, with a running count ───────────────
-- The count is what makes the unknown-person queue worth reading. One
-- mention is noise. Nine in five days is something the family should know.
CREATE TABLE IF NOT EXISTS mentions
(
    family_id   UUID,
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
