require('dotenv').config({ path: '.env.local' })
require('dotenv').config({ path: '.env' })

const express = require('express')
const cors = require('cors')
const { randomUUID } = require('crypto')

const db = require('./db')
const ch = require('./ch')
const llm = require('./llm')
const tavus = require('./tavus')
const extract = require('./extract')
const { APP_TZ, stamp, today } = require('./localtime')
const { buildSystem } = require('./persona')
const { makeServer } = require('../mcp/tools')
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js')

const app = express()
app.use(cors())
app.use(express.json({ limit: '8mb' }))

const PORT = process.env.PORT || 3001

// Live sessions, keyed by family. Lost on restart, which is fine: the
// transcript is already in ClickHouse and the context is already in Postgres.
// `turns` is a short rolling window the extraction pipeline reads for context.
const sessions = new Map()
const sessionOf = (id) => {
  if (!sessions.has(id)) sessions.set(id, { session_id: randomUUID(), turns: [] })
  return sessions.get(id)
}

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

// ─── First-run family, from .env ─────────────────────────────────────

async function ensureFamily() {
  if (await db.firstFamily()) return
  if (!process.env.FAMILY_ELDER_NAME || !process.env.FAMILY_SPEAKER_NAME) {
    console.warn('no family row and FAMILY_ELDER_NAME / FAMILY_SPEAKER_NAME not set — open /setup or fill .env')
    return
  }
  const id = await db.createFamily({
    elder_name: process.env.FAMILY_ELDER_NAME,
    speaker_name: process.env.FAMILY_SPEAKER_NAME,
    elder_city: process.env.FAMILY_ELDER_CITY,
    elder_tz: process.env.FAMILY_ELDER_TZ || APP_TZ,
    speaker_tz: process.env.FAMILY_SPEAKER_TZ,
  })
  console.log(`created family ${id} for ${process.env.FAMILY_ELDER_NAME}`)
}

// ─── Context that Ruby owns ──────────────────────────────────────────

app.get('/api/family', async (req, res) => {
  try {
    const f = await db.family(await fid(req))
    res.json(f ? { ...f, parent_name: f.elder_name, timezone: f.elder_tz } : {})
  } catch (e) { fail(res)(e) }
})

app.post('/api/family', async (req, res) => {
  try {
    const { elder_name, speaker_name, elder_city, elder_tz, speaker_tz } = req.body
    const existing = await db.firstFamily()
    if (existing) {
      await db.patchFamily(existing.id, { elder_name, speaker_name, elder_city, elder_tz, speaker_tz })
      return res.json({ id: existing.id, updated: true })
    }
    if (!elder_name || !speaker_name) {
      return res.status(400).json({ error: 'elder_name and speaker_name are required' })
    }
    const id = await db.createFamily({ elder_name, speaker_name, elder_city, elder_tz, speaker_tz })
    res.json({ id, created: true })
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
    const { name, context, relation, deceased, aliases } = req.body
    await db.addRelation(id, name, context, { relation, deceased, aliases })
    await db.answerGap(id, name, context)
    res.json({ ok: true })
  } catch (e) { fail(res)(e) }
})

app.post('/api/memories', async (req, res) => {
  try {
    const id = await fid(req)
    const { title, body } = req.body
    await db.addMemory(id, title, body)
    res.json({ ok: true })
  } catch (e) { fail(res)(e) }
})

app.post('/api/updates', async (req, res) => {
  try {
    const id = await fid(req)
    await db.addUpdate(id, req.body.body, { kind: req.body.kind })
    res.json({ ok: true })
  } catch (e) { fail(res)(e) }
})

app.post('/api/medicines', async (req, res) => {
  try {
    const id = await fid(req)
    const { name, dose, schedule_time } = req.body
    await db.addMedicine(id, name, dose, schedule_time)
    res.json({ ok: true })
  } catch (e) { fail(res)(e) }
})

// ─── Verify an auto-extracted fact (Ruby, via the LibreChat agent or curl) ──

app.get('/api/pending', async (req, res) => {
  try { res.json(await db.pendingVerification(await fid(req))) } catch (e) { fail(res)(e) }
})

app.post('/api/verify', async (req, res) => {
  try {
    const id = await fid(req)
    const { table, id: rowId } = req.body
    await db.verifyFact(id, table, rowId)
    res.json({ ok: true })
  } catch (e) { fail(res)(e) }
})

app.get('/api/extractions', async (req, res) => {
  try { res.json(await ch.recentExtractions(await fid(req), Number(req.query.limit) || 40)) }
  catch (e) { fail(res)(e) }
})

// ─── The conversation ────────────────────────────────────────────────

app.post('/api/tavus', async (req, res) => {
  try {
    const id = await fid(req)
    const family = await db.family(id)
    if (!family) return res.status(404).json({ error: 'No family yet. Fill .env or open /setup.' })

    const greeting = `${family.elder_name}! It's ${family.speaker_name}. I've been waiting to talk to you.`
    const conv = await tavus.createConversation({ family, greeting })

    const s = sessionOf(id)
    s.conversation_id = conv.conversation_id
    s.session_id = randomUUID()
    s.turns = []
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
  const wantStream = !!req.body.stream
  try {
    const id = await fid(req) || (await db.firstFamily())?.id
    const messages = req.body.messages || []
    // Tavus wraps the transcript with <user_audio_analysis>…</user_audio_analysis>
    // and similar tags. The model should see them; our stored transcript,
    // embeddings and extraction should not.
    const rawSpoken = [...messages].reverse().find(m => m.role === 'user')?.content || ''
    const spoken = rawSpoken
      .replace(/<user_audio_analysis>[\s\S]*?<\/user_audio_analysis>/gi, '')
      .replace(/<[^>]+>/g, '')
      .trim()

    const [family, relations, memories, updates] = await Promise.all([
      db.family(id), db.relations(id), db.memories(id), db.latestUpdates(id),
    ])

    const embedding = await llm.embed(spoken)
    const recalled = embedding.length ? await ch.recall(id, embedding, 8) : []
    const system = buildSystem({ family, relations, memories, updates, recalled })
    const convo = messages.filter(m => m.role !== 'system')

    // ── Streaming path (Tavus) ──
    if (wantStream) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })
      const cid = `chatcmpl-${randomUUID()}`
      const chunk = (delta, finish = null) => res.write(`data: ${JSON.stringify({
        id: cid, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000),
        model: llm.MODEL, choices: [{ index: 0, delta, finish_reason: finish }],
      })}\n\n`)

      chunk({ role: 'assistant' })
      let full = ''
      try {
        for await (const d of llm.chatStream(convo, { system, max_tokens: 220 })) {
          full += d
          chunk({ content: d })
        }
      } catch (e) {
        console.error('stream upstream:', e.message)
      }
      if (!full.trim()) { full = 'Amama, say that again for me — I want to hear you properly.'; chunk({ content: full }) }
      chunk({}, 'stop')
      res.write('data: [DONE]\n\n')
      res.end()

      ingest(id, spoken, full, embedding).catch(console.error)
      console.log(`turn (stream) in ${Date.now() - started}ms`)
      return
    }

    // ── Non-streaming path (curl / our own tests) ──
    const reply = await llm.chat(convo, { system, max_tokens: 220 })
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
    if (res.headersSent) res.end()
    else res.status(500).json({ error: e.message })
  }
})

// Tavus posts conversation events here (transcript lines, and the end of the
// call). We use the end to write a summary.
app.post('/api/tavus/webhook', async (req, res) => {
  res.json({ ok: true })
  try {
    const e = req.body || {}
    const type = e.event_type || e.message_type || ''
    const id = (await db.firstFamily())?.id
    if (!id) return

    if (/ended|shutdown/i.test(type)) {
      await generateSummary(id, 'conversation_end').catch(console.error)
      return
    }

    const text = e.properties?.text || e.properties?.transcript
    if (!text) return
    const speaker = e.properties?.role === 'user' || e.properties?.speaker === 'user' ? 'elder' : 'avatar'
    const embedding = await llm.embed(text)
    await write(id, speaker, text, embedding, {})
  } catch (err) { console.error(err) }
})

// ─── Everything that happens after she speaks ────────────────────────

async function ingest(family_id, spoken, reply, embedding) {
  const s = sessionOf(family_id)
  s.turns.push({ speaker: 'elder', text: spoken }, { speaker: 'avatar', text: reply })
  s.turns = s.turns.slice(-12)

  const [relations, meds] = await Promise.all([db.relations(family_id), db.medicines(family_id)])
  const knownPeople = relations.flatMap(r => [r.name, ...(r.aliases || [])])
  const knownMeds = meds.map(m => m.name)

  const [analysis, isRepeat, replyEmbedding] = await Promise.all([
    extract.analyse(s.turns, knownPeople, knownMeds),
    embedding.length ? ch.isRepeat(family_id, embedding) : 0,
    llm.embed(reply),
  ])

  const knownLower = new Set(knownPeople.map(k => k.toLowerCase()))
  const newNames = (analysis.people || [])
    .map(p => p.name).filter(n => extract.isNewName(n, knownLower))

  await write(family_id, 'elder', spoken, embedding, {
    entities: newNames.concat(analysis.about_late_husband ? ['(late husband)'] : []),
    topics: analysis.topics || [],
    distress: Math.min(10, Number(analysis.distress) || 0),
    is_repeat: isRepeat,
  })
  await write(family_id, 'avatar', reply, replyEmbedding, {})

  // Fan the extraction out into Postgres + the ClickHouse audit log.
  const applied = await extract.apply(family_id, s.session_id, analysis)
  if (applied.length) console.log(`  extracted: ${applied.join(' · ')}`)
}

const strArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]).map(String)

async function write(family_id, speaker, text, embedding, extra) {
  const s = sessions.get(family_id)
  await ch.insert([{
    family_id,
    session_id: String(s?.session_id || 'out-of-session'),
    ts: stamp(),
    speaker,
    text: String(text == null ? '' : text),
    embedding: Array.isArray(embedding) ? embedding : [],
    entities: strArray(extra.entities),
    topics: strArray(extra.topics),
    distress: Math.max(0, Math.min(10, Math.round(Number(extra.distress) || 0))),
    is_repeat: extra.is_repeat ? 1 : 0,
  }])
}

// ─── The daily summary — generated and kept ──────────────────────────

async function generateSummary(family_id, trigger = 'manual') {
  const [family, said, meds, gaps] = await Promise.all([
    db.family(family_id), ch.saidToday(family_id), db.medicineToday(family_id), db.openGaps(family_id),
  ])
  if (!said.length) return { summary: 'She has not opened her screen yet today.', stored: false }

  const summary = await llm.chat([{
    role: 'user',
    content: `You are briefing ${family.speaker_name} about her grandmother ${family.elder_name}'s day.
Write 3-4 plain sentences in the third person ("She talked about…", "${family.elder_name} mentioned…").
NOT addressed to the grandmother. No greeting, no sign-off, no reassurance.

Use ONLY what appears in the transcript below. Do not add, embellish, or infer any
detail that is not literally there. If little was said, the briefing is short.
Say what was actually discussed, the mood that came through, and flag anything
worth a phone call.

Medicines today: ${JSON.stringify(meds)}
Names nobody has explained yet: ${JSON.stringify(gaps.map(g => g.name))}
Transcript:
${said.slice(-60).map(s => `${s.speaker === 'elder' ? family.elder_name : family.speaker_name}: ${s.text}`).join('\n')}`,
  }], { temperature: 0.3, max_tokens: 300 })

  const elderLines = said.filter(s => s.speaker === 'elder')
  const mood = await llm.chat([{
    role: 'user',
    content: `In two or three words, her overall mood from these lines: ${JSON.stringify(elderLines.slice(-30).map(s => s.text))}`,
  }], { temperature: 0, max_tokens: 12 }).catch(() => '')

  await ch.insertInto('conversation_summaries', [{
    family_id,
    session_id: sessions.get(family_id)?.session_id || 'out-of-session',
    on_date: today(),
    summary,
    mood: (mood || '').trim().slice(0, 60),
    turn_count: said.length,
    trigger,
    created_at: stamp(),
  }])

  return { summary, mood, stored: true }
}

// ─── Reminders ───────────────────────────────────────────────────────

async function ensureTodaysReminders(family_id) {
  const meds = await db.medicines(family_id)
  for (const m of meds) {
    const text = `Time for your ${m.name}${m.dose ? `, ${m.dose}` : ''}`
    await db.ensureReminder(family_id, 'medicine', text, m.schedule_time)
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
      if (r.kind === 'medicine') await db.openDailyMedicineLog(family.id, r.text).catch(() => {})
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
    await db.addReminder(id, text, schedule_time)
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

app.get('/api/transcript', async (req, res) => {
  try {
    const said = await ch.saidToday(await fid(req))
    res.json(said.map(s => ({ speaker: s.speaker, text: s.text, ts: s.ts })))
  } catch (e) { fail(res)(e) }
})

app.get('/api/medication', async (req, res) => {
  try { res.json(await db.medicineToday(await fid(req))) } catch (e) { fail(res)(e) }
})

app.get('/api/trends', async (req, res) => {
  try {
    const id = await fid(req)
    const t = await ch.trends(id)
    const { yes = 0, total = 0 } = (await db.adherence(id)) || {}
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
    const { summary } = await generateSummary(id, 'manual')
    res.json({ summary })
  } catch (e) { fail(res)(e) }
})

app.get('/api/summaries', async (req, res) => {
  try { res.json(await ch.recentSummaries(await fid(req), Number(req.query.limit) || 7)) }
  catch (e) { fail(res)(e) }
})

// The six-day loop, batched. One digest, not a ping per gap.
app.get('/api/digest', async (req, res) => {
  try {
    const id = await fid(req)
    const [gaps, meds, pending] = await Promise.all([
      db.openGaps(id), db.medicineToday(id), db.pendingVerification(id),
    ])
    res.json({
      date: today(),
      high_priority: gaps.filter(g => g.priority === 'high'),
      questions: gaps.filter(g => g.priority !== 'high'),
      medicines: meds,
      to_confirm: pending,
    })
  } catch (e) { fail(res)(e) }
})

app.get('/api/health', async (_req, res) => {
  const out = { postgres: false, clickhouse: false }
  try { await db.ping(); out.postgres = true } catch {}
  try { await ch.rows('SELECT 1'); out.clickhouse = true } catch {}
  res.status(out.postgres && out.clickhouse ? 200 : 503).json(out)
})

// ─── MCP over HTTP, for LibreChat ────────────────────────────────────
// Stateless: a fresh server + transport per request. LibreChat connects to
// http://<host>:3001/mcp and gets the same tools as `npm run mcp` (stdio).

async function handleMcp(req, res) {
  const server = makeServer()
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  res.on('close', () => { transport.close(); server.close() })
  try {
    await server.connect(transport)
    await transport.handleRequest(req, res, req.body)
  } catch (e) {
    console.error('mcp:', e.message)
    if (!res.headersSent) res.status(500).json({ error: e.message })
  }
}
app.post('/mcp', handleMcp)
app.get('/mcp', (_req, res) => res.status(405).json({ error: 'POST only in stateless mode' }))

ensureFamily()
  .catch(e => console.error('ensureFamily:', e.message))
  .finally(() => app.listen(PORT, () => console.log(`server on :${PORT} (tz ${APP_TZ})`)))
