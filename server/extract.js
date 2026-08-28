const db = require('./db')
const ch = require('./ch')
const llm = require('./llm')
const { today, stamp } = require('./localtime')

// After the grandmother speaks, this pulls structured facts out of what she
// actually said — never inferred, never invented — and does two things with
// each one:
//
//   1. writes an audit row to ClickHouse `extractions` (judges watch this)
//   2. upserts it into the Postgres curated store as source='conversation',
//      unverified=true, so the avatar uses it but Ruby can still confirm it
//
// The two together are the point of the architecture: the conversation side
// (ClickHouse) teaching the curated side (Postgres), on the record.

const SCHEMA = {
  medicines: [], reminders: [], memories: [], notes: [], people: [],
  medicine_taken: null, distress: 0, about_late_husband: false, topics: [],
}

// Endearments, address terms, and bare relationship words — never a "person".
const NOT_NAMES = new Set([
  // endearments / address
  'kanna', 'kanne', 'ma', 'maa', 'da', 'di', 'chellam', 'raja', 'rani', 'ponnu',
  'thangam', 'kutty', 'kutti', 'dear', 'child', 'beta', 'beti', 'kiddo', 'love',
  // relationship words (not names)
  'amma', 'appa', 'anna', 'akka', 'thambi', 'paati', 'thatha', 'mama', 'chithi',
  'periamma', 'amama', 'grandfather', 'grandpa', 'granddad', 'grandmother',
  'grandma', 'granny', 'husband', 'wife', 'father', 'mother', 'brother', 'sister',
  'son', 'daughter', 'uncle', 'aunt', 'aunty', 'auntie', 'cousin', 'neighbour',
  'neighbor', 'doctor',
])

// Only the last few turns. The model must extract from the FINAL elder line;
// earlier lines are there so "call him on Tuesday" can resolve "him".
const CONTEXT_TURNS = 3

// Words that mean a symptom, not a medicine name — guards against the model
// filing "my knee has been aching" as a medicine.
const SYMPTOM_WORDS = /\b(ache|aching|ached|pain|painful|hurt|hurts|sore|swollen|stiff|dizzy|tired|weak|cough|cold|fever|nausea|knee|back|hip|chest|stomach|head)\b/i

const WORD_TIME = { morning: '08:00', noon: '12:00', afternoon: '14:00', evening: '19:00', night: '20:00', bedtime: '21:00' }
const parseTime = (t) => {
  const s = String(t || '').trim().toLowerCase()
  if (/^\d{1,2}:\d{2}$/.test(s)) return s.padStart(5, '0')
  for (const [w, hhmm] of Object.entries(WORD_TIME)) if (s.includes(w)) return hhmm
  return null
}
const looksLikeMedicine = (name) => {
  const n = String(name || '').trim()
  return n.length >= 2 && n.split(/\s+/).length <= 4 && !SYMPTOM_WORDS.test(n)
}

const PROMPT = (windowText, latest, knownPeople, knownMeds, todayStr) =>
`An elderly woman (ELDER) is talking with her granddaughter's avatar (AVATAR).
Extract structured facts from ELDER's FINAL line only. The earlier lines are
context for resolving pronouns — do not extract from them, and never extract
anything the AVATAR said. Extract only what she stated plainly. When unsure,
leave it out.

Today is ${todayStr}.
Known people (do NOT list these): ${JSON.stringify(knownPeople)}
Known medicines: ${JSON.stringify(knownMeds)}
Terms of endearment that are NOT names: kanna, ma, da, chellam, raja, kutty, beta…

Conversation:
${windowText}

Return ONLY JSON, no markdown, no commentary:
{
  "medicines":  [{"name","dose","time","change":"new|dose|stopped","said"}],
  "reminders":  [{"text":"imperative, what to remind her of","date":"YYYY-MM-DD or ''","time":"HH:MM or ''","said"}],
  "memories":   [{"title":"3-6 words","body":"1-2 sentences in her detail","said"}],
  "notes":      [{"body":"a health or family fact worth logging","kind":"health_note|news","said"}],
  "people":     [{"name":"a real personal name NOT already known","relation":"if stated else ''","said"}],
  "medicine_taken": {"medicine":"which one","status":"took|not_yet","said"},
  "distress": 0,
  "about_late_husband": false,
  "topics": ["one or two words"]
}

Rules:
- Each fact goes in ONE bucket. If it is a medicine/reminder/memory, do NOT also
  put it in notes. notes is only for health or family state that fits nowhere else
  (e.g. "my knee has been aching").
- memories = something that happened. reminders = a future action she asked to be
  reminded of. A person merely mentioned in passing → people only, not memories.
- people: skip endearments, skip anyone already known, skip the AVATAR's own name.
- medicine_taken: null unless she clearly says she did or did not take something,
  and set "medicine" to the actual medicine name she used.
- Everything empty if her final line is just chit-chat.`

async function analyse(windowTurns, knownPeople, knownMeds) {
  const turns = windowTurns.slice(-CONTEXT_TURNS)
  const latest = [...turns].reverse().find(t => (t.role || t.speaker) === 'elder')
  const latestText = latest?.content || latest?.text || ''
  if (!latestText.trim()) return { ...SCHEMA, _latest: '' }

  const windowText = turns
    .map(t => `${(t.role || t.speaker) === 'elder' ? 'ELDER' : 'AVATAR'}: ${t.content || t.text}`)
    .join('\n')

  const out = await llm.json(
    PROMPT(windowText, latestText, knownPeople, knownMeds, today()),
    { ...SCHEMA })
  return { ...SCHEMA, ...out, _latest: latestText }
}

// Per-session "already extracted this" guard, so the rolling window doesn't
// re-log a fact every turn. Keyed by session, capped so it can't grow forever.
const seenBySession = new Map()
const seenSet = (sid) => {
  if (!seenBySession.has(sid)) {
    if (seenBySession.size > 50) seenBySession.clear()
    seenBySession.set(sid, new Set())
  }
  return seenBySession.get(sid)
}
const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 120)
// Aggressive: letters and digits only, first 50 — catches typos and punctuation drift.
const sig = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 50)

async function audit(family_id, session_id, kind, payload, sourceText, applied, postgres_id, note) {
  await ch.insertInto('extractions', [{
    family_id,
    ts: stamp(),
    session_id: session_id || 'out-of-session',
    kind,
    payload: JSON.stringify(payload || {}),
    source_text: (sourceText || '').slice(0, 500),
    confidence: 0.8,
    applied: applied ? 1 : 0,
    postgres_id: postgres_id || '',
    note: note || '',
  }])
}

// Take the analysis and fan it out into Postgres + the audit log.
async function apply(family_id, session_id, a) {
  const known = (await db.relations(family_id)).flatMap(r => [r.name, ...(r.aliases || [])])
  const knownLower = new Set(known.map(n => n.toLowerCase()))
  const knownMedLower = new Set((await db.medicines(family_id)).map(m => m.name.toLowerCase()))
  const seen = seenSet(session_id || 'out-of-session')
  const fresh = (kind, key) => {
    const k = `${kind}:${norm(key)}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  }
  const results = []

  for (const m of a.medicines || []) {
    if (!m.name || !fresh('medicine', m.name)) continue
    if (!looksLikeMedicine(m.name)) {
      await audit(family_id, session_id, 'medicine', m, m.said, false, '', 'rejected: not a medicine name')
      continue
    }
    // "I took my Metformin" is not a new medicine — that's medicine_taken's job.
    if ((m.change === 'new' || !m.change) && knownMedLower.has(m.name.toLowerCase())) {
      await audit(family_id, session_id, 'medicine', m, m.said, false, '', 'already known, no change stated')
      continue
    }
    try {
      if (m.change === 'stopped') {
        await db.stopMedicine(family_id, m.name)
        await audit(family_id, session_id, 'medicine', m, m.said, true, '', 'stopped')
        results.push(`medicine stopped: ${m.name}`)
      } else {
        const row = await db.addMedicine(family_id, m.name, m.dose, parseTime(m.time), { source: 'conversation' })
        await audit(family_id, session_id, 'medicine', m, m.said, true, row?.id || '', m.change || 'new')
        results.push(`medicine: ${m.name}`)
      }
    } catch (e) { await audit(family_id, session_id, 'medicine', m, m.said, false, '', e.message) }
  }

  for (const r of a.reminders || []) {
    if (!r.text || !fresh('reminder', r.text)) continue
    try {
      const dup = await db.reminderExists(family_id, r.text)
      if (dup) { await audit(family_id, session_id, 'reminder', r, r.said, false, dup.id, 'already set'); continue }
      const row = await db.addReminder(family_id, r.text, parseTime(r.time),
        { source: 'conversation', on_date: /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : today() })
      await audit(family_id, session_id, 'reminder', r, r.said, true, row?.id || '', '')
      results.push(`reminder: ${r.text}`)
    } catch (e) { await audit(family_id, session_id, 'reminder', r, r.said, false, '', e.message) }
  }

  for (const mem of a.memories || []) {
    if (!mem.title || !mem.body || !fresh('memory', mem.title)) continue
    try {
      const row = await db.addMemory(family_id, mem.title, mem.body, { source: 'conversation' })
      await audit(family_id, session_id, 'memory', mem, mem.said, true, row?.id || '', '')
      results.push(`memory: ${mem.title}`)
    } catch (e) { await audit(family_id, session_id, 'memory', mem, mem.said, false, '', e.message) }
  }

  for (const n of a.notes || []) {
    if (!n.body || !fresh('note', sig(n.body))) continue
    try {
      const row = await db.addUpdate(family_id, n.body, { source: 'conversation', kind: n.kind || 'health_note' })
      await audit(family_id, session_id, 'note', n, n.said, true, row?.id || '', n.kind || 'health_note')
      results.push(`note: ${n.body.slice(0, 40)}`)
    } catch (e) { await audit(family_id, session_id, 'note', n, n.said, false, '', e.message) }
  }

  for (const p of a.people || []) {
    const name = (p.name || '').trim()
    if (!name || NOT_NAMES.has(name.toLowerCase()) || knownLower.has(name.toLowerCase())) continue
    if (!/^[\p{L}][\p{L}'.\- ]{1,40}$/u.test(name)) continue
    if (!fresh('person', name)) continue
    try {
      await db.logGap(family_id, name, 'person', 'routine')
      await audit(family_id, session_id, 'person', p, p.said, true, '', 'queued as gap')
      results.push(`person queued: ${name}`)
    } catch (e) { await audit(family_id, session_id, 'person', p, p.said, false, '', e.message) }
  }

  const mt = a.medicine_taken
  if (mt && (mt.status === 'took' || mt.status === 'not_yet') && fresh('taken', `${mt.medicine}:${mt.status}`)) {
    try {
      const r = await db.logMedicineTaken(family_id, `${mt.medicine || ''} ${mt.said || ''}`, mt.status === 'took')
      await audit(family_id, session_id, 'medicine_taken', mt, mt.said, !!r, r?.id || '',
        r ? `${r.medicine} → ${mt.status}` : 'no matching medicine')
      if (r) results.push(`medicine ${mt.status}: ${r.medicine}`)
    } catch (e) { await audit(family_id, session_id, 'medicine_taken', mt, mt.said, false, '', e.message) }
  }

  if (a.about_late_husband && Number(a.distress) >= 5) {
    await db.logGap(family_id,
      `${today()}: she sounded unsettled talking about him`, 'moment', 'high')
  }

  return results
}

// Is this a plausible personal name we don't already know?
const isNewName = (name, knownLower) => {
  const n = String(name || '').trim()
  return n.length >= 2
    && !NOT_NAMES.has(n.toLowerCase())
    && !knownLower.has(n.toLowerCase())
    && /^[\p{L}][\p{L}'.\- ]{1,40}$/u.test(n)
}

module.exports = { analyse, apply, isNewName, NOT_NAMES }
