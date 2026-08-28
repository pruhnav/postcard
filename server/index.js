require('dotenv').config({ path: '.env.local' })

const express = require('express')
const cors = require('cors')
const { randomUUID } = require('crypto')

const db = require('./db')
const ch = require('./ch')
const llm = require('./llm')
const tavus = require('./tavus')
const { buildSystem, ANALYSE } = require('./persona')

const app = express()
app.use(cors())
app.use(express.json({ limit: '8mb' }))

const PORT = process.env.PORT || 3001

// Live sessions, keyed by family. Lost on restart, which is fine: the
// transcript is already in ClickHouse and the context is already in Postgres.
const sessions = new Map()

const fid = async (req) =>
  req.query.family_id && req.query.family_id !== 'demo'
    ? req.query.family_id
    : req.body?.family_id && req.body.family_id !== 'demo'
      ? req.body.family_id
      : (await db.firstFamily())?.id

const fail = (res) => (e) => {
  console.error(e)
  res.status(500).json({ error: e.message })
}

// ─── Context that Ruby owns ──────────────────────────────────────────

app.get('/api/family', async (req, res) => {
  try {
    const f = await db.family(await fid(req))
    res.json(f ? { ...f, parent_name: f.elder_name, timezone: f.elder_tz } : {})
  } catch (e) { fail(res)(e) }
})

app.get('/api/context', async (req, res) => {
  try {
    const id = await fid(req)
    const [family, relations, memories, medicines, updates] = await Promise.all([
      db.family(id), db.relations(id), db.memories(id), db.medicines(id), db.latestUpdates(id, 3650),
    ])
    res.json({ family, relations, memories, medicines, updates })
  } catch (e) { fail(res)(e) }
})

app.post('/api/relations', async (req, res) => {
  try {
    const id = await fid(req)
    const { name, context } = req.body
    await db.addRelation(id, name, context)
    await db.answerGap(id, name, context)
    res.json({ ok: true })
  } catch (e) { fail(res)(e) }
})

app.post('/api/memories', async (req, res) => {
  try {
    const id = await fid(req)
    const { title, body } = req.body
    await db.q('insert into memories (family_id, title, body) values ($1,$2,$3)', [id, title, body])
    res.json({ ok: true })
  } catch (e) { fail(res)(e) }
})

app.post('/api/updates', async (req, res) => {
  try {
    const id = await fid(req)
    await db.q('insert into updates (family_id, body) values ($1,$2)', [id, req.body.body])
    res.json({ ok: true })
  } catch (e) { fail(res)(e) }
})

app.post('/api/medicines', async (req, res) => {
  try {
    const id = await fid(req)
    const { name, dose, schedule_time } = req.body
    await db.q(
      'insert into medicines (family_id, name, dose, schedule_time) values ($1,$2,$3,$4)',
      [id, name, dose, schedule_time])
    res.json({ ok: true })
  } catch (e) { fail(res)(e) }
})

// ─── The conversation ────────────────────────────────────────────────

app.post('/api/tavus', async (req, res) => {
  try {
    const id = await fid(req)
    const family = await db.family(id)
    if (!family) return res.status(404).json({ error: 'No family set up yet. Run schema.sql and open /setup.' })

    const greeting = `Amama! It's ${family.speaker_name}. I've been waiting to talk to you.`
    const conv = await tavus.createConversation({ family, greeting })

    sessions.set(id, { conversation_id: conv.conversation_id, session_id: randomUUID() })
    res.json({ conversation_url: conv.conversation_url, conversation_id: conv.conversation_id })
  } catch (e) {
    console.error(e)
    res.status(502).json({ error: e.message })
  }
})

// Tavus calls this as its model. Every turn passes through here, which is
// the only reason retrieval can influence what she actually hears.
app.post('/api/llm/chat/completions', async (req, res) => {
  const started = Date.now()
  try {
    const id = await fid(req) || (await db.firstFamily())?.id
    const messages = req.body.messages || []
    const spoken = [...messages].reverse().find(m => m.role === 'user')?.content || ''

    const [family, relations, memories, updates] = await Promise.all([
      db.family(id), db.relations(id), db.memories(id), db.latestUpdates(id),
    ])

    const embedding = await llm.embed(spoken)
    const recalled = embedding.length ? await ch.recall(id, embedding, 8) : []

    const system = buildSystem({ family, relations, memories, updates, recalled })
    const reply = await llm.chat(messages.filter(m => m.role !== 'system'), { system, max_tokens: 220 })

    res.json({
      id: `chatcmpl-${randomUUID()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: llm.MODEL,
      choices: [{ index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' }],
      usage: {},
    })

    ingest(id, spoken, reply, embedding).catch(console.error)
    console.log(`turn in ${Date.now() - started}ms`)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e.message })
  }
})

// Secondary transcript source. Useful when Tavus speaks without asking us,
// for example the greeting or an echoed reminder.
app.post('/api/tavus/webhook', async (req, res) => {
  res.json({ ok: true })
  try {
    const e = req.body || {}
    const text = e.properties?.text || e.properties?.transcript
    if (!text) return
    const id = (await db.firstFamily())?.id
    const speaker = e.properties?.role === 'user' ? 'elder' : 'avatar'
    const embedding = await llm.embed(text)
    await write(id, speaker, text, embedding, {})
  } catch (err) { console.error(err) }
})

// ─── Everything that happens after she speaks ────────────────────────

async function ingest(family_id, spoken, reply, embedding) {
  const relations = await db.relations(family_id)
  const known = relations.flatMap(r => [r.name, ...(r.aliases || [])])

  const [analysis, isRepeat, replyEmbedding] = await Promise.all([
    llm.json(ANALYSE(spoken, known), { names: [], topics: [], distress: 0 }),
    embedding.length ? ch.isRepeat(family_id, embedding) : 0,
    llm.embed(reply),
  ])

  const names = (analysis.names || []).filter(n => n && !known.includes(n))

  await write(family_id, 'elder', spoken, embedding, {
    entities: names.concat(analysis.about_late_husband ? ['(late husband)'] : []),
    topics: analysis.topics || [],
    distress: Math.min(10, Number(analysis.distress) || 0),
    is_repeat: isRepeat,
  })
  await write(family_id, 'avatar', reply, replyEmbedding, {})

  // Anything she brought up that nobody has explained. Batched into the
  // daily digest rather than pinged one at a time.
  for (const name of names) {
    await db.logGap(family_id, name, 'person', 'routine')
  }
  if (analysis.about_late_husband && Number(analysis.distress) >= 6) {
    await db.logGap(family_id, `${new Date().toISOString().slice(0, 10)}: she sounded unsettled talking about him`, 'moment', 'high')
  }

  // Did she answer a medicine reminder from the last hour and a half?
  if (analysis.medicine) {
    const open = await db.openMedicineLog(family_id)
    for (const row of open) await db.confirmMedicine(row.id, analysis.medicine === 'took')
  }
}

async function write(family_id, speaker, text, embedding, extra) {
  const s = sessions.get(family_id)
  await ch.insert([{
    family_id,
    session_id: s?.session_id || 'out-of-session',
    ts: new Date().toISOString().replace('T', ' ').replace('Z', ''),
    speaker,
    text,
    embedding: embedding || [],
    entities: extra.entities || [],
    topics: extra.topics || [],
    distress: extra.distress || 0,
    is_repeat: extra.is_repeat || 0,
  }])
}

// ─── Reminders ───────────────────────────────────────────────────────

// Medicines become reminders for today, once each morning.
async function ensureTodaysReminders(family_id) {
  const meds = await db.medicines(family_id)
  for (const m of meds) {
    await db.q(
      `insert into reminders (family_id, kind, text, schedule_time, on_date)
       select $1, 'medicine', $2, $3, current_date
       where not exists (
         select 1 from reminders
         where family_id = $1 and kind = 'medicine' and text = $2 and on_date = current_date)`,
      [family_id, `Time for your ${m.name}${m.dose ? `, ${m.dose}` : ''}`, m.schedule_time])
  }
}

// Every 30 seconds: anything due gets spoken by the avatar if she is on the
// call, and logged either way.
setInterval(async () => {
  try {
    const family = await db.firstFamily()
    if (!family) return
    await ensureTodaysReminders(family.id)

    const due = await db.pendingReminders(family.id)
    const s = sessions.get(family.id)

    for (const r of due) {
      if (s?.conversation_id) await tavus.speak(s.conversation_id, r.text)
      await db.markSpoken(r.id)

      if (r.kind === 'medicine') {
        await db.q(
          `insert into medicine_log (family_id, medicine_id, on_date, scheduled_at)
           select $1, m.id, current_date, now() from medicines m
           where m.family_id = $1 and $2 like '%' || m.name || '%'
           on conflict do nothing`, [family.id, r.text])
      }
    }
  } catch (e) { console.error('reminder sweep:', e.message) }
}, 30000)

app.get('/api/reminders/due', async (req, res) => {
  try { res.json(await db.dueReminders(await fid(req))) } catch (e) { fail(res)(e) }
})

app.post('/api/reminders/:id/acknowledge', async (req, res) => {
  try { await db.acknowledge(req.params.id); res.json({ ok: true }) } catch (e) { fail(res)(e) }
})

app.post('/api/reminders', async (req, res) => {
  try {
    const id = await fid(req)
    const { text, schedule_time } = req.body
    await db.q(
      `insert into reminders (family_id, kind, text, schedule_time, on_date)
       values ($1,'reminder',$2,$3,current_date)`, [id, text, schedule_time])
    res.json({ ok: true })
  } catch (e) { fail(res)(e) }
})

// ─── The console ─────────────────────────────────────────────────────

app.post('/api/frame', async (req, res) => {
  try { await db.saveFrame(await fid(req), req.body.image); res.json({ ok: true }) } catch (e) { fail(res)(e) }
})

app.get('/api/frame', async (req, res) => {
  try { res.json((await db.frame(await fid(req))) || {}) } catch (e) { fail(res)(e) }
})

app.get('/api/medication', async (req, res) => {
  try { res.json(await db.medicineToday(await fid(req))) } catch (e) { fail(res)(e) }
})

app.get('/api/trends', async (req, res) => {
  try {
    const id = await fid(req)
    const t = await ch.trends(id)
    const meds = await db.q(
      `select count(*) filter (where confirmed) as yes, count(*) as total
       from medicine_log where family_id = $1 and on_date > current_date - 30`, [id])
    const { yes = 0, total = 0 } = meds[0] || {}
    res.json({
      ...t,
      adherence_pct: Number(total) ? Math.round((Number(yes) / Number(total)) * 100) : 0,
      adherence_days: Number(total),
    })
  } catch (e) { fail(res)(e) }
})

app.get('/api/unknown-people', async (req, res) => {
  try {
    const id = await fid(req)
    const [relations, open] = await Promise.all([db.relations(id), db.openGaps(id)])
    const known = relations.flatMap(r => [r.name, ...(r.aliases || [])])
    res.json(await ch.unknownNames(id, known, open))
  } catch (e) { fail(res)(e) }
})

app.post('/api/summary', async (req, res) => {
  try {
    const id = await fid(req)
    const [family, said, meds, gaps] = await Promise.all([
      db.family(id), ch.saidToday(id), db.medicineToday(id), db.openGaps(id),
    ])
    if (!said.length) return res.json({ summary: 'She has not opened her screen yet today.' })

    const summary = await llm.chat([{
      role: 'user',
      content: `Write three or four plain sentences for ${family.speaker_name} about her grandmother's day.
No greeting, no sign-off, no reassurance she did not ask for. Say what was actually talked about,
what mood came through, and flag anything worth a call. Medicines today: ${JSON.stringify(meds)}.
Names nobody has explained yet: ${JSON.stringify(gaps.map(g => g.name))}.
Transcript: ${JSON.stringify(said.slice(-60).map(s => `${s.speaker}: ${s.text}`))}`,
    }], { temperature: 0.4, max_tokens: 300 })

    res.json({ summary })
  } catch (e) { fail(res)(e) }
})

// The six-day loop, batched. One digest, not a ping per gap.
app.get('/api/digest', async (req, res) => {
  try {
    const id = await fid(req)
    const [gaps, meds] = await Promise.all([db.openGaps(id), db.medicineToday(id)])
    res.json({
      date: new Date().toISOString().slice(0, 10),
      high_priority: gaps.filter(g => g.priority === 'high'),
      questions: gaps.filter(g => g.priority !== 'high'),
      medicines: meds,
    })
  } catch (e) { fail(res)(e) }
})

app.get('/api/health', async (_req, res) => {
  const out = { postgres: false, clickhouse: false }
  try { await db.q('select 1'); out.postgres = true } catch {}
  try { await ch.rows('SELECT 1'); out.clickhouse = true } catch {}
  res.status(out.postgres && out.clickhouse ? 200 : 503).json(out)
})

app.listen(PORT, () => console.log(`server on :${PORT}`))
