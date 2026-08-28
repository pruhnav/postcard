const fetch = require('node-fetch')

const GATEWAY = (process.env.LLM_GATEWAY_URL || '').replace(/\/$/, '')
const KEY = (process.env.LLM_GATEWAY_KEY || '').trim()
const MODEL = process.env.LLM_MODEL || 'anthropic/claude-haiku'

// Embeddings run locally — no API key, no external dependency. First call
// downloads ~90MB of model weights, then it is ~30ms per line on a laptop.
// all-MiniLM-L6-v2 is 384-dimensional; cosineDistance does not care about the
// number as long as seed and live use the same model, which they do.
const EMB_MODEL = process.env.EMBEDDINGS_MODEL || 'Xenova/all-MiniLM-L6-v2'

async function chat(messages, { system, temperature = 0.7, max_tokens = 400 } = {}) {
  const body = { model: MODEL, messages, temperature, max_tokens }
  if (system) body.messages = [{ role: 'system', content: system }, ...messages]

  const res = await fetch(`${GATEWAY}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    timeout: 20000,
  })
  const data = await res.json()
  return data.choices?.[0]?.message?.content || ''
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

module.exports = { chat, json, embed, MODEL }
