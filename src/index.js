import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

// When the API is behind an ngrok free tunnel, plain browser requests get
// ngrok's HTML interstitial instead of our JSON. This header skips it.
const API = process.env.REACT_APP_API || ''
if (/ngrok-free\.dev|ngrok\.io|ngrok\.app/.test(API)) {
  const original = window.fetch.bind(window)
  window.fetch = (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || ''
    if (url.startsWith(API)) {
      init = { ...init, headers: { ...(init.headers || {}), 'ngrok-skip-browser-warning': 'true' } }
    }
    return original(input, init)
  }
}

const root = ReactDOM.createRoot(document.getElementById('root'))
root.render(<React.StrictMode><App /></React.StrictMode>)
