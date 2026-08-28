// The whole product is about one person in one place, so we don't juggle
// per-row timezones. Every timestamp we write is her naive wall-clock in
// APP_TZ (produced by stamp() / today() here). ClickHouse stores and reads
// those digits against a single fixed reference, so toHour(ts) is her hour
// and toDate(ts) is her date — no session timezone needed. The one place a
// live "now" is compared to her clock (pending reminders) passes APP_TZ
// explicitly.
//
// APP_TZ should match the family's elder_tz. Default is Chennai.

const APP_TZ = process.env.APP_TZ || 'Asia/Kolkata'

const parts = (d) => {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TZ, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(d).reduce((o, p) => (o[p.type] = p.value, o), {})
  return f
}

// 'YYYY-MM-DD HH:MM:SS.mmm' in APP_TZ — the format ClickHouse DateTime64 wants.
const stamp = (d = new Date()) => {
  const p = parts(d)
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}.${String(d.getMilliseconds()).padStart(3, '0')}`
}

// 'YYYY-MM-DD' in APP_TZ.
const today = (d = new Date()) => {
  const p = parts(d)
  return `${p.year}-${p.month}-${p.day}`
}

module.exports = { APP_TZ, stamp, today }
