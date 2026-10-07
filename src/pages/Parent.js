import { useState, useEffect, useRef, useCallback } from 'react'
import Icon from '../icons'

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

  // Connect to Tavus ONCE, never restart mid-session
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

  // Camera: self view, and stills for the family console
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

  // Reminders: the server decides what is due and speaks it through the
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
    <div className="her-screen">

      <canvas ref={canvasRef} width={FRAME_W} height={FRAME_H} style={{ display: 'none' }} />

      {/* Loading screen */}
      {tavusLoading && (
        <div className="her-splash">
          <div className="halo"><Icon name="heart" size={38} stroke={1.6} /></div>
          <div className="her-splash-title">Starting your companion...</div>
          <div className="her-splash-sub">Please wait a moment, {elderName}</div>
          <div className="spinner" />
        </div>
      )}

      {/* Tavus video companion, fullscreen, stays connected */}
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
        <div className="her-splash">
          <div className="halo"><Icon name="heart" size={38} stroke={1.6} /></div>
          <div className="her-splash-title">
            {elderName}, {childName} will be right with you
          </div>
          <div className="her-splash-sub">
            We are getting things ready. Please sit comfortably.
          </div>
          <div className="her-splash-time">{time} · {date}</div>
        </div>
      )}

      {/* Clock overlay */}
      {tavusUrl && !tavusLoading && (
        <div className="her-clock">
          <div className="her-clock-time">{time}</div>
          <div className="her-clock-date">{date}</div>
        </div>
      )}

      {/* Self view */}
      <div className="selfview">
        <video ref={videoRef} autoPlay muted playsInline />
        {!cameraOn && (
          <div className="selfview-off">
            <Icon name="cameraOff" size={20} />
            Camera is off
          </div>
        )}
        <div className="selfview-tag">
          <span className={`dot${cameraOn ? ' on' : ''}`} />
          You
        </div>
      </div>

      {/* Reminder, stays until she presses Done */}
      {reminder && (
        <div className="reminder">
          <span className="tile accent">
            <Icon name={reminder.kind === 'medicine' ? 'pill' : 'bell'} size={26} />
          </span>
          <div style={{ flex: 1 }}>
            <div className="reminder-kind">{reminder.kind === 'medicine' ? 'Medicine' : 'Reminder'}</div>
            <div className="reminder-text">{reminder.text}</div>
          </div>
          <button className="btn btn-primary" onClick={acknowledge}>
            <Icon name="check" size={22} stroke={2.4} />
            Done
          </button>
        </div>
      )}
    </div>
  )
}
