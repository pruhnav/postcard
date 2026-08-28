import { BrowserRouter, Routes, Route, NavLink, useLocation } from 'react-router-dom'
import Setup from './pages/Setup'
import Parent from './pages/Parent'
import Dashboard from './pages/Dashboard'

const links = [
  ['/setup', 'Context'],
  ['/console', 'Console'],
  ['/her', 'Her screen'],
]

function Nav() {
  // Her screen is the whole screen. Nothing floats over it.
  const { pathname } = useLocation()
  if (pathname === '/her') return null

  return (
    <nav style={{
      position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 99,
      background: 'rgba(10,10,20,0.95)', backdropFilter: 'blur(12px)', borderTop: '1px solid #1e3a5f',
      display: 'flex', justifyContent: 'center', gap: 28, padding: '12px 0',
    }}>
      {links.map(([to, label]) => (
        <NavLink key={to} to={to} style={({ isActive }) => ({
          color: isActive ? '#fff' : '#6b7280',
          textDecoration: 'none', fontSize: 13,
          fontWeight: isActive ? 600 : 400,
          fontFamily: 'system-ui, sans-serif',
        })}>
          {label}
        </NavLink>
      ))}
    </nav>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/setup" element={<Setup />} />
        <Route path="/console" element={<Dashboard />} />
        <Route path="/her" element={<Parent />} />
        <Route path="/parent" element={<Parent />} />
        <Route path="/dashboard" element={<Dashboard />} />
      </Routes>
      <Nav />
    </BrowserRouter>
  )
}
