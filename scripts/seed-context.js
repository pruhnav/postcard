require('dotenv').config({ path: '.env.local' })
require('dotenv').config({ path: '.env' })

// Loads the curated store (Postgres) from docs/demo-context.json: the family,
// the people, the memories, the medicines, one line of news. Everything here
// is source='ruby', verified — it is what Ruby would have typed on /setup.
//
//   npm run seed:context
//   npm run seed:context -- path/to/other.json

const fs = require('fs')
const path = require('path')
const db = require('../server/db')

const file = process.argv[2] || path.join(__dirname, '..', 'docs', 'demo-context.json')

async function main() {
  const ctx = JSON.parse(fs.readFileSync(file, 'utf8'))

  let family = await db.firstFamily()
  if (!family) {
    const id = await db.createFamily(ctx.family)
    family = await db.family(id)
    console.log(`created family ${family.id} (${family.elder_name} / ${family.speaker_name})`)
  } else {
    await db.patchFamily(family.id, ctx.family)
    console.log(`family ${family.id} already existed — details updated`)
  }
  const fid = family.id

  for (const r of ctx.relations || []) {
    await db.addRelation(fid, r.name, r.context, { source: 'ruby', relation: r.relation, deceased: r.deceased })
    console.log(`  person   ${r.name}`)
  }
  for (const m of ctx.memories || []) {
    await db.addMemory(fid, m.title, m.body, { source: 'ruby' })
    console.log(`  memory   ${m.title}`)
  }
  for (const m of ctx.medicines || []) {
    await db.addMedicine(fid, m.name, m.dose, m.schedule_time, { source: 'ruby' })
    console.log(`  medicine ${m.name} @ ${m.schedule_time}`)
  }
  for (const u of ctx.updates || []) {
    await db.addUpdate(fid, u.body, { source: 'ruby', kind: u.kind || 'news' })
    console.log(`  news     ${u.body.slice(0, 50)}`)
  }

  console.log('\ndone')
  await db.pool.end()
}

main().catch(e => { console.error(e); process.exit(1) })
