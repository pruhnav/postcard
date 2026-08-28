import { useState, useEffect, useRef, useCallback } from 'react'

const API = process.env.REACT_APP_API || 'http://localhost:3001'

// How often we push a still frame to the family console.
const FRAME_INTERVAL_MS = 5000
const FRAME_W = 320
const FRAME_H = 240

export default function Parent() {
  const stored = JSON.parse(localStorage.getItem('family') || '{}')
  const family_id = localStorage.getItem('family_id') || 'demo'

  const [family, setFamily] = useState(stored)
  const [tavusUrl, setTavusUrl] = useState('')
  const [tavusLoading, setTavusLoading] = useState(true)
  const [tavusError, setTavusError] = useState('')
  const [cameraOn, setCameraOn] = useState(false)
  const [reminder, setReminder] = useState(null)
  const [time, setTime] = useState('')
  const [date, setDate] = useState('')

  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const connectedRef = useRef(false)

  const elderName = family.elder_name || family.parent_name || 'Amama'
  const childName = family.speaker_name || family.child_name || 'your family'

  // Clock
  useEffect(() => {
    const tick = () => {
      const now = new Date()
      setTime(now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }))
      setDate(now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }))
    }
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [])

  // Family context
  useEffect(() => {
    fetch(`${API}/api/family?family_id=${family_id}`)
      .then(r => r.json())
      .then(d => { if (d && !d.error) setFamily(d) })
      .catch(() => {})
  }, [family_id])

  // Connect to Tavus ONCE — never restart mid-session
  useEffect(() => {
    if (connectedRef.current) return
    connectedRef.current = true

    fetch(`${API}/api/tavus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ family_id }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.conversation_url) setTavusUrl(d.conversation_url)
        else setTavusError(d.error || 'Companion unavailable right now')
        setTavusLoading(false)
      })
      .catch(() => { setTavusError('Could not reach server'); setTavusLoading(false) })
  }, [family_id])

  // Camera — self view, and stills for the family console
  useEffect(() => {
    let stream
    navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false })
      .then(s => {
        stream = s
        if (videoRef.current) videoRef.current.srcObject = s
        setCameraOn(true)
      })
      .catch(() => setCameraOn(false))
    return () => stream && stream.getTracks().forEach(t => t.stop())
  }, [])

  useEffect(() => {
    if (!cameraOn) return
    const send = () => {
      const v = videoRef.current
      const c = canvasRef.current
      if (!v || !c || v.readyState < 2) return
      c.getContext('2d').drawImage(v, 0, 0, FRAME_W, FRAME_H)
      fetch(`${API}/api/frame`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ family_id, image: c.toDataURL('image/jpeg', 0.5) }),
      }).catch(() => {})
    }
    const t = setInterval(send, FRAME_INTERVAL_MS)
    return () => clearInterval(t)
  }, [cameraOn, family_id])

  // Reminders — the server decides what is due and speaks it through the
  // avatar. This screen only shows the words, so she can read what she heard.
  const pollReminders = useCallback(() => {
    fetch(`${API}/api/reminders/due?family_id=${family_id}`)
      .then(r => r.json())
      .then(list => { if (Array.isArray(list) && list.length) setReminder(list[0]) })
      .catch(() => {})
  }, [family_id])

  useEffect(() => {
    pollReminders()
    const t = setInterval(pollReminders, 20000)
    return () => clearInterval(t)
  }, [pollReminders])

  const acknowledge = () => {
    if (!reminder) return
    fetch(`${API}/api/reminders/${reminder.id}/acknowledge`, { method: 'POST' }).catch(() => {})
    setReminder(null)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000', overflow: 'hidden', fontFamily: 'system-ui' }}>

      <canvas ref={canvasRef} width={FRAME_W} height={FRAME_H} style={{ display: 'none' }} />

      {/* Loading screen */}
      {tavusLoading && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          background: 'linear-gradient(135deg, #0f0f1a, #1a1a3e)'
        }}>
          <div style={{ fontSize: 72, marginBottom: 24 }}>🌸</div>
          <div style={{ color: '#fff', fontSize: 26, fontWeight: 700, marginBottom: 12 }}>
            Starting your companion...
          </div>
          <div style={{ color: '#a0a0c0', fontSize: 16 }}>Please wait a moment, {elderName}</div>
          <div style={{
            marginTop: 36, width: 48, height: 48,
            border: '4px solid #7c3aed', borderTopColor: 'transparent',
            borderRadius: '50%', animation: 'spin 1s linear infinite'
          }} />
        </div>
      )}

      {/* Tavus video companion — fullscreen, stays connected */}
      {tavusUrl && !tavusLoading && (
        <iframe
          key={tavusUrl}
          src={tavusUrl}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none' }}
          allow="camera; microphone; autoplay; display-capture"
          title="AI Companion"
        />
      )}

      {/* Error screen */}
      {!tavusLoading && tavusError && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          background: 'linear-gradient(135deg, #0f0f1a, #1a1a3e)', padding: 40
        }}>
          <div style={{ fontSize: 64, marginBottom: 20 }}>💙</div>
          <div style={{ color: '#fff', fontSize: 24, fontWeight: 700, textAlign: 'center', marginBottom: 12 }}>
            {elderName}, {childName} will be right with you
          </div>
          <div style={{ color: '#a0a0c0', fontSize: 16, textAlign: 'center', maxWidth: 360, lineHeight: 1.6 }}>
            We are getting things ready. Please sit comfortably.
          </div>
          <div style={{ marginTop: 24, color: '#6b7280', fontSize: 13 }}>{time} · {date}</div>
        </div>
      )}

      {/* Clock overlay */}
      {tavusUrl && !tavusLoading && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, pointerEvents: 'none',
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, transparent 100%)',
          padding: '14px 22px'
        }}>
          <div style={{ color: '#fff', fontSize: 26, fontWeight: 700, textShadow: '0 2px 8px rgba(0,0,0,0.8)' }}>{time}</div>
          <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: 13, marginTop: 2, textShadow: '0 1px 4px rgba(0,0,0,0.8)' }}>{date}</div>
        </div>
      )}

      {/* Self view */}
      <div style={{
        position: 'absolute', right: 24, bottom: 24,
        width: 196, height: 147, borderRadius: 12, overflow: 'hidden',
        background: '#000', border: '1px solid rgba(255,255,255,0.15)',
        boxShadow: '0 4px 24px rgba(0,0,0,0.4)'
      }}>
        <video
          ref={videoRef} autoPlay muted playsInline
          style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }}
        />
        {!cameraOn && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center', color: '#6b7280', fontSize: 14
          }}>
            Camera is off
          </div>
        )}
        <div style={{ position: 'absolute', left: 10, bottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: cameraOn ? '#4caf50' : '#6b7280' }} />
          <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12, textShadow: '0 1px 4px rgba(0,0,0,0.8)' }}>You</div>
        </div>
      </div>

      {/* Reminder — stays until she presses Done */}
      {reminder && (
        <div style={{
          position: 'absolute', bottom: 36, left: '50%', transform: 'translateX(-50%)',
          width: 'min(600px, calc(100vw - 280px))',
          background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(12px)',
          border: '1px solid #fbbf24', borderRadius: 20,
          padding: '22px 26px', display: 'flex', alignItems: 'center', gap: 20,
          boxShadow: '0 4px 24px rgba(0,0,0,0.4)'
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ color: '#fbbf24', fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
              {reminder.kind === 'medicine' ? '💊 Medicine' : '🔔 Reminder'}
            </div>
            <div style={{ color: '#fff', fontSize: 26, fontWeight: 700, lineHeight: 1.3 }}>
              {reminder.text}
            </div>
          </div>
          <button
            onClick={acknowledge}
            style={{
              background: '#7c3aed', color: '#fff', border: 'none',
              borderRadius: 12, padding: '16px 28px',
              fontSize: 20, fontWeight: 700, fontFamily: 'system-ui', cursor: 'pointer',
              minWidth: 120
            }}
          >
            Done
          </button>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
