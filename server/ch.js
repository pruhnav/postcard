const { createClient } = require('@clickhouse/client')

const client = createClient({
  url: process.env.CLICKHOUSE_URL,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
})

const rows = async (query, query_params = {}) => {
  const rs = await client.query({ query, query_params, format: 'JSONEachRow' })
  return rs.json()
}

const insert = (values) =>
  client.insert({ table: 'utterances', values, format: 'JSONEachRow' })

// Everything she has ever said, searched by meaning rather than recency.
// This is what replaces the twenty-message window the original build used.
const recall = async (family_id, embedding, limit = 8) =>
  rows(
    `SELECT text, speaker, ts,
            cosineDistance(embedding, {emb:Array(Float32)}) AS d
     FROM utterances
     WHERE family_id = {fid:UUID} AND length(embedding) > 0
     ORDER BY d ASC
     LIMIT {lim:UInt8}`,
    { emb: embedding, fid: family_id, lim: limit }
  )

// Has she already said something close to this today? The avatar never
// tells her she is repeating herself. It just answers again, warmly.
// The count is for Ruby, on the console.
const isRepeat = async (family_id, embedding) => {
  const r = await rows(
    `SELECT count() AS n
     FROM utterances
     WHERE family_id = {fid:UUID}
       AND speaker = 'elder'
       AND ts >= today()
       AND length(embedding) > 0
       AND cosineDistance(embedding, {emb:Array(Float32)}) < 0.18`,
    { fid: family_id, emb: embedding }
  )
  return Number(r[0]?.n || 0) > 0 ? 1 : 0
}

const saidToday = (family_id) =>
  rows(
    `SELECT speaker, text, ts FROM utterances
     WHERE family_id = {fid:UUID} AND ts >= today()
     ORDER BY ts`,
    { fid: family_id }
  )

const trends = async (family_id) => {
  const [today] = await rows(
    `SELECT sum(repeats) AS repeats FROM daily_stats
     WHERE family_id = {fid:UUID} AND day = today()`,
    { fid: family_id }
  )
  const [avg] = await rows(
    `SELECT round(avg(repeats), 1) AS repeats, count() AS days FROM daily_stats
     WHERE family_id = {fid:UUID} AND day < today() AND day >= today() - 30`,
    { fid: family_id }
  )
  const hours = await rows(
    `SELECT hour, round(avgMerge(distress_avg) / 10, 3) AS v
     FROM distress_by_hour WHERE family_id = {fid:UUID}
     GROUP BY hour ORDER BY hour`,
    { fid: family_id }
  )

  const byHour = new Array(24).fill(0)
  hours.forEach(h => { byHour[Number(h.hour)] = Math.min(1, Number(h.v) || 0) })

  return {
    repeats_today: Number(today?.repeats || 0),
    repeats_avg: Number(avg?.repeats || 0),
    history_days: Number(avg?.days || 0),
    distress_by_hour: byHour,
  }
}

// Names she uses that nobody has explained yet, with the count and a
// couple of her own lines around each one.
const unknownNames = async (family_id, known, open) => {
  const list = await rows(
    `SELECT name, sum(mentions) AS mentions, min(first_heard) AS first_heard
     FROM mentions
     WHERE family_id = {fid:UUID} AND name NOT IN ({known:Array(String)})
     GROUP BY name
     HAVING mentions >= 1
     ORDER BY mentions DESC
     LIMIT 6`,
    { fid: family_id, known: known.length ? known : ['\u0000'] }
  )

  const out = []
  for (const m of list) {
    const quotes = await rows(
      `SELECT text FROM utterances
       WHERE family_id = {fid:UUID} AND speaker = 'elder' AND has(entities, {n:String})
       ORDER BY ts DESC LIMIT 3`,
      { fid: family_id, n: m.name }
    )
    const gap = open.find(g => g.name === m.name)
    out.push({
      name: m.name,
      mentions: Number(m.mentions),
      priority: gap?.priority || 'routine',
      first_heard: ago(m.first_heard),
      quotes: quotes.map(q => q.text),
    })
  }
  return out
}

function ago(ts) {
  const days = Math.floor((Date.now() - new Date(ts + 'Z').getTime()) / 86400000)
  if (Number.isNaN(days)) return ''
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

module.exports = { client, rows, insert, recall, isRepeat, saidToday, trends, unknownNames }
