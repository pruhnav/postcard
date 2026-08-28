const { Pool } = require('pg')

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.')
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
})

// No fallback store. If Postgres is down we want to know at once, not
// discover it at 5pm when every panel is empty.
const q = async (text, params = []) => (await pool.query(text, params)).rows
const one = async (text, params = []) => (await q(text, params))[0] || null

module.exports = {
  pool,
  q,
  one,

  family: (id) => one('select * from families where id = $1', [id]),

  firstFamily: () => one('select * from families order by created_at limit 1'),

  relations: (fid) => q('select * from relations where family_id = $1 order by name', [fid]),

  memories: (fid) => q('select * from memories where family_id = $1 order by created_at', [fid]),

  latestUpdates: (fid, days = 10) =>
    q(`select body, created_at from updates
       where family_id = $1 and created_at > now() - ($2 || ' days')::interval
       order by created_at desc limit 5`, [fid, String(days)]),

  medicines: (fid) =>
    q('select * from medicines where family_id = $1 and active order by schedule_time', [fid]),

  medicineToday: (fid) =>
    q(`select m.name as medicine_name,
              to_char(m.schedule_time, 'HH24:MI') as scheduled_time,
              l.confirmed as taken
       from medicines m
       left join medicine_log l
         on l.medicine_id = m.id and l.on_date = current_date
       where m.family_id = $1 and m.active
       order by m.schedule_time`, [fid]),

  openMedicineLog: (fid) =>
    q(`select l.id, l.medicine_id, m.name
       from medicine_log l join medicines m on m.id = l.medicine_id
       where l.family_id = $1 and l.on_date = current_date
         and l.confirmed is null
         and l.scheduled_at > now() - interval '90 minutes'`, [fid]),

  confirmMedicine: (id, confirmed) =>
    q('update medicine_log set confirmed = $2, confirmed_at = now() where id = $1', [id, confirmed]),

  dueReminders: (fid) =>
    q(`select id, kind, text from reminders
       where family_id = $1 and state = 'spoken'
       order by spoken_at desc limit 3`, [fid]),

  pendingReminders: (fid) =>
    q(`select r.id, r.kind, r.text
       from reminders r
       where r.family_id = $1
         and r.state = 'pending'
         and (r.on_date is null or r.on_date = current_date)
         and (r.schedule_time is null or r.schedule_time <= current_time)`, [fid]),

  markSpoken: (id) =>
    q(`update reminders set state = 'spoken', spoken_at = now() where id = $1`, [id]),

  acknowledge: (id) =>
    q(`update reminders set state = 'done', acknowledged_at = now() where id = $1`, [id]),

  openGaps: (fid) =>
    q(`select name, kind, priority, first_heard from gaps
       where family_id = $1 and status = 'open'
       order by priority desc, first_heard`, [fid]),

  logGap: (fid, name, kind, priority) =>
    q(`insert into gaps (family_id, name, kind, priority) values ($1,$2,$3,$4)
       on conflict (family_id, name) do nothing`, [fid, name, kind, priority || 'routine']),

  answerGap: (fid, name, answer) =>
    q(`update gaps set status = 'answered', answer = $3, answered_at = now()
       where family_id = $1 and name = $2`, [fid, name, answer]),

  addRelation: (fid, name, context) =>
    q(`insert into relations (family_id, name, context) values ($1,$2,$3)
       on conflict (family_id, name) do update set context = excluded.context`,
      [fid, name, context]),

  saveFrame: (fid, image) =>
    q(`insert into frames (family_id, image, captured_at) values ($1,$2,now())
       on conflict (family_id) do update set image = excluded.image, captured_at = now()`,
      [fid, image]),

  frame: (fid) => one('select image, captured_at from frames where family_id = $1', [fid]),
}
