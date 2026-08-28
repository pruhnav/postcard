const fetch = require('node-fetch')

const GATEWAY = (process.env.LLM_GATEWAY_URL || '').replace(/\/$/, '')
const KEY = (process.env.LLM_GATEWAY_KEY || '').trim()
const MODEL = process.env.LLM_MODEL || 'anthropic/claude-haiku'

const EMB_KEY = (process.env.EMBEDDINGS_API_KEY || '').trim()
const EMB_MODEL = process.env.EMBEDDINGS_MODEL || 'text-embedding-3-small'

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

async function json(prompt, fallback = {}) {
  try {
    const text = await chat(
      [{ role: 'user', content: prompt }],
      { temperature: 0, max_tokens: 300 }
    )
    return JSON.parse(text.replace(/```json|```/g, '').trim())
  } catch {
    return fallback
  }
}

async function embed(input) {
  const many = Array.isArray(input)
  if (!EMB_KEY) return many ? input.map(() => []) : []

  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${EMB_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMB_MODEL, input }),
    timeout: 20000,
  })
  const data = await res.json()
  const vecs = (data.data || []).map(d => d.embedding)
  return many ? vecs : vecs[0] || []
}

module.exports = { chat, json, embed, MODEL }
