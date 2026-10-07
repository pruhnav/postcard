import { useState, useEffect, useCallback, useRef } from 'react'
import Icon from '../icons'

const API = process.env.REACT_APP_API || 'http://localhost:3001'
const LIBRECHAT_URL = process.env.REACT_APP_LIBRECHAT_URL || 'http://localhost:3080'

function Panel({ title, icon, tone, note, children, style }) {
  return (
    <section className="panel" style={style}>
      <div className="panel-head">
        <div className="panel-title">
          {icon && <span className={`tile sm ${tone || ''}`}><Icon name={icon} size={15} /></span>}
          {title}
        </div>
        {note && <div className="panel-note">{note}</div>}
      </div>
      <div className="panel-body">{children}</div>
    </section>
  )
}

export default function Dashboard() {
  const family_id = localStorage.getItem('family_id') || 'demo'

  const [family, setFamily] = useState({})
  const [frame, setFrame] = useState(null)
  const [summary, setSummary] = useState('')
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [unknowns, setUnknowns] = useState([])
  const [meds, setMeds] = useState([])
  const [transcript, setTranscript] = useState([])
  const [trends, setTrends] = useState(null)
  const [draft, setDraft] = useState({})
  const [here, setHere] = useState('')
  const [there, setThere] = useState('')

  const savingRef = useRef({})
  const scrollRef = useRef(null)

  // Keep the newest line in view without yanking the page if you scrolled up.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (nearBottom) el.scrollTop = el.scrollHeight
  }, [transcript.length])

  const elderName = family.elder_name || family.parent_name || 'Amama'
  const elderTz = family.elder_tz || family.timezone || 'Asia/Kolkata'

  // Two clocks: the whole point of the product
  useEffect(() => {
    const tick = () => {
      const now = new Date()
      setHere(now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }))
      try {
        setThere(now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: elderTz }))
      } catch { setThere('--:--') }
    }
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [elderTz])

  const fetchAll = useCallback(() => {
    const get = (path, set) =>
      fetch(`${API}${path}${path.includes('?') ? '&' : '?'}family_id=${family_id}`)
        .then(r => r.json()).then(d => { if (d && !d.error) set(d) }).catch(() => {})

    get('/api/family', setFamily)
    get('/api/frame', setFrame)
    get('/api/unknown-people', d => setUnknowns(Array.isArray(d) ? d : []))
    get('/api/medication', d => setMeds(Array.isArray(d) ? d : []))
    get('/api/transcript', d => setTranscript(Array.isArray(d) ? d : []))
    get('/api/trends', setTrends)
  }, [family_id])

  useEffect(() => {
    fetchAll()
    const t = setInterval(fetchAll, 5000)
    return () => clearInterval(t)
  }, [fetchAll])

  const loadSummary = async () => {
    setSummaryLoading(true)
    try {
      const res = await fetch(`${API}/api/summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ family_id }),
      })
      const d = await res.json()
      setSummary(d.summary || '')
    } catch { setSummary('') }
    setSummaryLoading(false)
  }

  const saveContext = async (name) => {
    const text = (draft[name] || '').trim()
    if (!text || savingRef.current[name]) return
    savingRef.current[name] = true
    try {
      await fetch(`${API}/api/relations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ family_id, name, context: text }),
      })
      setUnknowns(u => u.filter(x => x.name !== name))
      setDraft(d => ({ ...d, [name]: '' }))
    } catch { savingRef.current[name] = false }
  }

  const frameAge = frame?.captured_at
    ? Math.max(0, Math.round((Date.now() - new Date(frame.captured_at).getTime()) / 1000))
    : null

  return (
    <div className="page page-console">

      <header className="console-head">
        <div>
          <div className="eyebrow">Looking in on</div>
          <div className="console-title">{elderName}</div>
        </div>
        <div className="clocks">
          <div className="clock her">
            <span className="tile accent"><Icon name="sun" size={17} /></span>
            <div>
              <div className="clock-value">{there}</div>
              <div className="clock-label">Her time</div>
            </div>
          </div>
          <div className="clock">
            <span className="tile"><Icon name="monitor" size={16} /></span>
            <div>
              <div className="clock-value">{here}</div>
              <div className="clock-label">Yours</div>
            </div>
          </div>
        </div>
      </header>

      <div style={{
        display: 'grid', gap: 14,
        gridTemplateColumns: 'minmax(280px, 1fr) minmax(320px, 1.1fr) minmax(320px, 1.2fr)',
        alignItems: 'start',
      }}>

        {/* Live view, day, medicine */}
        <div style={{ display: 'grid', gap: 14 }}>
          <Panel title="Her room" icon="camera"
            note={frameAge === null
              ? <span className="pill quiet">No signal</span>
              : <span className="pill ok live">{frameAge}s ago</span>}>
            <div className="room">
              {frame?.image
                ? <img src={frame.image} alt={`${elderName}'s room`} />
                : <div className="empty center">
                    <Icon name="cameraOff" size={22} />
                    Her screen is not open right now
                  </div>}
            </div>
          </Panel>

          <Panel title="What she's saying" icon="message"
            note={transcript.length ? `${transcript.length} lines today` : 'quiet'}>
            <div ref={scrollRef} className="transcript">
              {transcript.length === 0 && (
                <div className="empty">She has not said anything today.</div>
              )}
              {transcript.map((line, i) => (
                <div key={i} className={`line${line.speaker === 'elder' ? ' elder' : ''}`}>
                  <div className="line-meta">
                    <b>{line.speaker === 'elder' ? elderName : 'Companion'}</b>
                    {line.ts && ` · ${new Date(line.ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`}
                  </div>
                  <div className="line-text">{line.text}</div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Her day" icon="notebook" note={summaryLoading ? 'writing' : ''}>
            <p className={summary ? '' : 'empty'} style={{ fontSize: 14, lineHeight: 1.65 }}>
              {summary || 'Nothing written up yet for today.'}
            </p>
            <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={loadSummary} disabled={summaryLoading}>
              <Icon name="sparkles" size={15} />
              {summaryLoading ? 'Writing...' : 'Write today up'}
            </button>
          </Panel>

          <Panel title="Medicine" icon="pill" note="from what she said">
            {meds.length === 0 && <div className="empty">Nothing logged today.</div>}
            <div className="row-list">
              {meds.map((m, i) => (
                <div key={i} className="med-row">
                  <div>
                    <div className="med-name">{m.medicine_name}</div>
                    <div className="sub num">{m.scheduled_time}</div>
                  </div>
                  <span className={`pill ${m.taken ? 'ok' : 'danger'}`}>
                    {m.taken ? 'Said yes' : 'No answer'}
                  </span>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        {/* Unknown people, patterns */}
        <div style={{ display: 'grid', gap: 14 }}>
          <Panel title="People we don't know" icon="userQuestion" tone="accent"
            note={unknowns.length
              ? <span className="pill accent">{unknowns.length} waiting</span>
              : <span className="pill ok">Clear</span>}>
            {unknowns.length === 0 && (
              <div className="empty center">
                <span className="tile ok"><Icon name="checkCircle" size={18} /></span>
                Every name she used today was one we already knew.
              </div>
            )}
            {unknowns.map(p => (
              <article key={p.name} className="person">
                <div className="person-head">
                  <span className="monogram">{p.name.slice(0, 2)}</span>
                  <div>
                    <div className="person-name">{p.name}</div>
                    {p.first_heard && <div className="sub">First heard {p.first_heard}</div>}
                  </div>
                  <div className="mentions">
                    <div className="mentions-value">{p.mentions}</div>
                    <div className="mentions-label">MENTIONS</div>
                  </div>
                </div>

                {(p.quotes || []).slice(0, 3).map((q, i) => (
                  <div key={i} className="quote">"{q}"</div>
                ))}

                <textarea
                  className="field"
                  value={draft[p.name] || ''}
                  onChange={e => setDraft(d => ({ ...d, [p.name]: e.target.value }))}
                  placeholder={`Who is ${p.name}?`}
                  rows={2}
                  style={{ marginTop: 12 }}
                />
                <button className="btn btn-primary" style={{ marginTop: 8 }} onClick={() => saveContext(p.name)}>
                  <Icon name="check" size={15} />
                  Teach the companion
                </button>
              </article>
            ))}
          </Panel>

          <Panel title="Patterns" icon="activity" note="last 30 days">
            {!trends && <div className="empty">Not enough history yet.</div>}
            {trends && (
              <>
                <div className="kpis">
                  <Stat
                    icon="message"
                    label="Repeated questions today"
                    value={trends.repeats_today}
                    compare={`avg ${trends.repeats_avg} a day`}
                    alarm={trends.repeats_today > trends.repeats_avg * 1.5}
                  />
                  <Stat
                    icon="pill"
                    label="Medicine confirmed"
                    value={`${trends.adherence_pct}%`}
                    compare={`${trends.adherence_days} days tracked`}
                  />
                </div>
                <Unsettled hours={trends.distress_by_hour || []} />
              </>
            )}
          </Panel>
        </div>

        {/* Ask anything */}
        <Panel
          title="Ask about her"
          icon="sparkles"
          tone="accent"
          note={<a href={LIBRECHAT_URL} target="_blank" rel="noreferrer" className="link">
            Open full screen <Icon name="arrowUpRight" size={13} />
          </a>}
          style={{ position: 'sticky', top: 16, height: 'calc(100vh - 140px)' }}
        >
          <iframe src={LIBRECHAT_URL} title="Ask about her" className="frame" />
        </Panel>
      </div>
    </div>
  )
}

const Stat = ({ icon, label, value, compare, alarm }) => (
  <div className={`kpi${alarm ? ' alarm' : ''}`}>
    <span className={`tile sm ${alarm ? 'danger' : ''}`}><Icon name={icon} size={15} /></span>
    <div className="kpi-value">{value}</div>
    <div className="kpi-label">{label}</div>
    <div className="sub">{compare}</div>
  </div>
)

const hourLabel = h => `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`

function Unsettled({ hours }) {
  const hot = hours.map((v, h) => (v > 0.6 ? h : -1)).filter(h => h >= 0)
  const peak = hot.length
    ? (hot.length === 1 ? hourLabel(hot[0]) : `${hourLabel(hot[0])} to ${hourLabel(hot[hot.length - 1] + 1)}`)
    : null

  return (
    <div className="chart">
      <div className="chart-head">
        <div className="eyebrow">Unsettled by hour, her time</div>
        {peak
          ? <span className="pill accent">Peak {peak}</span>
          : <span className="pill ok">Settled all day</span>}
      </div>
      <div className="bars">
        {hours.map((v, h) => (
          <div key={h} title={`${hourLabel(h)}: ${Math.round(v * 100)}%`}
            className={`bar${v > 0.6 ? ' hot' : ''}${v < 0.05 ? ' zero' : ''}`}
            style={{ height: `${Math.max(3, v * 100)}%` }} />
        ))}
      </div>
      <div className="bars-axis"><span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>11pm</span></div>
    </div>
  )
}
