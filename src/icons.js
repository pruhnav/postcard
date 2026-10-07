// Stroke icons, lucide-style geometry (ISC license). One component, keyed by name.

const paths = {
  camera: <><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z" /><circle cx="12" cy="13" r="3" /></>,
  cameraOff: <><path d="M2 2l20 20" /><path d="M7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16" /><path d="M9.5 4h5L17 7h3a2 2 0 0 1 2 2v7.5" /><path d="M14.12 15.12A3 3 0 1 1 9.88 10.88" /></>,
  message: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" />,
  notebook: <><path d="M2 6h4" /><path d="M2 10h4" /><path d="M2 14h4" /><path d="M2 18h4" /><rect x="4" y="2" width="16" height="20" rx="2" /><path d="M15 2v20" /></>,
  pill: <><path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z" /><path d="m8.5 8.5 7 7" /></>,
  userQuestion: <><circle cx="9" cy="7" r="4" /><path d="M3 21v-2a4 4 0 0 1 4-4h4" /><path d="M16.5 14.5a2 2 0 1 1 2.8 1.84c-.5.22-.8.7-.8 1.24V18" /><path d="M18.5 21h.01" /></>,
  activity: <path d="M22 12h-4l-3 9L9 3l-3 9H2" />,
  sparkles: <><path d="M9.94 15.5A2 2 0 0 0 8.5 14.06L2.37 12.48a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.13a.5.5 0 0 1 .96 0l1.58 6.13a2 2 0 0 0 1.44 1.44l6.13 1.58a.5.5 0 0 1 0 .96L15.5 14.06a2 2 0 0 0-1.44 1.44l-1.58 6.13a.5.5 0 0 1-.96 0Z" /><path d="M20 3v4" /><path d="M22 5h-4" /></>,
  arrowUpRight: <><path d="M7 7h10v10" /><path d="M7 17 17 7" /></>,
  check: <path d="M20 6 9 17l-5-5" />,
  checkCircle: <><circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" /></>,
  bell: <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></>,
  heart: <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />,
  users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>,
  bookmark: <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z" />,
  pen: <><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></>,
  plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
  layout: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18" /><path d="M9 21V9" /></>,
  sliders: <><path d="M4 21v-7" /><path d="M4 10V3" /><path d="M12 21v-9" /><path d="M12 8V3" /><path d="M20 21v-5" /><path d="M20 12V3" /><path d="M2 14h4" /><path d="M10 8h4" /><path d="M18 16h4" /></>,
  monitor: <><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8" /><path d="M12 17v4" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" /></>,
  lock: <><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>,
}

export default function Icon({ name, size = 16, stroke = 1.75, ...rest }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {paths[name]}
    </svg>
  )
}

// Postcard's mark: an amber postage stamp with perforated edges and a serif P.
export function Logo({ size = 26 }) {
  const holes = []
  for (let i = 0; i < 5; i++) {
    const p = 4.5 + i * 3.75
    holes.push(<circle key={`t${i}`} cx={p} cy="1" r="1.1" />, <circle key={`b${i}`} cx={p} cy="23" r="1.1" />,
      <circle key={`l${i}`} cx="1" cy={p} r="1.1" />, <circle key={`r${i}`} cx="23" cy={p} r="1.1" />)
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <mask id="stamp-perf">
        <rect width="24" height="24" fill="#fff" />
        <g fill="#000">{holes}</g>
      </mask>
      <rect width="24" height="24" rx="2" fill="#f2b544" mask="url(#stamp-perf)" />
      <rect x="3.6" y="3.6" width="16.8" height="16.8" rx="1.2" fill="none" stroke="#2a1c00" strokeOpacity=".28" strokeWidth=".7" />
      <text x="12" y="16.6" textAnchor="middle" fontFamily="Lora, Georgia, serif" fontWeight="700" fontSize="12.5" fill="#2a1c00">P</text>
    </svg>
  )
}
