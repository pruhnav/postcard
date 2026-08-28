#!/usr/bin/env node
require('dotenv').config({ path: '.env.local' })
require('dotenv').config({ path: '.env' })

// Stdio MCP server, for `npm run mcp` and the classic LibreChat stdio config.
// The HTTP version lives inside server/index.js at /mcp — see mcp/tools.js.

const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js')
const { makeServer } = require('./tools')

makeServer().connect(new StdioServerTransport())
  .catch(e => { console.error(e); process.exit(1) })
