// Fake backend for looking at the frontend. No Postgres, no ClickHouse,
// no keys. Every endpoint returns plausible data so all three pages fill in.
//
//   node scripts/mock-server.js      (port 3001, same as the real one)
//
// The avatar iframe loads about:blank, which renders black. That is on
// purpose: it lets you check the clock, the self view and the reminder card
// sitting on top of a video without a Tavus session.

const express = require('express')
const cors = require('cors')

const app = express()
app.use(cors())
app.use(express.json({ limit: '8mb' }))

const FAMILY = {
  id: '00000000-0000-0000-0000-000000000001',
  elder_name: 'Amama',
  parent_name: 'Amama',
  speaker_name: 'Ruby',
  child_name: 'Ruby',
  elder_city: 'Chennai',
  elder_tz: 'Asia/Kolkata',
  timezone: 'Asia/Kolkata',
  speaker_tz: 'America/Los_Angeles',
}

let frame = null
let reminder = { id: 'r1', kind: 'medicine', text: 'Time for your blood pressure tablet' }

app.get('/api/family', (_q, res) => res.json(FAMILY))

app.get('/api/context', (_q, res) => res.json({
  family: FAMILY,
  relations: [
    { id: '1', name: 'Dino', relation: 'brother', context: 'Never sits still, always telling stories to get a reaction.' },
    { id: '2', name: 'Tina', relation: 'mother', context: 'Takes Amama to the temple and the park.' },
    { id: '3', name: 'Matt', relation: 'father', context: 'Software engineer. He and Amama tease each other constantly.' },
  ],
  memories: [
    { id: '1', title: 'Rhode Island, when Ruby was born', body: 'Amama complaining about putting on a sweater just to take the garbage out.' },
    { id: '2', title: 'Ganesha Chaturthi and the momos', body: 'Making momos with Ruby and her friends, the house full of people.' },
  ],
  medicines: [
    { id: '1', name: 'Metformin', dose: '500mg', schedule_time: '08:00:00' },
    { id: '2', name: 'Evening dose', dose: '500mg', schedule_time: '20:00:00' },
  ],
  updates: [{ created_at: new Date().toISOString(), body: 'Started the new job this week.' }],
}))

app.post('/api/tavus', (_q, res) => res.json({ conversation_url: 'about:blank' }))

app.get('/api/reminders/due', (_q, res) => res.json(reminder ? [reminder] : []))
app.post('/api/reminders/:id/acknowledge', (_q, res) => { reminder = null; res.json({ ok: true }) })

app.post('/api/frame', (req, res) => { frame = { image: req.body.image, captured_at: new Date().toISOString() }; res.json({ ok: true }) })
app.get('/api/frame', (_q, res) => res.json(frame || {}))

app.get('/api/medication', (_q, res) => res.json([
  { medicine_name: 'Metformin', scheduled_time: '08:00', taken: true },
  { medicine_name: 'Evening dose', scheduled_time: '20:00', taken: null },
]))

app.get('/api/trends', (_q, res) => res.json({
  repeats_today: 14,
  repeats_avg: 3.2,
  history_days: 30,
  adherence_pct: 90,
  adherence_days: 21,
  distress_by_hour: [0,0,0,0,0,0,0,.08,.12,.14,.1,.18,.2,.16,.22,.3,.34,.48,.62,.78,.7,.4,.1,0],
}))

let unknowns = [
  {
    name: 'Ravi',
    mentions: 9,
    first_heard: '5 days ago',
    quotes: [
      'Ravi came by with the mangoes again, such a sweet boy',
      'I told Ravi you were coming in December',
      'Ravi fixed the fan without me even asking',
    ],
  },
  {
    name: 'Lakshmi',
    mentions: 2,
    first_heard: 'yesterday',
    quotes: ['Lakshmi from downstairs asked about you'],
  },
]

app.get('/api/unknown-people', (_q, res) => res.json(unknowns))

app.post('/api/relations', (req, res) => {
  unknowns = unknowns.filter(u => u.name !== req.body.name)
  console.log(`taught: ${req.body.name} — ${req.body.context}`)
  res.json({ ok: true })
})

app.post('/api/summary', (_q, res) => setTimeout(() => res.json({
  summary: 'She was in a good mood this morning, mostly talking about the garden and the birds on the balcony. Ravi came up again, four times today. She asked what day it was fourteen times, which is high for her, and she sounded tired by the evening. Worth a call this weekend.',
}), 900))

app.get('/api/digest', (_q, res) => res.json({ date: new Date().toISOString().slice(0, 10), high_priority: [], questions: unknowns, medicines: [] }))
app.get('/api/health', (_q, res) => res.json({ postgres: 'mock', clickhouse: 'mock' }))

app.post('/api/memories', (_q, res) => res.json({ ok: true }))
app.post('/api/medicines', (_q, res) => res.json({ ok: true }))
app.post('/api/updates', (_q, res) => res.json({ ok: true }))
app.post('/api/reminders', (_q, res) => res.json({ ok: true }))

app.listen(3001, () => console.log('mock api on :3001 — nothing here is real'))
