import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import warmParchment from '../warmParchmentTheme'

// ── Inject theme colors as CSS variables ──
const root = document.documentElement
for (const [key, value] of Object.entries(warmParchment.colors)) {
  root.style.setProperty(`--wp-${key.replace(/([A-Z])/g, '-$1').toLowerCase()}`, value as string)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
