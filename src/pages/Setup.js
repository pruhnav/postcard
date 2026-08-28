import { useState, useEffect, useCallback } from 'react'

const API = process.env.REACT_APP_API || 'http://localhost:3001'

const c = {
  bg: '#0a0a14', panel: 'rgba(20,20,45,0.5)', line: '#1e3a5f',
  text: '#fff', dim: '#a0a0c0', amber: '#fbbf24', purple: '#7c3aed',
}

const field = {
  width: '100%', boxSizing: 'border-box', background: c.bg, color: c.text,
  border: `1px solid ${c.line}`, borderRadius: 8, padding: '10px 12px',
  fontSize: 14, fontFamily: 'inherit', marginBottom: 8,
}

const button = {
  background: c.purple, color: '#fff', border: 'none', borderRadius: 8,
  padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
}

function Section({ title, blurb, children }) {
  return (
    <section style={{
      background: c.panel, border: `1px solid ${c.line}`, borderRadius: 14,
      padding: 20, marginBottom: 16,
    }}>
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>{title}</h2>
      <p style={{ margin: '6px 0 16px', fontSize: 13, color: c.dim, lineHeight: 1.6 }}>{blurb}</p>
      {children}
    </section>
  )
}

export default function Setup() {
  const [ctx, setCtx] = useState({ relations: [], memories: [], medicines: [], updates: [] })
  const [rel, setRel] = useState({ name: '', context: '' })
  const [mem, setMem] = useState({ title: '', body: '' })
  const [med, setMed] = useState({ name: '', dose: '', schedule_time: '' })
  const [update, setUpdate] = useState('')

  const load = useCallback(() => {
    fetch(`${API}/api/context`).then(r => r.json())
      .then(d => { if (d && !d.error) setCtx(d) }).catch(() => {})
  }, [])

  useEffect(() => { load() }, [load])

  const post = async (path, body, reset) => {
    await fetch(`${API}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => {})
    reset()
    load()
  }

  return (
    <div style={{
      minHeight: '100vh', background: c.bg, color: c.text,
      fontFamily: 'system-ui, -apple-system, sans-serif',
      padding: '28px 24px 80px', maxWidth: 760, margin: '0 auto',
    }}>
      <h1 style={{ fontSize: 30, fontWeight: 700, margin: '0 0 6px' }}>
        What the avatar knows
      </h1>
      <p style={{ fontSize: 14, color: c.dim, lineHeight: 1.65, margin: '0 0 24px' }}>
        Everything here is written by you and nothing else can change it. The avatar will not
        invent anything beyond this. If it has no fresh news it says something warm and general
        rather than making something up.
      </p>

      <Section
        title="People"
        blurb="Only these people exist to the avatar. Anyone else she mentions becomes a question on your console."
      >
        {ctx.relations.map(r => (
          <div key={r.id} style={{ padding: '8px 0', borderBottom: `1px solid ${c.line}` }}>
            <div style={{ fontSize: 14 }}>{r.name} {r.relation && <span style={{ color: c.dim }}>· {r.relation}</span>}</div>
            <div style={{ fontSize: 13, color: c.dim, marginTop: 2 }}>{r.context}</div>
          </div>
        ))}
        <div style={{ marginTop: 14 }}>
          <input style={field} placeholder="Name" value={rel.name}
            onChange={e => setRel({ ...rel, name: e.target.value })} />
          <textarea style={{ ...field, minHeight: 70 }} placeholder="Who they are, in your words"
            value={rel.context} onChange={e => setRel({ ...rel, context: e.target.value })} />
          <button style={button} onClick={() => rel.name && post('/api/relations', rel, () => setRel({ name: '', context: '' }))}>
            Add person
          </button>
        </div>
      </Section>

      <Section
        title="Memories"
        blurb="A handful of specific ones, not a life history. One ordinary memory is worth three big occasions, because most days nothing happens."
      >
        {ctx.memories.map(m => (
          <div key={m.id} style={{ padding: '8px 0', borderBottom: `1px solid ${c.line}` }}>
            <div style={{ fontSize: 14 }}>{m.title}</div>
            <div style={{ fontSize: 13, color: c.dim, marginTop: 2, lineHeight: 1.5 }}>{m.body}</div>
          </div>
        ))}
        <div style={{ marginTop: 14 }}>
          <input style={field} placeholder="Title, e.g. Ganesha Chaturthi and the momos"
            value={mem.title} onChange={e => setMem({ ...mem, title: e.target.value })} />
          <textarea style={{ ...field, minHeight: 90 }} placeholder="What happened, with the details she would remember"
            value={mem.body} onChange={e => setMem({ ...mem, body: e.target.value })} />
          <button style={button} onClick={() => mem.title && post('/api/memories', mem, () => setMem({ title: '', body: '' }))}>
            Add memory
          </button>
        </div>
      </Section>

      <Section
        title="Medicine"
        blurb="The avatar says these out loud at the scheduled time and logs whether she answers. It never gives medical advice."
      >
        {ctx.medicines.map(m => (
          <div key={m.id} style={{
            display: 'flex', justifyContent: 'space-between',
            padding: '8px 0', borderBottom: `1px solid ${c.line}`, fontSize: 14,
          }}>
            <span>{m.name} {m.dose && <span style={{ color: c.dim }}>· {m.dose}</span>}</span>
            <span style={{ color: c.dim, fontFamily: 'ui-monospace, monospace' }}>{String(m.schedule_time).slice(0, 5)}</span>
          </div>
        ))}
        <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 8 }}>
          <input style={{ ...field, marginBottom: 0 }} placeholder="Name" value={med.name}
            onChange={e => setMed({ ...med, name: e.target.value })} />
          <input style={{ ...field, marginBottom: 0 }} placeholder="Dose" value={med.dose}
            onChange={e => setMed({ ...med, dose: e.target.value })} />
          <input style={{ ...field, marginBottom: 0 }} type="time" value={med.schedule_time}
            onChange={e => setMed({ ...med, schedule_time: e.target.value })} />
        </div>
        <button style={{ ...button, marginTop: 10 }}
          onClick={() => med.name && med.schedule_time && post('/api/medicines', med, () => setMed({ name: '', dose: '', schedule_time: '' }))}>
          Add medicine
        </button>
      </Section>

      <Section
        title="News about you"
        blurb="Drop a line in whenever something happens. Without anything recent here the avatar keeps to generalities on purpose."
      >
        {ctx.updates.slice(0, 5).map(u => (
          <div key={u.created_at} style={{ padding: '8px 0', borderBottom: `1px solid ${c.line}`, fontSize: 14, color: c.dim }}>
            {u.body}
          </div>
        ))}
        <div style={{ marginTop: 14 }}>
          <textarea style={{ ...field, minHeight: 70 }} placeholder="Started the new job this week, the apartment finally has furniture"
            value={update} onChange={e => setUpdate(e.target.value)} />
          <button style={button} onClick={() => update && post('/api/updates', { body: update }, () => setUpdate(''))}>
            Add news
          </button>
        </div>
      </Section>
    </div>
  )
}
