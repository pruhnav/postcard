// Shared tool definitions for the Postcard MCP server. Used two ways:
//   mcp/server.js         — stdio, for `npm run mcp` and classic LibreChat config
//   server/index.js /mcp  — streamable HTTP, so LibreChat in Docker can reach it

const { Server } = require('@modelcontextprotocol/sdk/server/index.js')
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js')

const db = require('../server/db')
const ch = require('../server/ch')
const llm = require('../server/llm')

const TOOLS = [
  {
    name: 'what_she_said_today',
    description: "Everything the grandmother said today, in order, with what the avatar replied. Source: ClickHouse utterances.",
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'search_her_words',
    description: "Search everything she has ever said, by meaning rather than keyword. Use for 'has she mentioned the temple before' or 'what does she say about her husband'. Source: ClickHouse vector recall.",
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' }, limit: { type: 'number' } },
      required: ['query'],
    },
  },
  {
    name: 'day_summary',
    description: "The kept end-of-conversation summaries, newest first, with her mood. Source: ClickHouse conversation_summaries.",
    inputSchema: { type: 'object', properties: { limit: { type: 'number' } } },
  },
  {
    name: 'extraction_log',
    description: "What the pipeline pulled out of recent conversations — medicines, reminders, memories, notes, names — and whether each was written to the curated store. Source: ClickHouse extractions.",
    inputSchema: { type: 'object', properties: { limit: { type: 'number' } } },
  },
  {
    name: 'facts_to_confirm',
    description: "Auto-extracted facts sitting in Postgres as unverified, waiting for Ruby to confirm. Grouped by table.",
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'confirm_fact',
    description: "Mark an auto-extracted fact as verified. table is one of relations|memories|medicines|updates|reminders, id is its Postgres id.",
    inputSchema: {
      type: 'object',
      properties: { table: { type: 'string' }, id: { type: 'string' } },
      required: ['table', 'id'],
    },
  },
  {
    name: 'unknown_people',
    description: "Names she has used that nobody has explained yet, with how often each has come up. Source: ClickHouse mentions.",
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'patterns',
    description: "How often she repeats herself vs her own average, when in the day she sounds unsettled, medicine confirmation rate. Source: ClickHouse materialized views + Postgres.",
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'teach_avatar',
    description: "Tell the avatar who someone is. Writes it to Postgres (verified) so the next conversation has the context.",
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' }, context: { type: 'string' } },
      required: ['name', 'context'],
    },
  },
]

async function run(name, args = {}) {
  const family = await db.firstFamily()
  if (!family) return 'No family set up yet.'
  const fid = family.id

  switch (name) {
    case 'what_she_said_today': {
      const said = await ch.saidToday(fid)
      return said.map(s => `${s.speaker}: ${s.text}`).join('\n') || 'Nothing today.'
    }
    case 'search_her_words': {
      const emb = await llm.embed(args.query)
      const hits = await ch.recall(fid, emb, args.limit || 10)
      return hits.map(h => `${h.ts} ${h.speaker}: ${h.text}`).join('\n') || 'Nothing found.'
    }
    case 'day_summary':
      return await ch.recentSummaries(fid, args.limit || 7)
    case 'extraction_log':
      return await ch.recentExtractions(fid, args.limit || 40)
    case 'facts_to_confirm':
      return await db.pendingVerification(fid)
    case 'confirm_fact':
      await db.verifyFact(fid, args.table, args.id)
      return `Confirmed ${args.table} ${args.id}.`
    case 'unknown_people': {
      const [relations, open] = await Promise.all([db.relations(fid), db.openGaps(fid)])
      const known = relations.flatMap(r => [r.name, ...(r.aliases || [])])
      return await ch.unknownNames(fid, known, open)
    }
    case 'patterns':
      return await ch.trends(fid)
    case 'teach_avatar':
      await db.addRelation(fid, args.name, args.context, { source: 'ruby' })
      await db.answerGap(fid, args.name, args.context)
      return `Saved. The avatar knows who ${args.name} is from the next conversation on.`
    default:
      return `Unknown tool: ${name}`
  }
}

// A configured MCP Server instance (transport attached by the caller).
function makeServer() {
  const server = new Server({ name: 'postcard', version: '1.0.0' }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    try {
      const out = await run(req.params.name, req.params.arguments || {})
      return { content: [{ type: 'text', text: typeof out === 'string' ? out : JSON.stringify(out, null, 2) }] }
    } catch (e) {
      return { content: [{ type: 'text', text: `error: ${e.message}` }], isError: true }
    }
  })
  return server
}

module.exports = { TOOLS, run, makeServer }
