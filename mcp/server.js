#!/usr/bin/env node
require('dotenv').config({ path: '.env.local' })

// Tools LibreChat can call, so "what did she talk about today" is a real
// query against ClickHouse rather than a hardcoded endpoint.
//
// Wire it up in librechat.yaml, then point an agent at it.

const { Server } = require('@modelcontextprotocol/sdk/server/index.js')
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js')
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
    description: "Everything the grandmother said today, in order, with what the avatar replied.",
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'search_her_words',
    description: "Search everything she has ever said, by meaning rather than keyword. Use for questions like 'has she mentioned the temple before' or 'what does she say about her husband'.",
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' }, limit: { type: 'number' } },
      required: ['query'],
    },
  },
  {
    name: 'unknown_people',
    description: "Names she has used that nobody has explained to the avatar yet, with how often each has come up.",
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'patterns',
    description: "How often she repeats herself compared with her own average, when in the day she sounds unsettled, and medicine confirmation rate.",
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'teach_avatar',
    description: "Tell the avatar who someone is. Writes it to Postgres so the next conversation has the context.",
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' }, context: { type: 'string' } },
      required: ['name', 'context'],
    },
  },
]

const server = new Server({ name: 'postcard', version: '1.0.0' }, { capabilities: { tools: {} } })

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params
  const family = await db.firstFamily()
  if (!family) return text('No family set up yet.')

  if (name === 'what_she_said_today') {
    const said = await ch.saidToday(family.id)
    return text(said.map(s => `${s.speaker}: ${s.text}`).join('\n') || 'Nothing today.')
  }

  if (name === 'search_her_words') {
    const emb = await llm.embed(args.query)
    const hits = await ch.recall(family.id, emb, args.limit || 10)
    return text(hits.map(h => `${h.ts} ${h.speaker}: ${h.text}`).join('\n') || 'Nothing found.')
  }

  if (name === 'unknown_people') {
    const [relations, open] = await Promise.all([db.relations(family.id), db.openGaps(family.id)])
    const known = relations.flatMap(r => [r.name, ...(r.aliases || [])])
    const list = await ch.unknownNames(family.id, known, open)
    return text(JSON.stringify(list, null, 2))
  }

  if (name === 'patterns') {
    return text(JSON.stringify(await ch.trends(family.id), null, 2))
  }

  if (name === 'teach_avatar') {
    await db.addRelation(family.id, args.name, args.context)
    await db.answerGap(family.id, args.name, args.context)
    return text(`Saved. The avatar knows who ${args.name} is from the next conversation on.`)
  }

  return text(`Unknown tool: ${name}`)
})

const text = (t) => ({ content: [{ type: 'text', text: t }] })

server.connect(new StdioServerTransport()).catch(e => { console.error(e); process.exit(1) })
