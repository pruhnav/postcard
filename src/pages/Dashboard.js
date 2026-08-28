import { useState, useEffect, useCallback, useRef } from 'react'

const API = process.env.REACT_APP_API || 'http://localhost:3001'
const LIBRECHAT_URL = process.env.REACT_APP_LIBRECHAT_URL || 'http://localhost:3080'

const card = {
  background: 'rgba(20,20,45,0.5)',
  border: '1px solid #1e3a5f',
  borderRadius: 12,
  padding: 16,
}

const label = { color: '#a0a0c0', fontSize: 13, fontWeight: 600, marginBottom: 10 }

function Panel({ title, note, children, style }) {
  return (
    <section style={{ ...card, display: 'flex', flexDirection: 'column', minHeight: 0, ...style }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={label}>{title}</div>
        {note && <div style={{ color: '#6b7280', fontSize: 11 }}>{note}</div>}
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>{children}</div>
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
    <div style={{
      minHeight: '100vh', background: '#0a0a14', color: '#fff',
      fontFamily: 'system-ui', padding: '20px 22px 72px',
    }}>

      <header style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
        paddingBottom: 16, borderBottom: '1px solid #1e3a5f', marginBottom: 18,
      }}>
        <div>
          <div style={{ color: '#6b7280', fontSize: 12 }}>Looking in on</div>
          <div style={{ fontSize: 26, fontWeight: 700, marginTop: 2 }}>{elderName}</div>
        </div>
        <div style={{ display: 'flex', gap: 30, textAlign: 'right' }}>
          <div>
            <div style={{ fontSize: 24, fontWeight: 700, color: '#fbbf24' }}>{there}</div>
            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>Her time</div>
          </div>
          <div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{here}</div>
            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>Yours</div>
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
          <Panel title="Her room" note={frameAge === null ? 'no signal' : `${frameAge}s ago`}>
            <div style={{
              aspectRatio: '4 / 3', borderRadius: 8, overflow: 'hidden',
              background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {frame?.image
                ? <img src={frame.image} alt={`${elderName}'s room`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <span style={{ color: '#4b5563', fontSize: 14 }}>Her screen is not open right now</span>}
            </div>
          </Panel>

          <Panel title="What she's saying" note={transcript.length ? `${transcript.length} lines today` : 'quiet'}>
            <div ref={scrollRef} style={{ maxHeight: 260, overflowY: 'auto', paddingRight: 4 }}>
              {transcript.length === 0 && (
                <div style={{ color: '#4b5563', fontSize: 14 }}>She has not said anything today.</div>
              )}
              {transcript.map((line, i) => (
                <div key={i} style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 2 }}>
                    {line.speaker === 'elder' ? elderName : 'Companion'}
                    {line.ts && ` · ${new Date(line.ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`}
                  </div>
                  <div style={{
                    fontSize: 14, lineHeight: 1.5,
                    color: line.speaker === 'elder' ? '#fff' : '#a0a0c0',
                    paddingLeft: 10,
                    borderLeft: `2px solid ${line.speaker === 'elder' ? '#fbbf24' : '#1e3a5f'}`,
                  }}>
                    {line.text}
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Her day" note={summaryLoading ? 'writing' : ''}>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.65, color: summary ? '#fff' : '#4b5563' }}>
              {summary || 'Nothing written up yet for today.'}
            </p>
            <button
              onClick={loadSummary}
              disabled={summaryLoading}
              style={{
                marginTop: 12, background: '#7c3aed', color: '#fff', border: 'none',
                borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 600,
                fontFamily: 'system-ui', cursor: 'pointer',
              }}
            >
              {summaryLoading ? 'Writing...' : 'Write today up'}
            </button>
          </Panel>

          <Panel title="Medicine" note="from what she said">
            {meds.length === 0 && <div style={{ color: '#4b5563', fontSize: 14 }}>Nothing logged today.</div>}
            {meds.map((m, i) => (
              <div key={i} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '9px 0', borderBottom: i < meds.length - 1 ? '1px solid #1e3a5f' : 'none',
              }}>
                <div>
                  <div style={{ fontSize: 14 }}>{m.medicine_name}</div>
                  <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{m.scheduled_time}</div>
                </div>
                <span style={{
                  fontSize: 12, padding: '4px 10px', borderRadius: 6,
                  background: m.taken ? '#0d2818' : '#2d0a0a',
                  color: m.taken ? '#4caf50' : '#f87171',
                  border: `1px solid ${m.taken ? '#1a5c2e' : '#7f1d1d'}`,
                }}>
                  {m.taken ? 'Said yes' : 'No answer'}
                </span>
              </div>
            ))}
          </Panel>
        </div>

        {/* Unknown people, patterns */}
        <div style={{ display: 'grid', gap: 14 }}>
          <Panel title="People we don't know" note={unknowns.length ? `${unknowns.length} waiting` : 'clear'}>
            {unknowns.length === 0 && (
              <div style={{ color: '#4b5563', fontSize: 14, textAlign: 'center', padding: 20 }}>
                Every name she used today was one we already knew 🎉
              </div>
            )}
            {unknowns.map(p => (
              <article key={p.name} style={{
                background: 'rgba(124,58,237,0.08)',
                border: '1px solid #1e3a5f', borderLeft: '3px solid #fbbf24',
                borderRadius: 8, padding: 14, marginBottom: 10,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <div style={{ fontSize: 20, fontWeight: 700 }}>{p.name}</div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: '#fbbf24' }}>{p.mentions}</div>
                    <div style={{ fontSize: 10, color: '#6b7280' }}>MENTIONS</div>
                  </div>
                </div>

                {p.first_heard && (
                  <div style={{ fontSize: 11, color: '#6b7280', marginTop: 3 }}>first heard {p.first_heard}</div>
                )}

                {(p.quotes || []).slice(0, 3).map((q, i) => (
                  <div key={i} style={{
                    marginTop: 10, paddingLeft: 10, borderLeft: '2px solid #1e3a5f',
                    fontSize: 13, lineHeight: 1.5, color: '#a0a0c0', fontStyle: 'italic',
                  }}>
                    "{q}"
                  </div>
                ))}

                <textarea
                  value={draft[p.name] || ''}
                  onChange={e => setDraft(d => ({ ...d, [p.name]: e.target.value }))}
                  placeholder={`Who is ${p.name}?`}
                  rows={2}
                  style={{
                    width: '100%', marginTop: 12, boxSizing: 'border-box',
                    background: '#0a0a14', color: '#fff',
                    border: '1px solid #1e3a5f', borderRadius: 8,
                    padding: 10, fontSize: 14, fontFamily: 'system-ui', resize: 'vertical',
                  }}
                />
                <button
                  onClick={() => saveContext(p.name)}
                  style={{
                    marginTop: 8, background: '#7c3aed', color: '#fff', border: 'none',
                    borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 600,
                    fontFamily: 'system-ui', cursor: 'pointer',
                  }}
                >
                  Teach the companion
                </button>
              </article>
            ))}
          </Panel>

          <Panel title="Patterns" note="last 30 days">
            {!trends && <div style={{ color: '#4b5563', fontSize: 14 }}>Not enough history yet.</div>}
            {trends && (
              <>
                <Stat
                  label="Repeated questions today"
                  value={trends.repeats_today}
                  compare={`avg ${trends.repeats_avg} a day`}
                  alarm={trends.repeats_today > trends.repeats_avg * 1.5}
                />
                <Stat
                  label="Medicine confirmed"
                  value={`${trends.adherence_pct}%`}
                  compare={`${trends.adherence_days} days tracked`}
                />
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 8 }}>UNSETTLED BY HOUR, HER TIME</div>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 56 }}>
                    {(trends.distress_by_hour || []).map((v, h) => (
                      <div key={h} title={`${h}:00`} style={{
                        flex: 1, height: `${Math.max(3, v * 100)}%`,
                        background: v > 0.6 ? '#f87171' : '#1e3a5f', borderRadius: 2,
                      }} />
                    ))}
                  </div>
                </div>
              </>
            )}
          </Panel>
        </div>

        {/* Ask anything */}
        <Panel title="Ask about her" note="LibreChat" style={{ height: 'calc(100vh - 130px)' }}>
          <iframe
            src={LIBRECHAT_URL}
            title="Ask about her"
            style={{ width: '100%', height: '100%', border: 'none', borderRadius: 8, background: '#0a0a14' }}
          />
        </Panel>
      </div>
    </div>
  )
}

const Stat = ({ label, value, compare, alarm }) => (
  <div style={{
    display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
    padding: '10px 0', borderBottom: '1px solid #1e3a5f',
  }}>
    <div>
      <div style={{ fontSize: 14 }}>{label}</div>
      <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{compare}</div>
    </div>
    <div style={{ fontSize: 26, fontWeight: 700, color: alarm ? '#f87171' : '#fff' }}>{value}</div>
  </div>
)
