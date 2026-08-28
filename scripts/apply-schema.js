require('dotenv').config({ path: '.env.local' })
require('dotenv').config({ path: '.env' })

// Applies both schemas. Everything is CREATE ... IF NOT EXISTS / ADD COLUMN IF
// NOT EXISTS, so this is safe to run repeatedly.
//
//   npm run schema                 both
//   npm run schema -- --postgres   Postgres only
//   npm run schema -- --clickhouse ClickHouse only

const fs = require('fs')
const path = require('path')

const only = process.argv.includes('--postgres') ? 'postgres'
  : process.argv.includes('--clickhouse') ? 'clickhouse'
  : 'both'

async function applyPostgres() {
  const { Pool } = require('pg')
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set')
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: /localhost|127\.0\.0\.1|host\.docker\.internal/.test(process.env.DATABASE_URL)
      ? false : { rejectUnauthorized: false },
  })
  const sql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8')
  await pool.query(sql)          // pg runs the whole file as one multi-statement batch
  await pool.end()
  console.log('postgres   ok  (schema.sql)')
}

async function applyClickHouse() {
  const { createClient } = require('@clickhouse/client')
  if (!process.env.CLICKHOUSE_URL) throw new Error('CLICKHOUSE_URL is not set')
  const client = createClient({
    url: process.env.CLICKHOUSE_URL,
    username: process.env.CLICKHOUSE_USER || 'default',
    password: process.env.CLICKHOUSE_PASSWORD || '',
    database: process.env.CLICKHOUSE_DATABASE || 'default',
  })
  const sql = fs.readFileSync(path.join(__dirname, '..', 'clickhouse', 'schema.sql'), 'utf8')
  const statements = sql
    .split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
    .split(';').map(s => s.trim()).filter(Boolean)
  for (const query of statements) {
    try {
      await client.command({ query })
      console.log(`clickhouse ok  ${query.slice(0, 55).replace(/\s+/g, ' ')}`)
    } catch (e) {
      console.error(`clickhouse FAIL ${query.slice(0, 55).replace(/\s+/g, ' ')}\n     ${e.message}`)
      process.exit(1)
    }
  }
  await client.close()
}

async function main() {
  if (only !== 'clickhouse') await applyPostgres()
  if (only !== 'postgres') await applyClickHouse()
  console.log('\nschema applied')
  process.exit(0)
}

main().catch(e => { console.error(e.message); process.exit(1) })
