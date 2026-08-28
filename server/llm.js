const fetch = require('node-fetch')

const GATEWAY = (process.env.LLM_GATEWAY_URL || '').replace(/\/$/, '')
const KEY = (process.env.LLM_GATEWAY_KEY || '').trim()
const MODEL = process.env.LLM_MODEL || 'anthropic/claude-haiku'

// Embeddings run locally — no API key, no external dependency. First call
// downloads ~90MB of model weights, then it is ~30ms per line on a laptop.
// all-MiniLM-L6-v2 is 384-dimensional; cosineDistance does not care about the
// number as long as seed and live use the same model, which they do.
const EMB_MODEL = process.env.EMBEDDINGS_MODEL || 'Xenova/all-MiniLM-L6-v2'

const withSystem = (system, messages) =>
  system ? [{ role: 'system', content: system }, ...messages] : messages

async function chat(messages, { system, temperature = 0.7, max_tokens = 400 } = {}) {
  const res = await fetch(`${GATEWAY}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages: withSystem(system, messages), temperature, max_tokens }),
    timeout: 20000,
  })
  const data = await res.json()
  return data.choices?.[0]?.message?.content || ''
}

// Streaming variant — yields text deltas as they arrive. Tavus's custom-LLM
// client sends {stream: true} and waits for OpenAI-style SSE chunks; without
// this the avatar gets a reply it cannot parse and stays silent.
async function* chatStream(messages, { system, temperature = 0.7, max_tokens = 400 } = {}) {
  const res = await fetch(`${GATEWAY}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages: withSystem(system, messages), temperature, max_tokens, stream: true }),
    timeout: 30000,
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`upstream ${res.status}: ${t.slice(0, 200)}`)
  }
  let buf = ''
  for await (const piece of res.body) {
    buf += piece.toString('utf8')
    let nl
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (payload === '[DONE]') return
      try {
        const delta = JSON.parse(payload).choices?.[0]?.delta?.content
        if (delta) yield delta
      } catch { /* keep-alive / partial line */ }
    }
  }
}

async function json(prompt, fallback = {}, { max_tokens = 700 } = {}) {
  try {
    const text = await chat(
      [{ role: 'user', content: prompt }],
      { temperature: 0, max_tokens }
    )
    const body = text.replace(/```json|```/g, '').trim()
    const start = Math.min(...['{', '['].map(c => { const i = body.indexOf(c); return i < 0 ? Infinity : i }))
    return JSON.parse(Number.isFinite(start) ? body.slice(start) : body)
  } catch {
    return fallback
  }
}

let _extractor = null
async function extractor() {
  if (_extractor) return _extractor
  // @xenova/transformers is ESM-only; load it from CommonJS with dynamic import.
  const { pipeline, env } = await import('@xenova/transformers')
  env.cacheDir = '.transformers-cache'
  _extractor = await pipeline('feature-extraction', EMB_MODEL)
  return _extractor
}

async function embed(input) {
  const many = Array.isArray(input)
  const texts = (many ? input : [input]).map(t => (t == null ? '' : String(t)))
  if (!texts.some(t => t.trim())) return many ? texts.map(() => []) : []

  const ex = await extractor()
  const out = []
  for (const t of texts) {
    if (!t.trim()) { out.push([]); continue }
    const r = await ex(t, { pooling: 'mean', normalize: true })
    out.push(Array.from(r.data))
  }
  return many ? out : out[0] || []
}

module.exports = { chat, chatStream, json, embed, MODEL }
