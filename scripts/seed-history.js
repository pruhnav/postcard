require('dotenv').config({ path: '.env.local' })
require('dotenv').config({ path: '.env' })

// Months of conversation, generated from the persona document and the
// context in Postgres.
//
// Every panel on the console reads an aggregate. With one afternoon of real
// data they all show a single point, which is the difference between a demo
// that lands and one that does not. Run this the night before.
//
//   node scripts/seed-history.js --days 90
//   node scripts/seed-history.js --days 90 --unknown Ravi --wipe

const db = require('../server/db')
const ch = require('../server/ch')
const llm = require('../server/llm')
const { DOC } = require('../server/persona')
const { today } = require('../server/localtime')

const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag)
  return i > -1 ? process.argv[i + 1] : fallback
}
const has = (flag) => process.argv.includes(flag)

const DAYS = Number(arg('--days', 90))
const UNKNOWN = arg('--unknown', 'Ravi')
const CONCURRENCY = 4

// The shape of the story the history tells. Repetition climbs over the last
// few weeks, a name nobody has explained starts appearing, and the evenings
// are harder than the mornings. None of this is stated anywhere in the UI.
// It has to be in the data or the panels have nothing to find.
function brief(dayIndex, total) {
  const recency = dayIndex / total
  return {
    repeats: recency > 0.75 ? 3 + Math.floor(Math.random() * 4)
           : recency > 0.5 ? 1 + Math.floor(Math.random() * 2)
           : Math.random() < 0.3 ? 1 : 0,
    unknown: recency > 0.93 && Math.random() < 0.75,
    hour: Math.random() < 0.65 ? 9 + Math.floor(Math.random() * 3) : 18 + Math.floor(Math.random() * 3),
    mood: Math.random() < 0.15 ? 'quiet and a little low'
        : Math.random() < 0.3 ? 'missing the family'
        : 'cheerful',
  }
}

async function generateDay({ family, relations, memories, b }) {
  const people = relations.map(r => `${r.name} (${r.relation || ''})`).join(', ')
  const mems = memories.map(m => m.title).join('; ')

  const prompt = `${DOC.slice(0, 2500)}

Write one short conversation between ${family.elder_name} and her granddaughter's avatar.
She is ${b.mood} today. People in her life: ${people}. Memories she may touch on: ${mems}.
${b.unknown ? `She mentions someone called ${UNKNOWN} in passing, warmly, without explaining who they are.` : ''}

8 to 12 turns, alternating, starting with her. Keep every line to one or two spoken sentences.
Ordinary domestic talk: food, the birds, the neighbours, the weather, her medicine.
Return ONLY a JSON array, no markdown:
[{"speaker":"elder","text":"..."},{"speaker":"avatar","text":"..."}]`

  const turns = await llm.json(prompt, null)
  if (!Array.isArray(turns) || !turns.length) return null
  return turns.filter(t => t && t.text && (t.speaker === 'elder' || t.speaker === 'avatar'))
}

const REPEATED = (name) => [
  `What day is it today, kanna?`,
  `When are you coming home?`,
  `Did you eat something?`,
  `Is ${name} still at the same job?`,
]

async function main() {
  const family = await db.firstFamily()
  if (!family) throw new Error('No family in Postgres. Run schema.sql and open /setup first.')

  const [relations, memories] = await Promise.all([db.relations(family.id), db.memories(family.id)])
  console.log(`seeding ${DAYS} days for ${family.elder_name}`)

  if (has('--wipe')) {
    await ch.client.command({ query: `DELETE FROM utterances WHERE family_id = '${family.id}'` })
    console.log('wiped existing utterances')
  }

  const days = [...Array(DAYS).keys()]
  let done = 0

  const worker = async () => {
    while (days.length) {
      const i = days.shift()
      const b = brief(DAYS - i, DAYS)
      const date = new Date(Date.now() - i * 86400000)

      let turns = null
      try { turns = await generateDay({ family, relations, memories, b }) } catch {}
      if (!turns) { done++; continue }

      // Her repeated questions, planted deliberately. The first time she asks
      // is not a repeat. Every time after that is, and the console counts them.
      const q = REPEATED(family.speaker_name)[i % 4]
      for (let r = 0; r < b.repeats + 1; r++) {
        turns.push({ speaker: 'elder', text: q, repeat: r > 0 })
        turns.push({ speaker: 'avatar', text: `It's ${['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'][date.getDay()]}, Amama. And I'm right here.` })
      }

      const texts = turns.map(t => t.text)
      let vectors = []
      try {
        for (let k = 0; k < texts.length; k += 96) {
          vectors = vectors.concat(await llm.embed(texts.slice(k, k + 96)))
        }
      } catch { vectors = texts.map(() => []) }

      // Her wall-clock time. The ClickHouse session runs in APP_TZ, so a row
      // stamped '2026-08-01 18:30:00' is genuinely 6:30pm in Chennai and the
      // distress-by-hour panel puts it where it belongs.
      const day = today(date)
      const rows = turns.map((t, n) => {
        const hh = String(b.hour).padStart(2, '0')
        const mm = String((n * 2) % 55).padStart(2, '0')
        const ss = String((n * 7) % 59).padStart(2, '0')
        const evening = b.hour >= 17
        return {
          family_id: family.id,
          session_id: `seed-${day}`,
          ts: `${day} ${hh}:${mm}:${ss}.000`,
          speaker: t.speaker,
          text: t.text,
          embedding: vectors[n] || [],
          entities: t.speaker === 'elder' && b.unknown && t.text.includes(UNKNOWN) ? [UNKNOWN] : [],
          topics: [],
          distress: t.speaker === 'elder'
            ? (b.mood === 'cheerful' ? (evening ? 2 : 1) : evening ? 6 : 3)
            : 0,
          is_repeat: t.repeat ? 1 : 0,
        }
      })

      await ch.insert(rows)
      done++
      process.stdout.write(`\r${done}/${DAYS} days`)
    }
  }

  await Promise.all([...Array(CONCURRENCY)].map(worker))
  console.log('\ndone')

  const t = await ch.trends(family.id)
  console.log(`repeats today ${t.repeats_today}, 30 day average ${t.repeats_avg}, ${t.history_days} days of history`)
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
