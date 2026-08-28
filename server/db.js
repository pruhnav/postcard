const { Pool } = require('pg')
const { APP_TZ, today } = require('./localtime')

// The curated store. Small, hand-editable, transactional. If Postgres is
// down we want to know at once, not discover it at 5pm when every panel is
// empty — there is no fallback store.

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.')
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: /localhost|127\.0\.0\.1|host\.docker\.internal/.test(process.env.DATABASE_URL)
    ? false
    : { rejectUnauthorized: false },
})

const q = async (text, params = []) => (await pool.query(text, params)).rows
const one = async (text, params = []) => (await q(text, params))[0] || null

module.exports = {
  pool,
  q,
  one,

  ping: () => q('select 1'),

  // ─── Families ──────────────────────────────────────────────────────

  family: (id) => one('select * from families where id = $1', [id]),

  firstFamily: () => one('select * from families order by created_at limit 1'),

  createFamily: async ({ elder_name, speaker_name, elder_city, elder_tz, speaker_tz }) => {
    const row = await one(
      `insert into families (elder_name, speaker_name, elder_city, elder_tz, speaker_tz)
       values ($1,$2,$3,coalesce($4,'Asia/Kolkata'),coalesce($5,'America/Los_Angeles'))
       returning id`,
      [elder_name, speaker_name, elder_city || null, elder_tz || null, speaker_tz || null])
    return row.id
  },

  patchFamily: (id, c) =>
    q(`update families set
         elder_name   = coalesce($2, elder_name),
         speaker_name = coalesce($3, speaker_name),
         elder_city   = coalesce($4, elder_city),
         elder_tz     = coalesce($5, elder_tz),
         speaker_tz   = coalesce($6, speaker_tz)
       where id = $1`,
      [id, c.elder_name || null, c.speaker_name || null, c.elder_city || null,
       c.elder_tz || null, c.speaker_tz || null]),

  // ─── Relations ─────────────────────────────────────────────────────

  relations: (fid) =>
    q('select * from relations where family_id = $1 order by name', [fid]),

  // source 'ruby' overwrites and verifies; 'conversation' fills only what is
  // blank and never downgrades a verified row.
  addRelation: (fid, name, context, extra = {}) => {
    const source = extra.source || 'ruby'
    if (source === 'ruby') {
      return q(
        `insert into relations (family_id, name, relation, context, deceased, source, unverified, verified_at)
         values ($1,$2,$3,$4,coalesce($5,false),'ruby',false, now())
         on conflict (family_id, name) do update set
           relation   = coalesce(excluded.relation, relations.relation),
           context    = coalesce(nullif(excluded.context,''), relations.context),
           deceased   = excluded.deceased or relations.deceased,
           source     = 'ruby', unverified = false, verified_at = now()`,
        [fid, name, extra.relation || null, context || '', extra.deceased ?? null])
    }
    return q(
      `insert into relations (family_id, name, relation, context, source, unverified)
       values ($1,$2,$3,$4,'conversation', true)
       on conflict (family_id, name) do update set
         relation = coalesce(relations.relation, excluded.relation),
         context  = coalesce(nullif(relations.context,''), excluded.context)`,
      [fid, name, extra.relation || null, context || ''])
  },

  // ─── Memories ──────────────────────────────────────────────────────

  memories: (fid) =>
    q('select * from memories where family_id = $1 order by created_at', [fid]),

  addMemory: (fid, title, body, extra = {}) =>
    one(
      `insert into memories (family_id, title, body, source, unverified, verified_at)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (family_id, title) do update set
         body = case when memories.source = 'ruby' then memories.body else excluded.body end
       returning id`,
      [fid, title, body,
       extra.source || 'ruby',
       (extra.source || 'ruby') === 'ruby' ? false : true,
       (extra.source || 'ruby') === 'ruby' ? new Date() : null]),

  // ─── News about Ruby / health notes about the grandmother ──────────

  latestUpdates: (fid, days = 10) =>
    q(`select body, kind, unverified, created_at from updates
       where family_id = $1 and created_at > now() - ($2 || ' days')::interval
       order by created_at desc limit 6`, [fid, String(days)]),

  addUpdate: (fid, body, extra = {}) =>
    one(
      `insert into updates (family_id, body, kind, source, unverified)
       values ($1,$2,$3,$4,$5) returning id`,
      [fid, body, extra.kind || 'news', extra.source || 'ruby',
       (extra.source || 'ruby') === 'ruby' ? false : true]),

  // ─── Medicines ─────────────────────────────────────────────────────

  medicines: (fid) =>
    q('select * from medicines where family_id = $1 and active order by schedule_time', [fid]),

  addMedicine: (fid, name, dose, schedule_time, extra = {}) => {
    const source = extra.source || 'ruby'
    return one(
      `insert into medicines (family_id, name, dose, schedule_time, source, unverified, verified_at)
       values ($1,$2,$3,coalesce($4::time,'08:00'),$5,$6,$7)
       on conflict (family_id, name) do update set
         dose          = coalesce(nullif(excluded.dose,''), medicines.dose),
         schedule_time = coalesce($4::time, medicines.schedule_time),
         active        = true,
         source        = case when $5 = 'ruby' then 'ruby' else medicines.source end,
         unverified    = case when $5 = 'ruby' then false else medicines.unverified end,
         verified_at   = case when $5 = 'ruby' then now() else medicines.verified_at end
       returning id`,
      [fid, name, dose || '', schedule_time || null, source,
       source === 'ruby' ? false : true,
       source === 'ruby' ? new Date() : null])
  },

  stopMedicine: (fid, name) =>
    q(`update medicines set active = false where family_id = $1 and lower(name) = lower($2)`, [fid, name]),

  medicineToday: (fid) =>
    q(`select m.name as medicine_name,
              to_char(m.schedule_time, 'HH24:MI') as scheduled_time,
              m.unverified,
              l.confirmed as taken
       from medicines m
       left join medicine_log l
         on l.medicine_id = m.id and l.on_date = $2
       where m.family_id = $1 and m.active
       order by m.schedule_time`, [fid, today()]),

  openMedicineLog: (fid) =>
    q(`select l.id, l.medicine_id, m.name
       from medicine_log l join medicines m on m.id = l.medicine_id
       where l.family_id = $1 and l.on_date = $2
         and l.confirmed is null
         and l.scheduled_at > now() - interval '90 minutes'`, [fid, today()]),

  // She volunteered that she took (or hasn't taken) something. Match it to a
  // medicine by name; if that fails, close any log row opened by a reminder in
  // the last 90 minutes; if that fails and there is exactly one medicine, use it.
  logMedicineTaken: async (fid, hint, took) => {
    const meds = await q('select id, name from medicines where family_id = $1 and active', [fid])
    let m = meds.find(x => (hint || '').toLowerCase().includes(x.name.toLowerCase()))

    if (!m) {
      const open = await q(
        `select l.id, m.name from medicine_log l join medicines m on m.id = l.medicine_id
         where l.family_id = $1 and l.on_date = $2 and l.confirmed is null
           and l.scheduled_at > now() - interval '90 minutes'
         order by l.scheduled_at desc limit 1`, [fid, today()])
      if (open[0]) {
        await q('update medicine_log set confirmed = $2, confirmed_at = now() where id = $1', [open[0].id, took])
        return { id: open[0].id, medicine: open[0].name }
      }
    }
    if (!m && meds.length === 1) m = meds[0]
    if (!m) return null

    const row = await one(
      `insert into medicine_log (family_id, medicine_id, on_date, scheduled_at, confirmed, confirmed_at)
       values ($1,$2,$3, now(), $4, now())
       on conflict (family_id, medicine_id, on_date) do update set
         confirmed = $4, confirmed_at = now()
       returning id`,
      [fid, m.id, today(), took])
    return { id: row.id, medicine: m.name }
  },

  confirmMedicine: (id, confirmed) =>
    q('update medicine_log set confirmed = $2, confirmed_at = now() where id = $1', [id, confirmed]),

  // A medicine reminder was just spoken — open the day's log row (confirmed
  // stays null) so a later "yes I took it" has something to close.
  openDailyMedicineLog: async (fid, hintText) => {
    const meds = await q('select id, name from medicines where family_id = $1 and active', [fid])
    for (const m of meds) {
      if (!(hintText || '').toLowerCase().includes(m.name.toLowerCase())) continue
      await q(
        `insert into medicine_log (family_id, medicine_id, on_date, scheduled_at)
         values ($1,$2,$3, now())
         on conflict (family_id, medicine_id, on_date) do nothing`,
        [fid, m.id, today()])
    }
  },

  adherence: (fid) =>
    one(`select count(*) filter (where confirmed) as yes, count(*) as total
         from medicine_log where family_id = $1 and on_date > current_date - 30`, [fid]),

  // ─── Reminders ─────────────────────────────────────────────────────

  dueReminders: (fid) =>
    q(`select id, kind, text from reminders
       where family_id = $1 and state = 'spoken'
       order by spoken_at desc limit 3`, [fid]),

  pendingReminders: (fid) =>
    q(`select r.id, r.kind, r.text
       from reminders r
       where r.family_id = $1
         and r.state = 'pending'
         and (r.on_date is null or r.on_date = $2::date)
         and (r.schedule_time is null or r.schedule_time <= (now() at time zone $3)::time)`,
      [fid, today(), APP_TZ]),

  ensureReminder: (fid, kind, text, schedule_time) =>
    q(`insert into reminders (family_id, kind, text, schedule_time, on_date)
       select $1, $2, $3, $4::time, $5::date
       where not exists (
         select 1 from reminders
         where family_id = $1 and kind = $2 and text = $3 and on_date = $5::date)`,
      [fid, kind, text, schedule_time || null, today()]),

  addReminder: (fid, text, schedule_time, extra = {}) =>
    one(`insert into reminders (family_id, kind, text, schedule_time, on_date, source, unverified)
         values ($1,$2,$3,$4::time,$5::date,$6,$7) returning id`,
      [fid, extra.kind || 'reminder', text, schedule_time || null,
       extra.on_date || today(), extra.source || 'ruby',
       (extra.source || 'ruby') === 'ruby' ? false : true]),

  reminderExists: (fid, text) =>
    one(`select id from reminders where family_id = $1 and lower(text) = lower($2)
         and state <> 'done' limit 1`, [fid, text]),

  markSpoken: (id) =>
    q(`update reminders set state = 'spoken', spoken_at = now() where id = $1`, [id]),

  acknowledge: (id) =>
    q(`update reminders set state = 'done', acknowledged_at = now() where id = $1`, [id]),

  // ─── Gaps (the six-day loop) ───────────────────────────────────────

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

  // ─── Verify (Ruby confirms an auto-extracted fact) ─────────────────

  verifyFact: async (fid, table, id) => {
    const allowed = { relations: 1, memories: 1, medicines: 1, updates: 1, reminders: 1 }
    if (!allowed[table]) throw new Error(`cannot verify ${table}`)
    return q(`update ${table} set unverified = false, verified_at = now()
              where family_id = $1 and id = $2`, [fid, id])
  },

  pendingVerification: async (fid) => {
    const [relations, memories, medicines, updates, reminders] = await Promise.all([
      q(`select id, name, relation, context from relations where family_id=$1 and unverified order by created_at`, [fid]),
      q(`select id, title, body from memories where family_id=$1 and unverified order by created_at`, [fid]),
      q(`select id, name, dose, to_char(schedule_time,'HH24:MI') as schedule_time from medicines where family_id=$1 and unverified order by created_at`, [fid]),
      q(`select id, body, kind from updates where family_id=$1 and unverified order by created_at`, [fid]),
      q(`select id, text, to_char(schedule_time,'HH24:MI') as schedule_time, on_date from reminders where family_id=$1 and unverified order by created_at`, [fid]),
    ])
    return { relations, memories, medicines, updates, reminders }
  },

  // ─── Frames ────────────────────────────────────────────────────────

  saveFrame: (fid, image) =>
    q(`insert into frames (family_id, image, captured_at) values ($1,$2,now())
       on conflict (family_id) do update set image = excluded.image, captured_at = now()`,
      [fid, image]),

  frame: (fid) => one('select image, captured_at from frames where family_id = $1', [fid]),
}
