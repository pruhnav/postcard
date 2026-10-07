import { useState, useEffect, useCallback } from 'react'
import Icon from '../icons'

const API = process.env.REACT_APP_API || 'http://localhost:3001'

function Section({ title, icon, count, blurb, children }) {
  return (
    <section className="panel section">
      <div className="section-head">
        <span className="tile accent"><Icon name={icon} size={17} /></span>
        <div>
          <h2 className="section-title">{title}{count > 0 && <span className="count">{count}</span>}</h2>
          <p className="section-blurb">{blurb}</p>
        </div>
      </div>
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
    <div className="page">
      <div className="page-setup">
        <div className="setup-head">
          <div>
            <div className="eyebrow" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <Icon name="lock" size={12} /> Written by you, read by the avatar
            </div>
            <h1 className="setup-title">What the avatar knows</h1>
            <p className="lede">
              Everything here is written by you and nothing else can change it. The avatar will not
              invent anything beyond this. If it has no fresh news it says something warm and general
              rather than making something up.
            </p>
          </div>
        </div>

        <Section
          title="People"
          icon="users"
          count={ctx.relations.length}
          blurb="Only these people exist to the avatar. Anyone else she mentions becomes a question on your console."
        >
          <div className="row-list">
            {ctx.relations.map(r => (
              <div key={r.id} className="entry">
                <div className="entry-title">{r.name} {r.relation && <span>· {r.relation}</span>}</div>
                <div className="entry-body">{r.context}</div>
              </div>
            ))}
          </div>
          <div className="form stack">
            <input className="field" placeholder="Name" value={rel.name}
              onChange={e => setRel({ ...rel, name: e.target.value })} />
            <textarea className="field" style={{ minHeight: 70 }} placeholder="Who they are, in your words"
              value={rel.context} onChange={e => setRel({ ...rel, context: e.target.value })} />
            <button className="btn btn-primary" onClick={() => rel.name && post('/api/relations', rel, () => setRel({ name: '', context: '' }))}>
              <Icon name="plus" size={15} /> Add person
            </button>
          </div>
        </Section>

        <Section
          title="Memories"
          icon="bookmark"
          count={ctx.memories.length}
          blurb="A handful of specific ones, not a life history. One ordinary memory is worth three big occasions, because most days nothing happens."
        >
          <div className="row-list">
            {ctx.memories.map(m => (
              <div key={m.id} className="entry">
                <div className="entry-title">{m.title}</div>
                <div className="entry-body">{m.body}</div>
              </div>
            ))}
          </div>
          <div className="form stack">
            <input className="field" placeholder="Title, e.g. Ganesha Chaturthi and the momos"
              value={mem.title} onChange={e => setMem({ ...mem, title: e.target.value })} />
            <textarea className="field" style={{ minHeight: 90 }} placeholder="What happened, with the details she would remember"
              value={mem.body} onChange={e => setMem({ ...mem, body: e.target.value })} />
            <button className="btn btn-primary" onClick={() => mem.title && post('/api/memories', mem, () => setMem({ title: '', body: '' }))}>
              <Icon name="plus" size={15} /> Add memory
            </button>
          </div>
        </Section>

        <Section
          title="Medicine"
          icon="pill"
          count={ctx.medicines.length}
          blurb="The avatar says these out loud at the scheduled time and logs whether she answers. It never gives medical advice."
        >
          <div className="row-list">
            {ctx.medicines.map(m => (
              <div key={m.id} className="entry entry-row">
                <span className="entry-title">{m.name} {m.dose && <span>· {m.dose}</span>}</span>
                <span className="time-chip">{String(m.schedule_time).slice(0, 5)}</span>
              </div>
            ))}
          </div>
          <div className="form">
            <div className="form-grid">
              <input className="field" placeholder="Name" value={med.name}
                onChange={e => setMed({ ...med, name: e.target.value })} />
              <input className="field" placeholder="Dose" value={med.dose}
                onChange={e => setMed({ ...med, dose: e.target.value })} />
              <input className="field" type="time" value={med.schedule_time}
                onChange={e => setMed({ ...med, schedule_time: e.target.value })} />
            </div>
            <button className="btn btn-primary"
              onClick={() => med.name && med.schedule_time && post('/api/medicines', med, () => setMed({ name: '', dose: '', schedule_time: '' }))}>
              <Icon name="plus" size={15} /> Add medicine
            </button>
          </div>
        </Section>

        <Section
          title="News about you"
          icon="pen"
          blurb="Drop a line in whenever something happens. Without anything recent here the avatar keeps to generalities on purpose."
        >
          <div className="row-list">
            {ctx.updates.slice(0, 5).map(u => (
              <div key={u.created_at} className="entry entry-body" style={{ fontSize: 14 }}>
                {u.body}
              </div>
            ))}
          </div>
          <div className="form">
            <textarea className="field" style={{ minHeight: 70 }} placeholder="Started the new job this week, the apartment finally has furniture"
              value={update} onChange={e => setUpdate(e.target.value)} />
            <button className="btn btn-primary" onClick={() => update && post('/api/updates', { body: update }, () => setUpdate(''))}>
              <Icon name="plus" size={15} /> Add news
            </button>
          </div>
        </Section>
      </div>
    </div>
  )
}
