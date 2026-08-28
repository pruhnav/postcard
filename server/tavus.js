const fetch = require('node-fetch')

const KEY = (process.env.TAVUS_API_KEY || '').trim()
const PERSONA = (process.env.TAVUS_PERSONA_ID || '').trim()
const CALLBACK = (process.env.TAVUS_CALLBACK_URL || '').trim()
const BASE = 'https://tavusapi.com/v2'

const headers = { 'x-api-key': KEY, 'Content-Type': 'application/json' }

async function listActive() {
  const res = await fetch(`${BASE}/conversations?status=active&limit=25`, { headers })
  const data = await res.json().catch(() => ({}))
  return (data.data || []).map(c => c.conversation_id)
}

// End every active conversation. The free tier allows one at a time, and a
// page refresh would otherwise leave a stale one holding the slot.
async function endAllActive() {
  const ids = await listActive().catch(() => [])
  await Promise.all(ids.map(id => end(id)))
  return ids.length
}

// One live conversation per session. The persona is configured in Tavus to
// call our own /api/llm/chat/completions endpoint as its model, which is how
// retrieval from ClickHouse ends up inside the conversation instead of
// sitting beside it in a dashboard.
async function createConversation({ family, greeting }) {
  const body = JSON.stringify({
    persona_id: PERSONA,
    conversation_name: `${family.elder_name} ${new Date().toISOString().slice(0, 10)}`,
    custom_greeting: greeting,
    callback_url: CALLBACK || undefined,
    properties: { language: 'english', enable_transcription: true },
  })
  const post = () => fetch(`${BASE}/conversations`, { method: 'POST', headers, body }).then(r => r.json())

  let data = await post()
  if (!data.conversation_url && /concurrent/i.test(data.message || '')) {
    const ended = await endAllActive()
    if (ended) { await new Promise(r => setTimeout(r, 1500)); data = await post() }
  }
  if (!data.conversation_url) throw new Error(data.message || 'Tavus refused the conversation')
  return data
}

// Make the avatar say something mid-conversation. This is how a reminder
// reaches her: spoken by the granddaughter she is already looking at,
// rather than a chime from a device.
async function speak(conversation_id, text) {
  if (!conversation_id) return false
  const res = await fetch(`${BASE}/conversations/${conversation_id}/interactions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      message_type: 'conversation',
      event_type: 'conversation.echo',
      conversation_id,
      properties: { modality: 'audio', text },
    }),
  })
  return res.ok
}

async function end(conversation_id) {
  if (!conversation_id) return
  await fetch(`${BASE}/conversations/${conversation_id}/end`, { method: 'POST', headers })
    .catch(() => {})
}

module.exports = { createConversation, speak, end, endAllActive, listActive }
