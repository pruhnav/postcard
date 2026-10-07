import { BrowserRouter, Routes, Route, NavLink, useLocation } from 'react-router-dom'
import Setup from './pages/Setup'
import Parent from './pages/Parent'
import Dashboard from './pages/Dashboard'
import Icon, { Logo } from './icons'

const links = [
  ['/setup', 'Context', 'sliders'],
  ['/console', 'Console', 'layout'],
  ['/her', 'Her screen', 'monitor'],
]

function Nav() {
  // Her screen is the whole screen. Nothing floats over it.
  const { pathname } = useLocation()
  if (pathname === '/her') return null

  return (
    <nav className="nav">
      <div className="nav-brand"><Logo size={22} />Postcard</div>
      {links.map(([to, label, icon]) => (
        <NavLink key={to} to={to} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
          <Icon name={icon} size={15} />
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
